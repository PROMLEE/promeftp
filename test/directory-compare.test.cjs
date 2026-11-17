// Characterization tests for directory-compare.cjs against real temporary folders.
// The adapter has the same shape as the local branch of comparisonAdapter in main.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { compare, selectedFilePlan } = require('../directory-compare.cjs');

const localAdapter = {
  join: (base, name) => path.join(base, name),
  async list(directory) {
    const rows = await fs.readdir(directory, { withFileTypes: true });
    return Promise.all(rows.map(async row => {
      const attrs = await fs.lstat(path.join(directory, row.name));
      return { name: row.name, directory: attrs.isDirectory(), link: attrs.isSymbolicLink(), size: attrs.size, modifiedAt: attrs.mtimeMs };
    }));
  },
};

// Creates a folder tree from { 'a/b.txt': 'text', 'dir/': null, 'link': { link: target } } and sets every file's mtime.
async function makeTree(root, spec, mtime = new Date('2026-01-01T00:00:00Z')) {
  await fs.mkdir(root, { recursive: true });
  for (const [name, value] of Object.entries(spec)) {
    const target = path.join(root, name);
    if (value === null) await fs.mkdir(target, { recursive: true });
    // Only objects of the form { link: target } are symlinks. A string's .link is the legacy String.prototype.link method.
    else if (typeof value === 'object' && typeof value.link === 'string') await fs.symlink(value.link, target);
    else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, value);
      await fs.utimes(target, mtime, mtime);
    }
  }
  return root;
}

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'promeftp-compare-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function run(t, sourceSpec, destinationSpec, options = {}) {
  const base = await fixture(t);
  const sourceRoot = await makeTree(path.join(base, 'src'), sourceSpec, options.sourceMtime);
  const destinationRoot = await makeTree(path.join(base, 'dst'), destinationSpec, options.destinationMtime);
  return compare({ sourceRoot, destinationRoot, source: localAdapter, destination: localAdapter, ...options.extra });
}

const byPath = rows => Object.fromEntries(rows.map(row => [row.relativePath, row]));

test('empty trees produce no rows', async t => {
  assert.deepEqual(await run(t, {}, {}), []);
});

test('a file only on the source is copied, and a file only on the destination is not selected', async t => {
  const rows = byPath(await run(t, { 'only-source.txt': 'a' }, { 'only-destination.txt': 'b' }));
  assert.equal(rows['only-source.txt'].reason, 'source-only');
  assert.equal(rows['only-source.txt'].operation, 'copy');
  assert.equal(rows['only-source.txt'].selected, true);
  assert.equal(rows['only-destination.txt'].reason, 'destination-only');
  assert.equal(rows['only-destination.txt'].operation, null);
  assert.equal(rows['only-destination.txt'].selected, false);
});

test('files with the same size and a modification time within 2 seconds are probably equal', async t => {
  const same = new Date('2026-01-01T00:00:00Z');
  const near = new Date(same.getTime() + 1500);
  const base = await fixture(t);
  const sourceRoot = await makeTree(path.join(base, 'src'), { 'f.txt': 'hello' }, same);
  const destinationRoot = await makeTree(path.join(base, 'dst'), { 'f.txt': 'world' }, near);
  const [row] = await compare({ sourceRoot, destinationRoot, source: localAdapter, destination: localAdapter });
  assert.equal(row.reason, 'probably-equal');
  assert.equal(row.selected, false);
});

test('files with the same size but a modification time 10 seconds apart are different', async t => {
  const base = await fixture(t);
  const sourceRoot = await makeTree(path.join(base, 'src'), { 'f.txt': 'hello' }, new Date('2026-01-01T00:00:00Z'));
  const destinationRoot = await makeTree(path.join(base, 'dst'), { 'f.txt': 'world' }, new Date('2026-01-01T00:00:10Z'));
  const [row] = await compare({ sourceRoot, destinationRoot, source: localAdapter, destination: localAdapter });
  assert.equal(row.reason, 'different');
  assert.equal(row.operation, 'update');
  assert.equal(row.selected, true);
});

test('a file whose size differs is an update even when the times match', async t => {
  const rows = byPath(await run(t, { 'f.txt': 'longer text' }, { 'f.txt': 'short' }));
  assert.equal(rows['f.txt'].reason, 'different');
  assert.equal(rows['f.txt'].operation, 'update');
});

test('a file on one side and a folder on the other is a type conflict that blocks its children', async t => {
  const rows = byPath(await run(t, { 'x': 'file' }, { 'x/inner.txt': 'nested' }));
  assert.equal(rows['x'].reason, 'type-conflict');
  assert.equal(rows['x'].operation, 'conflict');
  assert.equal(rows['x/inner.txt'].reason, 'path-conflict');
  assert.equal(rows['x/inner.txt'].selected, false);
});

test('a source name that differs from a destination name only by case is a path conflict', async t => {
  const rows = byPath(await run(t, { 'Readme.md': 'a' }, { 'readme.md': 'a' }));
  assert.equal(rows['Readme.md'].reason, 'path-conflict');
  assert.equal(rows['Readme.md'].operation, 'conflict');
  assert.equal(rows['Readme.md'].selected, false);
  assert.equal(rows['readme.md'].selected, false);
});

test('symbolic links are listed as links and are not followed', async t => {
  const rows = byPath(await run(t, { 'target.txt': 'x', 'link': { link: 'target.txt' } }, {}));
  assert.equal(rows['link'].source.type, 'link');
  assert.equal(rows['link'].reason, 'source-only');
  assert.equal(rows['link'].operation, 'copy');
});

test('an empty source folder is marked and selected as an empty directory copy', async t => {
  const base = await fixture(t);
  const sourceRoot = await makeTree(path.join(base, 'src'), { 'empty/': null, 'full/a.txt': 'a' });
  const destinationRoot = await makeTree(path.join(base, 'dst'), {});
  const rows = byPath(await compare({ sourceRoot, destinationRoot, source: localAdapter, destination: localAdapter }));
  assert.equal(rows['empty'].source.type, 'directory');
  assert.equal(rows['empty'].source.emptyDirectory, true);
  assert.equal(rows['full'].source.emptyDirectory, false);
  const plan = selectedFilePlan(Object.values(rows), ['empty', 'full']);
  assert.deepEqual(plan.emptyDirectories.map(row => row.relativePath), ['empty']);
  assert.deepEqual(plan.directories, ['empty']);
  assert.deepEqual(plan.files, [], 'selected folders without a selected file add no files');
});

test('rows are sorted with natural number order', async t => {
  const rows = await run(t, { 'file10.txt': 'a', 'file2.txt': 'b', 'file1.txt': 'c' }, {});
  assert.deepEqual(rows.map(row => row.relativePath), ['file1.txt', 'file2.txt', 'file10.txt']);
});

test('the comparison stops at maxEntries and at maxDepth with the existing messages', async t => {
  await assert.rejects(run(t, { 'a.txt': '1', 'b.txt': '2', 'c.txt': '3' }, {}, { extra: { limits: { maxEntries: 2 } } }), { message: 'Comparison exceeds 2 items.' });
  await assert.rejects(run(t, { 'a/b/c.txt': 'deep' }, {}, { extra: { limits: { maxDepth: 1 } } }), { message: 'Comparison exceeds 1 folder levels.' });
});

test('an aborted signal cancels the comparison', async t => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(run(t, { 'a.txt': '1' }, {}, { extra: { signal: controller.signal } }), { message: 'Comparison cancelled.' });
});

test('a missing folder is reported as an error and not as an empty result', async t => {
  const base = await fixture(t);
  await assert.rejects(compare({ sourceRoot: path.join(base, 'missing'), destinationRoot: base, source: localAdapter, destination: localAdapter }), { code: 'ENOENT' });
});

test('selectedFilePlan drops selected paths under a conflict and lists parent folders in depth order', async t => {
  const rows = await run(t, { 'keep/deep/file.txt': 'a', 'clash': 'file' }, { 'clash/inner.txt': 'nested' });
  const plan = selectedFilePlan(rows, ['keep/deep/file.txt', 'clash', 'clash/inner.txt']);
  assert.deepEqual(plan.files.map(row => row.relativePath), ['keep/deep/file.txt']);
  assert.deepEqual(plan.directories, ['keep', 'keep/deep']);
  assert.deepEqual(plan.emptyDirectories, []);
});

test('selectedFilePlan returns nothing for an empty selection', async t => {
  const rows = await run(t, { 'a.txt': '1' }, {});
  assert.deepEqual(selectedFilePlan(rows, []), { files: [], emptyDirectories: [], directories: [] });
});
