// Dragging bookmark folders and bookmarks in the sidebar reorders them and saves the order through the bridge.
// The renderer runs in a headless Chromium (Playwright) against a stubbed window.promeftp bridge that keeps the state.
// When Playwright or its browser is not installed, these tests are skipped with that reason.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..');
let chromium;
try { ({ chromium } = require('playwright')); } catch {}

function stubBridge(legacy) {
  if (legacy) localStorage.setItem('list-order:bookmarks', JSON.stringify(legacy));
  const state = {
    profiles: [
      { id: 'a1', label: 'A1', host: 'a1', group: 'Alpha' }, { id: 'b1', label: 'B1', host: 'b1', group: 'Beta' },
      { id: 'g1', label: 'G1', host: 'g1', group: 'Gamma' }, { id: 'g2', label: 'G2', host: 'g2', group: 'Gamma' },
      { id: 'r1', label: 'R1', host: 'r1' }, { id: 'r2', label: 'R2', host: 'r2' },
    ],
    folders: ['Gamma', 'Alpha', 'Beta'],
    order: { folders: [], bookmarks: [] },
  };
  window.__state = state;
  window.__calls = [];
  const handlers = {
    profiles: () => state.profiles,
    'bookmark-folders': () => state.folders,
    'bookmark-order': () => state.order,
    'set-bookmark-order': change => { state.order = { ...state.order, ...change }; },
    'move-bookmark': (id, folder) => { state.profiles.find(entry => entry.id === id).group = folder; },
  };
  const lists = ['connection-history', 'snippets', 'workspaces', 'transfer-list', 'config-aliases', 'config-files', 'terminal-triggers', 'global-auth-rules', 'sftp-favorites'];
  window.promeftp = new Proxy({}, { get(_, name) {
    if (name.startsWith('on')) return () => {};
    return (...args) => {
      window.__calls.push([name, ...args]);
      if (handlers[name]) return Promise.resolve(structuredClone(handlers[name](...args) ?? null));
      return Promise.resolve(lists.includes(name) ? [] : name.endsWith('s') || name.includes('info') ? {} : null);
    };
  } });
}

async function withPage(t, run, legacy) {
  if (!chromium) return t.skip('Playwright is not installed');
  let browser;
  try { browser = await chromium.launch(); } catch (error) { return t.skip('Chromium is not available: ' + error.message.split('\n')[0]); }
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(stubBridge, legacy);
    await page.goto('file://' + path.join(root, 'index.html'));
    await page.waitForFunction(() => document.querySelectorAll('#hosts .bookmark-folder').length === 3);
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

const folderNames = page => page.$$eval('#hosts .bookmark-folder-heading span', spans => spans.map(span => span.textContent));
const rowsIn = (page, folder) => page.locator('.bookmark-folder', { has: page.locator('.bookmark-folder-heading', { hasText: folder }) })
  .locator('.bookmark-row').allTextContents();
const heading = (page, name) => page.locator('.bookmark-folder-heading', { hasText: name });
const row = (page, name) => page.locator('.bookmark-row', { hasText: name });
const settle = page => page.waitForTimeout(100);

test('folders start by name and a dragged folder heading lands above or below another folder', async t => {
  await withPage(t, async page => {
    assert.deepEqual(await folderNames(page), ['Alpha', 'Beta', 'Gamma']);
    await heading(page, 'Gamma').dragTo(heading(page, 'Alpha'), { targetPosition: { x: 30, y: 2 } });
    await settle(page);
    assert.deepEqual(await folderNames(page), ['Gamma', 'Alpha', 'Beta']);
    await heading(page, 'Gamma').dragTo(heading(page, 'Beta'), { targetPosition: { x: 30, y: 20 } });
    await settle(page);
    assert.deepEqual(await folderNames(page), ['Alpha', 'Beta', 'Gamma']);
    // Over an open folder's bookmarks the dragged folder goes below that folder.
    await heading(page, 'Alpha').dragTo(row(page, 'B1'));
    await settle(page);
    assert.deepEqual(await folderNames(page), ['Beta', 'Alpha', 'Gamma']);
    assert.deepEqual(await page.evaluate(() => window.__state.order.folders), ['Beta', 'Alpha', 'Gamma']);
    // The order is read back from the saved state, as after a restart or in another window.
    await page.evaluate(() => refresh());
    assert.deepEqual(await folderNames(page), ['Beta', 'Alpha', 'Gamma']);
  });
});

test('a bookmark dropped on a bookmark of another folder moves into that folder at that place', async t => {
  await withPage(t, async page => {
    await row(page, 'G2').dragTo(row(page, 'G1'), { targetPosition: { x: 20, y: 2 } });
    await settle(page);
    assert.deepEqual(await rowsIn(page, 'Gamma'), ['G2', 'G1']);
    await row(page, 'G1').dragTo(row(page, 'A1'), { targetPosition: { x: 20, y: 2 } });
    await settle(page);
    assert.deepEqual(await rowsIn(page, 'Alpha'), ['G1', 'A1']);
    assert.deepEqual(await rowsIn(page, 'Gamma'), ['G2']);
    assert.equal(await page.evaluate(() => window.__state.profiles.find(entry => entry.id === 'g1').group), 'Alpha');
    // Dropped on a folder heading, a bookmark goes last in that folder.
    await row(page, 'R1').dragTo(heading(page, 'Beta'));
    await settle(page);
    assert.deepEqual(await rowsIn(page, 'Beta'), ['B1', 'R1']);
  });
});

test('the bookmark order a window kept in localStorage is carried into the saved state once', async t => {
  await withPage(t, async page => {
    assert.deepEqual(await page.evaluate(() => window.__state.order.bookmarks), ['r2', 'r1']);
    assert.equal(await page.evaluate(() => localStorage.getItem('list-order:bookmarks')), null);
    const top = await page.$$eval('#hosts > .bookmark-row', rows => rows.map(element => element.textContent));
    assert.deepEqual(top, ['R2', 'R1']);
  }, ['r2', 'r1']);
});
