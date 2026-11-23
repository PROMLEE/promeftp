// Agent connect flow with a fake ssh module injected into createTransport. No ssh or ssh-keygen runs, and no file under
// ~/.ssh, /etc/ssh or the app's data folder is read or written. Known-host entries come from the fake per file path.
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
const { createTransport, nextSteps, classifyHostKey, autoTrustAllowed } = require('../agent-transport.cjs');

const HOME = '/var/empty-home';
const USER = '/fake/home/.ssh/known_hosts';
const SYSTEM = '/sys/fake';
const endpointApp = 'hostname example.invalid\nuser alice\nport 22\nidentityagent ~/.1password/agent.sock';
const endpointLegacy = 'hostname example.invalid\nuser alice\nport 22';
const pOld = { id: 'b1', host: 'example.invalid', username: 'alice' };
const prompt = '(alice@example.invalid) Verification code: ';
const passwordPrompt = "alice@example.invalid's password: ";
const normalized = input => stateRules.profile(input, HOME);
const scopeOf = endpoint => saved.authScope(normalized(pOld), endpoint);
const keyOf = (endpoint = endpointApp, text = prompt) => saved.replyKey(normalized(pOld), endpoint, text);
const fingerprint = name => 'SHA256:' + createHash('sha256').update(name).digest('base64').replace(/=+$/, '');
const hostKeyPrompt = (fp, type = 'ED25519') => `The authenticity of host 'example.invalid (203.0.113.5)' can't be established.\n` +
  `${type} key fingerprint is ${fp}.\nAre you sure you want to continue connecting (yes/no/[fingerprint])?`;
const ed = fp => ({ fingerprint: fp, type: 'ED25519' });
const rsa = fp => ({ fingerprint: fp, type: 'RSA' });
const K_OLD = fingerprint('old');
const K_NEW = fingerprint('new');

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

// Starts one agent connection through the transport. Known-host entries and trust are supplied by the test.
async function open({ state = {}, grant = {}, endpoints = {}, userKnown = [], systemKnown = [], confirmHostKey,
  trustFails = false, unreadable = [], bookmark = pOld } = {}) {
  const endpoint = { app: endpointApp, legacy: endpointLegacy, ...endpoints };
  const st = { profiles: [pOld], globalAuthRules: [], authReplies: {}, sshPasswords: {}, trustedHostKeys: {},
    useStoredAuthOnConnect: true, useSavedRepliesAutomatically: true, useOpenSSHKeychain: false, ...state };
  const calls = { starts: [], answers: [], confirms: [], trusted: [], lookups: [], order: [] };
  const entries = { [USER]: userKnown, [SYSTEM]: systemKnown };
  const sessions = [];
  const controller = new AbortController();
  const ssh = {
    ...openssh,
    async effectiveOutput(config) { return config.configPath === '/dev/null' ? endpoint.legacy : endpoint.app; },
    async knownHostKeyEntries(file, host) {
      calls.lookups.push([file, host]);
      if (unreadable.includes(file)) throw Object.assign(new Error('Permission denied'), { code: 'EACCES' });
      return entries[file] ?? [];
    },
    async start(config, mode, size, onEvent, rules, strict, useKeychain, password, onPasswordUsed, agent) {
      const connection = { close() {}, answer(id, value) { calls.answers.push({ id, value }); calls.order.push('answer'); return true; } };
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
    profile: normalized, userKnownHosts: USER, systemKnownHosts: SYSTEM,
    confirmHostKey: confirmHostKey && (async args => { calls.confirms.push(args); calls.order.push('confirm'); return confirmHostKey(args); }),
    trustHostKey: async (host, fp) => {
      calls.trusted.push([host, fp]); calls.order.push('trust');
      if (trustFails) throw Error('storage failed');
    },
    ssh,
  });
  const events = [];
  const notify = (event, value) => { events.push({ event, value }); calls.order.push('notify:' + event); };
  const connecting = transport.connect(bookmark, { savedAuth: false, pam: [], ...grant }, 'ssh', notify, () => {}, controller.signal);
  await until(() => sessions.length === 1);
  await connecting;
  return {
    st, calls, events, transport, controller,
    // Delivers an OpenSSH prompt to the connection and waits until the transport has answered or notified.
    async prompt(value) {
      sessions[0]('prompt', { id: 'p1', prompt, hint: '', canRemember: true, targetProcess: true, hostKey: false, ...value });
      await settle();
    },
    async hostKey(fp, { type = 'ED25519' } = {}) {
      sessions[0]('prompt', { id: 'h1', prompt: hostKeyPrompt(fp, type), hint: '', canRemember: false, targetProcess: true, hostKey: true });
      await settle();
    },
    // Delivers a host key question without waiting, so the test can change the signal in the middle.
    hostKeyNow(fp) {
      sessions[0]('prompt', { id: 'h1', prompt: hostKeyPrompt(fp), hint: '', canRemember: false, targetProcess: true, hostKey: true });
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

test('the agent connection has no known_hosts path of its own in its config', async () => {
  const s = await open({});
  assert.equal('knownHosts' in s.calls.starts[0].config, false);
});

test('a host key the app trusted is accepted and the pin is audited', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': K_NEW } } });
  await s.hostKey(K_NEW);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: K_NEW }]);
  assert.equal(eventsNamed(s, 'hostkey.pinned')[0].value.fingerprint, K_NEW);
});

test('a key in ~/.ssh that matches is accepted when the app has no value for the host', async () => {
  const s = await open({ userKnown: [ed(K_NEW)] });
  await s.hostKey(K_NEW);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: K_NEW }]);
  assert.equal(eventsNamed(s, 'hostkey.autotrusted').length, 0);
});

test('the app value wins over ~/.ssh, so a key only ~/.ssh trusts is a change', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': K_OLD } }, userKnown: [ed(K_NEW)] });
  await s.hostKey(K_NEW);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: 'no' }]);
  assert.equal(errorOf(s).code, 'HOST_KEY_CHANGED');
  assert.equal(errorOf(s).detail.trusted, K_OLD);
  assert.equal(errorOf(s).detail.source, 'app');
});

test('a stale key in ~/.ssh does not block a key the app trusted', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': K_NEW } }, userKnown: [ed(K_OLD)] });
  await s.hostKey(K_NEW);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: K_NEW }]);
  assert.equal(errorOf(s), undefined);
});

test('a changed key asks once with the app value as the previous key, and approval accepts it', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': K_OLD } }, confirmHostKey: () => true });
  await s.hostKey(K_NEW);
  assert.equal(s.calls.confirms.length, 1);
  assert.equal(s.calls.confirms[0].previous, K_OLD);
  assert.equal(s.calls.confirms[0].fingerprint, K_NEW);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: K_NEW }]);
});

test('a declined confirmation answers no and reports HOST_KEY_UNCONFIRMED with a next step', async () => {
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': K_OLD } }, confirmHostKey: () => false });
  await s.hostKey(K_NEW);
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
  const s = await open({ state: { trustedHostKeys: { 'host:example.invalid': K_OLD } } });
  await s.hostKey(K_NEW);
  const error = errorOf(s);
  assert.equal(error.code, 'HOST_KEY_CHANGED');
  assert.equal(error.next[0].action, 'ask_user');
  assert.equal(error.detail.trusted, K_OLD);
});

test('without a confirmation handler an unknown key reports HOST_KEY_UNKNOWN and is not accepted', async () => {
  const s = await open({});
  await s.hostKey(fingerprint('unknown'));
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: 'no' }]);
  assert.equal(errorOf(s).code, 'HOST_KEY_UNKNOWN');
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

// --- 1.1.9: classification, automatic trust, and the trust sources ---

test('classifyHostKey: the app value decides first, then the agent value, then the user and system files', () => {
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519', app: [K_NEW] }), { kind: 'trusted', source: 'app' });
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519', app: [K_NEW], agent: [K_OLD] }), { kind: 'trusted', source: 'app' });
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519', agent: [K_NEW] }), { kind: 'trusted', source: 'agent' });
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519', agent: [K_OLD] }),
    { kind: 'changed', previous: K_OLD, source: 'agent' });
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519', agent: [K_OLD], user: [ed(K_NEW)] }),
    { kind: 'changed', previous: K_OLD, source: 'agent' });
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519', app: [K_OLD] }),
    { kind: 'changed', previous: K_OLD, source: 'app' });
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519' }), { kind: 'new' });
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519', user: [ed(K_OLD)] }),
    { kind: 'changed', previous: K_OLD, source: 'user_known_hosts' });
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519', user: [rsa(K_OLD)] }),
    { kind: 'changed', previous: K_OLD, source: 'user_known_hosts' });
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519', user: [ed(K_NEW)] }),
    { kind: 'trusted', source: 'user_known_hosts' });
});

test('autoTrustAllowed: off never trusts, new trusts only a new key, changed trusts every key that is not trusted', () => {
  const kinds = ['trusted', 'new', 'changed'];
  const table = {
    off: [false, false, false],
    new: [false, true, false],
    changed: [false, true, true],
  };
  for (const [mode, expected] of Object.entries(table)) {
    kinds.forEach((kind, index) => assert.equal(autoTrustAllowed(mode, kind), expected[index], `${mode} + ${kind}`));
  }
  assert.equal(autoTrustAllowed(undefined, 'new'), false);
});

test('off with a new key asks the user and does not trust automatically', async () => {
  const s = await open({ grant: { hostKeyTrust: 'off' }, confirmHostKey: () => false });
  await s.hostKey(K_NEW);
  assert.equal(s.calls.confirms.length, 1);
  assert.equal(s.calls.trusted.length, 0);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: 'no' }]);
});

test('new mode trusts a key the grant has never seen, without asking, and records it before answering', async () => {
  const s = await open({ grant: { hostKeyTrust: 'new' }, confirmHostKey: () => false });
  await s.hostKey(K_NEW);
  assert.equal(s.calls.confirms.length, 0);
  assert.deepEqual(s.calls.trusted, [['example.invalid', K_NEW]]);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: K_NEW }]);
  assert.deepEqual(s.calls.order.filter(step => step !== 'answer'), ['trust', 'notify:hostkey.autotrusted']);
  assert.deepEqual(s.calls.order.at(-1), 'answer');
  const [event] = eventsNamed(s, 'hostkey.autotrusted');
  assert.deepEqual({ kind: event.value.kind, previous: event.value.previous, source: event.value.source, mode: event.value.mode, saved: event.value.saved },
    { kind: 'new', previous: null, source: null, mode: 'new', saved: true });
  assert.equal(s.st.trustedHostKeys['host:example.invalid'], undefined);
});

test('new mode asks the user when the key differs from the trusted one', async () => {
  const s = await open({ grant: { hostKeyTrust: 'new' }, state: { trustedHostKeys: { 'host:example.invalid': K_OLD } },
    confirmHostKey: () => false });
  await s.hostKey(K_NEW);
  assert.equal(s.calls.confirms.length, 1);
  assert.equal(s.calls.trusted.length, 0);
  assert.equal(errorOf(s).code, 'HOST_KEY_UNCONFIRMED');
});

test('changed mode trusts a changed key without asking and reports the previous key and its source', async () => {
  const s = await open({ grant: { hostKeyTrust: 'changed' }, state: { trustedHostKeys: { 'host:example.invalid': K_OLD } },
    confirmHostKey: () => false });
  await s.hostKey(K_NEW);
  assert.equal(s.calls.confirms.length, 0);
  assert.deepEqual(s.calls.trusted, [['example.invalid', K_NEW]]);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: K_NEW }]);
  const [event] = eventsNamed(s, 'hostkey.autotrusted');
  assert.deepEqual({ kind: event.value.kind, previous: event.value.previous, source: event.value.source, mode: event.value.mode },
    { kind: 'changed', previous: K_OLD, source: 'app', mode: 'changed' });
});

test('the 1.1.8 pre-stop case: a key ~/.ssh trusted before is a change, asked in off mode and accepted in changed mode', async () => {
  const asked = await open({ grant: { hostKeyTrust: 'off' }, userKnown: [ed(K_OLD)], confirmHostKey: () => true });
  await asked.hostKey(K_NEW);
  assert.equal(asked.calls.confirms.length, 1);
  assert.equal(asked.calls.confirms[0].previous, K_OLD);
  assert.equal(asked.calls.confirms[0].source, 'user_known_hosts');
  assert.deepEqual(asked.calls.answers, [{ id: 'h1', value: K_NEW }]);
  assert.equal(errorOf(asked), undefined);

  const automatic = await open({ grant: { hostKeyTrust: 'changed' }, userKnown: [ed(K_OLD)], confirmHostKey: () => false });
  await automatic.hostKey(K_NEW);
  assert.equal(automatic.calls.confirms.length, 0);
  assert.deepEqual(automatic.calls.answers, [{ id: 'h1', value: K_NEW }]);
  assert.equal(errorOf(automatic), undefined);
});

test('the server key changed after the app trusted an older one: off asks, changed trusts with source app', async () => {
  const asked = await open({ grant: { hostKeyTrust: 'off' }, state: { trustedHostKeys: { 'host:example.invalid': K_OLD } },
    confirmHostKey: () => true });
  await asked.hostKey(K_NEW);
  assert.equal(asked.calls.confirms.length, 1);
  assert.deepEqual(asked.calls.answers, [{ id: 'h1', value: K_NEW }]);

  const automatic = await open({ grant: { hostKeyTrust: 'changed' }, state: { trustedHostKeys: { 'host:example.invalid': K_OLD } } });
  await automatic.hostKey(K_NEW);
  assert.deepEqual(automatic.calls.answers, [{ id: 'h1', value: K_NEW }]);
  assert.equal(eventsNamed(automatic, 'hostkey.autotrusted')[0].value.source, 'app');
});

test('the system-wide known_hosts is a trust source too: a key there is trusted, an old key there is a change', async () => {
  const trusted = await open({ systemKnown: [ed(K_NEW)] });
  await trusted.hostKey(K_NEW);
  assert.deepEqual(trusted.calls.answers, [{ id: 'h1', value: K_NEW }]);
  assert.ok(trusted.calls.lookups.some(([file]) => file === SYSTEM));

  const changed = await open({ grant: { hostKeyTrust: 'changed' }, systemKnown: [ed(K_OLD)] });
  await changed.hostKey(K_NEW);
  const [event] = eventsNamed(changed, 'hostkey.autotrusted');
  assert.equal(event.value.source, 'user_known_hosts');
  assert.equal(event.value.previous, K_OLD);
});

test('a failure to record an automatically trusted key still accepts for this connection and says it was not saved', async () => {
  const s = await open({ grant: { hostKeyTrust: 'new' }, trustFails: true });
  await s.hostKey(K_NEW);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: K_NEW }]);
  assert.equal(eventsNamed(s, 'hostkey.autotrusted')[0].value.saved, false);
});

test('when the session is aborted before the key is decided, nothing is recorded', async () => {
  const s = await open({ grant: { hostKeyTrust: 'changed' } });
  s.hostKeyNow(K_NEW);
  s.controller.abort();
  await settle();
  assert.equal(s.calls.trusted.length, 0);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: 'no' }]);
  assert.equal(eventsNamed(s, 'hostkey.autotrusted').length, 0);
});

test('the grant mode is validated: a missing mode is off, and an unknown mode is rejected', async () => {
  const s = await open({});
  assert.equal(s.transport.validateGrant({}, pOld).hostKeyTrust, 'off');
  assert.equal(s.transport.validateGrant({ hostKeyTrust: 'changed' }, pOld).hostKeyTrust, 'changed');
  assert.throws(() => s.transport.validateGrant({ hostKeyTrust: 'yes' }, pOld), { message: 'INVALID_REQUEST' });
});

test('T6: commandAutoApprove is kept only with commandApproval on; otherwise it is stored as false', async () => {
  const s = await open({});
  const grantOf = value => s.transport.validateGrant({ sftp: true, root: '/', ...value }, pOld);
  assert.equal(grantOf({ commandApproval: false, commandAutoApprove: true }).commandAutoApprove, false);
  assert.equal(grantOf({ commandApproval: true, commandAutoApprove: true }).commandAutoApprove, true);
  assert.equal(grantOf({ commandApproval: true }).commandAutoApprove, false);
  assert.equal(grantOf({ commandApproval: true, commandAutoApprove: 'yes' }).commandAutoApprove, false);
});

test('classifyHostKey: a file that cannot be read is a change with no previous key, never a new key', () => {
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519', unreadable: true }),
    { kind: 'changed', source: 'user_known_hosts' });
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519', user: [ed(K_NEW)], unreadable: true }),
    { kind: 'trusted', source: 'user_known_hosts' });
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519' }), { kind: 'new' });
});

test('an unreadable known_hosts is never taken as no entry: new mode asks instead of trusting a changed key', async () => {
  const s = await open({ grant: { hostKeyTrust: 'new' }, userKnown: [ed(K_OLD)], unreadable: [USER], confirmHostKey: () => false });
  await s.hostKey(K_NEW);
  assert.equal(s.calls.trusted.length, 0);
  assert.equal(s.calls.confirms.length, 1);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: 'no' }]);
  assert.equal(errorOf(s).code, 'HOST_KEY_UNCONFIRMED');
});

test('an unreadable known_hosts also asks in off mode, and without a handler reports HOST_KEY_CHANGED', async () => {
  const asked = await open({ grant: { hostKeyTrust: 'off' }, unreadable: [USER], confirmHostKey: () => true });
  await asked.hostKey(K_NEW);
  assert.equal(asked.calls.confirms.length, 1);
  assert.equal(asked.calls.confirms[0].previous, undefined);
  assert.equal(asked.calls.confirms[0].source, 'user_known_hosts');
  assert.deepEqual(asked.calls.answers, [{ id: 'h1', value: K_NEW }]);

  const noHandler = await open({ unreadable: [USER] });
  await noHandler.hostKey(K_NEW);
  assert.equal(errorOf(noHandler).code, 'HOST_KEY_CHANGED');
  assert.equal(errorOf(noHandler).detail.source, 'user_known_hosts');
});

test('changed mode may accept a key when the known_hosts cannot be read, showing the source and no previous key', async () => {
  const s = await open({ grant: { hostKeyTrust: 'changed' }, unreadable: [USER] });
  await s.hostKey(K_NEW);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: K_NEW }]);
  const [event] = eventsNamed(s, 'hostkey.autotrusted');
  assert.deepEqual({ kind: event.value.kind, previous: event.value.previous, source: event.value.source },
    { kind: 'changed', previous: null, source: 'user_known_hosts' });
});

test('the system-wide known_hosts that cannot be read is judged the same way: new mode asks', async () => {
  const s = await open({ grant: { hostKeyTrust: 'new' }, unreadable: [SYSTEM], confirmHostKey: () => false });
  await s.hostKey(K_NEW);
  assert.equal(s.calls.trusted.length, 0);
  assert.equal(s.calls.confirms.length, 1);
});

test('a readable entry that matches still trusts the key when the other file cannot be read', async () => {
  const s = await open({ grant: { hostKeyTrust: 'off' }, userKnown: [ed(K_NEW)], unreadable: [SYSTEM], confirmHostKey: () => false });
  await s.hostKey(K_NEW);
  assert.equal(s.calls.confirms.length, 0);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: K_NEW }]);
});

test('a missing known_hosts file is no entry: new mode trusts a key never seen before', async () => {
  const s = await open({ grant: { hostKeyTrust: 'new' }, confirmHostKey: () => false });
  await s.hostKey(K_NEW);
  assert.equal(s.calls.confirms.length, 0);
  assert.deepEqual(eventsNamed(s, 'hostkey.autotrusted')[0].value.kind, 'new');
});

test('classifyHostKey: an agent value that matches is trusted even when the app value differs', () => {
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519', app: [K_OLD], agent: [K_NEW] }),
    { kind: 'trusted', source: 'agent' });
  assert.deepEqual(classifyHostKey({ fingerprint: K_NEW, keyType: 'ED25519', app: [K_OLD], agent: [K_OLD] }),
    { kind: 'changed', previous: K_OLD, source: 'app' });
});

// The app trusts an old key, and the agent already trusts the server's current key.
const appOldAgentNew = () => ({ trustedHostKeys: { 'host:example.invalid': K_OLD }, agent: { trustedHostKeys: { 'host:example.invalid': K_NEW } } });

test('changed mode: a key the agent already trusts is not recorded again on each connection', async () => {
  for (let connection = 1; connection <= 2; connection++) {
    const s = await open({ grant: { hostKeyTrust: 'changed' }, state: appOldAgentNew(), confirmHostKey: () => false });
    await s.hostKey(K_NEW);
    assert.deepEqual(s.calls.answers, [{ id: 'h1', value: K_NEW }], `connection ${connection}`);
    assert.equal(s.calls.trusted.length, 0);
    assert.equal(eventsNamed(s, 'hostkey.autotrusted').length, 0);
    assert.equal(eventsNamed(s, 'hostkey.pinned').length, 1);
    assert.equal(s.calls.confirms.length, 0);
  }
});

test('off mode accepts a key the agent already trusts, without a dialog', async () => {
  const s = await open({ grant: { hostKeyTrust: 'off' }, state: appOldAgentNew(), confirmHostKey: () => false });
  await s.hostKey(K_NEW);
  assert.equal(s.calls.confirms.length, 0);
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: K_NEW }]);
});

test('an agent value that differs from the server key is still a change, reported against the app value', async () => {
  const state = { trustedHostKeys: { 'host:example.invalid': K_OLD }, agent: { trustedHostKeys: { 'host:example.invalid': fingerprint('C') } } };
  const s = await open({ grant: { hostKeyTrust: 'changed' }, state });
  await s.hostKey(K_NEW);
  const [event] = eventsNamed(s, 'hostkey.autotrusted');
  assert.equal(event.value.kind, 'changed');
  assert.equal(event.value.previous, K_OLD);
  assert.equal(event.value.source, 'app');
  assert.deepEqual(s.calls.answers, [{ id: 'h1', value: K_NEW }]);
});

// run(): a fake connection.exec with an EventEmitter child and PassThrough streams. No ssh runs.
function runWith(emit) {
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), killed: false,
    kill() { this.killed = true; } });
  const transport = createTransport({ state: () => ({ profiles: [], terminalTriggers: [] }), snippetScope: () => '', directory: tmp,
    readAnswer: async () => '', validAuthAnswer: () => true, matchesGlobalPattern, approve: async () => true });
  const session = { connection: { exec: () => child }, controller: new AbortController(), profile: 'none', grant: { triggers: [] } };
  const mirrored = [];
  const result = transport.run(session, 'cmd', () => {}, (key, text) => mirrored.push([key, text]));
  emit(child);
  return { result, mirrored, child };
}

test('M1: mirror receives stdout and stderr in the order they arrive, without terminal control codes', async () => {
  const { result, mirrored } = runWith(child => {
    child.stdout.write('out1\n');
    child.stderr.write('err1\n');
    child.stdout.write('\x1b[31mred\x1b[0m\n');
    setImmediate(() => { child.stdout.end(); child.stderr.end(); child.emit('close', 0, null); });
  });
  const value = await result;
  assert.deepEqual(mirrored.map(entry => entry[0]), ['stdout', 'stderr', 'stdout']);
  assert.deepEqual(mirrored.map(entry => entry[1]), ['out1\n', 'err1\n', 'red\n']);
  assert.equal(value.stdout, 'out1\nred\n');
  assert.equal(value.exitCode, 0);
});

test('M2: 70 KB of output mirrors exactly 65536 bytes, kills the command and reports truncated', async () => {
  const { result, mirrored, child } = runWith(child => {
    child.stdout.write('a'.repeat(70_000));
    setImmediate(() => child.emit('close', null, 'SIGTERM'));
  });
  const value = await result;
  assert.equal(mirrored.reduce((sum, entry) => sum + Buffer.byteLength(entry[1]), 0), 65536);
  assert.equal(value.truncated, true);
  assert.equal(value.stdout.length, 65536);
  assert.equal(child.killed, true);
});

test('M3: no output means mirror is never called and the result is unchanged', async () => {
  const { result, mirrored } = runWith(child => setImmediate(() => child.emit('close', 0, null)));
  assert.deepEqual(await result, { stdout: '', stderr: '', exitCode: 0, signal: null, truncated: false });
  assert.deepEqual(mirrored, []);
});

test('M4: a mirror that throws does not change the result', async () => {
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
  const transport = createTransport({ state: () => ({ profiles: [], terminalTriggers: [] }), snippetScope: () => '', directory: tmp,
    readAnswer: async () => '', validAuthAnswer: () => true, matchesGlobalPattern, approve: async () => true });
  const session = { connection: { exec: () => child }, controller: new AbortController(), profile: 'none', grant: { triggers: [] } };
  const result = transport.run(session, 'cmd', () => {}, () => { throw Error('mirror failed'); });
  child.stdout.write('hi');
  setImmediate(() => child.emit('close', 0, null));
  assert.equal((await result).stdout, 'hi');
});

test('D1: download limits default to 16 MiB and 64 staged files, and only whole numbers in range are kept', async () => {
  const s = await open({});
  const grantOf = value => s.transport.validateGrant({ sftp: true, root: '/', download: true, ...value }, pOld);
  assert.deepEqual([grantOf({}).maxMiB, grantOf({}).stagedFiles], [16, 64]);
  assert.deepEqual([grantOf({ maxMiB: 1024, stagedFiles: 1 }).maxMiB, grantOf({ maxMiB: 1024, stagedFiles: 1 }).stagedFiles], [1024, 1]);
  for (const bad of [{ maxMiB: 0 }, { maxMiB: 1025 }, { maxMiB: 1.5 }, { maxMiB: '16' }, { stagedFiles: 0 }, { stagedFiles: 257 }]) {
    assert.throws(() => grantOf(bad), { message: 'INVALID_REQUEST' }, JSON.stringify(bad));
  }
});

// download(): a fake SFTP channel that streams the given bytes, into a staging folder of the test's own.
async function downloadWith(grant, bytes, size = bytes.length) {
  const { Readable } = require('node:stream');
  const directory = await fs.mkdtemp(path.join(tmp, 'download-'));
  const transport = createTransport({ state: () => ({ profiles: [], terminalTriggers: [] }), snippetScope: () => '', directory,
    readAnswer: async () => '', validAuthAnswer: () => true, matchesGlobalPattern, approve: async () => true });
  const session = { controller: new AbortController(), grant };
  const channel = { createReadStream: () => Readable.from([bytes]) };
  return { directory, get: () => transport.download(session, '/srv/file.bin', channel, size) };
}

test('D2: a grant without limits refuses a file over 16 MiB before staging it, and accepts one under it', async () => {
  const big = await downloadWith({}, Buffer.alloc(1), 16 * 1024 * 1024 + 1);
  await assert.rejects(big.get(), { message: 'FILE_LIMIT' });
  await assert.rejects(fs.readdir(path.join(big.directory, 'downloads')), { code: 'ENOENT' });
  const small = await downloadWith({}, Buffer.from('hello'));
  assert.equal((await small.get()).bytes, 5);
});

test('D3: the grant limit applies to the stat size and to the bytes actually read', async () => {
  const mib = 1024 * 1024;
  const allowed = await downloadWith({ maxMiB: 2 }, Buffer.alloc(mib + 1));
  assert.equal((await allowed.get()).bytes, mib + 1);
  const statTooBig = await downloadWith({ maxMiB: 1 }, Buffer.alloc(1), mib + 1);
  await assert.rejects(statTooBig.get(), { message: 'FILE_LIMIT' });
  const grewWhileRead = await downloadWith({ maxMiB: 1 }, Buffer.alloc(mib + 1), 10);
  await assert.rejects(grewWhileRead.get(), { message: 'FILE_LIMIT' });
  assert.deepEqual(await fs.readdir(path.join(grewWhileRead.directory, 'downloads')), []);
});

test('D4: downloads stop when the staging folder holds the grant\'s staged file count', async () => {
  const two = await downloadWith({ stagedFiles: 2 }, Buffer.from('x'));
  await two.get();
  await two.get();
  await assert.rejects(two.get(), { message: 'FILE_LIMIT' });
});
