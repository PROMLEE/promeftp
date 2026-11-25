// Tests for sftp-parallel.cjs against an in-memory fake SFTP channel. Each request completes on a later tick and
// the fake records how many requests are in flight, so the window limit and the offsets are checked directly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runChunks, downloadParallel, uploadParallel } = require('../sftp-parallel.cjs');

function fakeChannel(files, { delay = 1 } = {}) {
  const handles = new Map();
  const stats = { inFlight: 0, maxInFlight: 0, reads: [], writes: [], closed: 0 };
  let nextHandle = 1;
  const later = (fn, cb) => {
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    setTimeout(() => { stats.inFlight -= 1; fn(cb); }, delay);
  };
  const channel = {
    stats,
    files,
    open(name, flags, cb) {
      later(done => {
        if (flags === 'r' && !files.has(name)) return done(Object.assign(Error('no such file'), { code: 2 }));
        if (flags === 'wx' && files.has(name)) return done(Object.assign(Error('exists'), { code: 4 }));
        if (flags === 'wx') files.set(name, Buffer.alloc(0));
        const id = Buffer.from(String(nextHandle++));
        handles.set(id.toString(), name);
        done(undefined, id);
      }, cb);
    },
    read(handle, buf, off, len, position, cb) {
      const name = handles.get(handle.toString());
      stats.reads.push(position);
      later(done => {
        const data = files.get(name);
        if (position >= data.length) return done(Object.assign(Error('EOF'), { code: 1 }));
        const count = Math.min(len, data.length - position);
        data.copy(buf, off, position, position + count);
        done(undefined, count);
      }, cb);
    },
    write(handle, buf, off, len, position, cb) {
      const name = handles.get(handle.toString());
      stats.writes.push(position);
      later(done => {
        const data = files.get(name);
        const grown = Buffer.alloc(Math.max(data.length, position + len));
        data.copy(grown, 0);
        buf.copy(grown, position, off, off + len);
        files.set(name, grown);
        done();
      }, cb);
    },
    close(handle, cb) {
      later(done => {
        handles.delete(handle.toString());
        stats.closed += 1;
        done();
      }, cb);
    },
    openHandles: () => handles.size,
  };
  return channel;
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'promeftp-parallel-'));
}

test('runChunks visits every chunk once with the right length and never exceeds the window', async () => {
  let running = 0, peak = 0;
  const seen = [];
  await runChunks(100, { chunkSize: 16, window: 3 }, async (offset, length) => {
    running += 1; peak = Math.max(peak, running);
    seen.push([offset, length]);
    await new Promise(resolve => setTimeout(resolve, 2));
    running -= 1;
  });
  assert.equal(peak, 3);
  assert.deepEqual(seen.map(([offset]) => offset).sort((a, b) => a - b), [0, 16, 32, 48, 64, 80, 96]);
  assert.deepEqual(seen.find(([offset]) => offset === 96), [96, 4]);
  assert.equal(seen.reduce((sum, [, length]) => sum + length, 0), 100);
});

test('runChunks with zero size runs nothing', async () => {
  let calls = 0;
  await runChunks(0, { chunkSize: 16, window: 4 }, async () => { calls += 1; });
  assert.equal(calls, 0);
});

test('runChunks waits for chunks in flight before rejecting and starts no new chunks after a failure', async () => {
  const started = [];
  let finishedInFlight = 0;
  await assert.rejects(runChunks(1000, { chunkSize: 10, window: 4 }, async offset => {
    started.push(offset);
    if (offset === 20) throw Error('boom');
    await new Promise(resolve => setTimeout(resolve, 5));
    finishedInFlight += 1;
  }), /boom/);
  // Every chunk that started before the failure finished, and nothing started after it.
  assert.equal(started.length, finishedInFlight + 1);
  assert.ok(started.length < 100);
});

for (const size of [0, 1, 7, 8, 9, 64, 100]) {
  test(`downloadParallel copies a ${size}-byte file exactly`, async () => {
    const dir = await tempDir();
    try {
      const body = Buffer.from(Array.from({ length: size }, (_, i) => (i * 37) % 251));
      const channel = fakeChannel(new Map([['/remote.bin', body]]));
      const local = path.join(dir, 'local.bin');
      const reports = [];
      await downloadParallel(channel, '/remote.bin', local, { size, chunkSize: 8, window: 4, progress: report => reports.push(report.bytes) });
      assert.deepEqual(await fs.readFile(local), body);
      assert.equal(channel.openHandles(), 0, 'remote handle is closed');
      if (size) assert.equal(reports.at(-1), size);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}

test('downloadParallel keeps several reads in flight', async () => {
  const dir = await tempDir();
  try {
    const body = Buffer.alloc(4096, 7);
    const channel = fakeChannel(new Map([['/big.bin', body]]), { delay: 5 });
    await downloadParallel(channel, '/big.bin', path.join(dir, 'big.bin'), { size: body.length, chunkSize: 128, window: 8 });
    assert.ok(channel.stats.maxInFlight > 1, `expected parallel reads, saw ${channel.stats.maxInFlight}`);
    assert.ok(channel.stats.maxInFlight <= 8 + 1, `window exceeded: ${channel.stats.maxInFlight}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('downloadParallel rejects when the remote file gets shorter and closes the handle', async () => {
  const dir = await tempDir();
  try {
    const files = new Map([['/shrink.bin', Buffer.alloc(100, 1)]]);
    const channel = fakeChannel(files);
    await assert.rejects(downloadParallel(channel, '/shrink.bin', path.join(dir, 'out.bin'), { size: 200, chunkSize: 16, window: 2 }),
      /changed during transfer/);
    assert.equal(channel.openHandles(), 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('downloadParallel stops at cancellation and closes the handle', async () => {
  const dir = await tempDir();
  try {
    const body = Buffer.alloc(10000, 3);
    const channel = fakeChannel(new Map([['/cancel.bin', body]]), { delay: 2 });
    const controller = new AbortController();
    const pending = downloadParallel(channel, '/cancel.bin', path.join(dir, 'c.bin'), { size: body.length, chunkSize: 100, window: 4, signal: controller.signal,
      progress: ({ bytes }) => { if (bytes >= 1000) controller.abort(); } });
    await assert.rejects(pending, /Transfer cancelled/);
    assert.equal(channel.openHandles(), 0);
    assert.ok(channel.stats.reads.length < 100, 'cancelled transfer should not read the whole file');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

for (const size of [0, 5, 16, 50]) {
  test(`uploadParallel writes a ${size}-byte local file to the remote handle exactly`, async () => {
    const dir = await tempDir();
    try {
      const body = Buffer.from(Array.from({ length: size }, (_, i) => (i * 13) % 256));
      const local = path.join(dir, 'up.bin');
      await fs.writeFile(local, body);
      const files = new Map();
      const channel = fakeChannel(files);
      await new Promise((resolve, reject) => channel.open('/target', 'wx', (error, handle) => error ? reject(error) : resolve(handle)))
        .then(handle => uploadParallel(channel, handle, local, { size, chunkSize: 8, window: 3 }));
      assert.deepEqual(files.get('/target'), body);
      assert.equal(channel.openHandles(), 0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}
