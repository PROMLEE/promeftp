const path = require('node:path');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createHash } = require('node:crypto');
const { stripVTControlCharacters } = require('node:util');
const openssh = require('./openssh.cjs');
const { compileTrigger, scanTriggers } = require('./terminal-triggers.cjs');
const { problem } = require('./agent-service.cjs');

const limit = 16 * 1024 * 1024;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function eligible(p) {
  return !p.usesAlias && !p.configPath && /^[\w][\w.:%-]*$/.test(p.host) &&
    /^[a-zA-Z0-9_][\w.-]*$/.test(p.username) && (!p.keyPath || path.isAbsolute(p.keyPath) && !/[%\r\n]/.test(p.keyPath));
}
function command(value) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 1024 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) throw problem('INVALID_COMMAND');
  return value;
}

function createTransport({ state, readAnswer, authScope, validAuthAnswer, matchesGlobalPattern, snippetScope, directory, approve, knownHosts }) {
  function catalog(p) {
    const scope = snippetScope({ mode: 'ssh', input: p });
    return {
      pam: (state().globalAuthRules || []).map(({ id, prompt }) => ({ id, name: prompt })),
      triggers: (state().terminalTriggers || []).filter(t => !t.scope || t.scope === scope)
        .map(({ id, name }) => ({ id, name })),
    };
  }
  function validateGrant(value, p) {
    const choices = catalog(p);
    function selected(field) {
      const ids = value[field] ?? [];
      if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => !choices[field].some(item => item.id === id))) throw problem('INVALID_REQUEST');
      return [...new Set(ids)];
    }
    const task = value.task ? { name: value.task.name, command: command(value.task.command) } : undefined;
    if (task && (typeof task.name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(task.name))) throw problem('INVALID_TASK');
    if (value.sftp === false && !task && value.commandApproval !== true) throw problem('INVALID_REQUEST');
    return { sftp: value.sftp !== false, download: value.sftp !== false && value.download === true, savedAuth: value.savedAuth === true,
      commandApproval: value.commandApproval === true, pam: selected('pam'), triggers: selected('triggers'), ...(task && { task }) };
  }

  async function connect(p, grant, mode, notify, check, signal) {
    if (!eligible(p)) throw problem('PROFILE_NOT_ELIGIBLE');
    const { host, username, port, keyPath, pam } = p;
    const config = { host, username, port, keyPath, pam, configPath: '/dev/null', knownHosts };
    const original = { ...config, configPath: '' };
    const endpoint = grant.savedAuth ? await openssh.effective(config) : '';
    check();
    const scope = endpoint && authScope(original, endpoint);
    let connection;
    let authenticated = false;
    const answered = new Set();
    const onEvent = (event, value) => {
      if (signal.aborted) return;
      if (event === 'ready') { authenticated = true; notify(event); return; }
      if (event === 'closed' || event === 'prompt-clear') { notify(event, value); return; }
      if (event === 'error') { notify(event, 'CONNECTION_FAILED'); return; }
      if (event !== 'prompt') return;
      const handle = async () => {
        check();
        if (value.hostKey) {
          notify('error', 'HOST_KEY_REJECTED');
          connection?.answer(value.id, 'no');
          return;
        }
        if (!authenticated && value.targetProcess && value.canRemember && state().useStoredAuthOnConnect !== false) {
          const question = value.prompt.replace(/^\([^\r\n)]{1,512}\) /, '');
          const key = endpoint && digest([host, '', keyPath || '', endpoint, value.prompt]);
          const saved = grant.savedAuth && state().useSavedRepliesAutomatically !== false && key && state().authReplies?.[key];
          const rules = (state().globalAuthRules || []).filter(rule => grant.pam.includes(rule.id));
          const global = rules.find(rule => rule.match !== 'regex' && (rule.prompt === value.prompt || rule.prompt === question))
            || rules.find(rule => rule.match === 'regex' && matchesGlobalPattern(rule, question));
          const entry = saved?.scope === scope && saved ? saved : global;
          const used = global === entry ? global?.id : key;
          if (entry && !answered.has(question) && !answered.has(used)) {
            const answer = await readAnswer(entry).catch(() => '');
            check();
            const latest = global === entry ? state().globalAuthRules?.find(rule => rule.id === used) : state().authReplies?.[key];
            if (latest === entry && state().useStoredAuthOnConnect !== false &&
                (global === entry || state().useSavedRepliesAutomatically !== false) && validAuthAnswer(answer)) {
              notify('auth.rule', used);
              if (connection?.answer(value.id, answer)) {
                answered.add(question);
                answered.add(used);
                return;
              }
            }
          }
        }
        notify('prompt', value);
      };
      handle().catch(() => { if (!signal.aborted) notify('prompt', value); });
    };
    // Keep credentials on the authentication channel. Never stream the master PTY to a client.
    let password = '';
    if (scope && state().useStoredAuthOnConnect !== false) {
      const entry = state().sshPasswords?.[scope];
      if (entry) {
        const answer = await readAnswer(entry).catch(() => '');
        check();
        if (entry === state().sshPasswords?.[scope] && state().useStoredAuthOnConnect !== false && validAuthAnswer(answer)) {
          password = answer;
        }
      }
    }
    const auditPassword = () => notify('auth.rule', 'saved-password');
    connection = await openssh.start(config, mode === 'ssh' ? 'exec' : mode, {}, onEvent, [],
      'yes', false, password, auditPassword, true);
    if (signal.aborted) connection.close();
    return connection;
  }

  function run(s, value, notify) {
    const child = s.connection.exec(value, s.controller.signal);
    const scope = snippetScope({ mode: 'ssh', input: state().profiles.find(p => p.id === s.profile) });
    const matches = new Set();
    const rules = (state().terminalTriggers || []).filter(rule =>
      s.grant.triggers.includes(rule.id) && rule.enabled !== false && (!rule.scope || rule.scope === scope))
      .flatMap(rule => { try { return [{ id: rule.id, name: rule.name, regex: compileTrigger(rule.pattern) }]; } catch { return []; } });
    const output = { stdout: '', stderr: '' };
    const tails = { stdout: '', stderr: '' };
    let remaining = 65536;
    let truncated = false;
    for (const key of Object.keys(output)) {
      child[key].setEncoding('utf8');
      child[key].on('data', chunk => {
        if (rules.length) {
          const hit = scanTriggers(tails[key], chunk, rules);
          tails[key] = hit.tail;
          for (const rule of hit.matches) if (!matches.has(rule.id)) {
            matches.add(rule.id);
            notify('trigger.match', JSON.stringify({ id: rule.id, name: rule.name }));
          }
        }
        const bytes = Buffer.from(chunk);
        const count = Math.min(remaining, bytes.length);
        output[key] += bytes.subarray(0, count).toString();
        remaining -= count;
        if (count < bytes.length) {
          truncated = true;
          child.kill();
        }
      });
    }
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({
        stdout: stripVTControlCharacters(output.stdout), stderr: stripVTControlCharacters(output.stderr),
        exitCode: code, signal, truncated,
      }));
    });
  }

  async function download(s, remote, channel) {
    const base = path.join(directory, 'downloads');
    await fs.mkdir(base, { recursive: true, mode: 0o700 });
    const now = Date.now();
    for (const dir of await fs.readdir(base, { withFileTypes: true })) {
      if (!dir.isDirectory() || !dir.name.startsWith('file-')) continue;
      const target = path.join(base, dir.name);
      const info = await fs.lstat(target).catch(() => null);
      if (info?.isDirectory() && now - info.mtimeMs > 86400000) await fs.rm(target, { recursive: true, force: true });
    }
    if ((await fs.readdir(base)).length >= 64) throw problem('FILE_LIMIT');
    const folder = await fs.mkdtemp(path.join(base, 'file-'));
    const localPath = path.join(folder, path.posix.basename(remote));
    let bytes = 0;
    const counter = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > limit) callback(problem('FILE_LIMIT'));
      else callback(null, chunk);
    } });
    try {
      await pipeline(channel.createReadStream(remote), counter, createWriteStream(localPath, { flags: 'wx', mode: 0o600 }),
        { signal: s.controller.signal });
      return { path: localPath, bytes };
    } catch (error) {
      await fs.rm(folder, { recursive: true, force: true });
      throw error;
    }
  }
  return { eligible, command, catalog, validateGrant, connect, approve, run, download };
}
module.exports = { createTransport };
