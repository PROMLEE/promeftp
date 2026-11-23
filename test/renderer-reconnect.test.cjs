// Reconnecting a pane must keep its tab on screen, including when the tab is split.
// The renderer runs in a headless Chromium (Playwright) against a stubbed window.promeftp bridge.
// When Playwright or its browser is not installed, these tests are skipped with that reason.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..');
let chromium;
try { ({ chromium } = require('playwright')); } catch {}

// A bridge where every call resolves. Sessions only change when the test emits an event.
function stubBridge() {
  const defaults = { profiles: [], 'bookmark-folders': [], 'connection-history': [], snippets: [], workspaces: [], 'transfer-list': [],
    'config-aliases': [], 'config-files': [], 'terminal-triggers': [], 'keyboard-shortcuts': {}, appearance: {}, 'preferences-data': {},
    'application-info': {}, 'global-auth-rules': [], 'sftp-favorites': [], 'agent-info': {}, 'update-status': {} };
  let onSession = () => {};
  window.__emit = payload => onSession(payload);
  window.promeftp = new Proxy({}, { get(_, name) {
    if (name === 'onSession') return callback => { onSession = callback; };
    if (name.startsWith('on')) return () => {};
    return (...args) => {
      if (name === 'local-list') return Promise.resolve({ directory: '/local', entries: [{ name: 'local.txt', size: 1, modifiedAt: 0 }] });
      if (name === 'sftp' && args[1] === 'list') return Promise.resolve({ directory: '/remote', entries: [{ name: 'remote.txt', size: 1, modifiedAt: 0 }] });
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
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

// Opens a tab with two panes split side by side, drops the second one, and presses its Reconnect button.
async function splitAndReconnect(page, firstMode, secondMode) {
  return page.evaluate(async ([firstMode, secondMode]) => {
    const settle = () => new Promise(resolve => setTimeout(resolve, 50));
    const first = start({ label: 'one', host: 'one' }, firstMode, {});
    __emit({ id: first, event: 'ready' });
    if (firstMode === secondMode) createSplit(sessions.get(first), 'row', { label: 'two', host: 'two' }, secondMode);
    else {
      // A file pane beside a terminal, as a restored workspace builds it: the pane has its own local panel.
      const id = start({ label: 'two', host: 'two' }, secondMode, { tabRecord: sessions.get(first).tabRecord, deferActivation: true, standaloneFiles: true });
      attachSplit(sessions.get(first), sessions.get(id).pane, 'right');
      activate(id);
    }
    const second = [...sessions.keys()].find(id => id !== first);
    __emit({ id: second, event: 'ready' });
    await settle();
    const tab = sessions.get(first).tabRecord;
    __emit({ id: second, event: 'closed' });
    sessions.get(second).status.querySelector('button.inline-action').click();
    const renewed = [...sessions.keys()].find(id => id !== first);
    __emit({ id: renewed, event: 'ready' });
    await settle();
    const afterReconnect = { active: active === renewed, tabHidden: tab.root.hidden };
    // Click the other pane, then the reconnected one, the way the user moves between them.
    sessions.get(first).pane.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    sessions.get(renewed).pane.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    sessions.get(renewed).pane.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await settle();
    const pane = sessions.get(renewed).pane;
    return {
      afterReconnect,
      afterClick: { active: active === renewed, tabHidden: tab.root.hidden, focus: tab.focus === renewed },
      stillSplit: Boolean(pane.parentElement?.classList.contains('split-node')),
      panes: tab.root.querySelectorAll('.pane').length,
      localPanels: tab.root.querySelectorAll('.local-file-panes .file-panel').length,
      ownLocalPanels: pane.querySelectorAll('.local-file-panes .file-panel').length,
      remoteRows: pane.querySelectorAll('.file-row').length,
      oldIdGone: !sessions.has(second),
    };
  }, [firstMode, secondMode]);
}

test('reconnecting a split SFTP remote pane keeps the tab visible and its panes in place', t => withPage(t, async page => {
  const result = await splitAndReconnect(page, 'sftp', 'sftp');
  assert.deepEqual(result.afterReconnect, { active: true, tabHidden: false });
  assert.deepEqual(result.afterClick, { active: true, tabHidden: false, focus: true });
  assert.equal(result.stillSplit, true);
  assert.equal(result.panes, 2);
  assert.equal(result.localPanels, 1);
  assert.ok(result.remoteRows > 0, 'the reconnected remote pane lists its folder');
  assert.equal(result.oldIdGone, true);
}));

test('reconnecting a split SSH terminal pane keeps the tab visible', t => withPage(t, async page => {
  const result = await splitAndReconnect(page, 'ssh', 'ssh');
  assert.deepEqual(result.afterReconnect, { active: true, tabHidden: false });
  assert.deepEqual(result.afterClick, { active: true, tabHidden: false, focus: true });
  assert.equal(result.stillSplit, true);
  assert.equal(result.panes, 2);
}));

test('reconnecting an SFTP pane beside a terminal rebuilds its own local panel', t => withPage(t, async page => {
  const result = await splitAndReconnect(page, 'ssh', 'sftp');
  assert.deepEqual(result.afterReconnect, { active: true, tabHidden: false });
  assert.deepEqual(result.afterClick, { active: true, tabHidden: false, focus: true });
  assert.equal(result.stillSplit, true);
  assert.equal(result.ownLocalPanels, 1);
}));
