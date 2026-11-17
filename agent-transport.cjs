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

// Maps OpenSSH's own failure lines to a stable code. A server banner is printed by the same OpenSSH process, so only
// lines in OpenSSH's own message forms count.
const failureRules = [
  ['HOST_KEY_CHANGED', /REMOTE HOST IDENTIFICATION HAS CHANGED/, 'hostkey', 'The server host key changed. Confirm the change before you trust it again.'],
  ['HOST_KEY_UNKNOWN', /Host key verification failed|No .* host key is known/, 'hostkey', 'Connect once in PromeFTP and trust the host key.'],
  ['DNS_FAILED', /Could not resolve hostname/, 'connect', 'Check the host name.'],
  ['HOST_UNREACHABLE', /No route to host|Network is unreachable/, 'connect', 'Check the network or VPN.'],
  ['CONNECT_TIMEOUT', /Connection timed out|Operation timed out/, 'connect', 'Check firewalls and the port.'],
  ['CONNECTION_REFUSED', /Connection refused/, 'connect', 'Check that sshd is running and the port is correct.'],
  ['PROXY_FAILED', /ProxyCommand|ProxyJump/, 'connect', 'Check ProxyJump or ProxyCommand.'],
  // A handshake reset looks the same whether the server, a firewall, or a jump host caused it, so it stays generic.
  ['CONNECTION_FAILED', /kex_exchange_identification|Connection closed by UNKNOWN/, 'connect', 'The server closed the connection during the handshake. Check the port, access limits, and firewall, and ProxyJump if you use it.'],
  ['AUTH_FAILED', /Permission denied \(|Too many authentication failures/, 'auth', 'Check the key, password, or PAM answers.'],
  ['SFTP_SUBSYSTEM_FAILED', /subsystem request failed|Received message too long/, 'subsystem', 'Check the sftp-server setting and login shell output such as echo in .bashrc.'],
];
// The message forms OpenSSH prints for its own failures. A bare "Connection refused" in a banner does not match.
// OpenSSH prints "user@host: Permission denied (...)." for a failed login, and "Received disconnect from host port n:2: ..."
// or "Disconnected from host port n" when sshd drops the connection (for example after too many attempts).
const sshOwnLine = /^(ssh: |@.*(WARNING: |REMOTE HOST IDENTIFICATION)|[^\s:]+@[^\s:]+: Permission denied \(|Permission denied \(|Host key verification failed\.|REMOTE HOST IDENTIFICATION HAS CHANGED|Received disconnect from \S+ port \d+:\d+: |Disconnected from |kex_exchange_identification: |subsystem request failed on channel|Received message too long|Connection closed by (UNKNOWN|\d))/;
// Keeps the last 20 lines of OpenSSH output, with secrets masked, for the app's own diagnostics view.
function scrubLines(lines) {
  return lines.slice(-20).map(line => line.slice(0, 200).replace(/((?:password|passcode|otp|token|secret)[^:\n]*:\s*).*/i, '$1***'));
}
function classifySshFailure(lines, { exit = null, stage = 'connect' } = {}) {
  const own = lines.filter(line => sshOwnLine.test(line));
  // Rules are checked in order, so the most specific cause wins even when OpenSSH prints a generic line after it.
  for (const [code, pattern, ruleStage, hint] of failureRules) {
    if (own.some(line => pattern.test(line))) return { code, stage: ruleStage, hint, exit };
  }
  return { code: 'CONNECTION_FAILED', stage, hint: 'See the activity log for details.', exit };
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function eligibilityReason(p) {
  if (!/^[\w][\w.:%-]*$/.test(p.host)) return 'Use a valid SSH host name or alias.';
  // PAM gateways commonly encode a route as account@host@account@host.
  // This value is passed to OpenSSH as an argv value, never through a shell.
  if (p.username && !/^[\p{L}\p{N}_@.:%+-]+$/u.test(p.username)) return 'Use a valid SSH username.';
  if (p.keyPath && !(path.isAbsolute(p.keyPath) && !/[%\r\n]/.test(p.keyPath))) return 'Use an absolute path for the identity file.';
  return '';
}
function eligible(p) {
  return !eligibilityReason(p);
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
  // Agent connections never store or ask about new keys. Only a fingerprint the user trusted in the app is accepted.
  function hostKeyDecision(prompt, scope) {
    const info = openssh.parseHostKeyPrompt(prompt);
    if (!info?.fingerprint) return { code: 'HOST_KEY_UNKNOWN' };
    const saved = [`host:${info.host}`, scope].filter(Boolean).map(key => state().trustedHostKeys?.[key]).filter(Boolean);
    if (saved.includes(info.fingerprint)) return { answer: info.accept, host: info.host, fingerprint: info.fingerprint };
    return { code: saved.length ? 'HOST_KEY_CHANGED' : 'HOST_KEY_UNKNOWN',
      detail: { host: info.host, fingerprint: info.fingerprint, ...(saved.length && { trusted: saved[0] }) } };
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

  async function resolve(p, legacy = false) {
    if (!eligible(p)) throw problem('PROFILE_NOT_ELIGIBLE');
    const config = { ...p, configPath: legacy ? '/dev/null' : p.configPath || '', knownHosts };
    const output = await openssh.effectiveOutput(config);
    return { config, endpoint: openssh.authEndpoint(output), route: digest(output) };
  }

  async function connect(p, grant, mode, notify, check, signal) {
    if (!grant.route && (p.usesAlias || p.configPath)) throw problem('ACCESS_DENIED');
    const { config, endpoint, route } = await resolve(p, !grant.route);
    if (grant.route && grant.route !== route) throw problem('SSH_CONFIG_CHANGED');
    const { host, keyPath } = p;
    const original = { ...config, configPath: p.configPath || '' };
    check();
    const scope = endpoint && authScope(original, endpoint);
    let connection;
    let authenticated = false;
    const answered = new Set();
    // OpenSSH output stays inside the app. It is scanned for the failure code and never streamed to a client.
    const output = [];
    let stage = 'connect';
    const onEvent = (event, value) => {
      if (signal.aborted) return;
      if (event === 'data') {
        output.push(...stripVTControlCharacters(String(value)).split(/\r?\n/).map(line => line.trim()).filter(Boolean));
        if (output.length > 200) output.splice(0, output.length - 200);
        return;
      }
      if (event === 'ready') { authenticated = true; notify(event, { endpoint }); return; }
      if (event === 'closed' || event === 'prompt-clear') { notify(event, value); return; }
      if (event === 'error') {
        const exit = Number(/\((\d+)\)/.exec(String(value))?.[1]) || null;
        notify('error', { ...classifySshFailure(output, { exit, stage }), log: scrubLines(output) });
        return;
      }
      if (event !== 'prompt') return;
      if (!authenticated) stage = value.hostKey ? 'hostkey' : 'auth';
      const handle = async () => {
        check();
        if (value.hostKey) {
          const decision = hostKeyDecision(value.prompt, scope);
          if (decision.code) {
            notify('error', { code: decision.code, stage: 'hostkey', hint: failureRules.find(rule => rule[0] === decision.code)?.[3],
              exit: null, detail: decision.detail, log: scrubLines(output) });
            connection?.answer(value.id, 'no');
          } else {
            notify('hostkey.pinned', { host: decision.host, fingerprint: decision.fingerprint });
            connection?.answer(value.id, decision.answer);
          }
          return;
        }
        if (!authenticated && value.targetProcess && value.canRemember && state().useStoredAuthOnConnect !== false) {
          const question = value.prompt.replace(/^\([^\r\n)]{1,512}\) /, '');
          const key = endpoint && digest([host, original.configPath, keyPath || '', endpoint, value.prompt]);
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
    if (grant.savedAuth && scope && state().useStoredAuthOnConnect !== false) {
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
      'ask', false, password, auditPassword, true);
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
  return { eligible, eligibilityReason, resolve, command, catalog, validateGrant, connect, approve, run, download };
}
module.exports = { createTransport, classifySshFailure, scrubLines };
