const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, Menu, nativeTheme, safeStorage } = require('electron');
const { createDecipheriv, createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { createReadStream, createWriteStream, existsSync } = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const os = require('node:os');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const path = require('node:path');
const openssh = require('./openssh.cjs');
const { compileTrigger, scanTriggers } = require('./terminal-triggers.cjs');
const { translate, supportedLocale } = require('./localization.js');
const { RE2 } = require('re2-wasm');
const { createAgentService } = require('./agent-service.cjs');
const { createTransport } = require('./agent-transport.cjs');
const { manageSkill, agentTargets, detectAgents } = require('./agent-skills.cjs');
const pathFavorites = require('./path-favorites.cjs');
const { createTransferService } = require('./transfer-service.cjs');
const directoryCompare = require('./directory-compare.cjs');

let window;
let preferencesWindow;
let preferencesLaunch;
let state;
let updater;
let pendingWrites = 0;
let queuedTransferBusy = false;
let transferQueue;
const comparisonPlans = new Map();
const comparisonControllers = new Map();
const transferConflictRequests = new Map();
let agentConnections = 0;
let agent;
let agentTransport;
let agentStartupError;
const sessions = new Map();
const statePath = () => path.join(app.getPath('userData'), 'profiles.json');

function syncUpdateBusy() {
  updater?.setBusy(sessions.size > 0 || agentConnections > 0 || pendingWrites > 0 || queuedTransferBusy);
}

async function updateState(change) {
  pendingWrites++;
  syncUpdateBusy();
  const operation = stateWrites.then(async () => {
    const next = structuredClone(state);
    change(next);
    const temp = statePath() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await fs.rename(temp, statePath());
    state = next;
    agent?.reconcile();
  });
  stateWrites = operation.catch(() => {});
  try { return await operation; }
  finally {
    pendingWrites--;
    syncUpdateBusy();
  }
}
let stateWrites = Promise.resolve();

function expandHome(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('~/') ? path.join(app.getPath('home'), trimmed.slice(2)) : trimmed;
}
function editableConfigPath(file) {
  const defaultPath = path.join(app.getPath('home'), '.ssh', 'config');
  const requested = path.resolve(expandHome(file || '') || defaultPath);
  const allowed = new Set([defaultPath, ...(state.configFiles || []).map(value => path.resolve(expandHome(value)))]);
  if (!allowed.has(requested)) throw Error('Add this SSH config file to PromeFTP before editing it.');
  return requested;
}
function profile(input) {
  const { label = '', host = '', hostname = '', port = null, username = '', keyPath = '', group = '', configPath = '', pam = false } = input;
  const address = host.trim();
  if (!address || address.startsWith('-') || /[\s\x00]/.test(address)) throw Error('Enter an SSH host or alias.');
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) throw Error('Port must be between 1 and 65535.');
  const override = input.usesAlias === true ? hostname.trim() : '';
  if (override && (override.startsWith('-') || !/^[\p{L}\p{N}._:%-]+$/u.test(override))) {
    throw Error('Enter a hostname or IP address.');
  }
  return {
    ...(override && { hostname: override }),
    label: label.trim() || address, host: address, port, username: username.trim(),
    keyPath: expandHome(keyPath), group: group.trim(), configPath: expandHome(configPath), pam: Boolean(pam),
    usesAlias: input.usesAlias === true,
  };
}

const preferencesMethods = new Set([
  'appearance', 'application-info', 'preferences-data', 'save-preferences', 'open-config-from-preferences', 'close-preferences',
  'keyboard-shortcuts', 'show-about', 'update-status', 'open-link', 'open-sponsors', 'open-project-license', 'open-license-notices', 'check-for-updates', 'set-automatic-updates',
  'saved-auth-replies', 'reveal-auth-answer', 'move-auth-reply-to-global', 'saved-auto-setting',
  'set-saved-auto-setting', 'global-auth-rules', 'save-global-auth-rule', 'remove-global-auth-rule',
  'update-auth-reply', 'remove-auth-reply', 'keychain-preferences', 'set-keychain-preferences',
  'agent-info', 'agent-enable', 'agent-register', 'agent-revoke', 'agent-save-token', 'agent-clear-token', 'agent-grant', 'agent-answer',
  'agent-history', 'agent-retention', 'agent-export', 'agent-skill',
  'write-clipboard',
]);
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    const trusted = (!name.startsWith('agent-') && event.sender === window?.webContents) ||
      (event.sender === preferencesWindow?.webContents && preferencesMethods.has(name));
    if (!trusted || event.senderFrame !== event.sender.mainFrame) throw Error('Untrusted request.');
    return fn(...args);
  });
}
function tell(id, event, value) {
  if (window && !window.isDestroyed()) window.webContents.send('session', { id, event, value });
}

function bookmarkFolderNames(snapshot) {
  return new Set([...(snapshot.bookmarkFolders || []), ...snapshot.profiles.map(entry => entry.group).filter(Boolean)]);
}

function bookmarkFolderName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 80) throw Error('Enter a folder name (1–80 characters).');
  return name;
}

function favoriteScope(input) {
  if (input === 'local') return 'local';
  return pathFavorites.scopeFor(profile(input));
}
function emitFavorites(scope) {
  if (!window || window.isDestroyed()) return;
  const value = pathFavorites.list(state, scope);
  for (const [id, record] of sessions) {
    if (record.mode !== 'sftp') continue;
    const target = scope === 'local' ? 'local' : record.input && pathFavorites.scopeFor(record.input);
    if (target === scope) tell(id, 'sftp-favorites', { scope, items: value });
  }
}
handle('sftp-favorites', async (id, legacy = []) => {
  const scope = favoriteScope(id);
  if (!pathFavorites.list(state, scope).length && Array.isArray(legacy) && legacy.length) {
    await updateState(next => pathFavorites.migrate(next, scope, legacy));
  }
  return pathFavorites.list(state, scope);
});
handle('save-sftp-favorites', async (id, items, manualOrder = false) => {
  const scope = favoriteScope(id);
  await updateState(next => pathFavorites.replace(next, scope, items, manualOrder === true));
  emitFavorites(scope);
  return pathFavorites.list(state, scope);
});
handle('mutate-sftp-favorite', async (id, change) => {
  const scope = favoriteScope(id);
  await updateState(next => pathFavorites.mutate(next, scope, change));
  emitFavorites(scope);
  return pathFavorites.list(state, scope);
});
handle('bookmark-folders', () => [...bookmarkFolderNames(state)]);
handle('save-bookmark-folder', (value, previous) => updateState(next => {
  const name = bookmarkFolderName(value);
  const names = bookmarkFolderNames(next);
  if (name !== previous && names.has(name)) throw Error('A folder already uses that name.');
  if (previous && !names.has(previous)) throw Error('Folder no longer exists.');
  names.delete(previous);
  names.add(name);
  next.bookmarkFolders = [...names];
  if (previous) {
    for (const entry of next.profiles) if (entry.group === previous) entry.group = name;
  }
}));
handle('remove-bookmark-folder', name => updateState(next => {
  next.bookmarkFolders = [...bookmarkFolderNames(next)].filter(folder => folder !== name);
  for (const entry of next.profiles) if (entry.group === name) entry.group = '';
}));
handle('move-bookmark', (id, folder) => updateState(next => {
  if (folder && !bookmarkFolderNames(next).has(folder)) throw Error('Folder no longer exists.');
  const entry = next.profiles.find(item => item.id === id);
  if (!entry) throw Error('Bookmark no longer exists.');
  entry.group = folder || '';
}));

handle('profiles', () => state.profiles);
handle('save-profile', async (input) => {
  const entry = { ...profile(input), id: input.id || randomUUID() };
  await updateState(next => {
    const index = next.profiles.findIndex(item => item.id === entry.id);
    if (index < 0) next.profiles.push(entry);
    else next.profiles[index] = entry;
    if (entry.group) next.bookmarkFolders = [...bookmarkFolderNames(next)];
  });
  return entry;
});
handle('remove-profile', id => updateState(next => {
  next.profiles = next.profiles.filter(item => item.id !== id);
}));
handle('choose-key', async () => {
  const result = await dialog.showOpenDialog(window, { title: 'Choose SSH private key', defaultPath: path.join(app.getPath('home'), '.ssh'), properties: ['openFile', 'showHiddenFiles'] });
  return result.filePaths[0];
});

handle('config-aliases', configPath => openssh.aliases(expandHome(configPath)));
handle('effective-config', input => openssh.effective(profile(input)));
handle('inspect-identity-file', value => openssh.inspectIdentityFile(value));
handle('choose-config', async () => {
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose OpenSSH config', defaultPath: path.join(app.getPath('home'), '.ssh'),
    properties: ['openFile', 'showHiddenFiles'],
  });
  return result.filePaths[0];
});
handle('config-files', () => state.configFiles || []);
handle('register-config', file => {
  const expanded = expandHome(file || '');
  if (!expanded || !path.isAbsolute(expanded)) throw Error('Choose an absolute config file path.');
  const name = path.resolve(expanded);
  return updateState(next => {
    next.configFiles ??= [];
    if (!next.configFiles.includes(name)) next.configFiles.push(name);
  });
});
handle('unregister-config', file => updateState(next => {
  next.configFiles = (next.configFiles || []).filter(entry => entry !== file);
}));
handle('edit-config-file', async file => {
  const name = editableConfigPath(file);
  let target = name;
  let info = await fs.lstat(name).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (info?.isSymbolicLink()) { target = await fs.realpath(name); info = await fs.stat(target); }
  if (info && !info.isFile()) throw Error('Choose an SSH config file.');
  if (info && info.size > 2_000_000) throw Error('SSH config file is too large to edit in PromeFTP.');
  return { path: name, content: info ? await fs.readFile(target, 'utf8') : '' };
});
handle('save-config-file', async (file, content, baseline) => {
  const name = editableConfigPath(file);
  if (typeof content !== 'string' || content.length > 2_000_000 || content.includes('\0')) throw Error('Invalid SSH config contents.');
  let target = name;
  let info = await fs.lstat(name).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (info?.isSymbolicLink()) {
    target = await fs.realpath(name);
    info = await fs.stat(target);
  }
  if (info && !info.isFile()) throw Error('Choose an SSH config file.');
  const current = info ? await fs.readFile(target, 'utf8') : '';
  if (typeof baseline === 'string' && current !== baseline) throw Error('This SSH config changed outside PromeFTP. Reload it before saving.');
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = target + '.promeftp-' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, content, { mode: info ? info.mode & 0o777 : 0o600, flag: 'wx' });
    await fs.rename(temp, target);
    await fs.chmod(target, info ? info.mode & 0o777 : 0o600);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
});
function historyIdentity({ input }) {
  const config = input.configPath || path.join(app.getPath('home'), '.ssh', 'config');
  const host = input.host.toLowerCase();
  const isAlias = input.usesAlias || !/[.:@]/.test(host);
  return JSON.stringify(isAlias ? [config, host] : [config, host, input.username || '', input.port || 22]);
}
function latestConnections(entries) {
  const seen = new Set();
  return entries.filter(entry => {
    const key = historyIdentity(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 100);
}
handle('connection-history', () => latestConnections(state.connectionHistory || []));
handle('remove-history-item', id => updateState(next => {
  next.connectionHistory = (next.connectionHistory || []).filter(entry => entry.id !== id);
}));

function workspaceName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 80) throw Error('Enter a workspace name (1–80 characters).');
  return name;
}
handle('workspaces', () => state.workspaces);
handle('rename-workspace', (id, value) => {
  const name = workspaceName(value);
  return updateState(next => {
    const current = next.workspaces.find(item => item.id === id);
    if (!current) throw Error('Workspace no longer exists.');
    if (next.workspaces.some(item => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) {
      throw Error('A workspace already uses that name.');
    }
    current.name = name;
  });
});
handle('save-workspace', async (value, tabs, layout = {}) => {
  const name = workspaceName(value);
  if (!Array.isArray(tabs) || tabs.length < 1 || tabs.length > 20) throw Error('Open 1–20 sessions to save a layout.');
  const entries = tabs.map(({ mode, input, group, local, remote }) => {
    if (!['ssh', 'sftp', 'local'].includes(mode)) throw Error('Unsupported session type.');
    const text = value => typeof value === 'string' ? value.slice(0, 4096) : '';
    return { mode, input: mode === 'local' ? { label: 'Local Shell' } : profile(input), group: text(group).slice(0, 40), local: text(local), remote: text(remote) };
  });
  const index = value => Number.isInteger(value) && value >= 0 && value < entries.length ? value : null;
  const seen = new Set();
  function tree(node, depth = 0) {
    if (index(node) !== null && !seen.has(node)) {
      seen.add(node);
      return node;
    }
    if (depth >= 20 || !['row', 'column'].includes(node?.axis) || !Number.isFinite(node.ratio)) {
      throw Error('Invalid split layout.');
    }
    return {
      axis: node.axis, ratio: Math.max(0.1, Math.min(0.9, node.ratio)),
      first: tree(node.first, depth + 1), second: tree(node.second, depth + 1),
    };
  }
  const clean = (value, length) => typeof value === 'string' ? value.trim().slice(0, length) : '';
  const panes = layout.panes?.map(item => {
    const preceding = new Set(seen);
    const root = tree(item.tree);
    const focus = seen.has(item.focus) && !preceding.has(item.focus) ? item.focus : null;
    const localRatio = Number.isFinite(item.localRatio) ? Math.max(0.2, Math.min(0.75, item.localRatio)) : undefined;
    return { name: clean(item.name, 80), group: clean(item.group, 40), groupColor: clean(item.groupColor, 16), color: clean(item.color, 16), tree: root, focus, localRatio };
  });
  if (panes && seen.size !== entries.length) throw Error('Invalid workspace layout.');
  const saved = {
    id: randomUUID(), name, tabs: entries,
    ...(panes && { panes }),
    active: index(layout.active), pinned: index(layout.pinned),
    ratio: Number.isFinite(layout.ratio) ? Math.max(0.28, Math.min(0.72, layout.ratio)) : 0.5,
  };
  await updateState(next => {
    if (next.workspaces.some(item => item.name.toLowerCase() === name.toLowerCase())) {
      throw Error('A workspace already uses that name.');
    }
    next.workspaces.push(saved);
  });
  return saved;
});
handle('confirm-remove-workspace', async id => {
  const saved = state.workspaces.find(item => item.id === id);
  if (!saved) return false;
  const { response } = await dialog.showMessageBox(window, {
    type: 'warning', message: 'Remove saved workspace?', detail: saved.name,
    buttons: ['Cancel', 'Remove'], defaultId: 0, cancelId: 0,
  });
  if (response !== 1) return false;
  await updateState(next => {
    next.workspaces = next.workspaces.filter(item => item.id !== id);
  });
  return true;
});
function snippetScope(context) {
  if (!context) return '';
  if (context.mode === 'local') return 'local';
  if (context.mode !== 'ssh') throw Error('Choose an SSH or local terminal.');
  const { host, hostname, username, port, configPath } = profile(context.input);
  return JSON.stringify(['ssh', host.toLowerCase(), hostname || '', username, port, configPath]);
}
handle('snippets', context => {
  const scope = snippetScope(context);
  return state.snippets.filter(snippet => !snippet.scope || snippet.scope === scope);
});
handle('save-snippet', async (name, command, context, id) => {
  if (typeof name !== 'string' || typeof command !== 'string' || !name.trim() || !command.trim()) {
    throw Error('Enter a name and command.');
  }
  const scope = snippetScope(context);
  await updateState(next => {
    const snippet = { id: id || randomUUID(), name: name.trim(), command, ...(scope && { scope }) };
    if (!id) next.snippets.push(snippet);
    else {
      const index = next.snippets.findIndex(item => item.id === id);
      if (index < 0) throw Error('Snippet no longer exists.');
      next.snippets[index] = snippet;
    }
  });
});
const triggerCache = new Map();
handle('terminal-triggers', context => {
  const scope = snippetScope(context);
  return (state.terminalTriggers || []).filter(rule => !rule.scope || rule.scope === scope);
});
handle('save-terminal-trigger', (name, pattern, action, response, context, id) => {
  if (typeof name !== 'string' || !name.trim() || name.length > 80) throw Error('Enter a trigger name.');
  compileTrigger(pattern);
  if (!['notify', 'ask', 'send'].includes(action) || typeof response !== 'string') {
    throw Error('Choose a trigger action and enter a valid response.');
  }
  response = action === 'send' ? response.replace(/\r\n?/g, '\n') : '';
  if (Buffer.byteLength(response) > 1023 || /\0/.test(response) || (action !== 'send' && /[\r\n]/.test(response))) {
    throw Error('Enter a valid response up to 1023 bytes.');
  }
  if (action === 'send' && !response) throw Error('Enter the response to send.');
  const scope = snippetScope(context);
  return updateState(next => {
    const rules = next.terminalTriggers ??= [];
    const previous = id ? rules.find(item => item.id === id) : undefined;
    const rule = { id: id || randomUUID(), name: name.trim(), pattern, action, response,
      ...(previous?.enabled === false && { enabled: false }), ...(scope && { scope }) };
    if (!id) {
      if (rules.length >= 50) throw Error('Up to 50 terminal triggers can be saved.');
      rules.push(rule);
    } else {
      const index = rules.findIndex(item => item.id === id);
      if (index < 0) throw Error('Trigger no longer exists.');
      rules[index] = rule;
    }
  }).then(() => triggerCache.delete(id));
});
handle('set-terminal-trigger-enabled', (id, enabled) => {
  if (typeof enabled !== 'boolean') throw Error('Invalid trigger state.');
  return updateState(next => {
    const rule = (next.terminalTriggers || []).find(item => item.id === id);
    if (!rule) throw Error('Trigger no longer exists.');
    rule.enabled = enabled;
  }).then(() => triggerCache.delete(id));
});
handle('remove-terminal-trigger', id => updateState(next => {
  next.terminalTriggers = (next.terminalTriggers || []).filter(rule => rule.id !== id);
}).then(() => triggerCache.delete(id)));
function scanSessionOutput(record, id, output) {
  const rules = (state.terminalTriggers || []).filter(rule => rule.enabled !== false && (!rule.scope || rule.scope === record.triggerScope));
  if (!rules.length) { record.triggerTail = ''; return; }
  const compiled = rules.map(rule => {
    const cached = triggerCache.get(rule.id);
    if (!cached || cached.pattern !== rule.pattern || cached.name !== rule.name || cached.action !== rule.action || cached.response !== rule.response) {
      triggerCache.set(rule.id, { ...rule, regex: compileTrigger(rule.pattern) });
    }
    return triggerCache.get(rule.id);
  });
  const { tail, matches } = scanTriggers(record.triggerTail || '', output, compiled);
  record.triggerTail = tail;
  for (const rule of matches) {
    if (rule.action === 'send') {
      const response = rule.response.replace(/\r\n?/g, '\n');
      const payload = response.replace(/\n/g, '\r') + (response.endsWith('\n') ? '' : '\r');
      sessions.get(id)?.connection?.input(payload);
      tell(id, 'terminal-trigger', { id: rule.id, name: rule.name, action: 'sent' });
    } else tell(id, 'terminal-trigger', { id: rule.id, name: rule.name, action: rule.action || 'notify' });
  }
}
const languages = ['system', 'en', 'ko', 'ja', 'zh-Hans'];
function activeLocale() {
  return supportedLocale(state.language === 'system' || !state.language ? app.getLocale() : state.language);
}
function localized(key) { return translate(activeLocale(), key); }
function terminalSettings(input) {
  const font = typeof input?.font === 'string' ? input.font.trim().slice(0, 80) : '';
  return {
    font: font || 'Menlo',
    size: Number.isInteger(input?.size) && input.size >= 9 && input.size <= 30 ? input.size : 13,
    scrollback: Number.isInteger(input?.scrollback) && input.scrollback >= 100 && input.scrollback <= 100000 ? input.scrollback : 20000,
    unlimited: input?.unlimited === true,
    optionMeta: input?.optionMeta === true,
    opacity: Number.isInteger(input?.opacity) && input.opacity >= 55 && input.opacity <= 100 ? input.opacity : 100,
  };
}
function openPreferences(page, legacyTerminal) {
  page = ['authentication', 'about', 'agent'].includes(page) ? page : 'general';
  if (preferencesWindow) {
    if (page !== 'general') {
      preferencesLaunch.page = page;
      preferencesWindow.webContents.send('command', 'preferences-' + page);
    }
    preferencesWindow.show();
    preferencesWindow.focus();
    return;
  }
  preferencesLaunch = { page, terminal: terminalSettings(legacyTerminal) };
  const panel = new BrowserWindow({
    width: 650, height: 510, useContentSize: true, resizable: false, minimizable: false,
    maximizable: false, fullscreenable: false, parent: window, show: false,
    title: localized('Preferences'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true },
  });
  preferencesWindow = panel;
  panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  panel.webContents.on('will-navigate', event => event.preventDefault());
  panel.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.meta && input.key.toLowerCase() === 'w')) {
      event.preventDefault();
      panel.close();
    }
  });
  panel.on('closed', () => { preferencesWindow = undefined; preferencesLaunch = undefined; });
  panel.once('ready-to-show', () => panel.show());
  return panel.loadFile('preferences.html');
}
handle('open-preferences', openPreferences);
handle('close-preferences', () => preferencesWindow?.close());
handle('show-about', () => openPreferences('about'));
handle('update-status', () => ({ lastCheck: updater?.lastUpdateCheck() ?? null }));
handle('preferences-data', () => ({
  locale: activeLocale(), language: state.language || 'system',
  terminal: state.terminalPreferences || preferencesLaunch?.terminal,
  page: preferencesLaunch?.page,
}));
handle('save-preferences', async ({ appearance, language, terminal } = {}) => {
  if (!languages.includes(language) || !['system', 'light', 'dark'].includes(appearance)) {
    throw Error('Choose a supported language and appearance.');
  }
  const next = terminalSettings(terminal);
  await updateState(data => Object.assign(data, { appearance, language, terminalPreferences: next }));
  nativeTheme.themeSource = appearance;
  buildApplicationMenu();
  preferencesWindow?.setTitle(localized('Preferences'));
  const settings = { terminal: next, locale: activeLocale(), version: app.getVersion(),
    build: process.defaultApp ? 'development' : app.getVersion() };
  window?.webContents.send('preferences-changed', settings);
  return settings;
});
handle('open-config-from-preferences', () => {
  preferencesWindow?.hide();
  window.show();
  window.focus();
  window.webContents.send('command', 'open-config');
});

const defaultFonts = ['Menlo', 'Monaco', 'SF Mono', 'Courier New'];
handle('application-info', () => ({
  version: app.getVersion(),
  build: process.defaultApp ? 'development' : app.getVersion(),
  fonts: [...new Set(updater?.fontFamilies() || defaultFonts)].sort((a, b) => a.localeCompare(b)),
  architecture: process.arch,
  systemVersion: process.getSystemVersion(),
  automatic: updater?.automatic() ?? null,
}));
function checkForUpdates() {
  if (sessions.size || agentConnections || pendingWrites) {
    return dialog.showMessageBox(BrowserWindow.getFocusedWindow() || window, { type: 'info', message: localized('Close active sessions before updating.') }).then(() => {});
  }
  updater?.check();
}
function setAutomaticUpdates(enabled) {
  const automatic = updater?.setAutomatic(enabled === true) ?? false;
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById('automatic-updates');
  if (menuItem) menuItem.checked = automatic;
  return automatic;
}
handle('check-for-updates', checkForUpdates);
handle('set-automatic-updates', setAutomaticUpdates);
handle('appearance', () => nativeTheme.themeSource);
handle('set-appearance', async appearance => {
  if (!['system', 'light', 'dark'].includes(appearance)) throw Error('Choose a supported appearance.');
  await updateState(next => { next.appearance = appearance; });
  nativeTheme.themeSource = appearance;
});
handle('remove-snippet', id => updateState(next => {
  next.snippets = next.snippets.filter(snippet => snippet.id !== id);
}));
handle('export-log', async (label, output) => {
  if (typeof output !== 'string' || output.length > 10_000_000) throw Error('Scrollback export is too large.');
  const name = label.replace(/[^a-z0-9가-힣_.-]+/gi, '-').slice(0, 80);
  const result = await dialog.showSaveDialog(window, { defaultPath: (name || 'promeftp') + '.log' });
  if (!result.canceled) await fs.writeFile(result.filePath, output, { mode: 0o600 });
});
function authScope(config, endpoint) {
  return createHash('sha256').update(JSON.stringify([
    config.host, config.configPath, config.keyPath, endpoint,
  ])).digest('hex');
}
async function sshPasswordScope(input) {
  const config = profile(input);
  const effective = await openssh.effective(config).catch(() => '');
  return authScope(config, effective || config.host);
}
handle('ssh-password-saved', async input => {
  const scope = await sshPasswordScope(input);
  const saved = state.sshPasswords?.[scope];
  if (!saved) return '';
  try { return await readAnswer(saved); }
  catch { return ''; }
});
handle('forget-ssh-password', async input => {
  const scope = await sshPasswordScope(input);
  await updateState(next => { if (next.sshPasswords) delete next.sshPasswords[scope]; });
});

function validAuthAnswer(value) {
  return typeof value === 'string' && value && Buffer.byteLength(value) <= 1023 && !/[\r\n\0]/.test(value);
}

const legacyAnswerReads = new Map();

async function decryptAuthAnswer(ciphertext) {
  if (ciphertext.startsWith('v2:')) {
    if (!state.authEncryptionKey) throw Error('Legacy encryption key is missing.');
    const { result } = await safeStorage.decryptStringAsync(Buffer.from(state.authEncryptionKey, 'base64'));
    const key = Buffer.from(result, 'base64');
    if (key.length !== 32) throw Error('Invalid authentication encryption key.');
    const bytes = Buffer.from(ciphertext.slice(3), 'base64');
    if (bytes.length < 29) throw Error('Invalid encrypted authentication answer.');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  }
  if (!legacyAnswerReads.has(ciphertext)) {
    const pending = safeStorage.decryptStringAsync(Buffer.from(ciphertext, 'base64')).then(({ result }) => result);
    legacyAnswerReads.set(ciphertext, pending);
    setTimeout(() => legacyAnswerReads.delete(ciphertext), 30000).unref();
  }
  return legacyAnswerReads.get(ciphertext);
}

function answerValue(entry) {
  return typeof entry?.answer === 'string' ? entry.answer : undefined;
}
async function readAnswer(entry) {
  if (typeof entry === 'string') return decryptAuthAnswer(entry);
  if (typeof entry?.answer === 'string') return entry.answer;
  if (typeof entry?.ciphertext !== 'string') return undefined;
  return decryptAuthAnswer(entry.ciphertext);
}
function migrateAuthAnswer(ciphertext, answer, apply) {
  if (!ciphertext || !validAuthAnswer(answer)) return;
  updateState(next => {
    apply(next, answer);
    const hasEncrypted = Object.values(next.sshPasswords || {}).some(entry => entry?.ciphertext) ||
      Object.values(next.authReplies || {}).some(entry => typeof entry === 'string' || entry?.ciphertext) ||
      (next.globalAuthRules || []).some(entry => entry?.ciphertext);
    if (!hasEncrypted) delete next.authEncryptionKey;
  }).catch(() => {});
}
function detailsWithoutKey(details) {
  const { key, ...metadata } = details;
  return metadata;
}

const globalPatternCache = new WeakMap();
function globalPattern(prompt) {
  return new RE2(prompt, 'u');
}
function matchesGlobalPattern(rule, question) {
  if (!globalPatternCache.has(rule)) {
    try { globalPatternCache.set(rule, globalPattern(rule.prompt)); }
    catch { globalPatternCache.set(rule, null); }
  }
  return globalPatternCache.get(rule)?.test(question) === true;
}

handle('reveal-auth-answer', async (kind, id) => {
  const entry = kind === 'global' ? state.globalAuthRules?.find(rule => rule.id === id)
    : kind === 'saved' && Object.hasOwn(state.authReplies || {}, id) ? state.authReplies[id] : undefined;
  const answer = await readAnswer(entry);
  if (!validAuthAnswer(answer)) throw Error('Saved answer no longer exists.');
  if (entry?.ciphertext) migrateAuthAnswer(entry.ciphertext, answer, (next, plain) => {
    const current = kind === 'global' ? next.globalAuthRules?.find(rule => rule.id === id) : next.authReplies?.[id];
    if (current?.ciphertext === entry.ciphertext) { current.answer = plain; delete current.ciphertext; }
  });
  return answer;
});

handle('keychain-preferences', () => ({
  openssh: state.useOpenSSHKeychain === true,
  pam: state.useStoredAuthOnConnect !== false,
}));
handle('set-keychain-preferences', (kind, enabled) => {
  if (!['openssh', 'pam'].includes(kind) || typeof enabled !== 'boolean') throw Error('Invalid Keychain preference.');
  return updateState(next => {
    next[kind === 'openssh' ? 'useOpenSSHKeychain' : 'useStoredAuthOnConnect'] = enabled;
  });
});
handle('saved-auto-setting', () => state.useSavedRepliesAutomatically !== false);
handle('set-saved-auto-setting', value => updateState(next => {
  next.useSavedRepliesAutomatically = value === true;
}));
function autoSavedReply(entry) {
  return state.useSavedRepliesAutomatically !== false && Boolean((entry?.answer || entry?.ciphertext) && entry.scope);
}

handle('saved-auth-replies', () => Object.entries(state.authReplies || {})
  .filter(([, entry]) => typeof entry === 'object' && (entry?.answer || entry?.ciphertext))
  .map(([id, { host, prompt }]) => ({ id, host, prompt })));
handle('update-auth-reply', async (id, value) => {
  if (value !== '' && !validAuthAnswer(value)) throw Error('Enter a single-line authentication answer.');
  await updateState(next => {
    const entry = next.authReplies?.[id];
    if (!(entry?.answer || entry?.ciphertext)) throw Error('Saved answer no longer exists.');
    if (value) { entry.answer = value; delete entry.ciphertext; }
  });
});
handle('remove-auth-reply', id => updateState(next => {
  if (next.authReplies && Object.hasOwn(next.authReplies, id)) delete next.authReplies[id];
}));

function normalizedAuthQuestion(question) {
  return question.replace(/^\([^\r\n)]{1,512}\) /, '');
}

handle('move-auth-reply-to-global', async id => {
  const entry = state.authReplies?.[id];
  if (!(entry?.answer || entry?.ciphertext)) throw Error('Saved answer no longer exists.');
  const answer = await readAnswer(entry);
  const result = await dialog.showMessageBox(BrowserWindow.getFocusedWindow() || window, {
    type: 'warning', message: localized('Use this answer across all SSH and SFTP connections?'),
    detail: normalizedAuthQuestion(entry.prompt), buttons: [localized('Cancel'), localized('Move to Global')], defaultId: 0, cancelId: 0,
  });
  if (result.response !== 1) return false;
  await updateState(next => {
    const current = next.authReplies?.[id];
    if (!(current?.answer || current?.ciphertext)) throw Error('The saved answer changed. Try again.');
    const prompt = normalizedAuthQuestion(current.prompt);
    const entries = next.globalAuthRules ??= [];
    if (entries.some(rule => rule.match !== 'regex' && rule.prompt === prompt)) throw Error('That question already has a global rule.');
    entries.push({ id: randomUUID(), prompt, match: 'exact', answer });
    delete next.authReplies[id];
  });
  return true;
});

handle('global-auth-rules', () => (state.globalAuthRules || []).map(({ id, prompt, match }) => ({
  id, prompt, match: match === 'regex' ? 'regex' : 'exact',
})));
handle('save-global-auth-rule', async (question, value, id, match = 'exact') => {
  const prompt = typeof question === 'string' ? question.trim() : '';
  if (!prompt || prompt.length > 1000 || /[\r\n\0]/.test(prompt) || !['exact', 'regex'].includes(match) ||
      (!(id && value === '') && !validAuthAnswer(value))) throw Error('Enter a question and a single-line answer.');
  if (match === 'regex') {
    try { globalPattern(prompt); }
    catch { throw Error('Invalid or unsupported regular expression.'); }
  }
  await updateState(next => {
    const entries = next.globalAuthRules ??= [];
    const existing = entries.find(entry => entry.id === id);
    if (id && !existing) throw Error('Global rule no longer exists.');
    if (entries.some(entry => entry.id !== id && entry.prompt === prompt && (entry.match || 'exact') === match)) {
      throw Error('That question already has a global rule.');
    }
    if (existing) {
      Object.assign(existing, { prompt, match });
      if (value) { existing.answer = value; delete existing.ciphertext; }
    } else entries.push({ id: randomUUID(), prompt, match, answer: value });
  });
});
handle('remove-global-auth-rule', id => updateState(next => {
  next.globalAuthRules = (next.globalAuthRules || []).filter(entry => entry.id !== id);
}));

handle('connect', async (id, input, mode, dimensions, rules = [], enteredPassword = '', rememberPassword = false) => {
  const config = mode === 'local' ? null : profile(input);
  if (sessions.has(id) || !['ssh', 'sftp', 'local'].includes(mode)) throw Error('Invalid session request.');
  if (typeof enteredPassword !== 'string' || Buffer.byteLength(enteredPassword) > 1023 || /[\r\n\0]/.test(enteredPassword)) {
    throw Error('Enter a single-line password up to 1023 bytes.');
  }
  const record = { input: config, mode, generation: randomUUID(), triggerScope: mode !== 'sftp' ? snippetScope({ mode, input }) : undefined,
    prompts: new Map(), remembered: new Map(), autoAnswered: new Set(), hostKeyDialogs: new Map() };
  sessions.set(id, record);
  syncUpdateBusy();
  try {
    let password = enteredPassword;
    if (config) {
      record.authEndpoint = openssh.effective(config).catch(() => '');
      const endpoint = await record.authEndpoint;
      if (sessions.get(id) !== record) return;
      const scope = authScope(config, endpoint || config.host);
      if (endpoint) record.transferIdentity = scope;
      record.passwordScope = scope;
      if (!password && (state.sshPasswords?.[scope]?.answer || state.sshPasswords?.[scope]?.ciphertext)) {
        try {
          const saved = state.sshPasswords[scope];
          password = await readAnswer(saved);
          if (saved.ciphertext) migrateAuthAnswer(saved.ciphertext, password, (next, plain) => {
            if (next.sshPasswords?.[scope]?.ciphertext === saved.ciphertext) {
              next.sshPasswords[scope] = { answer: plain };
            }
          });
        }
        catch { tell(id, 'error', 'Could not read the saved SSH password.'); }
      }
      if (enteredPassword && rememberPassword) {
        await updateState(next => {
          next.sshPasswords ??= {};
          next.sshPasswords[scope] = { answer: enteredPassword };
        });
      }
      if (endpoint && state.useStoredAuthOnConnect !== false && Object.values(state.authReplies || {}).some(autoSavedReply)) {
        record.strictAuthScope = Object.values(state.authReplies || {}).some(entry => autoSavedReply(entry) && entry.scope === scope)
          ? scope : undefined;
      }
    }
    record.globalAuth = Boolean(config && state.useStoredAuthOnConnect !== false && state.globalAuthRules?.length);
    const notify = (event, value) => {
      if (sessions.get(id) !== record) return;
      if (event === 'prompt') {
        record.prompts.set(value.id, null);
        if (value.hostKey) {
          showHostKeyPrompt(id, record, config, value).catch(() => {
            record.connection?.answer(value.id, 'no');
            record.prompts.delete(value.id);
            tell(id, 'error', 'Could not show the host key confirmation.');
          });
        } else showAuthPrompt(id, record, config, value);
        return;
      }
      if (event === 'prompt-clear') {
        record.prompts.delete(value);
        record.hostKeyDialogs.get(value)?.abort();
      }
      if (event === 'auto-answer' && value) record.autoAnswered.add(value.question);
      if (event === 'password-used') { record.passwordUsed = true; return; }
      if (event === 'ready') record.ready = true;
      if (event === 'data' && record.ready && mode !== 'sftp') scanSessionOutput(record, id, value);
      if (event === 'ready' && config && !record.historyRecorded) {
        record.historyRecorded = true;
        const history = { id: randomUUID(), mode, input: config, connectedAt: Date.now() };
        updateState(next => {
          next.connectionHistory = latestConnections([history, ...(next.connectionHistory || [])]);
        }).then(() => tell(id, 'history-changed'))
          .catch(() => tell(id, 'history-error', 'Could not save connection history.'));
      }
      if (event === 'ready' && record.remembered.size) {
        const answers = [...record.remembered];
        record.remembered.clear();
        updateState(next => {
          next.authReplies ??= {};
          for (const [key, { answer, metadata }] of answers) next.authReplies[key] = { ...metadata, answer };
        }).catch(() => tell(id, 'auth-storage-error', 'Could not save the authentication answer.'));
      }
      if (event === 'closed') {
        for (const dialog of record.hostKeyDialogs.values()) dialog.abort();
        sessions.delete(id);
        syncUpdateBusy();
      }
      tell(id, event, value);
    };
    record.connection = mode === 'local' ? openssh.startLocal(dimensions, notify)
      : await openssh.start(config, mode, dimensions, notify, rules, record.strictAuthScope || record.globalAuth ? 'ask' : '',
        state.useOpenSSHKeychain === true, password, () => notify('password-used'));
    if (sessions.get(id) !== record) record.connection.close();
  } catch (error) {
    sessions.delete(id);
    syncUpdateBusy();
    throw error;
  }
});
handle('read-clipboard', () => clipboard.readText());
handle('write-clipboard', value => {
  if (typeof value === 'string' && value.length <= 2_000_000) clipboard.writeText(value);
});
handle('open-link', value => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Unsupported link.');
  return shell.openExternal(url.href);
});
function openSponsors() {
  return shell.openExternal('https://github.com/sponsors/PROMLEE');
}
handle('open-sponsors', openSponsors);
handle('open-project-license', () => shell.openPath(path.join(app.getAppPath(), 'LICENSE')));
handle('open-license-notices', () => shell.openPath(path.join(app.getAppPath(), 'THIRD-PARTY-NOTICES.md')));
handle('disconnect', id => {
  const record = sessions.get(id);
  sessions.delete(id);
  for (const dialog of record?.hostKeyDialogs.values() || []) dialog.abort();
  record?.connection?.close();
  syncUpdateBusy();
});
async function showHostKeyPrompt(id, record, config, value) {
  const fingerprint = /^(?:[\w-]+ )?key fingerprint is:? (SHA256:[A-Za-z0-9+/]+={0,2}|MD5:(?:[a-f0-9]{2}:){15}[a-f0-9]{2})\.?$/mi.exec(value.prompt)?.[1];
  const accept = fingerprint && value.prompt.endsWith('(yes/no/[fingerprint])?') ? fingerprint : 'yes';
  const host = /^The authenticity of host '(.+)' can't be established\.$/m.exec(value.prompt)?.[1]
    .replace(/ \([^()]+\)$/, '').toLowerCase();
  const scope = fingerprint && host ? 'host:' + host : '';
  let legacyScope;
  if (scope && value.targetProcess && !state.trustedHostKeys?.[scope]) {
    record.authEndpoint ??= openssh.effective(config).catch(() => '');
    const endpoint = await record.authEndpoint;
    if (endpoint) legacyScope = authScope(config, endpoint);
  }
  const remember = () => updateState(next => {
    (next.trustedHostKeys ??= {})[scope] = fingerprint;
  }).catch(() => tell(id, 'auth-storage-error', 'Could not remember the verified host key.'));
  const pending = () => sessions.get(id) === record && record.prompts.has(value.id);
  function reply(answer) {
    if (!pending() || !record.connection?.answer(value.id, answer)) return false;
    record.prompts.delete(value.id);
    return true;
  }
  if (!pending()) return;
  const saved = state.trustedHostKeys?.[scope];
  if (scope && (saved === fingerprint || (!saved && legacyScope && state.trustedHostKeys?.[legacyScope] === fingerprint))) {
    if (!saved) await remember();
    if (reply(accept)) tell(id, 'auth-info', 'Verified saved host key');
    return;
  }
  const controller = new AbortController();
  record.hostKeyDialogs.set(value.id, controller);
  try {
    const result = await dialog.showMessageBox(window, {
      type: 'warning', message: 'Verify SSH host key',
      detail: value.prompt.slice(0, 4000),
      buttons: ['Cancel', 'Trust and Connect'], defaultId: 0, cancelId: 0,
      ...(scope && { checkboxLabel: 'Don’t ask again for this verified key', checkboxChecked: false }),
      signal: controller.signal,
    });
    if (result.response !== 1) {
      reply('no');
      return;
    }
    if (pending() && result.checkboxChecked && scope) await remember();
    reply(accept);
  } finally {
    record.hostKeyDialogs.delete(value.id);
  }
}

async function showAuthPrompt(id, record, config, value) {
  let details;
  let savedAnswer;
  let entry;
  let globalRule;
  let globalAnswer;
  const question = normalizedAuthQuestion(value.prompt);
  if (config && value.canRemember && value.prompt) {
    try {
      record.authEndpoint ??= openssh.effective(config);
      const endpoint = await record.authEndpoint;
      if (endpoint) {
        const key = createHash('sha256').update(JSON.stringify([
          config.host, config.configPath, config.keyPath, endpoint, value.prompt,
        ])).digest('hex');
        const scope = authScope(config, endpoint);
        const address = /^hostname (.+)$/m.exec(endpoint)?.[1];
        const user = /^user (.+)$/m.exec(endpoint)?.[1];
        const port = /^port (.+)$/m.exec(endpoint)?.[1];
        const host = [config.host, [user, address, port].filter(Boolean).join(' · ')].filter(Boolean).join(' — ');
        details = { key, scope, host, prompt: value.prompt };
        entry = state.authReplies?.[key];
        const encrypted = typeof entry === 'string' ? entry : entry?.ciphertext;
        if ((encrypted || entry?.answer) && state.useStoredAuthOnConnect !== false) {
          savedAnswer = await readAnswer(entry);
          if (encrypted && validAuthAnswer(savedAnswer)) migrateAuthAnswer(encrypted, savedAnswer, (next, plain) => {
            const current = next.authReplies?.[key];
            if (typeof current === 'string' && current === encrypted) next.authReplies[key] = { ...detailsWithoutKey(details), answer: plain };
            else if (current?.ciphertext === encrypted) { current.answer = plain; delete current.ciphertext; }
          });
        }
      }
    } catch { /* Authentication remains available if the system Keychain is unavailable. */ }
  }
  if (sessions.get(id) !== record || !record.prompts.has(value.id)) return;
  const savedCiphertext = typeof entry === 'string' ? entry : entry?.ciphertext;
  const migrateSaved = () => {
    if (!details || !savedCiphertext || !validAuthAnswer(savedAnswer)) return;
    migrateAuthAnswer(savedCiphertext, savedAnswer, (next, answer) => {
      const current = next.authReplies?.[details.key];
      if (typeof current === 'string' && current === savedCiphertext) next.authReplies[details.key] = { ...detailsWithoutKey(details), answer };
      else if (current?.ciphertext === savedCiphertext) { current.answer = answer; delete current.ciphertext; }
    });
  };
  const current = details && state.authReplies?.[details.key];
  if (state.useStoredAuthOnConnect !== false && validAuthAnswer(savedAnswer) && autoSavedReply(current) &&
      current.scope === record.strictAuthScope && !record.autoAnswered.has(question) &&
      record.connection?.answer(value.id, savedAnswer)) {
    record.autoAnswered.add(question);
    record.prompts.delete(value.id);
    tell(id, 'auto-answer', { question, source: 'Saved answer' });
    migrateSaved();
    return;
  }
  if (record.globalAuth && state.useStoredAuthOnConnect !== false && value.canRemember && value.prompt) {
    const rules = state.globalAuthRules || [];
    globalRule = rules.find(rule => rule.match !== 'regex' && rule.prompt === value.prompt)
      || rules.find(rule => rule.match !== 'regex' && rule.prompt === question)
      || rules.find(rule => rule.match === 'regex' && matchesGlobalPattern(rule, question));
    if (globalRule && !record.autoAnswered.has(question) && !record.autoAnswered.has(globalRule.id)) {
      try { globalAnswer = await readAnswer(globalRule); } catch {}
    }
  }
  if (sessions.get(id) !== record || !record.prompts.has(value.id)) return;
  if (globalRule && validAuthAnswer(globalAnswer) && state.globalAuthRules?.some(rule =>
    rule.id === globalRule.id && rule.prompt === globalRule.prompt && rule.match === globalRule.match &&
    (rule.answer === globalRule.answer && rule.ciphertext === globalRule.ciphertext)) &&
    !record.autoAnswered.has(question) && !record.autoAnswered.has(globalRule.id) && record.connection?.answer(value.id, globalAnswer)) {
    record.autoAnswered.add(question);
    record.autoAnswered.add(globalRule.id);
    record.prompts.delete(value.id);
    tell(id, 'auto-answer', { question, source: globalRule.match === 'regex' ? 'Global regex' : 'Global rule' });
    migrateAuthAnswer(globalRule.ciphertext, globalAnswer, (next, answer) => {
      const rule = next.globalAuthRules?.find(item => item.id === globalRule.id);
      if (rule?.ciphertext === globalRule.ciphertext) { rule.answer = answer; delete rule.ciphertext; }
    });
    return;
  }
  migrateSaved();
  record.prompts.set(value.id, details && { ...details, savedAnswer, savedEntry: entry });
  tell(id, 'prompt', {
    id: value.id, prompt: value.prompt, hint: value.hint,
    canRemember: Boolean(details), savedAnswer,
    rememberChecked: details ? state.authSaveChoices?.[details.key] ?? (savedAnswer !== undefined) : false,
    repeated: record.autoAnswered.has(question),
  });
}

handle('auth-answer', async (id, prompt, value, remember) => {
  const record = sessions.get(id);
  if (!record?.prompts.has(prompt)) return;
  const details = record.prompts.get(prompt);
  if (!record.connection?.answer(prompt, value)) return;
  record.prompts.delete(prompt);
  if (!details) return;
  const { key, savedAnswer, savedEntry, ...metadata } = details;
  if (typeof remember === 'boolean') {
    updateState(next => {
      (next.authSaveChoices ??= {})[key] = remember;
      if (!remember && next.authReplies?.[key]) delete next.authReplies[key];
    }).catch(() => tell(id, 'auth-storage-error', 'Could not save the authentication preference.'));
  }
  if (remember === true && validAuthAnswer(value)) {
    const latest = state.authReplies?.[key];
    const previousSaved = typeof savedEntry === 'string' ? savedEntry : savedEntry?.answer ?? savedEntry?.ciphertext;
    const latestSaved = typeof latest === 'string' ? latest : latest?.answer ?? latest?.ciphertext;
    if (value === savedAnswer && previousSaved && latestSaved) return;
    record.remembered.set(key, { answer: value, metadata });
  } else if (remember === false) {
    record.remembered.delete(key);
  }
});
handle('input', (id, data) => sessions.get(id)?.connection?.input(data));
handle('resize', (id, cols, rows) => sessions.get(id)?.connection?.resize(cols, rows));
handle('context-menu', entries => new Promise(resolve => {
  const items = entries.map(item => item === null ? { type: 'separator' } : {
    label: item.label,
    enabled: item.enabled !== false,
    ...(typeof item.checked === 'boolean' && { type: 'checkbox', checked: item.checked }),
    click: () => resolve(item.id),
  });
  Menu.buildFromTemplate(items).popup({ window, callback: () => setImmediate(() => resolve(null)) });
}));

function sftpCall(channel, method, ...args) {
  return new Promise((resolve, reject) => {
    channel[method](...args, (error, value) => error ? reject(error) : resolve(value));
  });
}
function validName(name) {
  return typeof name === 'string' && name.length > 0 && !/[\/\x00]/.test(name) && !['.', '..'].includes(name);
}
function verifySource(attrs, expected, remote, name) {
  if (expected && (!attrs.isFile() || attrs.size !== expected.size || (remote ? attrs.mtime * 1000 : attrs.mtimeMs) !== expected.modifiedAt)) throw Error(`Source changed since comparison: ${name}. Compare again.`);
}
async function upload(channel, local, remote, depth = 0, signal, progress = () => {}, expectedDestination, conflictPolicy, expectedSource) {
  await signal?.pausePoint?.();
  if (depth > 50) throw Error('Folder nesting is too deep.');
  if (signal?.aborted) throw Error('Transfer cancelled.');
  const attributes = await fs.lstat(local);
  verifySource(attributes, expectedSource, false, local);
  if (attributes.isDirectory()) {
    const existing = await sftpCall(channel, 'lstat', remote).catch(error => error.code === 2 ? null : Promise.reject(error));
    if (existing && !existing.isDirectory()) throw Error('Destination is not a folder. ' + remote);
    if (!existing) await sftpCall(channel, 'mkdir', remote);
    let skippedCount = 0;
    for (const name of (await fs.readdir(local)).sort((a, b) => a.localeCompare(b))) {
      const result = await upload(channel, path.join(local, name), path.posix.join(remote, name), depth + 1, signal, progress, undefined, conflictPolicy);
      skippedCount += result?.skippedCount || (result?.status === 'skipped' ? 1 : 0);
    }
    return { status: 'completed', skippedCount };
  }
  if (!attributes.isFile()) throw Error('Only regular files and folders can be uploaded. ' + local);
  const comparedRemote = remote;
  let keepBoth = false;
  const existing = await sftpCall(channel, 'lstat', remote).catch(error => {
    if (error.code !== 2) throw error;
    return null;
  });
  if (expectedDestination?.absent && existing) throw Error(`Destination appeared since comparison: ${remote}`);
  if (expectedDestination && !expectedDestination.absent && (!existing || existing.size !== expectedDestination.size || existing.mtime * 1000 !== expectedDestination.modifiedAt)) throw Error(`Destination changed since comparison: ${remote}`);
  if (existing && !existing.isFile()) throw Error('Destination is not a regular file. ' + remote);
  if (existing) {
    expectedDestination ??= { size: existing.size, modifiedAt: existing.mtime * 1000 };
    const choice = await conflictChoice('Replace the remote file?', remote, conflictPolicy, signal);
    if (choice === 'skip') return { status: 'skipped' };
    if (choice === 'keep-both') {
      keepBoth = true;
      const extension = path.posix.extname(remote), stem = remote.slice(0, remote.length - extension.length);
      for (let index = 1; index <= 1000; index++) {
        const candidate = `${stem} (${index})${extension}`;
        const found = await sftpCall(channel, 'lstat', candidate).catch(error => error.code === 2 ? null : Promise.reject(error));
        if (!found) { remote = candidate; break; }
        if (index === 1000) throw Error('Could not create a unique remote filename.');
      }
    }
  }
  const target = path.posix.join(path.posix.dirname(remote), '.promeftp-' + randomUUID());
  const handle = await sftpCall(channel, 'open', target, 'wx');
  try {
    let bytes = 0;
    const meter = new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; progress({ bytes, total: attributes.size, path: local }); callback(null, chunk); } });
    await pipeline(createReadStream(local), meter, channel.createWriteStream(target, { handle }), { signal });
    if (signal?.aborted) throw Error('Transfer cancelled.');
    if (expectedSource) verifySource(await fs.lstat(local), expectedSource, false, local);
    if (expectedDestination) {
      const current = await sftpCall(channel, 'lstat', comparedRemote).catch(error => error.code === 2 ? null : Promise.reject(error));
      if (expectedDestination.absent ? Boolean(current) : (!current || current.size !== expectedDestination.size || current.mtime * 1000 !== expectedDestination.modifiedAt)) throw Error(`Destination changed during transfer: ${comparedRemote}`);
    }
    if (keepBoth && await sftpCall(channel, 'lstat', remote).then(() => true, error => error.code === 2 ? false : Promise.reject(error))) throw Error(`Keep Both destination was created during transfer: ${remote}`);
    if (keepBoth) {
      if (typeof channel.ext_openssh_hardlink !== 'function') throw Error('This SFTP server does not support safe Keep Both commits.');
      await sftpCall(channel, 'ext_openssh_hardlink', target, remote);
      await sftpCall(channel, 'unlink', target);
    } else if (existing) {
      try { await sftpCall(channel, 'ext_openssh_rename', target, remote); }
      catch (error) {
        if (error.code !== 8 && error.message !== 'Server does not support this extended request') throw error;
        try { await sftpCall(channel, 'rename', target, remote); }
        catch { throw Error('The server refused to replace the file. ' + remote); }
      }
    } else await sftpCall(channel, 'rename', target, remote);
    if (signal) signal.committed = true;
  } catch (error) {
    await sftpCall(channel, 'unlink', target).catch(() => {});
    throw error;
  }
  return { status: 'completed' };
}
async function conflictChoice(message, detail, policy, signal) {
  if (signal?.aborted) throw Error('Transfer cancelled.');
  if (['skip', 'replace', 'keep-both'].includes(policy)) return policy;
  if (!window || window.isDestroyed()) return 'skip';
  const id = randomUUID();
  const owner = window;
  const request = () => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Error('Transfer cancelled.')); return; }
    const finish = choice => {
      transferConflictRequests.delete(id);
      signal?.removeEventListener('abort', abort);
      owner.removeListener('closed', abort);
      if (choice) resolve(choice);
      else {
        if (!owner.isDestroyed()) owner.webContents.send('session', { id: '*', event: 'transfer-conflict-dismissed', value: id });
        reject(Error('Transfer cancelled.'));
      }
    };
    const abort = () => finish();
    transferConflictRequests.set(id, finish);
    signal?.addEventListener('abort', abort, { once: true });
    owner.once('closed', abort);
    owner.webContents.send('session', { id: '*', event: 'transfer-conflict', value: { id, message, detail } });
  });
  return signal?.waitForDecision ? signal.waitForDecision(request) : request();
}
handle('transfer-resolve-conflict', (id, choice) => {
  if (!['skip', 'replace', 'keep-both'].includes(choice)) throw Error('Invalid conflict choice.');
  const finish = transferConflictRequests.get(id);
  if (!finish) return false;
  finish(choice);
  return true;
});
async function download(channel, remote, local, replace = false, depth = 0, signal, progress = () => {}, expectedDestination, conflictPolicy, expectedSource) {
  await signal?.pausePoint?.();
  if (depth > 50) throw Error('Folder nesting is too deep.');
  if (signal?.aborted) throw Error('Transfer cancelled.');
  const attributes = await sftpCall(channel, 'lstat', remote);
  verifySource(attributes, expectedSource, true, remote);
  if (attributes.isDirectory()) {
    await fs.mkdir(local, { mode: 0o700, recursive: true });
    let skippedCount = 0;
    for (const entry of (await sftpCall(channel, 'readdir', remote)).sort((a, b) => a.filename.localeCompare(b.filename))) {
      const name = entry.filename;
      if (!validName(name)) {
        if (['.', '..'].includes(name)) continue;
        throw Error('Invalid remote name.');
      }
      const result = await download(channel, path.posix.join(remote, name), path.join(local, name), false, depth + 1, signal, progress, undefined, conflictPolicy);
      skippedCount += result?.skippedCount || (result?.status === 'skipped' ? 1 : 0);
    }
    return { status: 'completed', skippedCount };
  }
  if (!attributes.isFile()) throw Error('Only regular files and folders can be downloaded. ' + remote);
  const comparedLocal = local;
  let keepBoth = false;
  const present = await fs.lstat(local).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (expectedDestination?.absent && present) throw Error(`Destination appeared since comparison: ${local}`);
  if (expectedDestination && !expectedDestination.absent && (!present || present.size !== expectedDestination.size || present.mtimeMs !== expectedDestination.modifiedAt)) throw Error(`Destination changed since comparison: ${local}`);
  if (present && (!replace || (conflictPolicy && conflictPolicy !== 'replace'))) {
    expectedDestination ??= { size: present.size, modifiedAt: present.mtimeMs };
    const choice = await conflictChoice('Replace the local file?', local, conflictPolicy, signal);
    if (choice === 'skip') return { status: 'skipped' };
    if (choice === 'keep-both') {
      keepBoth = true;
      const extension = path.extname(local), stem = local.slice(0, local.length - extension.length);
      for (let index = 1; index <= 1000; index++) {
        const candidate = `${stem} (${index})${extension}`;
        if (!await fs.lstat(candidate).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) { local = candidate; break; }
        if (index === 1000) throw Error('Could not create a unique local filename.');
      }
    } else replace = true;
  }
  const temp = path.join(path.dirname(local), '.promeftp-' + randomUUID());
  try {
    let bytes = 0;
    const meter = new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; progress({ bytes, total: attributes.size, path: remote }); callback(null, chunk); } });
    await pipeline(channel.createReadStream(remote), meter, createWriteStream(temp, { flags: 'wx', mode: 0o600 }), { signal });
    if (signal?.aborted) throw Error('Transfer cancelled.');
    if (expectedSource) verifySource(await sftpCall(channel, 'lstat', remote), expectedSource, true, remote);
    if (expectedDestination) {
      const current = await fs.lstat(comparedLocal).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (expectedDestination.absent ? Boolean(current) : (!current || current.size !== expectedDestination.size || current.mtimeMs !== expectedDestination.modifiedAt)) throw Error(`Destination changed during transfer: ${comparedLocal}`);
    }
    if (keepBoth && await fs.lstat(local).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) throw Error(`Keep Both destination was created during transfer: ${local}`);
    if (keepBoth) await fs.link(temp, local);
    else if (replace) await fs.rename(temp, local);
    else await fs.link(temp, local);
    if (signal) signal.committed = true;
  } finally {
    await fs.rm(temp, { force: true });
  }
}
transferQueue = createTransferService({
  file: path.join(app.getPath('userData'), 'sftp-transfer-queue.json'),
  historyFile: path.join(app.getPath('userData'), 'sftp-transfer-history.jsonl'),
  emit: jobs => { if (window && !window.isDestroyed()) window.webContents.send('session', { id: '*', event: 'transfer-jobs', value: jobs }); },
  onBusy: busy => { queuedTransferBusy = busy; syncUpdateBusy(); },
  execute: async (job, signal, progress) => {
    if (job.operation === 'mkdir-local') { await fs.mkdir(job.localPath, { recursive: true, mode: 0o700 }); return { status: 'completed' }; }
    let record = sessions.get(job.sessionId);
    if ((!record || !record.connection?.channel) && !job.connectionGeneration && job.connectionScope) record = [...sessions.values()].find(item => item.mode === 'sftp' && pathFavorites.scopeFor(item.input) === job.connectionScope);
    if (job.connectionGeneration && record?.generation !== job.connectionGeneration) throw Error('Connection changed. Open the matching SFTP connection and retry.');
    const channel = record?.connection?.channel;
    if (!channel?.readdir || record.mode !== 'sftp') throw Error('Reconnect this SFTP session before retrying.');
    if (job.operation === 'mkdir-remote') {
      const existing = await sftpCall(channel, 'lstat', job.remotePath).catch(error => error.code === 2 ? null : Promise.reject(error));
      if (!existing) await sftpCall(channel, 'mkdir', job.remotePath);
      else if (!existing.isDirectory()) throw Error(`Destination is not a folder: ${job.remotePath}`);
      return { status: 'completed' };
    }
    if (job.operation === 'upload') {
      return await upload(channel, job.localPath, job.remotePath, 0, signal, progress, job.expectedDestination, job.conflictPolicy, job.expectedSource);
    } else if (job.operation === 'download') {
      return await download(channel, job.remotePath, job.localPath, Boolean(job.replace), 0, signal, progress, job.expectedDestination, job.conflictPolicy, job.expectedSource);
    } else {
      const targetRecord = sessions.get(job.targetSessionId) || [...sessions.values()].find(item => item.mode === 'sftp' && pathFavorites.scopeFor(item.input) === job.targetScope);
      if (job.targetGeneration && targetRecord?.generation !== job.targetGeneration) throw Error('Destination connection changed. Open the matching SFTP connection and retry.');
      const target = targetRecord?.connection?.channel;
      if (!target?.readdir || target === channel) throw Error('Both SFTP connections must be open.');
      const stage = await fs.mkdtemp(path.join(app.getPath('temp'), 'promeftp-transfer-'));
      try {
        const local = path.join(stage, path.posix.basename(job.sourcePath));
        await download(channel, job.sourcePath, local, false, 0, signal, progress, undefined, undefined, job.expectedSource);
        if (signal.aborted) throw Error('Transfer cancelled.');
        return await upload(target, local, path.posix.join(job.targetDirectory, path.posix.basename(job.sourcePath)), 0, signal, progress, job.expectedDestination, job.conflictPolicy);
      } finally { await fs.rm(stage, { recursive: true, force: true }); }
    }
  },
});
handle('transfer-list', () => transferQueue.list());
handle('transfer-history', (query, limit) => transferQueue.history(typeof query === 'string' ? query.slice(0, 200) : '', Math.min(Number(limit) || 300, 500)));
function enqueueTransfer(input) {
  const source = sessions.get(input?.sessionId);
  if (!source || source.mode !== 'sftp') throw Error('Open the source SFTP connection first.');
  const sourceName = input.operation === 'upload' ? 'Local' : source.input.label || source.input.host;
  const enriched = { ...input, sourceName, connectionGeneration: source.generation, connectionIdentity: source.transferIdentity, connectionScope: pathFavorites.scopeFor(source.input) };
  if (input.operation === 'remote-copy') {
    const target = sessions.get(input.targetSessionId);
    if (!target || target.mode !== 'sftp') throw Error('Open the destination SFTP connection first.');
    enriched.targetScope = pathFavorites.scopeFor(target.input); enriched.targetName = target.input.label || target.input.host; enriched.targetGeneration = target.generation; enriched.targetIdentity = target.transferIdentity;
  }
  return transferQueue.enqueue(enriched);
}
handle('transfer-enqueue', enqueueTransfer);
function retryBinding(job) {
  const binding = {};
  function bind(idKey, generationKey, identityKey) {
    const record = sessions.get(job[idKey]);
    if (record?.connection?.channel?.readdir && record.mode === 'sftp' && record.generation === job[generationKey]) return;
    const identity = job[identityKey];
    const matches = identity ? [...sessions].filter(([, candidate]) =>
      candidate.mode === 'sftp' && candidate.connection?.channel?.readdir && candidate.transferIdentity === identity) : [];
    if (matches.length !== 1) throw Error('Open one matching SFTP connection, then retry. If the connection settings changed, queue the transfer again.');
    const [id, candidate] = matches[0];
    binding[idKey] = id;
    binding[generationKey] = candidate.generation;
  }
  if (job.operation !== 'mkdir-local') bind('sessionId', 'connectionGeneration', 'connectionIdentity');
  if (job.operation === 'remote-copy') bind('targetSessionId', 'targetGeneration', 'targetIdentity');
  return binding;
}
handle('transfer-control', (id, action) => {
  const job = transferQueue.list().find(item => item.id === id);
  return transferQueue.control(id, action, action === 'retry' && job ? retryBinding(job) : undefined);
});
handle('transfer-batch-control', async (batchId, action) => {
  if (typeof batchId !== 'string' || !['cancel', 'pause', 'resume', 'retry', 'clear'].includes(action)) throw Error('Invalid batch control.');
  const jobs = transferQueue.list().filter(job => job.batchId === batchId);
  if (!jobs.length) throw Error('Transfer batch no longer exists.');
  const eligible = jobs.filter(job => action === 'cancel' ? ['queued','running','paused','waiting-conflict'].includes(job.state) : action === 'pause' ? ['queued','running'].includes(job.state) : action === 'resume' ? job.state === 'paused' : action === 'retry' ? ['failed','interrupted'].includes(job.state) : ['completed','failed','cancelled','skipped','interrupted'].includes(job.state));
  const bindings = eligible.map(job => action === 'retry' ? retryBinding(job) : undefined);
  await Promise.all(eligible.map((job, index) => transferQueue.control(job.id, action, bindings[index])));
  return transferQueue.list();
});
function compareEndpoint(input) {
  if (!input || !['local', 'remote'].includes(input.kind) || typeof input.path !== 'string') throw Error('Invalid comparison folder.');
  if (input.kind === 'local') return { ...input, path: path.resolve(expandHome(input.path)) };
  const record = sessions.get(input.sessionId);
  if (!record || record.mode !== 'sftp' || !record.connection?.channel) throw Error('Reconnect the SFTP session before comparing.');
  if (!input.path.startsWith('/') || input.path.split('/').includes('..')) throw Error('Remote comparison path must be absolute and normalized.');
  return { ...input, scope: pathFavorites.scopeFor(record.input), generation: record.generation };
}
function comparisonAdapter(endpoint) {
  if (endpoint.kind === 'local') return {
    join: (base, name) => path.join(base, name),
    async list(directory) {
      const rows = await fs.readdir(directory, { withFileTypes: true });
      return Promise.all(rows.map(async row => {
        const attrs = await fs.lstat(path.join(directory, row.name));
        return { name: row.name, directory: attrs.isDirectory(), link: attrs.isSymbolicLink(), size: attrs.size, modifiedAt: attrs.mtimeMs };
      }));
    },
  };
  const channel = sessions.get(endpoint.sessionId)?.connection?.channel;
  return {
    join: (base, name) => path.posix.join(base, name),
    async list(directory) {
      const rows = await sftpCall(channel, 'readdir', directory);
      return rows.filter(row => validName(row.filename)).map(row => ({ name: row.filename, directory: row.attrs.isDirectory(), link: row.attrs.isSymbolicLink(), size: row.attrs.size, modifiedAt: row.attrs.mtime * 1000 }));
    },
  };
}
handle('compare-start', async (sourceInput, destinationInput, requestId) => {
  const controller = new AbortController();
  if (requestId) comparisonControllers.set(requestId, controller);
  try {
    const source = compareEndpoint(sourceInput), destination = compareEndpoint(destinationInput);
    const [sourceRoot, destinationRoot] = await Promise.all([
      source.kind === 'local' ? fs.realpath(source.path) : path.posix.normalize(source.path),
      destination.kind === 'local' ? fs.realpath(destination.path) : path.posix.normalize(destination.path),
    ]);
    let lastProgress = 0;
    const entries = await directoryCompare.compare({
      sourceRoot, destinationRoot, source: comparisonAdapter(source), destination: comparisonAdapter(destination),
      signal: controller.signal,
      onProgress: count => {
        const now = Date.now();
        if (!requestId || now - lastProgress < 120 || !window || window.isDestroyed()) return;
        lastProgress = now;
        window.webContents.send('session', { id: '*', event: 'compare-progress', value: { requestId, count } });
      },
    });
    if (controller.signal.aborted) throw Error('Comparison cancelled.');
    const id = randomUUID();
    comparisonPlans.set(id, { source, destination, sourceRoot, destinationRoot, entries, createdAt: Date.now() });
    while (comparisonPlans.size > 10) comparisonPlans.delete(comparisonPlans.keys().next().value);
    const describe = (endpoint, root) => {
      const input = sessions.get(endpoint.sessionId)?.input;
      return input ? `${input.label || input.host} ${root}` : root;
    };
    return { id, source: describe(source, sourceRoot), destination: describe(destination, destinationRoot), entries };
  } finally {
    if (requestId) comparisonControllers.delete(requestId);
  }
});
handle('compare-cancel', requestId => { const controller = comparisonControllers.get(requestId); if (!controller) return false; controller.abort(); return true; });
handle('compare-apply', async (id, selectedPaths, conflictPolicy = 'ask', requestId) => {
  const plan = comparisonPlans.get(id);
  if (!plan || !Array.isArray(selectedPaths) || selectedPaths.length > 20_000) throw Error('Comparison plan expired. Compare again.');
  if (!['ask', 'skip', 'replace', 'keep-both'].includes(conflictPolicy)) throw Error('Invalid conflict policy.');
  for (const endpoint of [plan.source, plan.destination]) if (endpoint.kind === 'remote' && sessions.get(endpoint.sessionId)?.generation !== endpoint.generation) throw Error('Connection changed since comparison. Compare again.');
  const selection = directoryCompare.selectedFilePlan(plan.entries, selectedPaths);
  const entries = selection.files;
  const controller = new AbortController();
  if (requestId) comparisonControllers.set(requestId, controller);
  let check;
  try {
    let lastProgress = 0;
    check = await directoryCompare.compare({ sourceRoot: plan.sourceRoot, destinationRoot: plan.destinationRoot, source: comparisonAdapter(plan.source), destination: comparisonAdapter(plan.destination), signal: controller.signal,
      onProgress: count => {
        const now = Date.now();
        if (!requestId || now - lastProgress < 120 || !window || window.isDestroyed()) return;
        lastProgress = now;
        window.webContents.send('session', { id: '*', event: 'compare-progress', value: { requestId, count } });
      },
    });
    if (controller.signal.aborted) throw Error('Comparison cancelled.');
  } finally { if (requestId) comparisonControllers.delete(requestId); }
  for (const row of entries) {
    const current = check.find(item => item.relativePath === row.relativePath);
    if (!current || current.reason !== row.reason || current.source?.size !== row.source?.size || current.source?.modifiedAt !== row.source?.modifiedAt || current.destination?.size !== row.destination?.size || current.destination?.modifiedAt !== row.destination?.modifiedAt) throw Error(`Folder changed since preview: ${row.relativePath}. Compare again.`);
  }
  const ids = [];
  const batchId = randomUUID();
  const sourceRecord = plan.source.kind === 'remote' ? sessions.get(plan.source.sessionId) : null;
  const destinationRecord = plan.destination.kind === 'remote' ? sessions.get(plan.destination.sessionId) : null;
  const sourceScope = sourceRecord && pathFavorites.scopeFor(sourceRecord.input);
  const destinationScope = destinationRecord && pathFavorites.scopeFor(destinationRecord.input);
  for (const [endpoint, record] of [[plan.source, sourceRecord], [plan.destination, destinationRecord]]) {
    if (endpoint.kind === 'remote' && record?.generation !== endpoint.generation) throw Error('Connection changed since comparison. Compare again.');
  }
  const labelEndpoint = (record, root) => [record?.input.label || record?.input.host, root].filter(Boolean).join(' ');
  const batchLabel = `${labelEndpoint(sourceRecord, plan.sourceRoot)} → ${labelEndpoint(destinationRecord, plan.destinationRoot)}`;
  for (const relativeDirectory of selection.directories) {
    const localPath = plan.destination.kind === 'local' ? path.join(plan.destinationRoot, ...relativeDirectory.split('/')) : null;
    const remotePath = plan.destination.kind === 'remote' ? path.posix.join(plan.destinationRoot, relativeDirectory) : null;
    if (plan.destination.kind === 'local') ids.push(await transferQueue.enqueue({ operation: 'mkdir-local', batchId, batchLabel, localPath, label: relativeDirectory }));
    else ids.push(await transferQueue.enqueue({ operation: 'mkdir-remote', batchId, batchLabel, sessionId: plan.destination.sessionId, connectionScope: destinationScope, connectionGeneration: destinationRecord.generation, connectionIdentity: destinationRecord.transferIdentity, localPath: '', remotePath, targetName: destinationRecord?.input.label || destinationRecord?.input.host, label: relativeDirectory }));
  }
  for (const row of selection.emptyDirectories) {
    if (selection.directories.includes(row.relativePath)) continue;
    const localPath = plan.destination.kind === 'local' ? path.join(plan.destinationRoot, ...row.relativePath.split('/')) : null;
    const remotePath = plan.destination.kind === 'remote' ? path.posix.join(plan.destinationRoot, row.relativePath) : null;
    if (plan.destination.kind === 'local') ids.push(await transferQueue.enqueue({ operation: 'mkdir-local', batchId, batchLabel, localPath, label: row.relativePath }));
    else ids.push(await transferQueue.enqueue({ operation: 'mkdir-remote', batchId, batchLabel, sessionId: plan.destination.sessionId, connectionScope: destinationScope, connectionGeneration: destinationRecord.generation, connectionIdentity: destinationRecord.transferIdentity, remotePath, label: row.relativePath }));
  }
  for (const row of entries) {
    const sourcePath = plan.source.kind === 'local' ? path.join(plan.sourceRoot, ...row.relativePath.split('/')) : path.posix.join(plan.sourceRoot, row.relativePath);
    const destinationPath = plan.destination.kind === 'local' ? path.join(plan.destinationRoot, ...row.relativePath.split('/')) : path.posix.join(plan.destinationRoot, row.relativePath);
    const label = row.relativePath;
    if (plan.source.kind === 'local' && plan.destination.kind === 'remote') {
      const destination = sessions.get(plan.destination.sessionId);
      ids.push(await transferQueue.enqueue({ operation: 'upload', batchId, batchLabel, conflictPolicy, sessionId: plan.destination.sessionId, connectionScope: destinationScope, connectionGeneration: destination.generation, connectionIdentity: destination.transferIdentity, sourceName: 'Local', targetName: destination?.input.label || destination?.input.host, localPath: sourcePath, remotePath: destinationPath, expectedSource: { size: row.source.size, modifiedAt: row.source.modifiedAt }, expectedDestination: row.destination ? { size: row.destination.size, modifiedAt: row.destination.modifiedAt } : { absent: true }, label }));
    } else if (plan.source.kind === 'remote' && plan.destination.kind === 'local') {
      const source = sessions.get(plan.source.sessionId);
      ids.push(await transferQueue.enqueue({ operation: 'download', batchId, batchLabel, conflictPolicy, sessionId: plan.source.sessionId, connectionScope: sourceScope, connectionGeneration: source.generation, connectionIdentity: source.transferIdentity, sourceName: source?.input.label || source?.input.host, targetName: 'Local', remotePath: sourcePath, localPath: destinationPath, replace: row.operation === 'update', expectedSource: { size: row.source.size, modifiedAt: row.source.modifiedAt }, expectedDestination: row.destination ? { size: row.destination.size, modifiedAt: row.destination.modifiedAt } : { absent: true }, label }));
    } else if (plan.source.kind === 'remote' && plan.destination.kind === 'remote') {
      const source = sessions.get(plan.source.sessionId), destination = sessions.get(plan.destination.sessionId);
      ids.push(await transferQueue.enqueue({ operation: 'remote-copy', batchId, batchLabel, conflictPolicy, sessionId: plan.source.sessionId, connectionScope: sourceScope, connectionGeneration: source.generation, connectionIdentity: source.transferIdentity, sourceName: source?.input.label || source?.input.host, targetName: destination?.input.label || destination?.input.host, sourcePath, targetSessionId: plan.destination.sessionId, targetScope: destinationScope, targetGeneration: destination.generation, targetIdentity: destination.transferIdentity, targetDirectory: path.posix.dirname(destinationPath), expectedSource: { size: row.source.size, modifiedAt: row.source.modifiedAt }, expectedDestination: row.destination ? { size: row.destination.size, modifiedAt: row.destination.modifiedAt } : { absent: true }, label }));
    }
    else throw Error('Local-to-local folder comparison is unnecessary.');
  }
  comparisonPlans.delete(id);
  return ids;
});

handle('copy-remote', async (sourceId, sourcePath, targetId, targetDirectory) => {
  const source = sessions.get(sourceId)?.connection?.channel;
  const target = sessions.get(targetId)?.connection?.channel;
  if (!source?.readdir || !target?.readdir || source === target) throw Error('Open two SFTP connections first.');
  const name = path.posix.basename(sourcePath);
  if (!validName(name)) throw Error('Invalid remote name.');
  pendingWrites++;
  syncUpdateBusy();
  try {
    const staging = await fs.mkdtemp(path.join(app.getPath('temp'), 'promeftp-copy-'));
    try {
      const item = path.join(staging, name);
      await download(source, sourcePath, item);
      if (sessions.get(targetId)?.connection?.channel !== target) throw Error('Destination disconnected.');
      await upload(target, item, path.posix.join(targetDirectory, name));
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  } finally {
    pendingWrites--;
    syncUpdateBusy();
  }
});
handle('local-directory', async directory => {
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose local folder', defaultPath: directory || app.getPath('home'), properties: ['openDirectory'],
  });
  return result.filePaths[0];
});
handle('local-list', async directory => {
  const resolved = await fs.realpath(directory ? expandHome(directory) : app.getPath('home'));
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  return { directory: resolved, entries: await Promise.all(entries.filter(entry => entry.isFile() || entry.isDirectory()).map(async entry => {
    const attributes = await fs.stat(path.join(resolved, entry.name));
    return { name: entry.name, directory: entry.isDirectory(), size: entry.isFile() ? attributes.size : undefined, modifiedAt: attributes.mtimeMs };
  })) };
});
handle('local-mkdir', async (directory, name) => {
  if (!validName(name) || !name.trim()) throw Error('Invalid folder name.');
  const parent = await fs.realpath(directory ? expandHome(directory) : app.getPath('home'));
  await fs.mkdir(path.join(parent, name), { mode: 0o700 });
});
handle('local-action', async (action, directory, name, nextName) => {
  if (!validName(name)) throw Error('Invalid file name.');
  const parent = await fs.realpath(directory ? expandHome(directory) : app.getPath('home'));
  const target = path.join(parent, name);
  const attributes = await fs.lstat(target);
  if (action === 'open') {
    const error = await shell.openPath(target);
    if (error) throw Error(error);
  } else if (action === 'edit') {
    if (!attributes.isFile()) throw Error('Only files can be edited.');
    await promisify(execFile)('/usr/bin/open', ['-t', target]);
  } else if (action === 'reveal') shell.showItemInFolder(target);
  else if (action === 'copy') {
    clipboard.writeText(target);
    clipboard.writeBuffer('public.file-url', Buffer.from(require('node:url').pathToFileURL(target).href));
  } else if (action === 'rename') {
    if (!validName(nextName) || !nextName.trim()) throw Error('Invalid new name.');
    const destination = path.join(parent, nextName.trim());
    if (await fs.lstat(destination).then(() => true, error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    })) throw Error('An item with that name already exists. Choose another name.');
    await fs.rename(target, destination);
  } else if (action === 'trash') {
    const result = await dialog.showMessageBox(window, {
      type: 'warning', message: 'Move item to Trash?', detail: target,
      buttons: ['Cancel', 'Move to Trash'], defaultId: 0, cancelId: 0,
    });
    if (result.response === 1) await shell.trashItem(target);
  } else if (action === 'info') {
    const kind = attributes.isDirectory() ? 'Folder' : attributes.isFile() ? 'File' : 'Other';
    await dialog.showMessageBox(window, {
      type: 'info', message: name,
      detail: `${kind}\n${attributes.isFile() ? `Size: ${attributes.size} bytes\n` : ''}Permissions: ${(attributes.mode & 0o777).toString(8).padStart(3, '0')}\nModified: ${attributes.mtime.toLocaleString()}\nPath: ${target}`,
      buttons: ['OK'],
    });
  } else throw Error('Unsupported local file action.');
});
handle('sftp', async (id, action, target, name) => {
  const channel = sessions.get(id)?.connection?.channel;
  if (!channel?.readdir) throw Error('SFTP disconnected.');
  if (action === 'list') {
    const directory = await sftpCall(channel, 'realpath', target);
    const rows = await sftpCall(channel, 'readdir', directory);
    return { directory, entries: rows.filter(row => validName(row.filename)).map(row => ({
      name: row.filename, size: row.attrs.isDirectory() ? undefined : row.attrs.size, directory: row.attrs.isDirectory(), link: row.attrs.isSymbolicLink(),
      modifiedAt: row.attrs.mtime ? row.attrs.mtime * 1000 : undefined,
    })) };
  }
  if (action === 'upload' || action === 'upload-local') {
    const locals = action === 'upload-local' ? [name] :
      (await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] })).filePaths;
    for (const local of locals) await enqueueTransfer({ operation: 'upload', sessionId: id, sourceName: 'Local', targetName: sessions.get(id)?.input.label || sessions.get(id)?.input.host, localPath: local, remotePath: path.posix.join(target, path.basename(local)), label: path.basename(local) });
  } else if (action === 'download-local') {
    const basename = path.posix.basename(target);
    if (!validName(basename)) throw Error('Invalid remote name.');
    await download(channel, target, path.join(name, basename));
  } else if (action === 'download') {
    const result = await dialog.showSaveDialog(window, { defaultPath: path.posix.basename(target) });
    if (!result.canceled) await enqueueTransfer({ operation: 'download', sessionId: id, sourceName: sessions.get(id)?.input.label || sessions.get(id)?.input.host, targetName: 'Local', remotePath: target, localPath: result.filePath, label: path.posix.basename(target) });
  } else if (action === 'edit') {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'promeftp-edit-'));
    const local = path.join(directory, path.posix.basename(target));
    let preserve = false;
    try {
      await download(channel, target, local, true);
      preserve = true;
      await promisify(execFile)('/usr/bin/open', ['-t', local]);
      const decision = await dialog.showMessageBox(window, {
        type: 'question', message: 'Save your changes in the editor before uploading.',
        detail: path.posix.basename(target),
        buttons: ['Keep Local Copy', 'Upload'], defaultId: 0, cancelId: 0,
      });
      if (decision.response !== 1) {
        shell.showItemInFolder(local);
        return { savedLocalPath: local };
      }
      const uploaded = await upload(channel, local, target);
      if (uploaded?.status !== 'completed') {
        shell.showItemInFolder(local);
        return { savedLocalPath: local, uploadStatus: uploaded?.status || 'failed' };
      }
      preserve = false;
    } catch (error) {
      if (!preserve) throw error;
      await dialog.showMessageBox(window, {
        type: 'warning', message: 'The remote file was not updated.',
        detail: `${error.message}\n\nYour edited copy is saved at:\n${local}`,
        buttons: ['Reveal Copy'],
      }).then(() => shell.showItemInFolder(local)).catch(() => {});
      throw error;
    } finally {
      if (!preserve) await fs.rm(directory, { recursive: true, force: true });
    }
  } else if (action === 'info') {
    const attributes = await sftpCall(channel, 'lstat', target);
    const kind = attributes.isDirectory() ? 'Folder' : attributes.isSymbolicLink() ? 'Link' : 'File';
    await dialog.showMessageBox(window, {
      type: 'info', message: path.posix.basename(target),
      detail: `${kind}\n${attributes.size !== undefined ? `Size: ${attributes.size} bytes\n` : ''}Permissions: ${(attributes.mode & 0o777).toString(8).padStart(3, '0')}\n${attributes.uid !== undefined ? `Owner: ${attributes.uid}:${attributes.gid}\n` : ''}Modified: ${attributes.mtime ? new Date(attributes.mtime * 1000).toLocaleString() : '—'}\nPath: ${target}`,
      buttons: ['OK'],
    });
  } else if (action === 'mkdir' || action === 'rename') {
    if (!validName(name) || !name.trim()) throw Error('Invalid name.');
    if (action === 'mkdir') await sftpCall(channel, 'mkdir', path.posix.join(target, name));
    else await sftpCall(channel, 'rename', target, path.posix.join(path.posix.dirname(target), name));
  } else if (action === 'delete') {
    const attributes = await sftpCall(channel, 'lstat', target);
    const result = await dialog.showMessageBox(window, {
      type: 'warning', message: 'Delete remote item?', detail: target,
      buttons: ['Cancel', 'Delete'], defaultId: 0, cancelId: 0,
    });
    if (result.response === 1) await sftpCall(channel, attributes.isDirectory() ? 'rmdir' : 'unlink', target);
  } else throw Error('Unsupported SFTP action.');
});

const fileShortcuts = [
  ['New Host', 'CmdOrCtrl+N', 'new-host'],
  ['Local Shell', 'CmdOrCtrl+T', 'local'],
  ['Close Tab', 'CmdOrCtrl+W', 'close-tab'],
];
const terminalShortcuts = [
  ['Snippets', 'CmdOrCtrl+P', 'snippets'],
  ['Terminal Triggers', '', 'triggers'],
  ['Find', 'CmdOrCtrl+F', 'find'],
  ['Split Right', 'CmdOrCtrl+D', 'split'],
  ['Split Down', 'CmdOrCtrl+Shift+D', 'split-down'],
  ['Clear Buffer', 'CmdOrCtrl+K', 'clear'],
  ['Increase Font Size', 'CmdOrCtrl+=', 'zoom-in'],
  ['Decrease Font Size', 'CmdOrCtrl+-', 'zoom-out'],
  ['Reset Font Size', 'CmdOrCtrl+0', 'zoom-reset'],
];
const preferencesShortcut = ['Preferences…', 'CmdOrCtrl+,', 'preferences'];
handle('keyboard-shortcuts', () => [
  { title: 'App', shortcuts: [...fileShortcuts, preferencesShortcut] },
  { title: 'Terminal', shortcuts: [...terminalShortcuts, ['Copy selection', 'CmdOrCtrl+C'], ['Paste', 'CmdOrCtrl+V'],
    ['Previous prompt mark', 'CmdOrCtrl+Alt+↑'], ['Next prompt mark', 'CmdOrCtrl+Alt+↓'], ['Snippets (alternate key)', 'CmdOrCtrl+Shift+P']] },
]);

function buildApplicationMenu() {
  const updateMenu = updater ? [
    { label: localized('Check for Updates…'), click: checkForUpdates },
    { id: 'automatic-updates', label: localized('Install Updates Automatically'), type: 'checkbox', checked: updater.automatic(),
      click: item => setAutomaticUpdates(item.checked) },
    { type: 'separator' },
  ] : [];
  const command = (label, accelerator, id) => ({
    label: localized(label), ...(accelerator && { accelerator }), click: () => window?.webContents.send('command', id),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { label: localized('About PromeFTP'), click: () => openPreferences('about') },
      command(...preferencesShortcut),
      ...updateMenu,
      {
        label: localized('Support Development…'),
        click: () => openSponsors().catch(error => dialog.showErrorBox(app.name, error.message)),
      },
      { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] },
    { label: localized('File'), submenu: fileShortcuts.map(args => command(...args)) },
    { role: 'editMenu', label: localized('Edit') },
    { label: localized('Terminal'), submenu: [
      ...terminalShortcuts.map(args => command(...args)),

    ] },
    { role: 'windowMenu', label: localized('Window') },
  ]));
}

function getAgent() {
  if (!agent) throw Error(agentStartupError || 'Agent integration is unavailable.');
  return agent;
}
function approveAgentCommand(session, command, profile, client) {
  const endpoint = session.endpoint || '';
  const resolvedHost = /^hostname (.+)$/m.exec(endpoint)?.[1] || profile.host;
  const resolvedUser = /^user (.+)$/m.exec(endpoint)?.[1] || profile.username || os.userInfo().username;
  const resolvedPort = /^port (.+)$/m.exec(endpoint)?.[1] || String(profile.port || 22);
  const jumpHost = /^proxyjump (.+)$/m.exec(endpoint)?.[1];
  return dialog.showMessageBox(preferencesWindow || window, {
    type: 'warning', message: localized('Allow this SSH command once?'),
    detail: [String(client).replace(/[\p{C}]/gu, ''), `${localized('Bookmark')}: ${profile.label || profile.host}`,
      `${localized('SSH target')}: ${resolvedUser}@${resolvedHost}:${resolvedPort}`,
      ...(jumpHost && jumpHost !== 'none' ? [`${localized('Jump host')}: ${jumpHost}`] : []),
      '', command].join('\n'),
    buttons: [localized('Deny'), localized('Run Command')], defaultId: 0, cancelId: 0, noLink: true, signal: session.controller.signal,
  }).then(({ response }) => response === 1);
}
async function initializeAgent() {
  const directory = path.join(app.getPath('userData'), 'agent');
  agentTransport = createTransport({
    directory, state: () => state, authScope, readAnswer, validAuthAnswer, matchesGlobalPattern, snippetScope,
    approve: approveAgentCommand,
  });
  agent = await createAgentService({
    directory, state: () => state, profiles: () => state.profiles, transport: agentTransport, sftpCall,
    save: change => updateState(next => change(next.agent ??= {})),
    busy: count => { agentConnections = count; syncUpdateBusy(); },
    onPrompt: () => openPreferences('agent'),
  });
  if (state.agent?.enabled) await agent.listen();
}
let detectedAgents;
handle('agent-info', async () => {
  const service = getAgent();
  const info = service.info();
  return { ...info, profiles: info.profiles.map(p => ({ ...p,
    ...(!p.eligible && { reason: agentTransport.eligibilityReason(state.profiles.find(entry => entry.id === p.id)) }),
    ...(p.eligible && agentTransport.catalog(state.profiles.find(entry => entry.id === p.id))),
  })), targets: await (detectedAgents ??= detectAgents(app.getPath('home'))),
    skills: Object.values(state.agent?.skills || {}),
    hasSavedToken: await fs.access(agentSkillTokenPath()).then(() => true, () => false),
    cli: process.defaultApp ? null : path.join(path.dirname(process.execPath), 'promeftp') };
});
handle('agent-enable', enabled => getAgent().enable(enabled));
handle('agent-register', async name => {
  const { response } = await dialog.showMessageBox(preferencesWindow || window, {
    message: localized('Register an agent client?'), buttons: [localized('Cancel'), localized('Register')], defaultId: 0, cancelId: 0,
  });
  if (response !== 1) return null;
  const { id, token } = await getAgent().register(name);
  return { id, token };
});
const agentSkillTokenPath = () => path.join(app.getPath('userData'), 'agent', 'skill-token.json');
handle('agent-save-token', async (clientId, token) => {
  if (typeof clientId !== 'string' || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error('Invalid agent token.');
  const client = state.agent?.clients?.find(entry => entry.id === clientId);
  const digest = createHash('sha256').update(token).digest('hex');
  if (!client || client.digest !== digest) throw Error('This token does not match the selected client.');
  const directory = path.dirname(agentSkillTokenPath());
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await fs.lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.uid !== process.getuid()) throw Error('Unsafe agent token directory.');
  await fs.chmod(directory, 0o700);
  const target = agentSkillTokenPath();
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify({ clientId, token }), { flag: 'wx', mode: 0o600 });
    await fs.chmod(temp, 0o600);
    await fs.rename(temp, target);
  } catch (error) { await fs.rm(temp, { force: true }); throw error; }
  return true;
});
handle('agent-clear-token', async () => { await fs.rm(agentSkillTokenPath(), { force: true }); return true; });
handle('agent-revoke', async id => {
  await getAgent().revoke(id);
  try {
    const saved = JSON.parse(await fs.readFile(agentSkillTokenPath(), 'utf8'));
    if (saved.clientId === id) await fs.rm(agentSkillTokenPath(), { force: true });
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
});
handle('agent-grant', (client, profileId, grant) => getAgent().grant(client, profileId, grant));
handle('agent-answer', (session, id, value) => getAgent().answer(session, id, value));
handle('agent-history', filter => getAgent().history(filter));
handle('agent-retention', days => getAgent().retention(days));
handle('agent-export', async (filter, includePaths) => {
  const service = getAgent();
  const { canceled, filePath } = await dialog.showSaveDialog(preferencesWindow || window, {
    defaultPath: 'PromeFTP-agent-activity.json', filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled) return;
  const rows = service.history(filter, 50000).map(row => {
    if (includePaths !== true && row.operation.startsWith('sftp.')) row.detail = null;
    return row;
  });
  service.audit({ operation: 'history.export', result: 'allowed' });
  await fs.writeFile(filePath, JSON.stringify(rows, null, 2), { mode: 0o600 });
  service.audit({ operation: 'history.export', result: 'success' });
});

let skillQueue = Promise.resolve();
function installAgentSkill(options, base) {
  const run = skillQueue.then(async () => {
    const { target, action, project, automatic } = options;
    const service = getAgent();
    const resolved = await fs.realpath(base);
    const key = createHash('sha256').update(JSON.stringify([target, project === true, resolved])).digest('hex');
    const receipt = state.agent?.skills?.[key];
    const event = { operation: 'skill.' + action, detail: JSON.stringify({ target, scope: project ? 'project' : 'user',
      ...(project && { project: path.basename(resolved) }), previous: receipt?.version }) };
    service.audit({ ...event, result: 'allowed' });
    try {
      const installed = await manageSkill({ target, action, base: resolved, project: project === true,
        appVersion: app.getVersion(), publicKey: (await fs.readFile(path.join(__dirname, 'updates/public-key.txt'), 'utf8')).trim(), receipt });
      await updateState(next => {
        const skills = (next.agent ??= {}).skills ??= {};
        if (installed.removed) delete skills[key];
        else skills[key] = { ...installed, target, base: resolved, project: project === true, automatic: automatic === true };
      });
      service.audit({ ...event, result: 'success', detail: JSON.stringify({ ...JSON.parse(event.detail), version: installed.version }) });
      return installed;
    } catch (error) {
      service.audit({ ...event, result: 'failed', reason: error.agentCode || 'SKILL_INSTALL_FAILED' });
      throw error;
    }
  });
  skillQueue = run.catch(() => {});
  return run;
}
handle('agent-skill', async options => {
  if (!options || !Object.hasOwn(agentTargets, options.target) || !['install', 'remove'].includes(options.action)) throw Error('Invalid skill request.');
  let base = app.getPath('home');
  if (options.project) {
    const result = await dialog.showOpenDialog(preferencesWindow || window, {
      title: 'Choose skill project', properties: ['openDirectory', 'showHiddenFiles'],
    });
    if (result.canceled) return null;
    [base] = result.filePaths;
  }
  return installAgentSkill(options, base);
});

app.setName('PromeFTP');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore();
  window?.focus();
});
app.whenReady().then(async () => {
  try {
    state = JSON.parse(await fs.readFile(statePath(), 'utf8'));
    state.snippets ??= [];
    state.sftpPathFavorites ??= [];
    state.workspaces ??= [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { profiles: [], snippets: [], workspaces: [], sftpPathFavorites: [] };
  }
  await transferQueue.start();
  if (['system', 'light', 'dark'].includes(state.appearance)) nativeTheme.themeSource = state.appearance;
  window = new BrowserWindow({
    width: 1200, height: 760, minWidth: 800, minHeight: 530,
    titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 17 },
    transparent: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.meta || input.control || input.alt) return;
    // A Latin character wins, so Dvorak, Colemak, AZERTY and German layouts keep their own letters and symbols.
    // Non-Latin input sources (Korean, Japanese, Russian) report a non-Latin key, so the physical key is used instead.
    const typed = /^[\x21-\x7e]$/.test(input.key) ? input.key.toLowerCase() : '';
    const physical = { KeyP: 'p', Equal: '=', NumpadAdd: '+', Minus: '-', NumpadSubtract: '-', Digit0: '0' }[input.code] || '';
    const shortcut = typed || physical;
    const command = shortcut === 'p' ? 'snippets'
      : ['+', '='].includes(shortcut) ? 'zoom-in'
      : shortcut === '-' ? 'zoom-out' : shortcut === '0' ? 'zoom-reset' : '';
    if (!command) return;
    event.preventDefault();
    window.webContents.send('command', command);
  });
  window.webContents.on('will-navigate', event => event.preventDefault());
  const bridge = path.join(process.resourcesPath, '..', 'Frameworks', 'PromeFTPUpdate.node');
  if (existsSync(bridge)) {
    updater = require(bridge);
    updater.start();
  }
  buildApplicationMenu();
  window.on('close', () => preferencesWindow?.close());
  await initializeAgent().catch(error => { agentStartupError = error.agentCode || 'Could not start agent integration.'; });
  await window.loadFile('index.html');
  const refreshSkills = () => {
    for (const skill of Object.values(state.agent?.skills || {})) {
      if (skill.automatic) installAgentSkill({ ...skill, action: 'install' }, skill.base).catch(() => {});
    }
  };
  setTimeout(refreshSkills, 60_000).unref();
  setInterval(refreshSkills, 24 * 60 * 60_000).unref();
}).catch(error => {
  dialog.showErrorBox('PromeFTP', error.message);
  app.exit(1);
});
let waitingForTransfersBeforeQuit = false;
app.on('before-quit', event => {
  if (waitingForTransfersBeforeQuit) return;
  if (!queuedTransferBusy) { agent?.stop(); return; }
  event.preventDefault(); waitingForTransfersBeforeQuit = true; agent?.stop();
  Promise.resolve(transferQueue?.stop()).finally(() => app.quit());
});
app.on('window-all-closed', () => {
  for (const { connection } of sessions.values()) connection?.close();
  app.quit();
});
