// Keeps the three IPC lists in step: handlers registered in main.cjs, names exposed by preload.cjs,
// and the preferences window allow-list. Reads the source text, so Electron is not needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');

function quotedNames(text) {
  return [...text.matchAll(/'([a-z][a-z0-9-]*)'/g)].map(match => match[1]);
}

// Returns the text of an array literal that starts with `marker` (the marker ends with its "[") up to the closing "]".
function arrayBody(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `could not find ${marker}`);
  const open = start + marker.length - 1;
  return source.slice(open, source.indexOf(']', open));
}

const handled = [...main.matchAll(/^handle\('([a-z][a-z0-9-]*)'/gm)].map(match => match[1]);
const handledSet = new Set(handled);
const exposed = quotedNames(arrayBody(preload, 'const methods = ['));
const exposedSet = new Set(exposed);
const preferencesSet = new Set(quotedNames(arrayBody(main, 'const preferencesMethods = new Set([')));

test('every handler name is registered once', () => {
  const duplicates = handled.filter((name, index) => handled.indexOf(name) !== index);
  assert.deepEqual(duplicates, []);
});

test('preload exposes exactly the names main.cjs handles', () => {
  const onlyPreload = [...exposedSet].filter(name => !handledSet.has(name));
  const onlyMain = [...handledSet].filter(name => !exposedSet.has(name));
  assert.deepEqual(onlyPreload, [], 'exposed by preload but not handled in main.cjs');
  assert.deepEqual(onlyMain, [], 'handled in main.cjs but not exposed by preload');
});

test('preload method list has no duplicates', () => {
  const duplicates = exposed.filter((name, index) => exposed.indexOf(name) !== index);
  assert.deepEqual(duplicates, []);
});

test('preferences allow-list only names handled methods', () => {
  const unknown = [...preferencesSet].filter(name => !handledSet.has(name));
  assert.deepEqual(unknown, []);
});

// 102 = 107 before the cleanup minus the five unused channels (show-about, set-appearance, save-sftp-favorites,
// forget-ssh-password, copy-remote), then 104 with the two transfer conflict-policy channels. Update this only when a
// channel is added or removed on purpose.
test('the surface sizes match the current app (106 handlers)', () => {
  assert.equal(handledSet.size, 106);
  assert.equal(exposedSet.size, 106);
});
