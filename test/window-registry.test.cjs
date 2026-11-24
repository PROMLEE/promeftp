// Multiple main windows: the registry in window-registry.cjs, and how main.cjs uses it (read as source text, so
// Electron is not needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWindowRegistry, ownedBy, cascadeBounds } = require('../window-registry.cjs');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');

function fakeWindow(name) {
  let destroyed = false;
  return { name, webContents: { name }, isDestroyed: () => destroyed, destroy() { destroyed = true; } };
}

test('primary is the focused window, else the one focused last, else the newest', () => {
  const registry = createWindowRegistry();
  const first = fakeWindow('first'), second = fakeWindow('second');
  registry.add(first);
  registry.add(second);
  assert.equal(registry.primary(first), first);
  assert.equal(registry.primary(undefined), second);
  registry.focused(first);
  assert.equal(registry.primary(undefined), first);
  // Settings or another window that is not a main window does not count as focused.
  assert.equal(registry.primary(fakeWindow('settings')), first);
  registry.remove(first);
  assert.equal(registry.primary(undefined), second);
  registry.remove(second);
  assert.equal(registry.primary(undefined), undefined);
});

test('destroyed windows are not listed, trusted or chosen', () => {
  const registry = createWindowRegistry();
  const first = fakeWindow('first'), second = fakeWindow('second');
  registry.add(first);
  registry.add(second);
  assert.equal(registry.size, 2);
  second.destroy();
  assert.equal(registry.size, 1);
  assert.equal(registry.has(second), false);
  assert.equal(registry.owns(second.webContents), false);
  assert.equal(registry.primary(second), first);
});

test('only main windows own IPC senders', () => {
  const registry = createWindowRegistry();
  const first = fakeWindow('first');
  registry.add(first);
  assert.equal(registry.owns(first.webContents), true);
  assert.equal(registry.owns(fakeWindow('other').webContents), false);
  assert.equal(registry.owns(undefined), false);
});

test('ownedBy picks the sessions of one window', () => {
  const first = fakeWindow('first'), second = fakeWindow('second');
  const sessions = new Map([['a', { owner: first }], ['b', { owner: second }], ['c', { owner: first }], ['d', {}]]);
  assert.deepEqual(ownedBy(sessions, first), ['a', 'c']);
  assert.deepEqual(ownedBy(sessions, second), ['b']);
});

test('a new window opens offset from the current one', () => {
  assert.deepEqual(cascadeBounds({ x: 100, y: 50, width: 1200, height: 760 }), { x: 124, y: 74 });
  assert.deepEqual(cascadeBounds(undefined), {});
});

test('main.cjs has no single main window left', () => {
  assert.doesNotMatch(main, /^let window\b/m);
  assert.doesNotMatch(main, /[^.\w]window\??\.(webContents|isDestroyed|focus|show|restore|loadFile|on)\b/);
  assert.doesNotMatch(main, /dialog\.show\w+\(window\b/);
});

test('IPC trusts every main window and runs each request with its window', () => {
  assert.match(main, /mainWindows\.owns\(event\.sender\)/);
  assert.match(main, /requestContext\.run\(\{ window: BrowserWindow\.fromWebContents\(event\.sender\) \}/);
});

test('sessions remember their window and are closed with it', () => {
  assert.match(main, /const record = \{ owner: requestWindow\(\),/);
  assert.match(main, /tell\(id, event, value, record\.owner\)/);
  assert.match(main, /created\.on\('closed', \(\) => \{\s*mainWindows\.remove\(created\);\s*closeWindowSessions\(created\);/);
});

test('New Window has a shortcut, and relaunching or the Dock opens a window', () => {
  assert.match(main, /\{ id: 'new-window', label: 'New Window', accel: 'CmdOrCtrl\+Shift\+N', scope: 'app', menu: 'File' \}/);
  assert.match(main, /if \(id === 'new-window'\) \{ createMainWindow\(\)/);
  assert.match(main, /app\.on\('second-instance', \(\) => \{\s*if \(windowsReady\) runCommand\(undefined, 'new-window'\);/);
  assert.match(main, /app\.on\('activate', \(\) => \{\s*if \(windowsReady && !mainWindows\.size\) runCommand\(undefined, 'new-window'\);/);
});

test('saved lists changed in one window reach the others', () => {
  assert.match(main, /const sharedStateKeys = \['profiles', 'bookmarkFolders', 'workspaces', 'connectionHistory'\];/);
  assert.match(main, /event: 'state-changed', value: changed/);
  const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  assert.match(renderer, /if \(event === 'state-changed' && id === '\*'\) \{ applySharedStateChange\(value\); return; \}/);
});

test('the macOS build copies every local module main.cjs requires', () => {
  const build = fs.readFileSync(path.join(root, 'build-macos.sh'), 'utf8');
  const copied = new Set(build.split('\n').find(line => line.startsWith('cp main.cjs ')).split(/\s+/));
  const required = [...main.matchAll(/require\('\.\/([^']+)'\)/g)].map(match => match[1]);
  assert.deepEqual(required.filter(name => !copied.has(name)), []);
});
