// Characterization tests for state-rules.cjs: profile validation, folder and workspace names, and snippet scopes.
// The home folder is passed in, so the tests never read the real home directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../state-rules.cjs');

const home = '/Users/example-home';

test('state-rules does not load Electron', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'state-rules.cjs'), 'utf8'), /require\(['"]electron['"]\)/);
});

test('expandHome expands ~/ against the given home folder only', () => {
  assert.equal(rules.expandHome('~/.ssh/id_ed25519', home), path.join(home, '.ssh/id_ed25519'));
  assert.equal(rules.expandHome('  ~/keys  ', home), path.join(home, 'keys'));
  assert.equal(rules.expandHome('~/', home), home);
  assert.equal(rules.expandHome('~user/x', home), '~user/x');
  assert.equal(rules.expandHome('/abs/path ', home), '/abs/path');
  assert.equal(rules.expandHome('', home), '');
});

test('profile trims the address and uses it as the default label', () => {
  assert.deepEqual(rules.profile({ host: ' example.invalid ' }, home), {
    label: 'example.invalid', host: 'example.invalid', port: null, username: '', keyPath: '', group: '', configPath: '', pam: false, usesAlias: false,
  });
});

test('profile keeps the given fields and expands ~/ in key and config paths', () => {
  assert.deepEqual(rules.profile({
    label: ' Work ', host: 'example.invalid', port: 2222, username: ' alice ', keyPath: '~/.ssh/k', group: ' Team ', configPath: '~/.ssh/config', pam: true,
  }, home), {
    label: 'Work', host: 'example.invalid', port: 2222, username: 'alice', keyPath: path.join(home, '.ssh/k'), group: 'Team',
    configPath: path.join(home, '.ssh/config'), pam: true, usesAlias: false,
  });
});

test('profile rejects an empty host, a leading dash, whitespace and a NUL character', () => {
  for (const host of ['', '   ', '-oProxyCommand=x', 'my host', 'host\0x']) {
    assert.throws(() => rules.profile({ host }, home), { message: 'Enter an SSH host or alias.' }, JSON.stringify(host));
  }
});

test('profile accepts ports 1 to 65535 and null, and rejects anything else', () => {
  for (const port of [1, 22, 65535, null]) assert.equal(rules.profile({ host: 'h', port }, home).port, port);
  for (const port of [0, 65536, -1, 22.5, '22', NaN]) {
    assert.throws(() => rules.profile({ host: 'h', port }, home), { message: 'Port must be between 1 and 65535.' }, String(port));
  }
});

test('a hostname is kept only when usesAlias is true', () => {
  const alias = rules.profile({ host: 'work', hostname: ' 203.0.113.7 ', usesAlias: true }, home);
  assert.equal(alias.hostname, '203.0.113.7');
  assert.equal(alias.usesAlias, true);
  assert.equal(Object.hasOwn(rules.profile({ host: 'work', hostname: '203.0.113.7' }, home), 'hostname'), false);
});

test('a blank hostname with usesAlias is no override', () => {
  assert.equal(Object.hasOwn(rules.profile({ host: 'h', hostname: '   ', usesAlias: true }, home), 'hostname'), false);
});

test('profile accepts IPv6 addresses and rejects other hostname characters when usesAlias is true', () => {
  assert.equal(rules.profile({ host: 'h', hostname: '2001:db8::1', usesAlias: true }, home).hostname, '2001:db8::1');
  for (const hostname of ['-x', 'bad host', 'a/b']) {
    assert.throws(() => rules.profile({ host: 'h', hostname, usesAlias: true }, home), { message: 'Enter a hostname or IP address.' }, hostname);
  }
});

test('bookmarkFolderName trims and accepts 1 to 80 characters', () => {
  assert.equal(rules.bookmarkFolderName('  Team  '), 'Team');
  assert.equal(rules.bookmarkFolderName('a'), 'a');
  assert.equal(rules.bookmarkFolderName('f'.repeat(80)), 'f'.repeat(80));
  assert.equal(rules.bookmarkFolderName(`  ${'f'.repeat(80)}  `), 'f'.repeat(80));
});

test('bookmarkFolderName rejects blank, 81 characters and non-strings', () => {
  for (const value of ['', '   ', 'f'.repeat(81), 12, undefined, null]) {
    assert.throws(() => rules.bookmarkFolderName(value), { message: 'Enter a folder name (1–80 characters).' }, String(value));
  }
});

test('bookmarkFolderNames combines saved folders with the groups of profiles', () => {
  const names = [...rules.bookmarkFolderNames({ bookmarkFolders: ['Alpha'], profiles: [{ group: 'Beta' }, { group: '' }, { group: 'Alpha' }, {}] })].sort();
  assert.deepEqual(names, ['Alpha', 'Beta']);
  assert.deepEqual([...rules.bookmarkFolderNames({ profiles: [] })], []);
});

test('bookmarkOrder keeps known folders and bookmarks once, in the given order', () => {
  const snapshot = { bookmarkFolders: ['Alpha', 'Beta'], profiles: [{ id: 'a', group: 'Gamma' }, { id: 'b' }] };
  assert.deepEqual(rules.bookmarkOrder({ folders: ['Gamma', 'Gone', 'Alpha', 'Gamma', 3], bookmarks: ['b', 'x', 'a', 'b'] }, snapshot),
    { folders: ['Gamma', 'Alpha'], bookmarks: ['b', 'a'] });
  for (const value of [undefined, null, 'x', { folders: 'Alpha', bookmarks: {} }]) {
    assert.deepEqual(rules.bookmarkOrder(value, snapshot), { folders: [], bookmarks: [] }, String(value));
  }
});

test('workspaceName trims and uses the workspace message for invalid names', () => {
  assert.equal(rules.workspaceName(' Dev '), 'Dev');
  assert.equal(rules.workspaceName('w'.repeat(80)), 'w'.repeat(80));
  for (const value of ['', '  ', 'w'.repeat(81), 3]) {
    assert.throws(() => rules.workspaceName(value), { message: 'Enter a workspace name (1–80 characters).' }, String(value));
  }
});

test('snippetScope is empty without a context and "local" for a local terminal', () => {
  assert.equal(rules.snippetScope(undefined, home), '');
  assert.equal(rules.snippetScope(null, home), '');
  assert.equal(rules.snippetScope({ mode: 'local' }, home), 'local');
});

test('snippetScope rejects a mode that is neither ssh nor local', () => {
  assert.throws(() => rules.snippetScope({ mode: 'sftp', input: { host: 'h' } }, home), { message: 'Choose an SSH or local terminal.' });
});

test('an SSH scope lowercases the host and records the connection identity', () => {
  const scope = rules.snippetScope({ mode: 'ssh', input: { host: 'Example.INVALID', username: 'alice', port: 2222, configPath: '~/.ssh/config' } }, home);
  assert.equal(scope, JSON.stringify(['ssh', 'example.invalid', '', 'alice', 2222, path.join(home, '.ssh/config')]));
});

test('an SSH scope includes the hostname override and uses null for a missing port', () => {
  const scope = rules.snippetScope({ mode: 'ssh', input: { host: 'work', hostname: '203.0.113.7', usesAlias: true } }, home);
  assert.equal(scope, JSON.stringify(['ssh', 'work', '203.0.113.7', '', null, '']));
});

test('an SSH scope passes profile validation errors through', () => {
  assert.throws(() => rules.snippetScope({ mode: 'ssh', input: { host: '' } }, home), { message: 'Enter an SSH host or alias.' });
});

test('the sample profiles fixture loads through profile() and lists its folders (example.invalid hosts only)', () => {
  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'profiles-sample.json'), 'utf8'));
  const loaded = sample.profiles.map(item => rules.profile(item, home));
  assert.equal(loaded.length, 3);
  assert.deepEqual(loaded.map(item => item.label), ['Build host', 'Staging', 'Edge']);
  assert.equal(loaded[1].pam, true);
  assert.equal(loaded[2].hostname, '192.0.2.10');
  assert.ok(loaded.filter(item => !item.usesAlias).every(item => item.host.endsWith('.example.invalid')));
  assert.deepEqual([...rules.bookmarkFolderNames(sample)].sort(), ['Archive', 'Ops', 'Staging']);
});

// T14: the local split saved with a workspace pane (state-rules.cjs workspaceLocalSplit).
test('T14 workspaceLocalSplit reads the 1.1.10 two-pane shape as a tree, with the ratio limited to 0.1 to 0.9', () => {
  const { workspaceLocalSplit } = require('../state-rules.cjs');
  assert.deepEqual(workspaceLocalSplit({ axis: 'row', ratio: 0.3, directories: ['/Users/a', '/Users/b'], focus: 1 }),
    { tree: { axis: 'row', ratio: 0.3, first: { directory: '/Users/a' }, second: { directory: '/Users/b' } }, focus: 1 });
  assert.equal(workspaceLocalSplit({ axis: 'column', ratio: 1.5, directories: ['/a', '/b'] }).tree.ratio, 0.9);
  assert.equal(workspaceLocalSplit({ axis: 'column', ratio: -2, directories: ['/a', '/b'] }).tree.ratio, 0.1);
  assert.equal(workspaceLocalSplit({ axis: 'column', directories: ['/a', '/b'] }).tree.ratio, 0.5);
  assert.equal(workspaceLocalSplit({ axis: 'column', ratio: 0.5, directories: ['/a', '/b'] }).focus, 0);
  assert.deepEqual(workspaceLocalSplit({ tree: null, axis: 'row', ratio: 0.3, directories: ['/a', '/b'] }).tree, { axis: 'row', ratio: 0.3, first: { directory: '/a' }, second: { directory: '/b' } });
});

test('T14 workspaceLocalSplit keeps a nested tree up to six panes and drops a larger one', () => {
  const { workspaceLocalSplit } = require('../state-rules.cjs');
  const leaf = directory => ({ directory });
  const three = { axis: 'row', ratio: 0.5, first: leaf('/a'), second: { axis: 'column', ratio: 0.4, first: leaf('/b'), second: leaf('/c') } };
  assert.deepEqual(workspaceLocalSplit({ tree: three, focus: 2 }), { tree: three, focus: 2 });
  assert.equal(workspaceLocalSplit({ tree: three, focus: 7 }).focus, 0);
  let tree = leaf('/0');
  for (let index = 1; index < 7; index += 1) tree = { axis: 'row', ratio: 0.5, first: tree, second: leaf('/' + index) };
  assert.equal(workspaceLocalSplit({ tree }), undefined);
  assert.equal(workspaceLocalSplit({ tree: leaf('/a') }), undefined);
});

test('T14 workspaceLocalSplit drops a malformed split (undefined), so the pane opens with one local pane', () => {
  const { workspaceLocalSplit } = require('../state-rules.cjs');
  assert.equal(workspaceLocalSplit(undefined), undefined);
  assert.equal(workspaceLocalSplit({ axis: 'diagonal', ratio: 0.5, directories: ['/a', '/b'] }), undefined);
  assert.equal(workspaceLocalSplit({ axis: 'row', ratio: 0.5, directories: ['/a'] }), undefined);
  assert.equal(workspaceLocalSplit({ axis: 'row', ratio: 0.5, directories: ['/a', 3] }), undefined);
  assert.equal(workspaceLocalSplit('row'), undefined);
});
