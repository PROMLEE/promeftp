// Agent connect flow with a fake ssh module injected into createTransport. No ssh or ssh-keygen runs, and no file under
// ~/.ssh or the app's data folder is read or written. Files exist only in a temporary directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const openssh = require('../openssh.cjs');
const stateRules = require('../state-rules.cjs');
const saved = require('../saved-auth.cjs');
const { matchesGlobalPattern } = require('../auth-rules.cjs');
const { createTransport, nextSteps } = require('../agent-transport.cjs');

const HOME = '/var/empty-home';
const endpointApp = 'hostname example.invalid\nuser alice\nport 22\nidentityagent ~/.1password/agent.sock';
const endpointLegacy = 'hostname example.invalid\nuser alice\nport 22';
const pOld = { id: 'b1', host: 'example.invalid', username: 'alice' };
const prompt = '(alice@example.invalid) Verification code: ';
const passwordPrompt = "alice@example.invalid's password: ";
const normalized = input => stateRules.profile(input, HOME);
const scopeOf = endpoint => saved.authScope(normalized(pOld), endpoint);
const keyOf = (endpoint = endpointApp, text = prompt) => saved.replyKey(normalized(pOld), endpoint, text);
const fingerprint = name => 'SHA256:' + createHash('sha256').update(name).digest('base64').replace(/=+$/, '');
const hostKeyPrompt = fp => `The authenticity of host 'example.invalid (203.0.113.5)' can't be established.\n` +
  `ED25519 key fingerprint is ${fp}.\nAre you sure you want to continue connecting (yes/no/[fingerprint])?`;

let tmp;
test.before(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'promeftp-agent-transport-')); });
test.after(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw Error('timed out waiting for the transport');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
async function settle() {
  for (let i = 0; i < 50; i++) await new Promise(resolve => setImmediate(resolve));
}

// Starts one agent connection through the transport. Endpoints and trust are supplied by the test.
async function open({ state = {}, grant = {}, endpoints = {}, agentFps = [], userFps = [], confirmHostKey, bookmark = pOld } = {}) {
  const agentFile = path.join(tmp, 'agent', 'known_hosts');
  const userFile = path.join(tmp, 'home', '.ssh', 'known_hosts');
  const endpoint = { app: endpointApp, legacy: endpointLegacy, ...endpoints };
  const st = { profiles: [pOld], globalAuthRules: [], authReplies: {}, sshPasswords: {}, trustedHostKeys: {},
    useStoredAuthOnConnect: true, useSavedRepliesAutomatically: true, useOpenSSHKeychain: false, ...state };
  const calls = { starts: [], answers: [], forgets: [], confirms: [], lookups: [] };
  const sessions = [];
  const ssh = {
    ...openssh,
    async effectiveOutput(config) { return config.configPath === '/dev/null' ? endpoint.legacy : endpoint.app; },
    async knownHostFingerprints(file, host) { calls.lookups.push([file, host]); return file === userFile ? userFps : agentFps; },
    async forgetKnownHost(file, host) { calls.forgets.push([file, host]); return true; },
    async start(config, mode, size, onEvent, rules, strict, useKeychain, password, onPasswordUsed, agent) {
      const connection = { close() {}, answer(id, value) { calls.answers.push({ id, value }); return true; } };
      calls.starts.push({ config, mode, strict, useKeychain, password, agent });
      sessions.push(onEvent);
      return connection;
    },
  };
  const transport = createTransport({
    state: () => st,
    readAnswer: async entry => entry.answer ?? '',
    validAuthAnswer: value => typeof value === 'string' && value !== '' && !/[\r\n\0]/.test(value),
    matchesGlobalPattern, snippetScope: () => '', directory: tmp, approve: async () => true,
    knownHosts: agentFile, profile: normalized, userKnownHosts: userFile,
    ...(confirmHostKey && { confirmHostKey: async args => { calls.confirms.push(args); return confirmHostKey(args); } }),
    ssh,
  });
  const events = [];
  const notify = (event, value) => events.push({ event, value });
  const connecting = transport.connect(bookmark, { savedAuth: false, pam: [], ...grant }, 'ssh', notify, () => {},
    new AbortController().signal);
  await until(() => sessions.length === 1);
  await connecting;
  return {
    st, calls, events, transport, agentFile, userFile,
    // Delivers an OpenSSH prompt to the connection and waits until the transport has answered or notified.
    async prompt(value) {
      sessions[0]('prompt', { id: 'p1', prompt, hint: '', canRemember: true, targetProcess: true, hostKey: false, ...value });
      await settle();
    },
    async hostKey(fp, extra = {}) {
      sessions[0]('prompt', { id: 'h1', prompt: hostKeyPrompt(fp), hint: '', canRemember: false, targetProcess: true,
        hostKey: true, ...extra });
      await settle();
    },
  };
}
const eventsNamed = (session, name) => session.events.filter(entry => entry.event === name);
const errorOf = session => eventsNamed(session, 'error')[0]?.value;

test('a legacy connection that reaches the same target uses the saved reply keyed by the app endpoint', async () => {
  const s = await open({ grant: { savedAuth: true }, state: { authReplies: { [keyOf()]: { answer: '123456', scope: scopeOf(endpointApp) } } } });
  await s.prompt({});
  assert.deepEqual(s.calls.answers, [{ id: 'p1', value: '123456' }]);
  assert.deepEqual(eventsNamed(s, 'auth.rule').map(entry => entry.value), [keyOf()]);
  assert.equal(eventsNamed(s, 'prompt').length, 0);
});

test('a legacy connection to a different user does not use the saved reply and reports scope_mismatch', async () => {
  const s = await open({ grant: { savedAuth: true }, endpoints: { legacy: 'hostname example.invalid\nuser bob\nport 22' },
    state: { authReplies: { [keyOf()]: { answer: '123456', scope: scopeOf(endpointApp) } } } });
  await s.prompt({});
  assert.deepEqual(s.calls.answers, []);
  const [prompted] = eventsNamed(s, 'prompt');
  assert.equal(prompted.value.savedAuth, 'scope_mismatch');
  assert.equal(JSON.stringify(s.events).includes('123456'), false);
});

test('an old profile without keyPath reaches the saved password of the app scope', async () => {
  const s = await open({ grant: { savedAuth: true }, state: { sshPasswords: { [scopeOf(endpointApp)]: { answer: 'pw-secret' } } } });
  assert.equal(s.calls.starts[0].password, 'pw-secret');
  assert.equal(s.calls.starts[0].agent, true);
});

test('with saved auth off the reason is not_granted and the saved reply is not used', async () => {
  const s = await open({ grant: { savedAuth: false }, state: { authReplies: { [keyOf()]: { answer: '123456', scope: scopeOf(endpointApp) } } } });
  await s.prompt({});
  assert.deepEqual(s.calls.answers, []);
  assert.equal(eventsNamed(s, 'prompt')[0].value.savedAuth, 'not_granted');
});

test('with automatic saved replies turned off the reason is disabled', async () => {
  const s = await open({ grant: { savedAuth: true }, state: { useSavedRepliesAutomatically: false,
    authReplies: { [keyOf()]: { answer: '123456', scope: scopeOf(endpointApp) } } } });
  await s.prompt({});
  assert.equal(eventsNamed(s, 'prompt')[0].value.savedAuth, 'disabled');
});

test('the same question is answered once per connection, then the reason is already_used', async () => {
  const s = await open({ grant: { savedAuth: true }, state: { authReplies: { [keyOf()]: { answer: '123456', scope: scopeOf(endpointApp) } } } });
  await s.prompt({});
  await s.prompt({ id: 'p2' });
  assert.deepEqual(s.calls.answers.map(entry => entry.id), ['p1']);
  assert.equal(eventsNamed(s, 'prompt')[0].value.savedAuth, 'already_used');
});

test('a global rule answers with savedAuth on even when the PAM list is empty', async () => {
  const rule = { id: 'g1', prompt, answer: '654321' };
  const s = await open({ grant: { savedAuth: true, pam: [] }, state: { globalAuthRules: [rule] } });
  await s.prompt({});
  assert.deepEqual(s.calls.answers, [{ id: 'p1', value: '654321' }]);
  assert.deepEqual(eventsNamed(s, 'auth.rule').map(entry => entry.value), ['g1']);
});

test('a global rule outside the PAM list is not used with savedAuth off', async () => {
  const rule = { id: 'g1', prompt, answer: '654321' };
  const s = await open({ grant: { savedAuth: false, pam: [] }, state: { globalAuthRules: [rule] } });
  await s.prompt({});
  assert.deepEqual(s.calls.answers, []);
  assert.equal(eventsNamed(s, 'prompt')[0].value.savedAuth, 'global_rule_not_granted');
});

test('a global rule in the PAM list is used with savedAuth off', async () => {
  const rule = { id: 'g1', prompt, answer: '654321' };
  const s = await open({ grant: { savedAuth: false, pam: ['g1'] }, state: { globalAuthRules: [rule] } });
  await s.prompt({});
  assert.deepEqual(s.calls.answers, [{ id: 'p1', value: '654321' }]);
});

test('a password prompt with no saved answer tells the agent to ask the user to save it in PromeFTP', async () => {
  const s = await open({ grant: { savedAuth: true } });
  await s.prompt({ prompt: passwordPrompt });
  const [prompted] = eventsNamed(s, 'prompt');
  assert.equal(prompted.value.savedAuth, 'no_saved_reply');
  assert.equal(prompted.value.next[0].action, 'ask_user');
  assert.match(prompted.value.next[0].message, /^PromeFTP signed in without a prompt/);
});

test('the keychain option reaches OpenSSH only for a grant with saved auth', async () => {
  assert.equal((await open({ grant: { savedAuth: true }, state: { useOpenSSHKeychain: true } })).calls.starts[0].useKeychain, true);
  assert.equal((await open({ grant: { savedAuth: true }, state: { useOpenSSHKeychain: false } })).calls.starts[0].useKeychain, false);
  assert.equal((await open({ grant: { savedAuth: false }, state: { useOpenSSHKeychain: true } })).calls.starts[0].useKeychain, false);
});

test('a host key the app trusted is accepted and the pin is audited', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': fingerprint('A') } } });
  await s.hostKey(fingerprint('A'));
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: fingerprint('A') }]);
  assert.equal(eventsNamed(s, 'hostkey.pinned')[0].value.fingerprint, fingerprint('A'));
});

test('a key in ~/.ssh that matches is accepted when the app has no value for the host', async () => {
  const s = await open({ userFps: [fingerprint('A')] });
  await s.hostKey(fingerprint('A'));
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: fingerprint('A') }]);
});

test('the app value wins over ~/.ssh, so a key only ~/.ssh trusts is a change', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': fingerprint('A') } }, userFps: [fingerprint('B')] });
  await s.hostKey(fingerprint('B'));
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: 'no' }]);
  assert.equal(errorOf(s).code, 'HOST_KEY_CHANGED');
});

test('a stale key in ~/.ssh does not block a key the app trusted', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': fingerprint('new') } }, userFps: [fingerprint('old')] });
  await s.hostKey(fingerprint('new'));
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: fingerprint('new') }]);
  assert.equal(errorOf(s), undefined);
});

test('a changed key asks once with the app value as the previous key, and approval accepts it', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': fingerprint('old') } }, confirmHostKey: () => true });
  await s.hostKey(fingerprint('new'));
  assert.equal(s.calls.confirms.length, 1);
  assert.equal(s.calls.confirms[0].previous, fingerprint('old'));
  assert.equal(s.calls.confirms[0].fingerprint, fingerprint('new'));
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: fingerprint('new') }]);
});

test('a declined confirmation answers no and reports HOST_KEY_UNCONFIRMED with a next step', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': fingerprint('old') } }, confirmHostKey: () => false });
  await s.hostKey(fingerprint('new'));
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: 'no' }]);
  assert.equal(errorOf(s).code, 'HOST_KEY_UNCONFIRMED');
  assert.equal(errorOf(s).next[0].action, 'ask_user');
});

test('an unknown key is accepted only after the user confirms it', async () => {
  const declined = await open({ confirmHostKey: () => false });
  await declined.hostKey(fingerprint('unknown'));
  assert.equal(declined.calls.confirms[0].previous, undefined);
  assert.deepEqual(declined.calls.answers, [{ id: 'h1', value: 'no' }]);
  assert.equal(errorOf(declined).code, 'HOST_KEY_UNCONFIRMED');

  const approved = await open({ confirmHostKey: () => true });
  await approved.hostKey(fingerprint('unknown'));
  assert.deepEqual(approved.calls.answers, [{ id: 'h1', value: fingerprint('unknown') }]);
});

test('without a confirmation handler a changed key reports HOST_KEY_CHANGED with a next step', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': fingerprint('old') } } });
  await s.hostKey(fingerprint('new'));
  const error = errorOf(s);
  assert.equal(error.code, 'HOST_KEY_CHANGED');
  assert.equal(error.next[0].action, 'ask_user');
  assert.equal(error.detail.trusted, fingerprint('old'));
  assert.equal(error.detail.source, 'app');
});

test('without a confirmation handler an unknown key reports HOST_KEY_UNKNOWN and is not accepted', async () => {
  const s = await open({});
  await s.hostKey(fingerprint('unknown'));
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: 'no' }]);
  assert.equal(errorOf(s).code, 'HOST_KEY_UNKNOWN');
});

test('a stored agent key the user has not trusted is forgotten before connecting, in the agent file only', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': fingerprint('new') } }, agentFps: [fingerprint('old')] });
  assert.deepEqual(s.calls.forgets, [[s.agentFile, 'example.invalid']]);
  assert.ok(s.calls.forgets.every(([file]) => file === s.agentFile));
  assert.ok(s.calls.forgets.every(([file]) => !file.includes('.ssh')));
});

test('a non-standard port is forgotten under its bracketed name', async () => {
  const endpoints = { app: 'hostname example.invalid\nuser alice\nport 2222', legacy: 'hostname example.invalid\nuser alice\nport 2222' };
  const s = await open({ endpoints, state: { trustedHostKeys: { 'host:[example.invalid]:2222': fingerprint('new') } }, agentFps: [fingerprint('old')] });
  assert.deepEqual(s.calls.forgets, [[s.agentFile, '[example.invalid]:2222']]);
});

test('a trusted agent key is kept and nothing is forgotten', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': fingerprint('A') } }, agentFps: [fingerprint('A')] });
  assert.deepEqual(s.calls.forgets, []);
});

test('every failure code has next steps, and an unmapped code gets the default step', () => {
  for (const code of ['HOST_KEY_UNKNOWN', 'HOST_KEY_CHANGED', 'HOST_KEY_UNCONFIRMED', 'AUTH_FAILED', 'SSH_CONFIG_CHANGED',
    'DNS_FAILED', 'HOST_UNREACHABLE', 'CONNECT_TIMEOUT', 'CONNECTION_REFUSED', 'PROXY_FAILED', 'CONNECTION_FAILED',
    'SFTP_SUBSYSTEM_FAILED']) {
    assert.ok(Array.isArray(nextSteps[code]) && nextSteps[code].length > 0, `no next steps for ${code}`);
  }
  assert.deepEqual(nextSteps.HOST_KEY_CHANGED.map(step => step.action), ['ask_user']);
  assert.deepEqual(nextSteps.DNS_FAILED.map(step => step.action), ['retry', 'check_input']);
  assert.equal(nextSteps.SSH_CONFIG_CHANGED[0].action, 'refresh_grant');
});

test('an app value decides cleanup: a stored key the app does not trust is forgotten even when ~/.ssh trusts it', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': fingerprint('A') } },
    agentFps: [fingerprint('B')], userFps: [fingerprint('B')] });
  assert.deepEqual(s.calls.forgets, [[s.agentFile, 'example.invalid']]);
  await s.hostKey(fingerprint('A'));
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: fingerprint('A') }]);
  assert.equal(eventsNamed(s, 'hostkey.pinned').length, 1);
  assert.equal(errorOf(s), undefined);
});

test('without an app value, a key ~/.ssh trusts stays in the agent file', async () => {
  const s = await open({ userFps: [fingerprint('A')], agentFps: [fingerprint('A')] });
  assert.deepEqual(s.calls.forgets, []);
});
