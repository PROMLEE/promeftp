// Agent session lifecycle: the status a client sees, the authentication deadline, and session.wait. The real service
// listens on a Unix socket in a temporary directory, with a fake ssh transport. Time comes from node:test mock timers.
// No file under the app's data folder or the real agent socket is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { createHash, randomBytes } = require('node:crypto');
const { createAgentService, protocol, historyOf } = require('../agent-service.cjs');

const hash = value => createHash('sha256').update(value).digest('hex');
const p1 = { id: 'p1', label: 'Test', host: 'example.invalid', username: 'alice', port: null, keyPath: '', configPath: '' };
const token = randomBytes(32).toString('base64url');
// A grant as an older app version saved it: the fingerprint is the whole bookmark, so the service migrates it at start.
const grant = (p = p1) => ({ sftp: true, root: '/', download: true, commandApproval: false, savedAuth: false, pam: [], triggers: [],
  route: 'route', fingerprint: hash(JSON.stringify(p)) });
// The fingerprint the service writes now: connection fields only, in this order.
const stampOf = p => hash(JSON.stringify({ host: p.host, hostname: p.hostname || '', port: p.port ?? null, username: p.username || '',
  keyPath: p.keyPath || '', configPath: p.configPath || '', usesAlias: p.usesAlias === true, pam: p.pam === true }));
const file = { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true, size: 10, mtime: new Date(0) };

let root;
test.before(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'promeftp-svc-')); });
test.after(async () => { await fs.rm(root, { recursive: true, force: true }); });

async function until(check) {
  for (let i = 0; i < 3000; i++) {
    if (check()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw Error('timed out waiting for the service');
}
async function settle() {
  for (let i = 0; i < 50; i++) await new Promise(resolve => setImmediate(resolve));
}
function request(dir, body) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path.join(dir, 'api.sock'));
    let text = '';
    // Written without half-closing, as the Swift CLI does, so the server can answer after a wait.
    socket.on('connect', () => socket.write(JSON.stringify({ version: protocol, token, ...body }) + '\n'));
    socket.on('data', chunk => { text += chunk; });
    socket.on('end', () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
    socket.on('error', reject);
  });
}

let counter = 0;
// Starts a service with mock timers enabled first, so its interval and the socket timers are controlled by the test.
// profiles and permission(profile) default to the test bookmark with its older-style grant.
async function start(t, { profiles = [p1], permission = p => grant(p), onView } = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });
  const dir = path.join(root, `case-${++counter}`);
  await fs.mkdir(dir, { mode: 0o700 });
  const st = { agent: { enabled: true, clients: [{ id: 'c1', name: 'test', digest: hash(token),
    grants: Object.fromEntries(profiles.map(p => [p.id, permission(p)])) }] } };
  const fake = { notify: null, connection: null, answers: [], downloads: 0, approvals: [], approved: true, runs: 0, mirror: null, shells: [] };
  const transport = {
    eligible: () => true,
    nextFor: () => [{ action: 'ask_user', message: 'Check PromeFTP.' }],
    connect(p, g, mode, notify) {
      fake.notify = notify;
      fake.connection = { channel: {}, close() { fake.closes = (fake.closes || 0) + 1; }, shell(...args) { fake.shells.push(args); return { close() {} }; }, answer(id, value) { fake.answers.push([id, value]); return true; } };
      return Promise.resolve(fake.connection);
    },
    // Never resolves, so a request holds the active slot until the 30 second limit.
    download() { fake.downloads++; return new Promise(() => {}); },
    command: value => value,
    approve: async (...args) => { fake.approvals.push(args); return fake.approved; },
    run: async (s, command, notify, mirror) => { fake.runs++; if (fake.hang) return new Promise(() => {}); fake.mirror?.(mirror); return { exitCode: 0, truncated: false }; },
  };
  const sftpCall = async (channel, op, arg) => {
    if (op === 'realpath') return arg;
    if (op === 'lstat') return file;
    throw Object.assign(new Error('no such file'), { code: 2 });
  };
  // Applies each change to the in-memory settings, as the app's save does before the service reads them again.
  const saves = { count: 0 };
  const service = await createAgentService({ directory: dir, state: () => st, save: async change => { saves.count++; change(st.agent); },
    profiles: () => profiles, transport, sftpCall, busy: () => {}, socketDir: dir, ...(onView && { onView }) });
  await service.listen();
  t.after(() => service.stop());
  const call = body => request(dir, body);
  // Opens an SFTP session and waits until the transport has started the connection.
  async function open() {
    const res = await call({ method: 'session.open', params: { profile: 'p1', mode: 'sftp' } });
    await until(() => fake.notify);
    return res.data.session;
  }
  const status = session => call({ method: 'session.status', params: { session } });
  const wait = (session, timeout) => call({ method: 'session.wait', params: timeout === undefined ? { session } : { session, timeout } });
  return { service, fake, st, dir, call, open, status, wait, saves };
}
// A service whose socket path is already taken: by another live listener, or by a file that is not a socket.
// Nothing listens on it through the service, so the test decides when it is released.
async function occupiedService(t, { plainFile = false } = {}) {
  const dir = path.join(root, `occupied-${++counter}`);
  await fs.mkdir(dir, { mode: 0o700 });
  let blocker;
  if (plainFile) await fs.writeFile(path.join(dir, 'api.sock'), '');
  else {
    blocker = net.createServer();
    await new Promise(resolve => blocker.listen(path.join(dir, 'api.sock'), resolve));
  }
  const st = { agent: { enabled: true, clients: [] } };
  const service = await createAgentService({ directory: dir, state: () => st, save: async change => change(st.agent), profiles: () => [p1],
    transport: { eligible: () => true, nextFor: () => [] }, sftpCall: async () => file, busy: () => {}, socketDir: dir });
  t.after(() => { service.stop(); if (blocker?.listening) blocker.close(); });
  return { service, st, blocker };
}

test('a new session is connecting, its status carries a wait step, and it expires 120 seconds after open', async t => {
  const ctx = await start(t);
  const opened = Date.now();
  const session = await ctx.open();
  const { data } = await ctx.status(session);
  assert.equal(data.status, 'connecting');
  assert.equal(data.expires, opened + 120_000);
  assert.equal(data.retryAfter, 2);
  assert.deepEqual(data.next.map(step => step.action), ['wait']);
});

test('a prompt moves the session to waiting_for_user and extends the deadline to 180 seconds from now', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  t.mock.timers.tick(10_000);
  ctx.fake.notify('prompt', { id: 'q1', prompt: 'Verification code: ' });
  const { data } = await ctx.status(session);
  assert.equal(data.status, 'waiting_for_user');
  assert.equal(data.expires, Date.now() + 180_000);
  assert.equal(data.next[0].action, 'wait');
});

test('prompt extends deadline, capped at 600s from open', async t => {
  const ctx = await start(t);
  const opened = Date.now();
  const session = await ctx.open();
  const expiresAfterPrompt = async () => (await ctx.status(session)).data.expires;
  t.mock.timers.tick(110_000);
  ctx.fake.notify('prompt', { id: 'q1', prompt: 'Verification code: ' });
  assert.equal(await expiresAfterPrompt(), opened + 290_000);
  t.mock.timers.tick(170_000);
  ctx.fake.notify('prompt', { id: 'q2', prompt: 'Verification code: ' });
  assert.equal(await expiresAfterPrompt(), opened + 460_000);
  t.mock.timers.tick(170_000);
  ctx.fake.notify('prompt', { id: 'q3', prompt: 'Verification code: ' });
  assert.equal(await expiresAfterPrompt(), opened + 600_000);
  t.mock.timers.tick(140_000);
  ctx.fake.notify('prompt', { id: 'q4', prompt: 'Verification code: ' });
  assert.equal(await expiresAfterPrompt(), opened + 600_000);
  assert.equal((await ctx.status(session)).data.status, 'waiting_for_user');
});

test('an answer given within the extended deadline still reaches the connection', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  t.mock.timers.tick(110_000);
  ctx.fake.notify('prompt', { id: 'q1', prompt: 'Verification code: ' });
  t.mock.timers.tick(150_000);
  ctx.service.answer(session, 'q1', '123456');
  assert.deepEqual(ctx.fake.answers, [['q1', '123456']]);
  assert.equal((await ctx.status(session)).data.status, 'connecting');
});

test('without an answer the session ends with AUTH_TIMEOUT, and the closed status asks the user', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  t.mock.timers.tick(120_000);
  const { data } = await ctx.status(session);
  assert.equal(data.status, 'closed');
  assert.equal(data.reason, 'AUTH_TIMEOUT');
  assert.equal(data.next[0].action, 'ask_user');
  assert.equal('expires' in data, false);
});

test('a ready session reports only its status', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  ctx.fake.notify('ready', { endpoint: '' });
  assert.deepEqual((await ctx.status(session)).data, { session, status: 'ready' });
});

test('a session the server closes after ready reports REMOTE_CLOSED with a retry step', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  ctx.fake.notify('ready', { endpoint: '' });
  ctx.fake.notify('closed');
  const { data } = await ctx.status(session);
  assert.equal(data.reason, 'REMOTE_CLOSED');
  assert.deepEqual(data.next.map(step => step.action), ['retry']);
});

test('a failed connection reports its error with error.next, which replaces the reason step', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  ctx.fake.notify('error', { code: 'AUTH_FAILED', stage: 'auth', hint: 'Check the key.', exit: 255,
    next: [{ action: 'ask_user', message: 'Saved credentials were rejected.' }] });
  ctx.fake.notify('closed');
  const { data } = await ctx.status(session);
  // The reason is why the session ended (it was still connecting). The failure itself is in error.code.
  assert.equal(data.reason, 'CONNECT_FAILED');
  assert.equal(data.error.code, 'AUTH_FAILED');
  assert.deepEqual(data.next, [{ action: 'ask_user', message: 'Saved credentials were rejected.' }]);
});

test('idle sessions close with IDLE_TIMEOUT after 10 minutes without requests, with a retry step', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  ctx.fake.notify('ready', { endpoint: '' });
  t.mock.timers.tick(600_001);
  const { data } = await ctx.status(session);
  assert.equal(data.reason, 'IDLE_TIMEOUT');
  assert.deepEqual(data.next.map(step => step.action), ['retry']);
});

test('a client that closes its session gets CLIENT_CLOSED with no next step', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  await ctx.call({ method: 'session.close', params: { session } });
  const { data } = await ctx.status(session);
  assert.equal(data.reason, 'CLIENT_CLOSED');
  assert.deepEqual(data.next, []);
});

test('a user who cancels authentication gets USER_CANCELLED and an ask_user step', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  ctx.fake.notify('prompt', { id: 'q1', prompt: 'Verification code: ' });
  ctx.service.answer(session, 'q1', null);
  const { data } = await ctx.status(session);
  assert.equal(data.reason, 'USER_CANCELLED');
  assert.deepEqual(data.next.map(step => step.action), ['ask_user']);
});

test('a permission change ends the session with PERMISSION_CHANGED and an ask_user step', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  ctx.st.agent.clients[0].grants.p1 = { ...grant(), download: false };
  t.mock.timers.tick(1000);
  const { data } = await ctx.status(session);
  assert.equal(data.reason, 'PERMISSION_CHANGED');
  assert.deepEqual(data.next.map(step => step.action), ['ask_user']);
});

test('stopping the service ends sessions with SERVICE_DISABLED and an ask_user step', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  // The listener is closed by stop(), so the session can only be checked through the activity record.
  ctx.service.stop();
  assert.deepEqual(ctx.service.history({ session, operation: 'session.ended' }).map(row => row.reason), ['SERVICE_DISABLED']);
});

test('a request that runs past 30 seconds ends the session with TIMEOUT and a retry step', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  ctx.fake.notify('ready', { endpoint: '' });
  const pending = ctx.call({ method: 'sftp.download', params: { session, path: '/x' } });
  await until(() => ctx.fake.downloads === 1);
  t.mock.timers.tick(30_000);
  assert.equal((await pending).error, 'TIMEOUT');
  const { data } = await ctx.status(session);
  assert.equal(data.reason, 'TIMEOUT');
  assert.deepEqual(data.next.map(step => step.action), ['retry']);
});

test('session.wait returns at once when the session is already ready', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  ctx.fake.notify('ready', { endpoint: '' });
  assert.deepEqual((await ctx.wait(session, 5000)).data, { session, status: 'ready' });
});

test('session.wait returns when the status changes, without waiting for the timeout', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  const pending = ctx.wait(session);
  await until(() => ctx.service.history({ operation: 'session.wait' }).length === 1);
  const before = Date.now();
  ctx.fake.notify('ready', { endpoint: '' });
  assert.deepEqual((await pending).data, { session, status: 'ready' });
  assert.equal(Date.now() - before, 0);
});

test('status change wakes waiters: every waiting call returns on the same change', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  const first = ctx.wait(session);
  const second = ctx.wait(session, 20_000);
  await until(() => ctx.service.history({ operation: 'session.wait' }).length === 2);
  ctx.fake.notify('prompt', { id: 'q1', prompt: 'Verification code: ' });
  assert.equal((await first).data.status, 'waiting_for_user');
  assert.equal((await second).data.status, 'waiting_for_user');
});

test('session.wait returns the current connecting status after its timeout when nothing changes', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  const pending = ctx.wait(session, 5000);
  await until(() => ctx.service.history({ operation: 'session.wait' }).length === 1);
  t.mock.timers.tick(5000);
  const { data } = await pending;
  assert.equal(data.status, 'connecting');
  assert.equal(data.retryAfter, 2);
});

test('a wait longer than 30 seconds does not close the session: it stays open past 30 seconds', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  const pending = ctx.wait(session);
  await until(() => ctx.service.history({ operation: 'session.wait' }).length === 1);
  t.mock.timers.tick(25_000);
  assert.equal((await pending).data.status, 'connecting');
  t.mock.timers.tick(10_000);
  const { data } = await ctx.status(session);
  assert.equal(data.status, 'connecting');
  assert.equal(ctx.service.history({ session, operation: 'session.ended' }).length, 0);
});

test('session.wait with no timeout waits 25 seconds', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  let done = false;
  const pending = ctx.wait(session).then(response => { done = true; return response; });
  await until(() => ctx.service.history({ operation: 'session.wait' }).length === 1);
  t.mock.timers.tick(24_999);
  await settle();
  assert.equal(done, false);
  t.mock.timers.tick(1);
  assert.equal((await pending).data.status, 'connecting');
});

test('session.wait rejects a timeout outside 1000 to 25000 milliseconds, or not a number', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  for (const timeout of [999, 30000, '5000']) {
    assert.equal((await ctx.wait(session, timeout)).error, 'INVALID_REQUEST', `timeout ${timeout}`);
  }
});

test('session.wait on a session that already ended returns the closed status at once', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  ctx.fake.notify('closed');
  const { data } = await ctx.wait(session, 5000);
  assert.equal(data.status, 'closed');
  assert.equal(data.reason, 'CONNECT_FAILED');
  assert.ok(Array.isArray(data.next));
});

test('the wait call does not hold the active request slot: a request during a wait is not refused as busy', async t => {
  const ctx = await start(t);
  const session = await ctx.open();
  const pending = ctx.wait(session);
  await until(() => ctx.service.history({ operation: 'session.wait' }).length === 1);
  ctx.fake.notify('ready', { endpoint: '' });
  await pending;
  const res = await ctx.call({ method: 'session.status', params: { session } });
  assert.equal(res.data.status, 'ready');
});

// Opens an SSH session (mode ssh), which needs command approval or a task in the grant, and makes it ready.
async function openSsh(ctx) {
  const res = await ctx.call({ method: 'session.open', params: { profile: 'p1', mode: 'ssh' } });
  await until(() => ctx.fake.notify);
  ctx.fake.notify('ready', { endpoint: '' });
  return res.data.session;
}

test('T1: a label or folder change keeps the grant: not stale, still in profiles.list, and a session still opens', async t => {
  const bookmark = { ...p1, group: '' };
  const ctx = await start(t, { profiles: [bookmark] });
  bookmark.label = 'Renamed';
  bookmark.group = 'Production';
  assert.equal(ctx.service.info().clients[0].grants.p1.stale, false);
  assert.deepEqual((await ctx.call({ method: 'profiles.list' })).data.map(p => p.id), ['p1']);
  const opened = await ctx.call({ method: 'session.open', params: { profile: 'p1', mode: 'sftp' } });
  assert.equal(opened.error, undefined);
  assert.equal(opened.data.status, 'connecting');
});

test('T2: a grant saved with the old whole-bookmark fingerprint is moved to the new one once, at startup', async t => {
  const ctx = await start(t);
  assert.equal(ctx.st.agent.clients[0].grants.p1.fingerprint, stampOf(p1));
  assert.equal(ctx.service.info().clients[0].grants.p1.stale, false);
  assert.equal(ctx.saves.count, 1);
});

test('T2b: a grant that matches neither fingerprint stays stale, and startup saves nothing', async t => {
  const older = hash('an older bookmark');
  const ctx = await start(t, { permission: p => ({ ...grant(p), fingerprint: older }) });
  assert.equal(ctx.st.agent.clients[0].grants.p1.fingerprint, older);
  assert.equal(ctx.service.info().clients[0].grants.p1.stale, true);
  assert.equal(ctx.saves.count, 0);
});

test('T3: with commandAutoApprove, ssh.command runs without asking and the activity records AUTO_APPROVED', async t => {
  const ctx = await start(t, { permission: p => ({ ...grant(p), commandApproval: true, commandAutoApprove: true }) });
  const session = await openSsh(ctx);
  const res = await ctx.call({ method: 'ssh.command', params: { session, command: 'uptime' } });
  assert.deepEqual(res.data, { exitCode: 0, truncated: false });
  assert.equal(ctx.fake.approvals.length, 0);
  assert.equal(ctx.fake.runs, 1);
  const rows = ctx.service.history({ session, operation: 'ssh.approval' });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].result, rows[0].reason], ['allowed', 'AUTO_APPROVED']);
  // The command row records the command as auto-approved, not as user-approved.
  // Two rows per command: the start (allowed) and the finish (success). The finish row carries the final detail.
  const commandRows = ctx.service.history({ session, operation: 'ssh.command' });
  const finished = commandRows.at(-1);
  assert.equal(finished.result, 'success');
  assert.equal(JSON.parse(finished.detail).target, 'auto-approved command');
});

test('historyOf: with no service (startup failed) the history is empty; with a service it is that service history', async t => {
  assert.deepEqual(historyOf(undefined, { session: 'x' }), []);
  const ctx = await start(t);
  const seen = [];
  const rows = historyOf({ history: filter => { seen.push(filter); return ['row']; } }, { client: 'c1' });
  assert.deepEqual(rows, ['row']);
  assert.deepEqual(seen, [{ client: 'c1' }]);
  assert.ok(Array.isArray(ctx.service.history({})));
});

test('T4: enabled stays the saved setting, and a socket held by another listener is the offline reason SOCKET_IN_USE', async t => {
  const { service } = await occupiedService(t);
  await assert.rejects(service.listen(), { agentCode: 'SOCKET_IN_USE' });
  const info = service.info();
  assert.equal(info.enabled, true);
  assert.equal(info.online, false);
  assert.equal(info.offlineReason, 'SOCKET_IN_USE');
});

test('T4b: a socket path that is not a socket gives the offline reason UNSAFE_SOCKET', async t => {
  const { service } = await occupiedService(t, { plainFile: true });
  await assert.rejects(service.listen(), { agentCode: 'UNSAFE_SOCKET' });
  assert.equal(service.info().offlineReason, 'UNSAFE_SOCKET');
});

test('T5: a change of host or port makes the grant stale, and the bookmark leaves profiles.list', async t => {
  const bookmark = { ...p1 };
  const ctx = await start(t, { profiles: [bookmark] });
  bookmark.host = 'other.invalid';
  assert.equal(ctx.service.info().clients[0].grants.p1.stale, true);
  assert.deepEqual((await ctx.call({ method: 'profiles.list' })).data, []);
  bookmark.host = p1.host;
  bookmark.port = 2222;
  assert.equal(ctx.service.info().clients[0].grants.p1.stale, true);
});

test('T7: when no grant needs migrating, startup does not save', async t => {
  const ctx = await start(t, { permission: p => ({ ...grant(p), fingerprint: stampOf(p) }) });
  assert.equal(ctx.saves.count, 0);
  assert.equal(ctx.service.info().clients[0].grants.p1.stale, false);
});

test('T8: without commandAutoApprove the approval window decides, and a refusal is USER_DENIED', async t => {
  const ctx = await start(t, { permission: p => ({ ...grant(p), commandApproval: true, commandAutoApprove: false }) });
  const session = await openSsh(ctx);
  ctx.fake.approved = false;
  const res = await ctx.call({ method: 'ssh.command', params: { session, command: 'uptime' } });
  assert.equal(res.error, 'USER_DENIED');
  assert.equal(ctx.fake.approvals.length, 1);
  assert.equal(ctx.fake.runs, 0);
});

test('T9: once the socket is released, enable(true) (Try Again) brings the service online with no offline reason', async t => {
  const { service, blocker } = await occupiedService(t);
  await assert.rejects(service.listen(), { agentCode: 'SOCKET_IN_USE' });
  await new Promise(resolve => blocker.close(resolve));
  await service.enable(true);
  const info = service.info();
  assert.equal(info.online, true);
  assert.equal(info.offlineReason, '');
});

test('T10: a grant saved before commandAutoApprove existed still asks for approval', async t => {
  const ctx = await start(t, { permission: p => ({ ...grant(p), commandApproval: true }) });
  const session = await openSsh(ctx);
  const res = await ctx.call({ method: 'ssh.command', params: { session, command: 'uptime' } });
  assert.equal(res.error, undefined);
  assert.equal(ctx.fake.approvals.length, 1);
  assert.deepEqual(ctx.service.history({ session, operation: 'ssh.approval' }).map(row => [row.result, row.reason]),
    [['waiting_for_user', null], ['allowed', null]]);
});

// Live view events for the terminal tab (onView).
function viewStart(t, options = {}) {
  const events = [];
  return start(t, { onView: event => events.push(event), ...options }).then(ctx => ({ ...ctx, events }));
}
const viewTypes = events => events.map(event => event.type);

test('V1: an ssh session sends one open event when it is ready, with the bookmark label and the client name', async t => {
  const ctx = await viewStart(t, { permission: p => ({ ...grant(p), commandApproval: true }) });
  const session = await openSsh(ctx);
  assert.deepEqual(ctx.events, [{ session, type: 'open', label: 'Test', client: 'test' }]);
});

test('V2: an sftp session sends no view events, not even when it closes', async t => {
  const ctx = await viewStart(t);
  const session = await ctx.open();
  ctx.fake.notify('ready', { endpoint: '' });
  await ctx.call({ method: 'session.close', params: { session } });
  assert.deepEqual(ctx.events, []);
});

test('V3: a refused approval sends approval then failed USER_DENIED, and no command or output', async t => {
  const ctx = await viewStart(t, { permission: p => ({ ...grant(p), commandApproval: true }) });
  const session = await openSsh(ctx);
  ctx.fake.approved = false;
  const res = await ctx.call({ method: 'ssh.command', params: { session, command: 'uptime' } });
  assert.equal(res.error, 'USER_DENIED');
  assert.deepEqual(viewTypes(ctx.events), ['open', 'approval', 'failed']);
  assert.deepEqual(ctx.events[1], { session, type: 'approval', command: 'uptime' });
  assert.deepEqual(ctx.events[2], { session, type: 'failed', code: 'USER_DENIED' });
});

test('V4: an approved command sends approval, command (approved), output and result in order', async t => {
  const ctx = await viewStart(t, { permission: p => ({ ...grant(p), commandApproval: true }) });
  ctx.fake.mirror = mirror => mirror('stdout', 'hello\n');
  const session = await openSsh(ctx);
  const res = await ctx.call({ method: 'ssh.command', params: { session, command: 'uptime' } });
  assert.deepEqual(res.data, { exitCode: 0, truncated: false });
  assert.deepEqual(viewTypes(ctx.events), ['open', 'approval', 'command', 'output', 'result']);
  assert.deepEqual(ctx.events[2], { session, type: 'command', command: 'uptime', how: 'approved' });
  assert.deepEqual(ctx.events[3], { session, type: 'output', stream: 'stdout', text: 'hello\n' });
  assert.equal(ctx.events[4].exitCode, 0);
  assert.equal(ctx.events[4].truncated, false);
});

test('V5: an auto-approved command skips the approval event and says how it was approved', async t => {
  const ctx = await viewStart(t, { permission: p => ({ ...grant(p), commandApproval: true, commandAutoApprove: true }) });
  const session = await openSsh(ctx);
  await ctx.call({ method: 'ssh.command', params: { session, command: 'uptime' } });
  assert.deepEqual(viewTypes(ctx.events), ['open', 'command', 'result']);
  assert.equal(ctx.events[1].how, 'auto');
});

test('V6: a named task sends command with how task and the task name', async t => {
  const ctx = await viewStart(t, { permission: p => ({ ...grant(p), task: { name: 'disk', command: 'df -h' } }) });
  const session = await openSsh(ctx);
  const res = await ctx.call({ method: 'ssh.run', params: { session, task: 'disk' } });
  assert.equal(res.error, undefined);
  assert.deepEqual(ctx.events[1], { session, type: 'command', command: 'df -h', how: 'task', task: 'disk' });
});

test('V7: a throwing onView does not change the result of the request', async t => {
  const ctx = await start(t, { permission: p => ({ ...grant(p), commandApproval: true, commandAutoApprove: true }),
    onView: () => { throw Error('view failed'); } });
  const session = await openSsh(ctx);
  const res = await ctx.call({ method: 'ssh.command', params: { session, command: 'uptime' } });
  assert.deepEqual(res.data, { exitCode: 0, truncated: false });
  assert.equal(res.error, undefined);
});

test('V8: closeFromUser ends the session as USER_CLOSED with its next step and sends closed once', async t => {
  const ctx = await viewStart(t, { permission: p => ({ ...grant(p), commandApproval: true }) });
  const session = await openSsh(ctx);
  assert.equal(ctx.service.closeFromUser(session), true);
  assert.deepEqual(ctx.events.filter(event => event.type === 'closed'), [{ session, type: 'closed', reason: 'USER_CLOSED' }]);
  assert.equal(ctx.fake.closes, 1);
  const { data } = await ctx.status(session);
  assert.equal(data.status, 'closed');
  assert.equal(data.reason, 'USER_CLOSED');
  assert.equal(data.next[0].action, 'ask_user');
  assert.match(data.next[0].message, /closed this session/);
  assert.deepEqual(ctx.service.history({ session, operation: 'session.ended' }).map(row => row.reason), ['USER_CLOSED']);
});

test('V9: closeFromUser on a session that is already closed or unknown does nothing', async t => {
  const ctx = await viewStart(t, { permission: p => ({ ...grant(p), commandApproval: true }) });
  const session = await openSsh(ctx);
  await ctx.call({ method: 'session.close', params: { session } });
  const before = ctx.events.length;
  assert.equal(ctx.service.closeFromUser(session), false);
  assert.equal(ctx.service.closeFromUser('missing'), false);
  assert.equal(ctx.events.length, before);
  assert.deepEqual(ctx.service.history({ session, operation: 'session.ended' }).map(row => row.reason), ['CLIENT_CLOSED']);
});

test('V10: a remote close sends closed with REMOTE_CLOSED', async t => {
  const ctx = await viewStart(t, { permission: p => ({ ...grant(p), commandApproval: true }) });
  const session = await openSsh(ctx);
  ctx.fake.notify('closed');
  assert.deepEqual(ctx.events.at(-1), { session, type: 'closed', reason: 'REMOTE_CLOSED' });
});

test('V11: openShell reaches the connection only for a viewed, ready session, and the shell data stays with the caller', async t => {
  const ctx = await viewStart(t, { permission: p => ({ ...grant(p), commandApproval: true }) });
  const session = await openSsh(ctx);
  const onData = () => {};
  const onExit = () => {};
  ctx.service.openShell(session, { cols: 90, rows: 30 }, onData, onExit);
  assert.deepEqual(ctx.fake.shells, [[{ cols: 90, rows: 30 }, onData, onExit]]);
  assert.throws(() => ctx.service.openShell('missing', {}, onData, onExit), { agentCode: 'SESSION_NOT_FOUND' });
  ctx.service.closeFromUser(session);
  assert.throws(() => ctx.service.openShell(session, {}, onData, onExit), { agentCode: 'SESSION_NOT_FOUND' });
});

test('V12: a command that runs past 30 seconds sends failed TIMEOUT before closed TIMEOUT, and no result', async t => {
  const ctx = await viewStart(t, { permission: p => ({ ...grant(p), commandApproval: true, commandAutoApprove: true }) });
  ctx.fake.hang = true;
  const session = await openSsh(ctx);
  const pending = ctx.call({ method: 'ssh.command', params: { session, command: 'sleep 99' } });
  await until(() => ctx.fake.runs === 1);
  t.mock.timers.tick(30_000);
  assert.equal((await pending).error, 'TIMEOUT');
  assert.deepEqual(viewTypes(ctx.events), ['open', 'command', 'failed', 'closed']);
  assert.equal(ctx.events[2].code, 'TIMEOUT');
  assert.equal(ctx.events[3].reason, 'TIMEOUT');
});

test('V13: touchFromUser keeps a viewed session from idling out, and adds no audit row', async t => {
  const ctx = await viewStart(t, { permission: p => ({ ...grant(p), commandApproval: true }) });
  const session = await openSsh(ctx);
  const rows = () => ctx.service.history({ session }).length;
  const before = rows();
  t.mock.timers.tick(9 * 60_000);
  assert.equal(ctx.service.touchFromUser(session), true);
  assert.equal(rows(), before);
  t.mock.timers.tick(9 * 60_000);
  assert.equal((await ctx.status(session)).data.status, 'ready');
  t.mock.timers.tick(11 * 60_000);
  assert.equal((await ctx.status(session)).data.reason, 'IDLE_TIMEOUT');
  assert.equal(ctx.service.touchFromUser(session), false);
  assert.equal(ctx.service.touchFromUser('missing'), false);
});
