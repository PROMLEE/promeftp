// Characterization tests for transfer-service.cjs. The transfer itself is replaced by a fake execute(),
// and the queue and history files live in a temporary directory that each test removes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTransferService } = require('../transfer-service.cjs');

async function setup(execute, { seed, withHistory = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'promeftp-transfer-'));
  const file = path.join(dir, 'transfers.json');
  const historyFile = withHistory ? path.join(dir, 'history.jsonl') : undefined;
  if (seed) await fs.writeFile(file, JSON.stringify(seed));
  const emitted = [];
  const service = createTransferService({ file, historyFile, execute, emit: (jobs, job) => emitted.push({ jobs, job }) });
  await service.start();
  // stop() waits for running transfers and pending file writes, so the directory is not removed under them.
  const cleanup = async () => {
    await service.stop();
    await fs.rm(dir, { recursive: true, force: true });
  };
  return { dir, file, historyFile, service, emitted, cleanup };
}

async function waitFor(check, description) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for: ${description}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

// A promise the test resolves when it wants a blocked execute() to continue.
function gate() {
  let open;
  const promise = new Promise(resolve => { open = resolve; });
  return { promise, open };
}

test('an enqueued transfer runs, leaves the queue, and is logged to history', async t => {
  const env = await setup(async (job, signal, progress) => { progress({ bytes: 4, total: 4 }); });
  t.after(env.cleanup);
  const id = await env.service.enqueue({ operation: 'upload', label: 'a.txt', sessionId: 's1', localPath: '/x', remotePath: '/y' });
  await waitFor(() => env.service.list().length === 0, 'queue empties');
  const history = await env.service.history();
  assert.equal(history.length, 1);
  assert.equal(history[0].id, id);
  assert.equal(history[0].state, 'completed');
  assert.equal(history[0].label, 'a.txt');
  assert.equal(history[0].bytes, 4);
  assert.equal(history[0].total, 4);
});

test('a result with status skipped is recorded as skipped', async t => {
  const env = await setup(async () => ({ status: 'skipped', skippedCount: 3 }));
  t.after(env.cleanup);
  await env.service.enqueue({ operation: 'download', sessionId: 's1' });
  await waitFor(() => env.service.list().length === 0, 'queue empties');
  assert.deepEqual((await env.service.history()).map(entry => entry.state), ['skipped']);
});

test('a failed transfer stays queued with its error until it is retried', async t => {
  let calls = 0;
  const env = await setup(async () => { calls += 1; if (calls === 1) throw new Error('boom'); });
  t.after(env.cleanup);
  const id = await env.service.enqueue({ operation: 'download', sessionId: 's1' });
  await waitFor(() => env.service.list()[0]?.state === 'failed', 'job fails');
  assert.equal(env.service.list()[0].error, 'boom');
  await env.service.control(id, 'retry');
  await waitFor(() => env.service.list().length === 0, 'retry finishes');
  assert.equal(calls, 2);
  assert.deepEqual((await env.service.history()).map(entry => entry.state), ['completed', 'failed']);
});

test('error text is cut to 500 characters', async t => {
  const env = await setup(async () => { throw new Error('x'.repeat(900)); });
  t.after(env.cleanup);
  await env.service.enqueue({ operation: 'upload', sessionId: 's1' });
  await waitFor(() => env.service.list()[0]?.state === 'failed', 'job fails');
  assert.equal(env.service.list()[0].error.length, 500);
});

test('a queued transfer can be cancelled before it starts', async t => {
  const blocker = gate();
  const ran = [];
  const env = await setup(async job => { ran.push(job.label); if (job.label === 'first') await blocker.promise; });
  t.after(env.cleanup);
  await env.service.enqueue({ operation: 'upload', label: 'first', sessionId: 's1' });
  const second = await env.service.enqueue({ operation: 'upload', label: 'second', sessionId: 's1' });
  await waitFor(() => ran.includes('first'), 'first starts');
  await env.service.control(second, 'cancel');
  assert.equal(env.service.list().some(job => job.id === second), false, 'cancelled job leaves the queue');
  blocker.open();
  await waitFor(() => env.service.list().length === 0, 'queue empties');
  assert.deepEqual(ran, ['first'], 'the cancelled job never runs');
  assert.deepEqual((await env.service.history()).map(entry => [entry.label, entry.state]), [['first', 'completed'], ['second', 'cancelled']]);
});

test('a running transfer is aborted by cancel and recorded as cancelled', async t => {
  let started = false;
  const env = await setup((job, signal) => new Promise((resolve, reject) => {
    started = true;
    signal.addEventListener('abort', () => reject(new Error('aborted by test')));
  }));
  t.after(env.cleanup);
  const id = await env.service.enqueue({ operation: 'upload', sessionId: 's1' });
  await waitFor(() => started, 'transfer starts');
  await env.service.control(id, 'cancel');
  await waitFor(() => env.service.list().length === 0, 'cancelled job leaves the queue');
  assert.deepEqual((await env.service.history()).map(entry => entry.state), ['cancelled']);
});

test('a paused queued transfer waits until it is resumed', async t => {
  const blocker = gate();
  const ran = [];
  const env = await setup(async job => { ran.push(job.label); if (job.label === 'first') await blocker.promise; });
  t.after(env.cleanup);
  await env.service.enqueue({ operation: 'upload', label: 'first', sessionId: 's1' });
  const second = await env.service.enqueue({ operation: 'upload', label: 'second', sessionId: 's1' });
  await waitFor(() => ran.includes('first'), 'first starts');
  await env.service.control(second, 'pause');
  assert.equal(env.service.list().find(job => job.id === second).state, 'paused');
  blocker.open();
  await waitFor(() => env.service.list().length === 1 && env.service.list()[0].id === second, 'first finishes');
  assert.deepEqual(ran, ['first']);
  await env.service.control(second, 'resume');
  await waitFor(() => env.service.list().length === 0, 'resumed job finishes');
  assert.deepEqual(ran, ['first', 'second']);
});

test('the queue file is version 2 and never stores runtime-only fields', async t => {
  const blocker = gate();
  const env = await setup(async (job, signal, progress) => { progress({ bytes: 1, total: 2 }); await blocker.promise; });
  t.after(env.cleanup);
  await env.service.enqueue({ operation: 'upload', label: 'x', sessionId: 's1' });
  // emit() runs after the file is written, so wait for the running state to be emitted, not just set in memory.
  await waitFor(() => env.emitted.some(({ job }) => job?.state === 'running'), 'running state is saved');
  const saved = JSON.parse(await fs.readFile(env.file, 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal(saved.jobs.length, 1);
  assert.equal(saved.jobs[0].state, 'running');
  for (const key of ['cancel', 'active', 'progressSample', 'shutdown']) {
    assert.equal(Object.hasOwn(saved.jobs[0], key), false, `${key} is not persisted`);
  }
  blocker.open();
  await waitFor(() => env.service.list().length === 0, 'queue empties');
});

test('restoring the queue marks unfinished jobs interrupted and moves finished ones to history', async t => {
  const seed = { version: 2, jobs: [
    { id: 'a', operation: 'upload', state: 'running', sessionId: 's1', createdAt: 1, active: true },
    { id: 'b', operation: 'download', state: 'queued', sessionId: 's2', createdAt: 2 },
    { id: 'c', operation: 'upload', state: 'completed', createdAt: 3, finishedAt: Date.now(), label: 'old.txt' },
  ] };
  const env = await setup(async () => {}, { seed });
  t.after(env.cleanup);
  const restored = env.service.list();
  assert.deepEqual(restored.map(job => [job.id, job.state]), [['a', 'interrupted'], ['b', 'interrupted']]);
  assert.deepEqual((await env.service.history()).map(entry => [entry.id, entry.state]), [['c', 'completed']]);
  const saved = JSON.parse(await fs.readFile(env.file, 'utf8'));
  assert.deepEqual(saved.jobs.map(job => job.id), ['a', 'b']);
});

test('invalid requests are rejected with the existing messages', async t => {
  const blocker = gate();
  const env = await setup(async () => { await blocker.promise; });
  t.after(async () => { blocker.open(); await env.cleanup(); });
  await assert.rejects(env.service.enqueue({ operation: 'delete', sessionId: 's1' }), { message: 'Invalid transfer request.' });
  await assert.rejects(env.service.enqueue(null), { message: 'Invalid transfer request.' });
  await assert.rejects(env.service.control('missing', 'cancel'), { message: 'Transfer no longer exists.' });
  const id = await env.service.enqueue({ operation: 'upload', sessionId: 's1' });
  await waitFor(() => env.service.list()[0]?.state === 'running', 'job runs');
  await assert.rejects(env.service.control(id, 'bogus'), { message: 'Unsupported transfer action.' });
});

test('history filters by text and honours the limit, newest first', async t => {
  const env = await setup(async () => {});
  t.after(env.cleanup);
  await env.service.enqueue({ operation: 'upload', label: 'alpha.txt', sessionId: 's1' });
  await waitFor(() => env.service.list().length === 0, 'alpha finishes');
  await env.service.enqueue({ operation: 'upload', label: 'beta.txt', sessionId: 's1' });
  await waitFor(() => env.service.list().length === 0, 'beta finishes');
  assert.deepEqual((await env.service.history('alp')).map(entry => entry.label), ['alpha.txt']);
  assert.deepEqual((await env.service.history('', 1)).map(entry => entry.label), ['beta.txt']);
  assert.deepEqual((await env.service.history()).map(entry => entry.label), ['beta.txt', 'alpha.txt']);
});

test('without a history file the history is empty and nothing is written', async t => {
  const env = await setup(async () => {}, { withHistory: false });
  t.after(env.cleanup);
  await env.service.enqueue({ operation: 'upload', label: 'gone.txt', sessionId: 's1' });
  await waitFor(() => env.service.list().length === 0, 'queue empties');
  assert.deepEqual(await env.service.history(), []);
});

test('T11: a remote-duplicate transfer (backup fallback) is accepted, runs, and is logged', async t => {
  const seen = [];
  const env = await setup(async job => { seen.push(job.operation); return { status: 'completed' }; });
  t.after(env.cleanup);
  const id = await env.service.enqueue({ operation: 'remote-duplicate', sessionId: 's1', sourcePath: '/srv/app.conf',
    targetPath: '/srv/app.conf.20261118-153000', label: 'app.conf' });
  await waitFor(() => env.service.list().length === 0, 'queue empties');
  assert.deepEqual(seen, ['remote-duplicate']);
  const history = await env.service.history();
  assert.equal(history[0].id, id);
  assert.equal(history[0].state, 'completed');
});
