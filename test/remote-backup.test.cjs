// Backup names, shell quoting, the cp command and failure classes (test plan T1-T10). Pure functions only: no SSH
// connection and no file under the user's folders is touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const { backupStamp, backupName, shellQuote, backupCommand, classifyBackupFailure } = require('../remote-backup.cjs');

test('T1: the stamp is the local time as YYYYMMDD-HHMMSS', () => {
  assert.equal(backupStamp(new Date(2026, 10, 18, 15, 30, 0)), '20261118-153000');
});

test('T2: the backup name is the original name, a dot, and the stamp', () => {
  assert.equal(backupName('app.conf', '20261118-153000', new Set()), 'app.conf.20261118-153000');
});

test('T3: the cp command quotes both paths, with -p for a file and -pR for a folder', () => {
  assert.equal(backupCommand('/etc/app.conf', '/etc/app.conf.20261118-153000', false),
    "cp -p -- '/etc/app.conf' '/etc/app.conf.20261118-153000'");
  assert.equal(backupCommand('/srv/site', '/srv/site.20261118-153000', true),
    "cp -pR -- '/srv/site' '/srv/site.20261118-153000'");
});

test('T4: a taken name gets -2, then -3; when the default and -2 to -99 are all taken, it fails', () => {
  const base = 'app.conf.20261118-153000';
  assert.equal(backupName('app.conf', '20261118-153000', new Set([base])), `${base}-2`);
  assert.equal(backupName('app.conf', '20261118-153000', new Set([base, `${base}-2`])), `${base}-3`);
  const all = new Set([base, ...Array.from({ length: 98 }, (_, index) => `${base}-${index + 2}`)]);
  assert.throws(() => backupName('app.conf', '20261118-153000', all), { message: 'BACKUP_NAME_TAKEN' });
});

test('T5: a dot-file and a name without an extension follow the same rule', () => {
  assert.equal(backupName('.env', '20261118-153000', new Set()), '.env.20261118-153000');
  assert.equal(backupName('Makefile', '20261118-153000', new Set()), 'Makefile.20261118-153000');
});

test('T6: single digits are padded, so January 1 at 00:00:05 is 0101-000005', () => {
  assert.equal(backupStamp(new Date(2026, 0, 1, 0, 0, 5)), '20260101-000005');
});

test("T7: quoting keeps an apostrophe, and $() stays inside the quotes", () => {
  assert.equal(shellQuote("it's"), "'it'\\''s'");
  assert.equal(backupCommand('/srv/$(rm -rf /)', '/srv/out', false), "cp -p -- '/srv/$(rm -rf /)' '/srv/out'");
});

test('T8: a path with a control character is rejected with INVALID_PATH', () => {
  assert.throws(() => backupCommand('/srv/a\nb', '/srv/out', false), { agentCode: 'INVALID_PATH' });
  assert.throws(() => backupCommand('srv/relative', '/srv/out', false), { agentCode: 'INVALID_PATH' });
});

test('T9: each failure is sorted into NO_SHELL, NO_CP, PERMISSION, NO_SPACE, or FAILED', () => {
  assert.equal(classifyBackupFailure({ code: 1, stderr: 'This service allows sftp connections only.' }), 'NO_SHELL');
  assert.equal(classifyBackupFailure({ code: 127 }), 'NO_CP');
  assert.equal(classifyBackupFailure({ code: 1, stderr: "cp: cannot create regular file 'x': Permission denied" }), 'PERMISSION');
  assert.equal(classifyBackupFailure({ code: 1, stderr: 'No space left on device' }), 'NO_SPACE');
  assert.equal(classifyBackupFailure({ code: 1, stderr: 'something else' }), 'FAILED');
});

test('T10: an empty name is refused, and a failure with no details is FAILED', () => {
  assert.throws(() => backupName('', '20261118-153000', new Set()), { agentCode: 'INVALID_NAME' });
  assert.equal(classifyBackupFailure({}), 'FAILED');
});

// Output-aware classification (review item 1). A refused shell prints its sentence on stdout.
const { collectCommand, copyAttributes } = require('../remote-backup.cjs');
const { EventEmitter } = require('node:events');

test('a refused shell whose sentence goes to stdout with exit 1 is NO_SHELL', () => {
  assert.equal(classifyBackupFailure({ code: 1, stdout: 'This service allows sftp connections only.\n', stderr: '' }), 'NO_SHELL');
});

test('exit 1 with no output at all is NO_SHELL; with an stderr message it is judged by that message', () => {
  assert.equal(classifyBackupFailure({ code: 1, stdout: '', stderr: '' }), 'NO_SHELL');
  assert.equal(classifyBackupFailure({ code: 1, stdout: '   \n', stderr: '' }), 'NO_SHELL');
  assert.equal(classifyBackupFailure({ code: 1, stdout: '', stderr: "cp: x: Permission denied" }), 'PERMISSION');
  assert.equal(classifyBackupFailure({ code: 2, stdout: '', stderr: '' }), 'FAILED');
});

// A fake spawned child: stdout and stderr are emitters, and close/error are emitted by the test.
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test('collectCommand returns the exit code and the captured stdout and stderr', async () => {
  const child = fakeChild();
  const pending = collectCommand(child, { controller: new AbortController(), timeout: 5000 });
  child.stdout.emit('data', Buffer.from('out line'));
  child.stderr.emit('data', Buffer.from('err line'));
  child.emit('close', 3);
  assert.deepEqual(await pending, { code: 3, stdout: 'out line', stderr: 'err line', timedOut: false });
});

test('a command past its timeout is aborted and reports timedOut, even when abort arrives as an error event', async () => {
  const child = fakeChild();
  const controller = new AbortController();
  // Like spawn with a signal: the abort is delivered as an 'error' event, then the process closes.
  controller.signal.addEventListener('abort', () => {
    child.emit('error', Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    child.emit('close', null);
  });
  const result = await collectCommand(child, { controller, timeout: 20 });
  assert.equal(result.timedOut, true);
  assert.equal(controller.signal.aborted, true);
});

test('a command that fails to start (error without a timeout) rejects, so it is a plain failure', async () => {
  const child = fakeChild();
  const pending = collectCommand(child, { controller: new AbortController(), timeout: 5000 });
  child.emit('error', new Error('spawn ssh ENOENT'));
  await assert.rejects(pending, { message: 'spawn ssh ENOENT' });
});

test('output is capped at the limit for each stream', async () => {
  const child = fakeChild();
  const pending = collectCommand(child, { controller: new AbortController(), timeout: 5000, limit: 8 });
  child.stderr.emit('data', Buffer.from('0123456789abcdef'));
  child.stdout.emit('data', Buffer.from('ABCDEFGHIJ'));
  child.emit('close', 1);
  const result = await pending;
  assert.equal(result.stderr, '01234567');
  assert.equal(result.stdout, 'ABCDEFGH');
});

// Mode and time copy after a fallback upload (review item 3). The ops are an in-memory remote tree.
function fakeRemote(tree) {
  const log = [];
  const attrsOf = node => ({
    mode: node.mode, atime: node.atime, mtime: node.mtime,
    isDirectory: () => node.type === 'dir', isSymbolicLink: () => node.type === 'link',
  });
  const ops = {
    lstat: async p => { if (!tree[p]) throw Object.assign(new Error('no such file'), { code: 2 }); return attrsOf(tree[p]); },
    readdir: async p => Object.keys(tree).filter(key => key.startsWith(p + '/') && !key.slice(p.length + 1).includes('/')).map(key => key.split('/').pop()),
    chmod: async (p, mode) => { if (!tree[p]) throw Object.assign(new Error('no such file'), { code: 2 }); tree[p].mode = mode; log.push(['chmod', p]); },
    utimes: async (p, atime, mtime) => { tree[p].atime = atime; tree[p].mtime = mtime; log.push(['utimes', p]); },
  };
  return { ops, log };
}

test('copyAttributes gives the copy the original mode and times, for a file', async () => {
  const tree = {
    '/srv/app.conf': { type: 'file', mode: 0o640, atime: 100, mtime: 200 },
    '/srv/app.conf.20261118-153000': { type: 'file', mode: 0o644, atime: 0, mtime: 0 },
  };
  const { ops } = fakeRemote(tree);
  assert.deepEqual(await copyAttributes(ops, '/srv/app.conf', '/srv/app.conf.20261118-153000'), []);
  assert.equal(tree['/srv/app.conf.20261118-153000'].mode, 0o640);
  assert.equal(tree['/srv/app.conf.20261118-153000'].mtime, 200);
});

test('copyAttributes applies each child of a folder, and the folder itself last', async () => {
  const tree = {
    '/srv/site': { type: 'dir', mode: 0o750, atime: 1, mtime: 9 },
    '/srv/site/index.html': { type: 'file', mode: 0o600, atime: 1, mtime: 3 },
    '/srv/site/img': { type: 'dir', mode: 0o755, atime: 1, mtime: 4 },
    '/srv/site/img/a.png': { type: 'file', mode: 0o644, atime: 1, mtime: 5 },
    '/srv/site.copy': { type: 'dir', mode: 0o777, atime: 0, mtime: 0 },
    '/srv/site.copy/index.html': { type: 'file', mode: 0o666, atime: 0, mtime: 0 },
    '/srv/site.copy/img': { type: 'dir', mode: 0o777, atime: 0, mtime: 0 },
    '/srv/site.copy/img/a.png': { type: 'file', mode: 0o666, atime: 0, mtime: 0 },
  };
  const { ops, log } = fakeRemote(tree);
  assert.deepEqual(await copyAttributes(ops, '/srv/site', '/srv/site.copy'), []);
  assert.equal(tree['/srv/site.copy/index.html'].mode, 0o600);
  assert.equal(tree['/srv/site.copy/img/a.png'].mode, 0o644);
  assert.equal(tree['/srv/site.copy'].mode, 0o750);
  const last = log.at(-1);
  assert.deepEqual(last, ['utimes', '/srv/site.copy']);
});

test('copyAttributes skips symbolic links and records a failure without throwing', async () => {
  const tree = {
    '/srv/dir': { type: 'dir', mode: 0o755, atime: 1, mtime: 1 },
    '/srv/dir/link': { type: 'link', mode: 0o777, atime: 1, mtime: 1 },
    '/srv/dir.copy': { type: 'dir', mode: 0o777, atime: 0, mtime: 0 },
  };
  const { ops, log } = fakeRemote(tree);
  const failures = await copyAttributes(ops, '/srv/dir', '/srv/dir.copy');
  assert.equal(log.some(([, p]) => p === '/srv/dir.copy/link'), false);
  assert.equal(failures.length, 0);
  const missing = await copyAttributes(ops, '/srv/nothing', '/srv/nothing.copy');
  assert.equal(missing.length, 1);
  assert.match(missing[0], /\/srv\/nothing: /);
});
