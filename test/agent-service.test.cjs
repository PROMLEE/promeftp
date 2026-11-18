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
const { createAgentService, protocol } = require('../agent-service.cjs');

const hash = value => createHash('sha256').update(value).digest('hex');
const p1 = { id: 'p1', label: 'Test', host: 'example.invalid', username: 'alice', port: null, keyPath: '', configPath: '' };
const token = randomBytes(32).toString('base64url');
const grant = () => ({ sftp: true, root: '/', download: true, commandApproval: false, savedAuth: false, pam: [], triggers: [],
  route: 'route', fingerprint: hash(JSON.stringify(p1)) });
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
async function start(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });
  const dir = path.join(root, `case-${++counter}`);
  await fs.mkdir(dir, { mode: 0o700 });
  const st = { agent: { enabled: true, clients: [{ id: 'c1', name: 'test', digest: hash(token), grants: { p1: grant() } }] } };
  const fake = { notify: null, connection: null, answers: [], downloads: 0 };
  const transport = {
    eligible: () => true,
    nextFor: () => [{ action: 'ask_user', message: 'Check PromeFTP.' }],
    connect(p, g, mode, notify) {
      fake.notify = notify;
      fake.connection = { channel: {}, close() {}, answer(id, value) { fake.answers.push([id, value]); return true; } };
      return Promise.resolve(fake.connection);
    },
    // Never resolves, so a request holds the active slot until the 30 second limit.
    download() { fake.downloads++; return new Promise(() => {}); },
  };
  const sftpCall = async (channel, op, arg) => {
    if (op === 'realpath') return arg;
    if (op === 'lstat') return file;
    throw Object.assign(new Error('no such file'), { code: 2 });
  };
  const service = await createAgentService({ directory: dir, state: () => st, save: async () => {}, profiles: () => [p1],
    transport, sftpCall, busy: () => {}, socketDir: dir });
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
  return { service, fake, st, dir, call, open, status, wait };
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
