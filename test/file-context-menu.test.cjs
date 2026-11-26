// Right-clicking a file row acts on the selection (Finder rules): inside it, the whole selection; outside it, that row alone.
// The renderer runs in a headless Chromium (Playwright) against a stubbed window.promeftp bridge.
// When Playwright or its browser is not installed, these tests are skipped with that reason.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..');
let chromium;
try { ({ chromium } = require('playwright')); } catch {}

// Records every bridge call. A context menu answers with the index of the item whose label the test picked.
function stubBridge() {
  const defaults = { profiles: [], 'bookmark-folders': [], 'connection-history': [], snippets: [], workspaces: [], 'transfer-list': [],
    'config-aliases': [], 'config-files': [], 'terminal-triggers': [], 'keyboard-shortcuts': {}, appearance: {}, 'preferences-data': {},
    'application-info': {}, 'global-auth-rules': [], 'sftp-favorites': [], 'agent-info': {}, 'update-status': {} };
  window.__calls = [];
  window.__menus = [];
  window.__pick = undefined;
  let onSession = () => {};
  window.__emit = payload => onSession(payload);
  window.promeftp = new Proxy({}, { get(_, name) {
    if (name === 'onSession') return callback => { onSession = callback; };
    if (name.startsWith('on')) return () => {};
    return (...args) => {
      window.__calls.push([name, ...args]);
      if (name === 'sftp' && args[1] === 'list') {
        return Promise.resolve({ directory: '/remote', entries: ['r1.txt'].map(item => ({ name: item, size: 1, modifiedAt: 0 })) });
      }
      if (name === 'context-menu') {
        window.__menus.push(args[0].filter(Boolean).map(item => ({ label: item.label, enabled: item.enabled !== false })));
        const index = args[0].findIndex(item => item && item.label === window.__pick);
        window.__pick = undefined;
        return Promise.resolve(index < 0 ? null : index);
      }
      if (name === 'local-list') {
        return Promise.resolve({ directory: '/local', entries: ['a.txt', 'b.txt', 'c.txt'].map(item => ({ name: item, size: 1, modifiedAt: 0 })) });
      }
      return Promise.resolve(name in defaults ? defaults[name] : null);
    };
  } });
}

async function withPage(t, run) {
  if (!chromium) return t.skip('Playwright is not installed');
  let browser;
  try { browser = await chromium.launch(); } catch (error) { return t.skip('Chromium is not available: ' + error.message.split('\n')[0]); }
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(stubBridge);
    await page.goto('file://' + path.join(root, 'index.html'));
    await page.waitForFunction(() => typeof start === 'function' && typeof reconnect === 'function');
    // The local panel lives inside an SFTP pane, so one connected SFTP session shows it.
    await page.evaluate(() => { const id = start({ label: 'one', host: 'one' }, 'sftp', {}); __emit({ id, event: 'ready' }); });
    await page.waitForSelector('.file-row .file-name[data-name="a.txt"]');
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

const pressed = page => page.$$eval('.file-name[data-name][aria-pressed]', items => items
  .filter(item => item.getAttribute('aria-pressed') === 'true').map(item => item.dataset.name));

// The labels and enabled state of the last context menu, in the order they were shown.
const lastMenu = page => page.evaluate(() => window.__menus.at(-1));

test('right-clicking inside a multi-selection keeps the selection and disables single-item commands', t => withPage(t, async page => {
  await page.click('.file-name[data-name="a.txt"]');
  await page.click('.file-name[data-name="b.txt"]', { modifiers: ['Meta'] });
  await page.click('.file-name[data-name="b.txt"]', { button: 'right' });
  assert.deepEqual((await pressed(page)).sort(), ['a.txt', 'b.txt']);
  const menu = await lastMenu(page);
  const state = label => menu.find(item => item.label === label)?.enabled;
  assert.equal(state('Move to Trash'), true);
  assert.equal(state('Copy Path'), true);
  assert.equal(state('Copy'), true);
  assert.equal(state('Rename…'), false);
  assert.equal(state('Get Info'), false);
  assert.equal(state('Reveal in Finder'), false);
}));

test('right-clicking outside the selection selects only that row, and single-item commands come back', t => withPage(t, async page => {
  await page.click('.file-name[data-name="a.txt"]');
  await page.click('.file-name[data-name="b.txt"]', { modifiers: ['Meta'] });
  await page.click('.file-name[data-name="c.txt"]', { button: 'right' });
  assert.deepEqual(await pressed(page), ['c.txt']);
  const menu = await lastMenu(page);
  assert.equal(menu.find(item => item.label === 'Rename…')?.enabled, true);
  assert.equal(menu.find(item => item.label === 'Get Info')?.enabled, true);
}));

test('Move to Trash on a multi-selection sends every selected name in one call', t => withPage(t, async page => {
  await page.click('.file-name[data-name="a.txt"]');
  await page.click('.file-name[data-name="b.txt"]', { modifiers: ['Meta'] });
  await page.evaluate(() => { window.__pick = 'Move to Trash'; });
  await page.click('.file-name[data-name="b.txt"]', { button: 'right' });
  await page.waitForFunction(() => window.__calls.some(call => call[0] === 'local-action' && call[1] === 'trash'));
  const trash = await page.evaluate(() => window.__calls.filter(call => call[0] === 'local-action' && call[1] === 'trash'));
  assert.equal(trash.length, 1);
  assert.deepEqual(trash[0][3], ['a.txt', 'b.txt']);
}));

test('Copy Path on a multi-selection copies every path, one per line', t => withPage(t, async page => {
  await page.click('.file-name[data-name="a.txt"]');
  await page.click('.file-name[data-name="b.txt"]', { modifiers: ['Meta'] });
  await page.evaluate(() => { window.__pick = 'Copy Path'; });
  await page.click('.file-name[data-name="a.txt"]', { button: 'right' });
  await page.waitForFunction(() => window.__calls.some(call => call[0] === 'write-clipboard'));
  const written = await page.evaluate(() => window.__calls.filter(call => call[0] === 'write-clipboard').at(-1)[1]);
  assert.equal(written.split('\n').length, 2);
  assert.ok(written.endsWith('/a.txt') || written.endsWith('/b.txt'));
  assert.match(written, /a\.txt/);
  assert.match(written, /b\.txt/);
}));
