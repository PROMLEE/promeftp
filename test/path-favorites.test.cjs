// Characterization tests for path-favorites.cjs. The module works on a plain state object, so no files are touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const pathFavorites = require('../path-favorites.cjs');

const scope = 'scope-a';
const itemsFor = (state, value) => (state.sftpPathFavorites || []).filter(item => item.scope === value);

test('scopeFor is a 64-character hash that changes with the connection identity', () => {
  const base = { host: 'example.invalid', port: 22, username: 'user' };
  assert.match(pathFavorites.scopeFor(base), /^[0-9a-f]{64}$/);
  assert.equal(pathFavorites.scopeFor(base), pathFavorites.scopeFor({ ...base }));
  assert.notEqual(pathFavorites.scopeFor(base), pathFavorites.scopeFor({ ...base, port: 2222 }));
  assert.notEqual(pathFavorites.scopeFor(base), pathFavorites.scopeFor({ ...base, username: 'other' }));
  assert.notEqual(pathFavorites.scopeFor(base), pathFavorites.scopeFor({ ...base, configPath: '/x/config' }));
});

test('scopeFor treats missing fields the same as empty values', () => {
  assert.equal(pathFavorites.scopeFor(), pathFavorites.scopeFor({}));
  assert.equal(pathFavorites.scopeFor({}), pathFavorites.scopeFor({ configPath: '', host: '', hostname: '', port: null, username: '' }));
});

test('normalizePath collapses dot segments and duplicate slashes', () => {
  assert.equal(pathFavorites.normalizePath('/a//b/../c'), '/a/c');
  assert.equal(pathFavorites.normalizePath('/'), '/');
});

test('normalizePath rejects relative paths, NUL bytes and non-strings', () => {
  for (const bad of ['relative/path', '', '\0/etc', 42, undefined]) {
    assert.throws(() => pathFavorites.normalizePath(bad), { message: 'Favorite path must be absolute.' }, String(bad));
  }
});

test('replace stores favorites in order, trims names, and falls back to the last path segment', () => {
  const state = {};
  pathFavorites.replace(state, scope, [{ path: '/b', displayName: '  Beta  ' }, { path: '/a/projects' }]);
  const items = itemsFor(state, scope);
  assert.deepEqual(items.map(item => [item.path, item.displayName, item.order]), [['/b', 'Beta', 0], ['/a/projects', 'projects', 1]]);
  assert.equal(state.sftpFavoriteManual[scope], undefined, 'manual order is not set by default');
});

test('replace marks the scope manual only when asked, and keeps other scopes', () => {
  const state = {};
  pathFavorites.replace(state, 'other', [{ path: '/keep' }]);
  pathFavorites.replace(state, scope, [{ path: '/x' }], true);
  assert.equal(state.sftpFavoriteManual[scope], true);
  assert.deepEqual(itemsFor(state, 'other').map(item => item.path), ['/keep']);
});

test('replace rejects duplicates and more than 200 entries', () => {
  // Paths are compared after normalization, so "/x/../a" is the same folder as "/a".
  assert.throws(() => pathFavorites.replace({}, scope, [{ path: '/a' }, { path: '/x/../a' }]), { message: 'A folder can only be saved once.' });
  assert.throws(() => pathFavorites.replace({}, scope, Array.from({ length: 201 }, (_, i) => ({ path: `/p${i}` }))), { message: 'Invalid folder favorites.' });
  assert.throws(() => pathFavorites.replace({}, scope, 'nope'), { message: 'Invalid folder favorites.' });
  const state = {};
  pathFavorites.replace(state, scope, Array.from({ length: 200 }, (_, i) => ({ path: `/p${i}` })));
  assert.equal(itemsFor(state, scope).length, 200, 'exactly 200 is accepted');
});

test('display names are cut to 80 characters', () => {
  const state = {};
  pathFavorites.replace(state, scope, [{ path: '/a', displayName: 'n'.repeat(120) }]);
  assert.equal(itemsFor(state, scope)[0].displayName.length, 80);
});

test('list sorts by name unless the user ordered the favorites manually', () => {
  const state = {};
  pathFavorites.replace(state, scope, [{ path: '/z', displayName: 'Zeta' }, { path: '/a', displayName: 'alpha' }]);
  assert.deepEqual(pathFavorites.list(state, scope).map(item => item.displayName), ['alpha', 'Zeta']);
  pathFavorites.replace(state, scope, [{ path: '/z', displayName: 'Zeta' }, { path: '/a', displayName: 'alpha' }], true);
  assert.deepEqual(pathFavorites.list(state, scope).map(item => item.displayName), ['Zeta', 'alpha']);
  assert.deepEqual(pathFavorites.list({}, scope), [], 'empty state lists nothing');
});

test('mutate add appends a new favorite and rejects a duplicate path', () => {
  const state = {};
  pathFavorites.mutate(state, scope, { action: 'add', path: '/one', displayName: 'One' });
  pathFavorites.mutate(state, scope, { action: 'add', path: '/two' });
  assert.deepEqual(itemsFor(state, scope).map(item => [item.path, item.order]), [['/one', 0], ['/two', 1]]);
  assert.throws(() => pathFavorites.mutate(state, scope, { action: 'add', path: '/one' }), { message: 'A folder can only be saved once.' });
  assert.throws(() => pathFavorites.mutate(state, scope, { action: 'add', path: 'rel' }), { message: 'Favorite path must be absolute.' });
});

test('mutate rename trims the name, and an empty name falls back to the folder name', () => {
  const state = {};
  pathFavorites.mutate(state, scope, { action: 'add', path: '/data/logs', displayName: 'Logs' });
  const id = itemsFor(state, scope)[0].id;
  pathFavorites.mutate(state, scope, { action: 'rename', id, displayName: '  Renamed  ' });
  assert.equal(itemsFor(state, scope)[0].displayName, 'Renamed');
  pathFavorites.mutate(state, scope, { action: 'rename', id, displayName: '   ' });
  assert.equal(itemsFor(state, scope)[0].displayName, 'logs');
  assert.throws(() => pathFavorites.mutate(state, scope, { action: 'rename', id: 'missing', displayName: 'x' }), { message: 'Favorite no longer exists.' });
});

test('mutate edit-path changes the path and rejects a path another favorite uses', () => {
  const state = {};
  pathFavorites.mutate(state, scope, { action: 'add', path: '/one' });
  pathFavorites.mutate(state, scope, { action: 'add', path: '/two' });
  const [first, second] = itemsFor(state, scope);
  pathFavorites.mutate(state, scope, { action: 'edit-path', id: first.id, path: '/moved' });
  assert.equal(itemsFor(state, scope)[0].path, '/moved');
  assert.throws(() => pathFavorites.mutate(state, scope, { action: 'edit-path', id: first.id, path: '/two' }), { message: 'A folder can only be saved once.' });
  assert.throws(() => pathFavorites.mutate(state, scope, { action: 'edit-path', id: 'missing', path: '/x' }), { message: 'Favorite no longer exists.' });
  assert.equal(second.path, '/two');
});

test('mutate remove deletes a favorite and reports a missing one', () => {
  const state = {};
  pathFavorites.mutate(state, scope, { action: 'add', path: '/one' });
  const id = itemsFor(state, scope)[0].id;
  pathFavorites.mutate(state, scope, { action: 'remove', id });
  assert.deepEqual(itemsFor(state, scope), []);
  assert.throws(() => pathFavorites.mutate(state, scope, { action: 'remove', id }), { message: 'Favorite no longer exists.' });
});

test('mutate reorder applies the new order and marks the scope manual', () => {
  const state = {};
  pathFavorites.mutate(state, scope, { action: 'add', path: '/one' });
  pathFavorites.mutate(state, scope, { action: 'add', path: '/two' });
  const [one, two] = itemsFor(state, scope);
  pathFavorites.mutate(state, scope, { action: 'reorder', ids: [two.id, one.id] });
  assert.deepEqual(pathFavorites.list(state, scope).map(item => item.path), ['/two', '/one']);
  assert.equal(state.sftpFavoriteManual[scope], true);
  const stale = { action: 'reorder', ids: [two.id] };
  assert.throws(() => pathFavorites.mutate(state, scope, stale), { message: 'Favorite list changed. Refresh it and try again.' });
  const duplicated = { action: 'reorder', ids: [two.id, two.id] };
  assert.throws(() => pathFavorites.mutate(state, scope, duplicated), { message: 'Favorite list changed. Refresh it and try again.' });
});

test('mutate rejects unknown actions', () => {
  assert.throws(() => pathFavorites.mutate({}, scope, { action: 'explode' }), { message: 'Unsupported favorite action.' });
  assert.throws(() => pathFavorites.mutate({}, scope, undefined), { message: 'Unsupported favorite action.' });
});

test('migrate seeds an empty scope from old paths, sorted by folder name, and does nothing otherwise', () => {
  const state = {};
  assert.equal(pathFavorites.migrate(state, scope, ['/home/zed', '/srv/alpha', '/home/zed', '/srv/alpha']), true);
  assert.deepEqual(pathFavorites.list(state, scope).map(item => item.path), ['/srv/alpha', '/home/zed']);
  assert.equal(pathFavorites.migrate(state, scope, ['/another']), false, 'a scope that already has favorites is left alone');
  assert.equal(pathFavorites.migrate({}, 'empty', []), false, 'an empty list migrates nothing');
  assert.equal(pathFavorites.migrate({}, 'missing', 'not-an-array'), false);
});
