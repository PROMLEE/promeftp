const path = require('node:path');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createHash } = require('node:crypto');
const { stripVTControlCharacters } = require('node:util');
const openssh = require('./openssh.cjs');
const { compileTrigger, scanTriggers } = require('./terminal-triggers.cjs');
const { problem, downloadLimits, downloadLimitsOf } = require('./agent-service.cjs');
const { normalizedAuthQuestion } = require('./auth-rules.cjs');
const { authScope, savedAuthDecision } = require('./saved-auth.cjs');

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
// Next steps returned with a failure, for the agent. Fixed English text that never contains a secret.
const askUser = message => ({ action: 'ask_user', message });
const retry = { action: 'retry', message: 'Retry once. If it fails again, stop and report the error code.' };
const checkInput = { action: 'check_input', message: 'Check the host name, port, and ProxyJump or ProxyCommand settings.' };
const connectionNext = [retry, checkInput];
const defaultNext = [askUser('Ask the user to check this bookmark in PromeFTP.')];
const nextSteps = {
  HOST_KEY_UNKNOWN: [askUser('Ask the user to confirm the host key in the PromeFTP dialog, or connect once in PromeFTP.'),
    { action: 'retry', message: 'Retry only after the user has confirmed the host key.' }],
  HOST_KEY_CHANGED: [askUser('The server key differs from the trusted one. Ask the user to verify the new fingerprint; do not retry automatically.')],
  HOST_KEY_UNCONFIRMED: [askUser('The user declined or did not answer the host key dialog.')],
  AUTH_FAILED: [askUser('Saved credentials were rejected. Ask the user to update them in PromeFTP.')],
  SSH_CONFIG_CHANGED: [{ action: 'refresh_grant', message: "Ask the user to re-save this bookmark's agent permission." }],
  SFTP_SUBSYSTEM_FAILED: [askUser('Ask the user to check the sftp-server setting and login shell output such as echo in .bashrc.')],
  DNS_FAILED: connectionNext,
  HOST_UNREACHABLE: connectionNext,
  CONNECT_TIMEOUT: connectionNext,
  CONNECTION_REFUSED: connectionNext,
  PROXY_FAILED: connectionNext,
  CONNECTION_FAILED: connectionNext,
};
const nextFor = code => nextSteps[code] || defaultNext;
const withNext = failure => ({ ...failure, next: nextFor(failure.code) });
// Shown to the agent when a password prompt arrives and no saved answer exists.
const NO_PROMPT_IN_APP = 'PromeFTP signed in without a prompt (likely ssh-agent). Save the password/answer once in PromeFTP or set an identity file on this bookmark.';
// Only the lines that decide where OpenSSH connects. Other settings change how a login is authenticated, not where.
const targetLines = endpoint => endpoint.split('\n').filter(line => /^(hostname|user|port|proxyjump|proxycommand) /.test(line)).join('\n');
const sameTarget = (a, b) => targetLines(a) === targetLines(b);
// Decides what a host key is, from the trust sources in order: app value, agent value, then the user's known_hosts
// files (read only). Only the first source that has entries is compared. A key of another type than the question's
// is not treated as the same key, so it is classed as changed, never as new.
// A user or system file that could not be read is not "no entry": the key is judged as changed, with no previous key,
// so it is never trusted automatically in 'new' mode.
function classifyHostKey({ fingerprint, keyType = '', app = [], agent = [], user = [], unreadable = false }) {
  // A key that matches any trusted value of the first source that holds one is trusted. The agent's own value counts
  // even when the app has a different value, so a key already trusted for the agent is not asked about again.
  if (app.includes(fingerprint)) return { kind: 'trusted', source: 'app' };
  if (agent.includes(fingerprint)) return { kind: 'trusted', source: 'agent' };
  if (app.length) return { kind: 'changed', previous: app[0], source: 'app' };
  if (agent.length) return { kind: 'changed', previous: agent[0], source: 'agent' };
  const sameType = keyType ? user.filter(entry => entry.type === keyType) : user;
  if (sameType.some(entry => entry.fingerprint === fingerprint)) return { kind: 'trusted', source: 'user_known_hosts' };
  if (!user.length && !unreadable) return { kind: 'new' };
  const previous = (sameType[0] ?? user[0])?.fingerprint;
  return { kind: 'changed', ...(previous && { previous }), source: 'user_known_hosts' };
}
// The automatic trust each grant mode allows. 'off' never trusts without asking. 'new' accepts only a key never seen.
// 'changed' also accepts a key that differs from the trusted one or is of a new type.
function autoTrustAllowed(mode, kind) {
  return mode === 'changed' ? kind !== 'trusted' : mode === 'new' ? kind === 'new' : false;
}

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

function createTransport({ state, readAnswer, validAuthAnswer, matchesGlobalPattern, snippetScope, directory, approve,
  profile, userKnownHosts, systemKnownHosts = '/etc/ssh/ssh_known_hosts', confirmHostKey, trustHostKey, ssh = openssh }) {
  // The same normalization as the app, so the endpoint, the scope and the reply key match what the app computes.
  function normalized(input) {
    try { return profile(input); }
    catch { throw problem('PROFILE_NOT_ELIGIBLE'); }
  }
  function catalog(p) {
    const scope = snippetScope({ mode: 'ssh', input: p });
    return {
      pam: (state().globalAuthRules || []).map(({ id, prompt }) => ({ id, name: prompt })),
      triggers: (state().terminalTriggers || []).filter(t => !t.scope || t.scope === scope)
        .map(({ id, name }) => ({ id, name })),
    };
  }
  // The trust sources for a host, in the order classifyHostKey uses them. Each source is read only. A file that cannot be
  // read is recorded in unreadable, so a failed read is never mistaken for a file with no entry.
  async function trustedFor(host, scope) {
    const app = [`host:${host}`, scope].filter(Boolean).map(key => state().trustedHostKeys?.[key]).filter(Boolean);
    const agent = [state().agent?.trustedHostKeys?.[`host:${host}`]].filter(Boolean);
    const unreadable = [];
    const readEntries = async file => {
      try { return await ssh.knownHostKeyEntries(file, host); }
      catch { unreadable.push(file); return []; }
    };
    const user = [...await readEntries(userKnownHosts), ...await readEntries(systemKnownHosts)];
    return { app, agent, user, unreadable: unreadable.length > 0 };
  }
  // A key that is trusted is accepted. A key the grant's mode allows is trusted automatically and recorded. Any other key
  // goes to the user's confirmation in the app.
  async function hostKeyDecision(prompt, { scope, profile: bookmark, endpoint, signal, mode = 'off' }) {
    const info = ssh.parseHostKeyPrompt(prompt);
    if (!info?.fingerprint) return { code: 'HOST_KEY_UNKNOWN' };
    const verdict = classifyHostKey({ fingerprint: info.fingerprint, keyType: info.keyType, ...(await trustedFor(info.host, scope)) });
    if (verdict.kind === 'trusted') return { answer: info.accept, host: info.host, fingerprint: info.fingerprint };
    const { previous, source, kind } = verdict;
    const detail = { host: info.host, fingerprint: info.fingerprint,
      ...(kind === 'changed' && { ...(previous && { trusted: previous }), source }) };
    if (autoTrustAllowed(mode, kind)) {
      if (signal?.aborted) return { code: 'HOST_KEY_UNCONFIRMED', detail };
      // A failure to record the key does not stop this connection. The audit event says it was not saved.
      const saved = await Promise.resolve().then(() => trustHostKey(info.host, info.fingerprint)).then(() => true, () => false);
      return { answer: info.accept, host: info.host, fingerprint: info.fingerprint, auto: true, kind, mode,
        previous: previous ?? null, source: source ?? null, saved };
    }
    if (!confirmHostKey) return { code: kind === 'changed' ? 'HOST_KEY_CHANGED' : 'HOST_KEY_UNKNOWN', detail };
    const approved = await Promise.resolve()
      .then(() => confirmHostKey({ profile: bookmark, host: info.host, fingerprint: info.fingerprint,
        previous, source: kind === 'changed' ? source : undefined, endpoint, signal }))
      .catch(() => false);
    if (approved !== true) return { code: 'HOST_KEY_UNCONFIRMED', detail };
    return { answer: info.accept, host: info.host, fingerprint: info.fingerprint };
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
    const hostKeyTrust = value.hostKeyTrust ?? 'off';
    if (!['off', 'new', 'changed'].includes(hostKeyTrust)) throw problem('INVALID_REQUEST');
    // Running without asking needs command approval on. Without it the flag is stored as false.
    const commandAutoApprove = value.commandApproval === true && value.commandAutoApprove === true;
    const limits = {};
    for (const [field, rule] of Object.entries(downloadLimits)) {
      const given = value[field] ?? rule.fallback;
      if (!Number.isSafeInteger(given) || given < rule.min || given > rule.max) throw problem('INVALID_REQUEST');
      limits[field] = given;
    }
    return { sftp: value.sftp !== false, download: value.sftp !== false && value.download === true, savedAuth: value.savedAuth === true,
      commandApproval: value.commandApproval === true, commandAutoApprove, pam: selected('pam'), triggers: selected('triggers'),
      hostKeyTrust, ...limits, ...(task && { task }) };
  }

  async function resolve(input, legacy = false) {
    const p = normalized(input);
    if (!eligible(p)) throw problem('PROFILE_NOT_ELIGIBLE');
    const config = { ...p, configPath: legacy ? '/dev/null' : p.configPath || '' };
    const output = await ssh.effectiveOutput(config);
    return { config, endpoint: ssh.authEndpoint(output), route: digest(output) };
  }

  async function connect(input, grant, mode, notify, check, signal) {
    const p = normalized(input);
    if (!grant.route && (p.usesAlias || p.configPath)) throw problem('ACCESS_DENIED');
    const target = await resolve(p, !grant.route);
    if (grant.route && grant.route !== target.route) throw problem('SSH_CONFIG_CHANGED');
    // Saved replies are keyed by the endpoint the app computes. A legacy connection uses that same endpoint, but only
    // when it reaches the same target. Otherwise saved replies are not used for this connection.
    const identity = grant.route ? target : await resolve(p, false);
    const mismatch = !sameTarget(target.endpoint, identity.endpoint);
    const endpoint = identity.endpoint;
    const scope = endpoint && !mismatch ? authScope(p, endpoint) : '';
    check();
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
      if (event === 'ready') { authenticated = true; notify(event, { endpoint: target.endpoint }); return; }
      if (event === 'closed' || event === 'prompt-clear') { notify(event, value); return; }
      if (event === 'error') {
        const exit = Number(/\((\d+)\)/.exec(String(value))?.[1]) || null;
        notify('error', withNext({ ...classifySshFailure(output, { exit, stage }), log: scrubLines(output) }));
        return;
      }
      if (event !== 'prompt') return;
      if (!authenticated) stage = value.hostKey ? 'hostkey' : 'auth';
      const handle = async () => {
        check();
        if (value.hostKey) {
          const decision = await hostKeyDecision(value.prompt, { scope, profile: p, endpoint: target.endpoint, signal,
            mode: grant.hostKeyTrust });
          if (decision.code) {
            notify('error', withNext({ code: decision.code, stage: 'hostkey',
              hint: failureRules.find(rule => rule[0] === decision.code)?.[3] || 'The user did not confirm the host key.',
              exit: null, detail: decision.detail, log: scrubLines(output) }));
            connection?.answer(value.id, 'no');
          } else if (decision.auto) {
            notify('hostkey.autotrusted', { host: decision.host, fingerprint: decision.fingerprint, previous: decision.previous,
              source: decision.source, kind: decision.kind, mode: decision.mode, saved: decision.saved });
            connection?.answer(value.id, decision.answer);
          } else {
            notify('hostkey.pinned', { host: decision.host, fingerprint: decision.fingerprint });
            connection?.answer(value.id, decision.answer);
          }
          return;
        }
        if (!authenticated) {
          const question = normalizedAuthQuestion(value.prompt);
          const rules = state().globalAuthRules || [];
          const decision = savedAuthDecision({ state: state(), config: p, endpoint, scope, mismatch, prompt: value.prompt,
            canRemember: value.canRemember, answered, allowSaved: grant.savedAuth,
            allowedRuleIds: grant.savedAuth ? rules.map(rule => rule.id) : grant.pam, matchesGlobalPattern });
          let reason = decision.reason;
          if (decision.entry) {
            const answer = await readAnswer(decision.entry).catch(() => '');
            check();
            const latest = decision.source === 'global' ? state().globalAuthRules?.find(rule => rule.id === decision.used)
              : state().authReplies?.[decision.key];
            if (latest === decision.entry && state().useStoredAuthOnConnect !== false &&
                (decision.source === 'global' || state().useSavedRepliesAutomatically !== false) && validAuthAnswer(answer)) {
              notify('auth.rule', decision.used);
              if (connection?.answer(value.id, answer)) {
                answered.add(question);
                answered.add(decision.used);
                return;
              }
            }
            reason = 'read_failed';
          }
          const lastLine = value.prompt.trim().split(/\r?\n/).at(-1);
          const next = reason === 'no_saved_reply' && /password|passphrase/i.test(lastLine) ? [askUser(NO_PROMPT_IN_APP)] : undefined;
          notify('prompt', { ...value, savedAuth: reason, ...(next && { next }) });
          return;
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
    connection = await ssh.start(target.config, mode === 'ssh' ? 'exec' : mode, {}, onEvent, [],
      'ask', grant.savedAuth && state().useOpenSSHKeychain === true, password, auditPassword, true);
    if (signal.aborted) connection.close();
    return connection;
  }

  function run(s, value, notify, mirror = () => {}) {
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
        const kept = bytes.subarray(0, count).toString();
        output[key] += kept;
        remaining -= count;
        if (count) {
          const text = stripVTControlCharacters(kept);
          if (text) try { mirror(key, text); } catch {}
        }
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

  // size is the remote file's size from stat. A larger file is refused before anything is staged; the byte count below
  // still stops a file that grows while it is read.
  async function download(s, remote, channel, size = 0) {
    const { maxMiB, stagedFiles } = downloadLimitsOf(s.grant);
    const maxBytes = maxMiB * 1024 * 1024;
    if (size > maxBytes) throw problem('FILE_LIMIT');
    const base = path.join(directory, 'downloads');
    await fs.mkdir(base, { recursive: true, mode: 0o700 });
    const now = Date.now();
    for (const dir of await fs.readdir(base, { withFileTypes: true })) {
      if (!dir.isDirectory() || !dir.name.startsWith('file-')) continue;
      const target = path.join(base, dir.name);
      const info = await fs.lstat(target).catch(() => null);
      if (info?.isDirectory() && now - info.mtimeMs > 86400000) await fs.rm(target, { recursive: true, force: true });
    }
    if ((await fs.readdir(base)).length >= stagedFiles) throw problem('FILE_LIMIT');
    const folder = await fs.mkdtemp(path.join(base, 'file-'));
    const localPath = path.join(folder, path.posix.basename(remote));
    let bytes = 0;
    const counter = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) callback(problem('FILE_LIMIT'));
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
  return { eligible, eligibilityReason, resolve, command, catalog, validateGrant, connect, approve, run, download, nextFor };
}
module.exports = { createTransport, classifySshFailure, scrubLines, nextSteps, classifyHostKey, autoTrustAllowed };
