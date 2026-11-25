const api = window.promeftp;
const byId = id => document.getElementById(id);
const editor = byId('editor');
const message = byId('message');
const workspace = byId('workspace');
const tabs = byId('tabs');
const sessions = new Map();
let active;
const tabRecords = [];
let terminalPreferences = { ...defaultTerminal };
try { Object.assign(terminalPreferences, JSON.parse(localStorage.getItem('terminal-preferences'))); } catch {}
let draggedTab;
let selected;
let profiles = [];
let configAliases = [];
// HostName, User and Port per alias name, filled after the names are listed (see loadAliasDetails).
let configAliasDetails = new Map();
let aliasRequest = 0;

function syncTerminalTransparency() {
  const session = sessions.get(active);
  document.body.classList.toggle('terminal-transparent', Number(terminalPreferences.opacity ?? 100) < 100 && Boolean(session && session.mode !== 'sftp'));
}

for (const control of document.querySelectorAll('[data-icon]')) {
  control.classList.add('icon-button');
  control.append(icon(control.dataset.icon));
}
const passwordInput = editor.elements.namedItem('password');
byId('password-control').append(passwordField(passwordInput, 'Show password', 'Hide password'));
const rememberPasswordInput = editor.elements.namedItem('rememberPassword');
try { rememberPasswordInput.checked = localStorage.getItem('remember-ssh-password') !== 'false'; } catch { rememberPasswordInput.checked = true; }
rememberPasswordInput.addEventListener('change', () => {
  try { localStorage.setItem('remember-ssh-password', String(rememberPasswordInput.checked)); } catch {}
  refreshSavedPassword();
});
passwordInput.addEventListener('input', () => {
  refreshSavedPassword();
});

const collapsedFolders = new Set();
let bookmarkFolders = [];
let draggedBookmark;
let draggedOrder;
function orderedItems(items, key, getId) {
  let order = [];
  try { order = JSON.parse(localStorage.getItem('list-order:' + key)) || []; } catch {}
  const positions = new Map(order.map((id, index) => [id, index]));
  return items.map((item, index) => ({ item, index, position: positions.get(getId(item)) ?? -1 }))
    .sort((a, b) => a.position - b.position || a.index - b.index).map(entry => entry.item);
}
function bindOrderedRow(row, key, id, getItems, rerender, group = '') {
  row.draggable = true;
  row.dataset.orderKey = key;
  row.dataset.orderId = id;
  row.dataset.orderGroup = group;
  row.addEventListener('dragstart', event => {
    draggedOrder = { key, id, group };
    event.dataTransfer.setData('text/promeftp-order', key);
  });
  row.addEventListener('dragover', event => {
    if (!draggedOrder || draggedOrder.key !== key || draggedOrder.id === id || draggedOrder.group !== group) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    row.classList.add('order-drop-target');
  });
  row.addEventListener('dragleave', event => {
    if (!(event.relatedTarget instanceof Node) || !row.contains(event.relatedTarget)) row.classList.remove('order-drop-target');
  });
  row.addEventListener('drop', event => {
    if (!draggedOrder || draggedOrder.key !== key || draggedOrder.id === id || draggedOrder.group !== group) return;
    event.preventDefault();
    event.stopPropagation();
    row.classList.remove('order-drop-target');
    const ids = orderedItems(getItems(), key, getId => getId.id).map(item => item.id);
    const from = ids.indexOf(draggedOrder.id);
    const to = ids.indexOf(id);
    if (from < 0 || to < 0) return;
    const [moving] = ids.splice(from, 1);
    const target = ids.indexOf(id);
    const after = event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
    ids.splice(target + Number(after), 0, moving);
    try { localStorage.setItem('list-order:' + key, JSON.stringify(ids)); } catch {}
    draggedOrder = undefined;
    rerender();
  });
  row.addEventListener('dragend', () => { draggedOrder = undefined; row.classList.remove('order-drop-target'); });
}

async function moveBookmark(entry, folder) {
  await api['move-bookmark'](entry.id, folder);
  if (selected === entry.id) editor.elements.group.value = folder;
  collapsedFolders.delete(folder);
  await refresh();
}

async function duplicateBookmark(entry) {
  const baseName = entry.label || entry.host || 'Bookmark';
  const name = await askName(baseName + ' copy', 'Duplicate bookmark');
  if (name === undefined) return;
  try {
    await api['save-profile']({ ...entry, id: undefined, label: name.trim() || baseName + ' copy' });
    await refresh();
  } catch (error) { showError(error); }
}

function bookmarkRow(entry) {
  const row = document.createElement('div');
  row.className = 'bookmark-row';
  const open = button(entry.label, () => edit(entry, 'ssh', splitDraft));
  open.className = 'host' + (entry.id === selected ? ' active' : '');
  open.title = entry.username ? entry.username + '@' + entry.host : entry.host;
  const menu = () => chooseMenu([
    ['Edit Bookmark…', () => edit(entry, 'ssh', splitDraft)],
    ['Duplicate Bookmark…', () => duplicateBookmark(entry)],
    ['Open SSH Tab', () => start(entry, 'ssh')],
    ['Open SFTP Tab', () => start(entry, 'sftp')],
    null,
    ['Move to Bookmarks', () => moveBookmark(entry, ''), Boolean(entry.group)],
    ...bookmarkFolders.map(folder => ['Move to ' + folder, () => moveBookmark(entry, folder), folder !== entry.group]),
    null,
    ['Delete Bookmark', async () => {
      await api['remove-profile'](entry.id);
      if (selected === entry.id) {
        selected = undefined;
        if (!editor.hidden) edit(undefined, 'ssh', splitDraft);
      }
      await refresh();
    }],
  ]).catch(showError);
  open.addEventListener('dblclick', event => { event.preventDefault(); start(entry, 'ssh'); });
  row.append(open);
  row.addEventListener('contextmenu', event => { event.preventDefault(); menu(); });
  row.addEventListener('dragstart', event => {
    draggedBookmark = entry;
    event.dataTransfer.setData('text/plain', 'PromeFTP bookmark');
    event.dataTransfer.effectAllowed = 'copyMove';
  });
  row.addEventListener('dragend', clearLayoutDrag);
  bindOrderedRow(row, 'bookmarks', entry.id, () => profiles, renderHosts, entry.group);
  return row;
}

async function editBookmarkFolder(previous) {
  const name = await askName(previous || '', previous ? 'Rename folder' : 'New bookmark folder');
  if (name === undefined) return;
  try {
    await api['save-bookmark-folder'](name, previous);
    if (previous && editor.elements.group.value === previous) editor.elements.group.value = name.trim();
    if (collapsedFolders.delete(previous)) collapsedFolders.add(name.trim());
    await refresh();
  } catch (error) { showError(error); }
}
function bookmarkFolder(name, entries, searching) {
  const folder = document.createElement('section');
  folder.className = 'bookmark-folder';
  const header = document.createElement('div');
  header.className = 'bookmark-folder-heading';
  const children = document.createElement('div');
  children.className = 'bookmark-folder-items';
  children.hidden = !searching && collapsedFolders.has(name);
  const toggle = button(t(''), () => {
    children.hidden = !children.hidden;
    if (children.hidden) collapsedFolders.add(name);
    else collapsedFolders.delete(name);
    toggle.setAttribute('aria-expanded', String(!children.hidden));
  });
  const title = document.createElement('span');
  title.textContent = name;
  toggle.append(icon('chevron'), icon('folder'), title);
  toggle.title = name;
  toggle.setAttribute('aria-expanded', String(!children.hidden));
  const menu = () => chooseMenu([
    ['Rename Folder…', () => editBookmarkFolder(name)],
    ['Remove Folder', async () => {
      await api['remove-bookmark-folder'](name);
      if (editor.elements.group.value === name) editor.elements.group.value = '';
      collapsedFolders.delete(name);
      await refresh();
    }],
  ]).catch(showError);
  header.append(toggle);
  header.addEventListener('contextmenu', event => { event.preventDefault(); menu(); });
  bindOrderedRow(header, 'bookmark-folders', name, () => bookmarkFolders.map(id => ({ id })), renderHosts, 'folders');
  children.append(...orderedItems(entries, 'bookmarks', entry => entry.id).map(bookmarkRow));
  folder.append(header, children);
  folder.addEventListener('dragover', event => {
    if (!draggedBookmark || draggedBookmark.group === name) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    folder.classList.add('bookmark-drop');
  });
  folder.addEventListener('dragleave', event => {
    if (!(event.relatedTarget instanceof Node) || !folder.contains(event.relatedTarget)) folder.classList.remove('bookmark-drop');
  });
  folder.addEventListener('drop', event => {
    if (!draggedBookmark || draggedBookmark.group === name) return;
    event.preventDefault();
    const entry = draggedBookmark;
    draggedBookmark = undefined;
    folder.classList.remove('bookmark-drop');
    moveBookmark(entry, name).catch(showError);
  });
  return folder;
}

function renderHosts() {
  const query = byId('search').value.trim().toLowerCase();
  const list = byId('hosts');
  const groups = new Map(bookmarkFolders.map(folder => [folder, []]));
  const root = [];
  for (const entry of profiles) {
    if (![entry.label, entry.host, entry.group].some(value => value?.toLowerCase().includes(query))) continue;
    if (!entry.group) root.push(entry);
    else {
      if (!groups.has(entry.group)) groups.set(entry.group, []);
      groups.get(entry.group).push(entry);
    }
  }
  list.replaceChildren(...orderedItems([...groups]
    .filter(([name, entries]) => !query || entries.length || name.toLowerCase().includes(query))
    .map(([name, entries]) => bookmarkFolder(name, entries, Boolean(query))), 'bookmark-folders', group => group[0]), ...orderedItems(root, 'bookmarks', entry => entry.id).map(bookmarkRow));
  byId('host-empty').hidden = list.childElementCount > 0;
  byId('host-empty').textContent = query ? 'No matching bookmarks' : 'No bookmarks';
}

function activate(id, focus = true) {
  active = id;
  homeTab.classList.toggle('active', !id);
  editor.hidden = Boolean(id);
  const session = sessions.get(id);
  const selectedTab = session?.tabRecord;
  if (selectedTab) selectedTab.focus = id;
  selectedTab?.element.classList.remove('agent-unseen');
  for (const tab of tabRecords) {
    const inFilter = selectedTabGroup === '*' || (selectedTabGroup === '_' ? !tab.group : tab.group === selectedTabGroup);
    tab.root.hidden = tab !== selectedTab || !inFilter;
    tab.element.classList.toggle('active', tab === selectedTab);
    tab.element.firstElementChild.setAttribute('aria-selected', String(tab === selectedTab));
  }
  for (const pane of sessions.values()) pane.pane.classList.toggle('focused', pane === session);
  if (session && !session.area.hidden) {
    session.fit.fit();
    requestAgentShell(session);
    if (focus) (session.auth.querySelector('input') || session.terminal).focus();
  }
  session?.fileLayout?.refreshLocalControls?.();
  session?.fileLayout?.refreshDivider?.();
  syncTerminalTransparency();
  selectedTab?.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  requestAnimationFrame(() => {
    for (const pane of sessions.values()) {
      if (pane.tabRecord !== selectedTab || !pane.pane.getClientRects().length) continue;
      if (pane.terminal && !pane.area.hidden) {
        const rect = pane.area.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) continue;
        pane.fit.fit();
        if (pane.terminal.rows > 0) pane.terminal.refresh(0, pane.terminal.rows - 1);
      }
      pane.fileLayout?.refreshLocalControls?.();
      pane.fileLayout?.refreshDivider?.();
    }
  });
}
function edit(entry, intent = 'ssh', draft) {
  splitDraft = draft;
  byId('cancel-split-connect').hidden = !draft;
  editor.querySelector('[value=ssh]').hidden = draft?.session.mode === 'sftp';
  editor.querySelector('[value=sftp]').hidden = Boolean(draft && draft.session.mode !== 'sftp');
  editor.reset();
  passwordInput.value = '';
  try { rememberPasswordInput.checked = localStorage.getItem('remember-ssh-password') !== 'false'; } catch { rememberPasswordInput.checked = true; }
  byId('auth-rules').replaceChildren();
  byId('advanced').open = false;
  selected = entry?.id;
  byId('update-bookmark').disabled = !selected;
  delete editor.elements.namedItem('keyPath').dataset.configValue;
  for (const key of ['label', 'host', 'hostname', 'port', 'username', 'keyPath', 'group', 'configPath']) {
    if (entry) editor.elements.namedItem(key).value = entry[key] ?? '';
  }
  editor.elements.namedItem('pam').checked = Boolean(entry?.pam);
  byId('editor-title').textContent = t(draft ? (draft.session.mode === 'sftp' ? 'Split SFTP' : draft.axis === 'row' ? 'Split Right' : 'Split Down')
    : intent === 'sftp' ? 'SFTP' : 'Connect');
  editor.dataset.intent = intent;
  editor.querySelector('[value=ssh]').classList.toggle('primary', intent === 'ssh');
  editor.querySelector('[value=sftp]').classList.toggle('primary', intent === 'sftp');
  byId('effective').hidden = true;
  byId('close-effective').hidden = true;
  usesAlias = entry?.usesAlias === true;
  refreshAliasEndpoint(entry?.id && entry.usesAlias === undefined);
  refreshDestinationPreview();
  refreshSavedPassword();
  message.textContent = '';
  activate();
  renderHosts();
}
async function refresh() {
  [profiles, bookmarkFolders] = await Promise.all([api.profiles(), api['bookmark-folders']()]);
  bookmarkFolders.sort((a, b) => a.localeCompare(b));
  byId('bookmark-folder-names').replaceChildren(...bookmarkFolders.map(name => new Option(name, name)));
  renderHosts();
}
function showError(error) {
  message.textContent = error.message;
  message.className = 'error';
}
const homeTab = iconButton('network', 'Hosts', () => activate());
homeTab.className = 'home-tab';
tabs.append(homeTab);
const tabGroups = document.createElement('div');
tabGroups.className = 'tab-groups';
tabs.append(tabGroups);
const groupFilter = document.createElement('select');
groupFilter.className = 'tab-group-filter';
groupFilter.setAttribute('aria-label', t('Show tab group'));
tabs.append(groupFilter);
let selectedTabGroup = localStorage.getItem('tab-group-filter') || '*';
groupFilter.addEventListener('change', () => {
  selectedTabGroup = groupFilter.value;
  localStorage.setItem('tab-group-filter', selectedTabGroup);
  renderTabs();
  const visible = tabRecords.filter(tab => selectedTabGroup === '*' || (selectedTabGroup === '_' ? !tab.group : tab.group === selectedTabGroup));
  if (visible.length && !visible.includes(sessions.get(active)?.tabRecord)) activate(visible[0].focus, false);
});
function includeTabInSelectedGroup(tab) {
  if (selectedTabGroup === '*' || selectedTabGroup === '_') return;
  tab.group = selectedTabGroup;
}
function renderTabs() {
  const groups = new Map();
  for (const tab of tabRecords) {
    const name = tab.group;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(tab);
  }
  const names = [...new Set(tabRecords.map(tab => tab.group).filter(Boolean))];
  const options = [new Option(t('All Groups'), '*'), new Option(t('Ungrouped'), '_'), ...names.map(name => new Option(name, name))];
  groupFilter.replaceChildren(...options);
  if (![...groupFilter.options].some(option => option.value === selectedTabGroup)) selectedTabGroup = '*';
  groupFilter.value = selectedTabGroup;
  tabGroups.replaceChildren();
  for (const [name, entries] of groups) {
    if (selectedTabGroup !== '*' && (selectedTabGroup === '_' ? Boolean(name) : name !== selectedTabGroup)) continue;
    const group = document.createElement('div');
    group.className = 'tab-group' + (name ? ' named' : '');
    if (name) {
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', name);
      const title = document.createElement('span');
      title.className = 'tab-group-label';
      title.textContent = name;
      title.title = name;
      const groupColor = entries.find(tab => tab.groupColor)?.groupColor || '';
      group.style.setProperty('--group-color', validColor(groupColor) || 'var(--accent)');
      title.addEventListener('contextmenu', event => {
        event.preventDefault();
        chooseMenu([
          [t('Rename Group…'), async () => {
            const next = await askName(name, t('Rename Group'));
            if (next === undefined || !next.trim()) return;
            for (const tab of entries) tab.group = next.trim();
            if (selectedTabGroup === name) selectedTabGroup = next.trim();
            renderTabs();
            activate(active, false);
          }],
          ['Group Color…', () => pickColor(groupColor, color => {
            for (const tab of entries) tab.groupColor = color;
            renderTabs();
          })],
          ['Reset Group Color', () => { for (const tab of entries) tab.groupColor = ''; renderTabs(); }],
          [t('Ungroup Tabs'), () => { for (const tab of entries) tab.group = ''; if (selectedTabGroup === name) selectedTabGroup = '_'; renderTabs(); activate(active, false); }],
        ]);
      });
      group.append(title);
    }
    for (const tab of entries) group.append(tab.element);
    tabGroups.append(group);
  }
  const currentTab = sessions.get(active)?.tabRecord;
    const visibleTabs = tabRecords.filter(tab => selectedTabGroup === '*' || (selectedTabGroup === '_' ? !tab.group : tab.group === selectedTabGroup));
  if (currentTab && !visibleTabs.includes(currentTab)) activate(visibleTabs[0]?.focus, false);
}
function keyboardChoices(dialog, search, list, selector = 'button') {
  dialog.addEventListener('keydown', event => {
    if (event.target !== search && (!list.contains(event.target) || !event.target.matches(selector))) return;
    const choices = [...list.querySelectorAll(selector)].filter(item => !item.disabled && !item.closest('[hidden]'));
    if (!choices.length) return;
    const index = choices.indexOf(document.activeElement);
    const first = search.value.trim() ? Math.max(0, choices.findIndex(item => !item.dataset.keyboardSecondary)) : 0;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const next = index < 0 ? (direction > 0 ? first : choices.length - 1)
        : (index + direction + choices.length) % choices.length;
      choices[next].focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choices[index < 0 ? first : index].click();
    }
  });
}

const configDialog = byId('config-dialog');
const configSearch = byId('alias-search');
const configFiles = byId('config-files');
const configField = editor.elements.namedItem('configPath');
const configMessage = byId('config-message');
keyboardChoices(configDialog, configSearch, byId('aliases'));
async function renderConfigFiles() {
  const registered = await api['config-files']();
  const activeFile = configField.value;
  const files = new Set(registered);
  if (activeFile) files.add(activeFile);
  configFiles.replaceChildren(new Option('~/.ssh/config', ''), ...[...files].map(file => new Option(file, file)));
  configFiles.value = activeFile;
  configFiles.title = activeFile || '~/.ssh/config';
  byId('remove-config-file').disabled = !registered.includes(activeFile);
}
async function refreshConfigDialog() {
  configMessage.textContent = '';
  try {
    await renderConfigFiles();
    await refreshAliases();
  } catch (error) {
    configAliases = [];
    renderAliases();
    configMessage.textContent = error.message;
  }
}
function useConfig(file) {
  configField.value = file;
  refreshAliasEndpoint();
  return refreshConfigDialog();
}
byId('rail-config').addEventListener('click', async () => {
  configSearch.value = '';
  await refreshConfigDialog();
  if (!configDialog.open) configDialog.showModal();
  configSearch.focus();
});
byId('close-config').addEventListener('click', () => configDialog.close());
configSearch.addEventListener('input', renderAliases);
configFiles.addEventListener('change', () => useConfig(configFiles.value));
byId('add-config-file').addEventListener('click', async () => {
  try {
    const file = await api['choose-config']();
    if (!file) return;
    await api['register-config'](file);
    await useConfig(file);
  } catch (error) { configMessage.textContent = error.message; }
});
const sshConfigEditor = byId('ssh-config-editor');
const sshConfigSections = byId('ssh-config-sections');
let sshConfigDocument;
let sshConfigFile;
let sshConfigTargetHost = '';
let sshConfigSuggestedKex = '';
let sshConfigOriginalContent = '';
function parseSshConfig(contents) {
  const document = { global: [], sections: [] };
  let current;
  for (const line of contents.split(/\r?\n/)) {
    const header = /^(\s*)(Host|Match)(?:\s+|=)(.*)$/i.exec(line);
    if (header) {
      current = { type: header[2].toLowerCase(), indent: header[1], value: header[3], lines: [] };
      document.sections.push(current);
    } else (current ? current.lines : document.global).push(line);
  }
  return document;
}
function serializeSshConfig(document) {
  const sections = document.sections.map(section =>
    [section.indent + (section.type === 'host' ? 'Host' : 'Match') + ' ' + section.value, ...section.lines].join('\n'));
  const global = document.global.join('\n');
  return global + (sections.length ? (global && !global.endsWith('\n') ? '\n' : '') + sections.join('\n') : '');
}
function configDirective(line) {
  return /^(\s*)([A-Za-z][\w-]*)(?:\s+|=)(.*)$/.exec(line);
}
function addSshDirective(section, name, value) {
  const existing = section.lines.findIndex(line => configDirective(line)?.[2].toLowerCase() === name.toLowerCase());
  if (existing >= 0) {
    const parsed = configDirective(section.lines[existing]);
    const current = parsed[3].trim();
    if (/^[\^\-]/.test(current)) throw Error(t('This KEX list uses an advanced operator; edit it manually in the directive field.'));
    const additive = current.startsWith('+');
    const values = (additive ? current.slice(1) : current).split(/[\s,]+/).filter(Boolean);
    const algorithm = value.replace(/^\+/, '');
    if (!values.includes(algorithm)) values.push(algorithm);
    section.lines[existing] = parsed[1] + parsed[2] + ' ' + (additive ? '+' : '') + values.join(',');
  } else section.lines.push('\t' + name + ' ' + value);
}
function renderConfigDirectives(section, container) {
  if (section.type === 'match') {
    const raw = document.createElement('pre');
    raw.className = 'ssh-config-raw';
    raw.textContent = section.lines.join('\n');
    container.append(raw);
    return;
  }
  const rows = document.createElement('div');
  rows.className = 'ssh-config-directives';
  section.lines.forEach((line, index) => {
    const parsed = configDirective(line);
    if (!parsed || line.trimStart().startsWith('#')) return;
    const row = document.createElement('div');
    row.className = 'ssh-config-directive';
    const key = document.createElement('input');
    key.value = parsed[2]; key.setAttribute('aria-label', 'SSH config directive');
    const value = document.createElement('input');
    value.value = parsed[3]; value.setAttribute('aria-label', parsed[2] + ' value');
    const remove = iconButton('trash', 'Remove directive', () => {
      section.lines[index] = '';
      row.remove();
    });
    const update = () => {
      if (!/^[A-Za-z][\w-]*$/.test(key.value.trim()) || ['host', 'match'].includes(key.value.trim().toLowerCase()) ||
          !value.value.trim() || /[\r\n\0]/.test(value.value)) return;
      section.lines[index] = parsed[1] + key.value.trim() + ' ' + value.value;
    };
    key.addEventListener('change', update);
    value.addEventListener('input', update);
    row.append(key, value, remove);
    rows.append(row);
  });
  container.append(rows);
}
function renderSshConfigEditor() {
  sshConfigSections.replaceChildren();
  const global = document.createElement('section');
  global.className = 'ssh-config-section';
  const globalTitle = document.createElement('h3'); globalTitle.textContent = t('Global options');
  global.append(globalTitle);
  renderConfigDirectives({ type: 'global', lines: sshConfigDocument.global }, global);
  const globalAdd = button(t('Add directive'), () => {
    sshConfigDocument.global.push('\tNewOption value');
    renderSshConfigEditor();
    const fields = sshConfigSections.querySelectorAll('.ssh-config-directive input[aria-label="SSH config directive"]');
    fields[fields.length - 1]?.focus(); fields[fields.length - 1]?.select();
  });
  global.classList.toggle('empty', !sshConfigDocument.global.some(configDirective));
  global.append(globalAdd);
  sshConfigSections.append(global);
  for (const section of sshConfigDocument.sections) {
    const group = document.createElement('section'); group.className = 'ssh-config-section';
    if (section.type === 'match') {
      const title = document.createElement('h3'); title.textContent = t('Match section · preserved') + ' · ' + section.value;
      group.append(title);
      renderConfigDirectives(section, group);
      sshConfigSections.append(group);
      continue;
    }
    const header = document.createElement('div'); header.className = 'ssh-config-section-header';
    const patterns = document.createElement('input'); patterns.value = section.value;
    patterns.setAttribute('aria-label', t('Host patterns'));
    patterns.addEventListener('input', () => { section.value = patterns.value.replace(/[\r\n\0]/g, ''); });
    const removeHost = iconButton('trash', t('Remove Host section'), () => {
      sshConfigDocument.sections.splice(sshConfigDocument.sections.indexOf(section), 1);
      renderSshConfigEditor();
    });
    header.append(patterns, removeHost); group.append(header);
    renderConfigDirectives(section, group);
    const tools = document.createElement('div'); tools.className = 'ssh-config-section-tools';
    tools.append(button(t('Add directive'), () => {
      section.lines.push('\tNewOption value');
      renderSshConfigEditor();
      const fields = sshConfigSections.querySelectorAll('.ssh-config-section input[aria-label="SSH config directive"]');
      fields[fields.length - 1]?.focus();
    }));
    if (sshConfigTargetHost && section.value.split(/\s+/).includes(sshConfigTargetHost)) {
      const algorithm = sshConfigSuggestedKex || 'diffie-hellman-group14-sha1';
      tools.append(button(t('Add KEX compatibility') + ' · ' + algorithm, () => {
        try {
          if (sshConfigDocument.global.some(line => configDirective(line)?.[2].toLowerCase() === 'kexalgorithms')) {
            throw Error(t('A global KexAlgorithms setting takes precedence. Edit that directive to change it for every host.'));
          }
          addSshDirective(section, 'KexAlgorithms', '+' + algorithm);
          renderSshConfigEditor();
          byId('ssh-config-editor-message').textContent = t('Added for this Host section. Save to apply.');
        } catch (error) { byId('ssh-config-editor-message').textContent = error.message; }
      }));
    }
    group.append(tools);
    sshConfigSections.append(group);
  }
}
async function openSshConfigEditor(file = configFiles.value, targetHost = '', suggestedKex = '') {
  const registered = await api['config-files']();
  if (file && !registered.includes(file)) await api['register-config'](file);
  const result = await api['edit-config-file'](file);
  sshConfigFile = result.path;
  sshConfigOriginalContent = result.content;
  sshConfigTargetHost = targetHost;
  sshConfigSuggestedKex = suggestedKex;
  byId('ssh-config-editor-title').textContent = t('SSH config');
  sshConfigDocument = parseSshConfig(result.content);
  if (targetHost) {
    let targetSection = sshConfigDocument.sections.find(section => section.type === 'host' && section.value.trim() === targetHost);
    if (targetSection) sshConfigDocument.sections.splice(sshConfigDocument.sections.indexOf(targetSection), 1);
    else targetSection = { type: 'host', indent: '', value: targetHost, lines: [] };
    sshConfigDocument.sections.unshift(targetSection);
  }
  byId('ssh-config-editor-path').textContent = sshConfigFile;
  byId('ssh-config-editor-message').textContent = '';
  renderSshConfigEditor();
  sshConfigEditor.showModal();
}
byId('edit-config-file').addEventListener('click', () => openSshConfigEditor().catch(error => {
  configMessage.textContent = error.message;
}));
byId('close-ssh-config-editor').addEventListener('click', () => sshConfigEditor.close());
byId('cancel-ssh-config').addEventListener('click', () => sshConfigEditor.close());
byId('add-ssh-host').addEventListener('click', () => {
  sshConfigDocument.sections.push({ type: 'host', indent: '', value: 'new-host', lines: [] });
  renderSshConfigEditor();
  const fields = sshConfigSections.querySelectorAll('.ssh-config-section-header input');
  fields[fields.length - 1]?.focus(); fields[fields.length - 1]?.select();
});
byId('save-ssh-config').addEventListener('click', async () => {
  try {
    const content = serializeSshConfig(sshConfigDocument);
    const directives = [...sshConfigDocument.global, ...sshConfigDocument.sections.flatMap(section => section.lines)];
    const incomplete = directives.some(line => {
      const directive = configDirective(line);
      return directive && (['host', 'match'].includes(directive[2].toLowerCase()) || !directive[3].trim());
    });
    if (/\bNewOption(?:\s+value)?\s*$/m.test(content) || incomplete || sshConfigDocument.sections.some(section =>
        section.type === 'host' && (!section.value.trim() || /^new-host$/i.test(section.value.trim())))) {
      throw Error(t('Finish the new directive or Host entry before saving.'));
    }
    await api['save-config-file'](sshConfigFile, content, sshConfigOriginalContent);
    sshConfigOriginalContent = content;
    await refreshConfigDialog();
  byId('ssh-config-editor-message').textContent = t('Saved. OpenSSH will use these settings on the next connection.');
  } catch (error) { byId('ssh-config-editor-message').textContent = error.message; }
});
byId('remove-config-file').addEventListener('click', async () => {
  try {
    await api['unregister-config'](configFiles.value);
    await useConfig('');
  } catch (error) { configMessage.textContent = error.message; }
});
const bookmarksTab = byId('sidebar-bookmarks');
const historyTab = byId('sidebar-history');
const workspacesTab = byId('sidebar-workspaces');
const historyMessage = byId('history-message');
const historySearch = byId('history-search');
const historyPanel = byId('history-panel');
const sidebarWorkspacePanel = byId('sidebar-workspace-panel');
let historyEntries = [];
function renderConnectionHistory() {
  const query = historySearch.value.trim().toLowerCase();
  const list = byId('history-list');
  list.replaceChildren();
  for (const entry of historyEntries) {
    const { input, mode } = entry;
    if (![input.label, input.host, input.hostname, input.username, mode].some(value => value?.toLowerCase().includes(query))) continue;
    const row = document.createElement('div');
    row.className = 'bookmark-row history-row';
    const open = button(input.label || input.host, () => start(input, mode));
    open.className = 'host';
    open.title = input.host;
    const detail = document.createElement('small');
    detail.textContent = mode.toUpperCase() + ' · ' + new Date(entry.connectedAt).toLocaleString();
    open.append(detail);
    const menu = () => chooseMenu([
      ['Edit & Bookmark…', async () => {
        const saved = await api['save-profile'](input);
        await refresh();
        edit(saved, mode);
      }],
      ['Open Connection', () => start(input, mode)],
      null,
      ['Add to Bookmarks', async () => {
        await api['save-profile'](input);
        await refresh();
      }],
      ['Remove from History', async () => {
        await api['remove-history-item'](entry.id);
        await refreshHistory();
      }],
    ]).catch(error => { historyMessage.textContent = error.message; });
    row.append(open);
    row.addEventListener('contextmenu', event => { event.preventDefault(); menu(); });
    list.append(row);
  }
  if (!list.childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'empty-hosts';
    empty.textContent = query ? 'No matching connections' : 'No connections yet';
    list.append(empty);
  }
}
async function refreshHistory() {
  historyMessage.textContent = '';
  try {
    historyEntries = await api['connection-history']();
    renderConnectionHistory();
  } catch (error) { historyMessage.textContent = error.message; }
}
function selectSidebarTab(view, persist = true) {
  if (!['bookmarks', 'history', 'workspaces'].includes(view)) view = 'bookmarks';
  byId('bookmark-panel').hidden = view !== 'bookmarks';
  historyPanel.hidden = view !== 'history';
  sidebarWorkspacePanel.hidden = view !== 'workspaces';
  for (const [name, tab] of [['bookmarks', bookmarksTab], ['history', historyTab], ['workspaces', workspacesTab]]) {
    tab.setAttribute('aria-selected', String(view === name));
    tab.tabIndex = view === name ? 0 : -1;
  }
  if (view === 'history') refreshHistory();
  if (view === 'workspaces') refreshSidebarWorkspaces();
  if (persist) try { localStorage.setItem('sidebar-tab', view); } catch {}
}
bookmarksTab.addEventListener('click', () => selectSidebarTab('bookmarks'));
historyTab.addEventListener('click', () => selectSidebarTab('history'));
workspacesTab.addEventListener('click', () => selectSidebarTab('workspaces'));
bookmarksTab.parentElement.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const options = [bookmarksTab, historyTab, workspacesTab];
  const current = options.indexOf(event.target);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
    : (current + (event.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length;
  selectSidebarTab(['bookmarks', 'history', 'workspaces'][next]);
  options[next].focus();
});
try { selectSidebarTab(localStorage.getItem('sidebar-tab') || 'bookmarks', false); }
catch { selectSidebarTab('bookmarks', false); }
historySearch.addEventListener('input', renderConnectionHistory);
byId('add-bookmark-folder').addEventListener('click', () => editBookmarkFolder());

byId('add-rule').addEventListener('click', () => {
  const rules = byId('auth-rules');
  if (rules.querySelectorAll('.auth-rule').length >= 5) return;
  if (!rules.children.length) {
    const info = document.createElement('p');
    info.textContent = t('One reply per match. This connection only.');
    rules.append(info);
  }
  const row = document.createElement('div');
  row.className = 'auth-rule';
  const prompt = document.createElement('input');
  prompt.placeholder = 'Exact prompt';
  prompt.setAttribute('aria-label', 'Exact prompt');
  const answer = document.createElement('input');
  answer.type = 'password';
  answer.autocomplete = 'off';
  answer.placeholder = 'Reply';
  answer.setAttribute('aria-label', 'Automatic reply');
  row.append(prompt, passwordField(answer), iconButton('trash', 'Remove rule', () => {
    row.remove();
    if (!rules.querySelector('.auth-rule')) rules.replaceChildren();
  }));
  rules.append(row);
  prompt.focus();
});
byId('search').addEventListener('input', renderHosts);
const sidebarResize = byId('sidebar-resize');
function resizeSidebar(value) {
  const width = Math.max(164, Math.min(360, Math.round(value)));
  document.body.style.setProperty('--sidebar-width', width + 'px');
  sidebarResize.setAttribute('aria-valuenow', width);
  return width;
}
let sidebarWidth = resizeSidebar(Number(localStorage.getItem('sidebar-width')) || 184);
function rememberSidebarWidth() {
  localStorage.setItem('sidebar-width', String(sidebarWidth));
}
sidebarResize.addEventListener('pointerdown', event => sidebarResize.setPointerCapture(event.pointerId));
sidebarResize.addEventListener('pointermove', event => {
  if (sidebarResize.hasPointerCapture(event.pointerId)) sidebarWidth = resizeSidebar(event.clientX);
});
sidebarResize.addEventListener('lostpointercapture', rememberSidebarWidth);
sidebarResize.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  sidebarWidth = resizeSidebar(sidebarWidth + (event.key === 'ArrowRight' ? 12 : -12));
  rememberSidebarWidth();
});
byId('toggle-sidebar').addEventListener('click', event => {
  const collapsed = document.body.classList.toggle('sidebar-hidden');
  event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
});
byId('rail-local').addEventListener('click', () => start({ label: 'Local Shell' }, 'local'));
byId('rail-sftp').addEventListener('click', () => edit(undefined, 'sftp'));
byId('reload-aliases').addEventListener('click', refreshConfigDialog);
editor.elements.namedItem('configPath').addEventListener('change', () => refreshAliases().catch(showError));
function renderAliases() {
  const query = byId('alias-search').value;
  const list = byId('aliases');
  const configPath = editor.elements.namedItem('configPath').value;
  list.replaceChildren();
  for (const alias of configAliases) {
    const details = configAliasDetails.get(alias);
    if (!aliasMatchesSearch(query, alias, details)) continue;
    const item = button(alias, () => {
      configDialog.addEventListener('close', () => {
        destinationField.focus();
        destinationField.setSelectionRange(alias.length, alias.length);
      }, { once: true });
      configDialog.close();
      edit({ label: alias, host: alias, configPath, usesAlias: true }, editor.dataset.intent === 'sftp' ? 'sftp' : 'ssh', splitDraft);
    });
    item.className = 'host alias';
    if (details?.hostname && details.hostname.toLowerCase() !== alias.toLowerCase()) {
      const hostname = document.createElement('small');
      hostname.textContent = details.hostname;
      item.append(hostname);
      item.title = details.hostname;
    }
    list.append(item);
  }
}
async function refreshAliases() {
  const request = ++aliasRequest;
  const file = editor.elements.namedItem('configPath').value;
  const names = await api['config-aliases'](file);
  if (request !== aliasRequest) return;
  configAliases = names;
  configAliasDetails = new Map();
  renderAliases();
  loadAliasDetails(file, names, request);
}
// The names are already listed. ssh -G resolves the details in the background (main process, eight at a time), and
// the list is filtered again when they arrive. The dialog does not wait for this.
function loadAliasDetails(file, names, request) {
  if (!names.length) return;
  api['config-aliases'](file, names).then(details => {
    if (request !== aliasRequest) return;
    configAliasDetails = new Map(details.map(item => [item.name, item]));
    renderAliases();
  }, () => {});
}
byId('choose-config').addEventListener('click', async () => {
  try {
    const file = await api['choose-config']();
    if (file) {
      await api['register-config'](file);
      await useConfig(file);
    }
  } catch (error) { showError(error); }
});
byId('new-host').addEventListener('click', () => {
  edit(undefined, 'ssh', splitDraft);
  editor.elements.namedItem('host').focus();
});
byId('choose-key').addEventListener('click', async () => {
  try {
    const file = await api['choose-key']();
    if (file) {
      const key = editor.elements.namedItem('keyPath');
      key.value = file;
      delete key.dataset.configValue;
      refreshAliasEndpoint();
    }
  } catch (error) { showError(error); }
});
const destinationField = editor.elements.namedItem('host');
const loginField = editor.elements.namedItem('username');
const splitDestinationButton = byId('split-destination');
let usesAlias = false;
let endpointRequest = 0;

function connectionInput() {
  const input = Object.fromEntries(new FormData(editor));
  delete input.password;
  delete input.rememberPassword;
  const keyField = editor.elements.namedItem('keyPath');
  if (usesAlias && keyField.dataset.configValue && keyField.value === keyField.dataset.configValue) delete input.keyPath;
  input.port = input.port ? Number(input.port) : null;
  input.pam = editor.elements.namedItem('pam').checked;
  input.usesAlias = usesAlias;
  input.id = selected;
  return input;
}

let passwordStateRequest = 0;
async function refreshSavedPassword() {
  const request = ++passwordStateRequest;
  try {
    const saved = await api['ssh-password-saved'](connectionInput());
    if (request !== passwordStateRequest) return;
    if (!passwordInput.value && saved) {
      passwordInput.value = saved;
      rememberPasswordInput.checked = true;
    }
  } catch { /* An incomplete connection form cannot have a saved password. */ }
}
byId('close-effective').addEventListener('click', () => {
  byId('effective').hidden = true;
  byId('close-effective').hidden = true;
});

async function refreshAliasEndpoint(checkLegacy = false) {
  const request = ++endpointRequest;
  const panel = byId('alias-endpoint');
  const hostname = byId('alias-hostname');
  const key = editor.elements.namedItem('keyPath');
  if (usesAlias && key.dataset.configValue && key.value === key.dataset.configValue) {
    key.value = '';
    delete key.dataset.configValue;
  }
  panel.hidden = !usesAlias;
  hostname.disabled = !usesAlias;
  const port = editor.elements.namedItem('port');
  hostname.placeholder = 'Resolving config…';
  loginField.placeholder = 'Default';
  port.placeholder = 'Port';
  for (const field of [loginField, port]) field.title = usesAlias ? 'Leave blank to use SSH config' : '';
  byId('alias-field-label').hidden = !usesAlias;
  const label = usesAlias ? 'SSH alias' : 'Hostname or IP';
  destinationField.placeholder = label;
  destinationField.setAttribute('aria-label', label);
  if (!usesAlias && !checkLegacy) return;
  const input = connectionInput();
  try {
    if (!usesAlias) {
      const aliases = await api['config-aliases'](input.configPath);
      if (request !== endpointRequest || !aliases.includes(input.host)) return;
      usesAlias = true;
      refreshSavedPassword();
      return refreshAliasEndpoint();
    }
    const config = await api['effective-config']({ ...input, hostname: '', username: '', port: null });
    if (request !== endpointRequest) return;
    const value = name => new RegExp('^' + name + ' (.+)$', 'm').exec(config)?.[1]?.trim();
    const resolvedHostname = value('hostname');
    const resolvedUser = value('user');
    const resolvedPort = value('port');
    const resolvedKeyName = value('identityfile');
    const resolvedKey = resolvedKeyName ? await api['inspect-identity-file'](resolvedKeyName) : null;
    if (request !== endpointRequest) return;
    const currentKey = key.value ? await api['inspect-identity-file'](key.value) : null;
    if (request !== endpointRequest) return;
    if (currentKey && !currentKey.available && resolvedKey?.path === currentKey.path) {
      key.value = '';
      delete key.dataset.configValue;
    }
    if (!hostname.value && resolvedHostname && resolvedHostname !== 'none') hostname.value = resolvedHostname;
    hostname.placeholder = resolvedHostname || 'From SSH config';
    if (!loginField.value && resolvedUser && resolvedUser !== 'none') loginField.value = resolvedUser;
    if (!port.value && resolvedPort && resolvedPort !== 'none') port.value = resolvedPort;
    if (!key.value && resolvedKey?.available) {
      key.value = resolvedKey.path;
      key.dataset.configValue = resolvedKey.path;
    } else if (resolvedKey?.available && key.value === resolvedKey.path) {
      key.dataset.configValue = resolvedKey.path;
    }
    loginField.placeholder = 'Default';
    port.placeholder = 'Port';
    refreshSavedPassword();
  } catch {
    if (request === endpointRequest) hostname.placeholder = 'Config unavailable';
  }
}

byId('resolve-alias').addEventListener('click', async () => {
  if (!usesAlias) return;
  const button = byId('resolve-alias');
  button.disabled = true;
  try {
    const config = await api['effective-config']({ ...connectionInput(), hostname: '', username: '', port: null });
    const values = Object.fromEntries(config.split('\n').map(line => {
      const separator = line.indexOf(' ');
      return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1).trim()];
    }));
    const resolvedHost = byId('alias-hostname').value.trim() || values.hostname;
    if (!resolvedHost || resolvedHost === 'none') throw new Error('No hostname is configured for this alias.');
    destinationField.value = resolvedHost;
    byId('alias-hostname').value = '';
    if (!loginField.value && values.user && values.user !== 'none') loginField.value = values.user;
    const port = editor.elements.namedItem('port');
    if (!port.value && values.port && values.port !== 'none') port.value = values.port;
    const key = editor.elements.namedItem('keyPath');
    const firstIdentity = /^identityfile (.+)$/m.exec(config)?.[1]?.trim();
    if (!key.value && firstIdentity && firstIdentity !== 'none') {
      const resolvedKey = await api['inspect-identity-file'](firstIdentity);
      if (resolvedKey?.available) key.value = resolvedKey.path;
    }
    delete key.dataset.configValue;
    usesAlias = false;
    refreshAliasEndpoint();
    refreshDestinationPreview();
    refreshSavedPassword();
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
});

function refreshDestinationPreview() {
  const address = destinationField.value.trim();
  const separator = address.lastIndexOf('@');
  const host = address.slice(separator + 1);
  const username = address.slice(0, separator);
  const valid = separator > 0 && host && !address.startsWith('-') && !host.startsWith('-') && !/[\s/]/.test(address);
  byId('destination-preview').hidden = !valid;
  if (!valid) return;
  byId('destination-host').textContent = host;
  byId('destination-user').textContent = username;
  const existingUser = loginField.value.trim();
  const conflict = Boolean(existingUser && existingUser !== username);
  splitDestinationButton.disabled = conflict;
  byId('destination-conflict').hidden = !conflict;
  return { host, username, conflict };
}
destinationField.addEventListener('input', () => {
  if (usesAlias) {
    byId('alias-hostname').value = '';
    const key = editor.elements.namedItem('keyPath');
    if (key.dataset.configValue && key.value === key.dataset.configValue) key.value = '';
    delete key.dataset.configValue;
  }
  usesAlias = false;
  refreshAliasEndpoint();
  refreshDestinationPreview();
  refreshSavedPassword();
});
editor.addEventListener('change', event => {
  if (event.target.name === 'configPath') refreshAliasEndpoint();
  if (['configPath', 'port', 'username', 'hostname', 'keyPath'].includes(event.target.name)) refreshSavedPassword();
});
loginField.addEventListener('input', refreshDestinationPreview);
splitDestinationButton.addEventListener('click', () => {
  const destination = refreshDestinationPreview();
  if (!destination || destination.conflict) return;
  destinationField.value = destination.host;
  loginField.value = destination.username;
  usesAlias = false;
  refreshAliasEndpoint();
  byId('effective').hidden = true;
  byId('close-effective').hidden = true;
  refreshDestinationPreview();
  loginField.focus();
});
editor.addEventListener('submit', async event => {
  event.preventDefault();
  const input = connectionInput();
  const password = passwordInput.value;
  const rememberPassword = rememberPasswordInput.checked;
  try {
    if (['update-bookmark', 'save-bookmark-copy'].includes(event.submitter?.value)) {
      if (event.submitter.value === 'save-bookmark-copy') input.id = undefined;
      else if (!selected) throw Error('Select a bookmark to update, or use Save as New Bookmark.');
      const entry = await api['save-profile'](input);
      await refresh();
      selected = entry.id;
      byId('update-bookmark').disabled = false;
      renderHosts();
      message.className = '';
      message.textContent = event.submitter.value === 'save-bookmark-copy' ? t('New bookmark created') : t('Bookmark changes saved');
    } else if (event.submitter?.value === 'effective') {
      const output = byId('effective');
      output.textContent = await api['effective-config'](input);
      output.hidden = false;
      byId('close-effective').hidden = false;
    } else {
      const rules = [...byId('auth-rules').querySelectorAll('.auth-rule')].map(row => {
        const [prompt, answer] = row.querySelectorAll('input');
        return { prompt: prompt.value, answer: answer.value };
      });
      if (rules.length) input.pam = true;
      if (splitDraft) {
        const { session, axis } = splitDraft;
        if (!sessions.has(session.id)) throw Error('The split target is no longer open.');
        createSplit(session, axis, input, session.mode === 'sftp' ? 'sftp' : 'ssh', rules, undefined, { password, rememberPassword, fromEditor: true });
        editor.querySelector('[value=ssh]').hidden = false;
        splitDraft = undefined;
        byId('cancel-split-connect').hidden = true;
        editor.querySelector('[value=sftp]').hidden = false;
        byId('editor-title').textContent = t('Connect');
      } else start(input, event.submitter?.value === 'sftp' ? 'sftp' : 'ssh', { rules, password, rememberPassword, fromEditor: true });
      byId('auth-rules').replaceChildren();
    }
  } catch (error) { showError(error); }
});

// The line shown for a failed backup. Known causes have their own sentence; anything else shows the first stderr line.
function backupProblemText(item) {
  switch (item.error) {
    case 'PERMISSION': return t('You don\'t have permission to write in this folder.');
    case 'NO_SPACE': return t('The server is out of disk space.');
    case 'BACKUP_NAME_TAKEN': return t('Too many backups with this name were made in the same second.');
    case 'LINK': return t('Links can\'t be backed up. Back up the original instead.');
    case 'TIMEOUT': return t('Backup took too long and was stopped. Check the folder before retrying.');
    default: return t('Backup failed') + ': ' + (item.detail || item.error);
  }
}
function status(session, value, failed = false) {
  session.status.textContent = t(value);
  session.status.hidden = value === 'Connected' && !failed;
  session.status.classList.toggle('error', failed);
}
function sshConfigHostForSession(session) {
  const input = session.input || {};
  return input.usesAlias ? input.host : String(input.hostname || input.host || '').split('@').at(-1);
}
function showReconnect(session) {
  session.status.replaceChildren(document.createTextNode(t('Disconnected') + ' '));
  if (session.kexNotice) {
    const configure = button(t('Configure SSH…'), () => openSshConfigEditor(session.input.configPath || '', sshConfigHostForSession(session), session.kexSuggestion || ''));
    configure.className = 'inline-action';
    session.status.append(configure, document.createTextNode(' '));
  }
  const retry = button(t('Reconnect'), () => reconnect(session));
  retry.className = 'inline-action';
  session.status.append(retry);
  session.status.hidden = false;
}
function reconnect(session) {
  if (!session.closed || !session.input) return;
  const { pane, tabRecord, mode, input, fileLayout, localDirectory, remoteDirectory } = session;
  api.disconnect(session.id).catch(() => {});
  session.fileLayout?.connections.delete(session);
  session.observer?.disconnect();
  session.terminal?.dispose();
  sessions.delete(session.id);
  refreshTransferBanner();
  // The new session gets a fresh pane in the same place. The old pane still carries listeners bound to the
  // closed session (focus, pointer and drop handlers), and those would activate or move a session that no longer exists.
  const fresh = document.createElement('section');
  pane.replaceWith(fresh);
  // A shared file layout lives in the tab and survives. A layout of its own lived inside the old pane, so it is rebuilt.
  const sharedLayout = fileLayout && fileLayout === tabRecord.fileLayout ? fileLayout : undefined;
  const local = sharedLayout ? localDirectory : fileLayout?.directory ?? localDirectory;
  if (tabRecord.focus === session.id) tabRecord.focus = undefined;
  return start(input, mode, { tabRecord, pane: fresh, fileLayout: sharedLayout, local, remote: remoteDirectory });
}
const tabColors = { red: '#ef626b', orange: '#e68c45', yellow: '#d5a631', green: '#55ab73', blue: '#559cf2', purple: '#a582e5', pink: '#e879a8', cyan: '#48b9c7', indigo: '#7777e8', teal: '#32a995', lime: '#98b94d', brown: '#b17a57' };
function validColor(value) {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : tabColors[value] || '';
}
function pickColor(current, onPick) {
  const dialog = document.createElement('dialog');
  dialog.className = 'color-picker-dialog';
  dialog.dataset.blocking = '';
  const form = document.createElement('form');
  form.method = 'dialog';
  const title = document.createElement('h3');
  title.textContent = 'Choose Color';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = validColor(current) || '#559cf2';
  const actions = document.createElement('div');
  actions.className = 'color-picker-actions';
  const cancel = button(t('Cancel'), () => dialog.close());
  const apply = button(t('Apply'), () => { onPick(input.value); dialog.close(); });
  actions.append(cancel, apply);
  form.append(title, input, actions);
  dialog.append(form);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

async function chooseMenu(entries) {
  const key = await api['context-menu'](entries.map((entry, id) => entry && {
    id, label: entry[0], enabled: entry[2], checked: entry[3],
  }));
  if (key !== null) await entries[key]?.[1]();
}

const tooltip = document.createElement('div');
tooltip.className = 'app-tooltip';
tooltip.hidden = true;
document.body.append(tooltip);
let tooltipTimer;
let tooltipTarget;
function normalizeTooltip(target) {
  if (!(target instanceof Element) || !target.hasAttribute('title')) return;
  const value = target.getAttribute('title');
  if (value) { target.dataset.tooltip = value; if (!target.hasAttribute('aria-description')) target.setAttribute('aria-description', value); }
  target.removeAttribute('title');
}
document.querySelectorAll('[title]').forEach(normalizeTooltip);
new MutationObserver(records => records.forEach(record => {
  if (record.type === 'attributes') normalizeTooltip(record.target);
  else record.addedNodes.forEach(node => {
    if (node instanceof Element) {
      normalizeTooltip(node);
      node.querySelectorAll?.('[title]').forEach(normalizeTooltip);
    }
  });
})).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
function hideTooltip() { clearTimeout(tooltipTimer); tooltip.hidden = true; tooltipTarget = undefined; }
function queueTooltip(target) {
  const message = target?.dataset.tooltip;
  if (!message) return hideTooltip();
  clearTimeout(tooltipTimer);
  tooltipTarget = target;
  tooltipTimer = setTimeout(() => {
    if (!tooltipTarget?.isConnected || tooltipTarget.dataset.tooltip !== message) return hideTooltip();
    tooltip.textContent = message;
    tooltip.hidden = false;
    const bounds = tooltipTarget.getBoundingClientRect();
    const tip = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.max(8, Math.min(innerWidth - tip.width - 8, bounds.left + bounds.width / 2 - tip.width / 2)) + 'px';
    const below = innerHeight - bounds.bottom;
    const above = bounds.top;
    const top = below >= tip.height + 14 || below >= above
      ? bounds.bottom + 6 : bounds.top - tip.height - 6;
    tooltip.style.top = Math.max(8, Math.min(innerHeight - tip.height - 8, top)) + 'px';
  }, 180);
}
document.addEventListener('pointerover', event => {
  const target = event.target.closest?.('[data-tooltip]');
  if (target && !target.contains(event.relatedTarget)) queueTooltip(target);
});
document.addEventListener('pointerout', event => {
  if (tooltipTarget?.contains(event.target) && !tooltipTarget.contains(event.relatedTarget)) hideTooltip();
});
document.addEventListener('focusin', event => queueTooltip(event.target.closest?.('[data-tooltip]')));
document.addEventListener('focusout', hideTooltip);
document.addEventListener('scroll', hideTooltip, true);

function dragStart(event, source) {
  event.stopPropagation();
  draggedTab = source;
  event.dataTransfer.setData('text/plain', 'PromeFTP layout');
  event.dataTransfer.effectAllowed = 'move';
}
function clearLayoutDrag() {
  draggedTab = undefined;
  draggedBookmark = undefined;
  for (const element of document.querySelectorAll('[data-layout-drop]')) delete element.dataset.layoutDrop;
  for (const element of document.querySelectorAll('[data-layout-operation]')) delete element.dataset.layoutOperation;
}
function paneKind(node) {
  const panes = [node, ...node.querySelectorAll('.pane')].filter(item => item.matches('.pane'));
  if (!panes.length) return '';
  const kinds = new Set(panes.map(item => item.matches('.files-pane') ? 'sftp' : 'terminal'));
  return kinds.size === 1 ? [...kinds][0] : '';
}
function canMoveInto(target) {
  if (!draggedTab || !target) return false;
  const sourceRecord = draggedTab.tabRecord || draggedTab.tab;
  // Agent tabs mirror one agent session. Nothing moves into them or out of them.
  if (target.agent || draggedTab.agent || sourceRecord?.agent) return false;
  const source = draggedTab.pane || (sourceRecord.fileLayout
    ? sourceRecord.fileLayout.remotesRoot.firstElementChild : sourceRecord.root.firstElementChild);
  const kind = source && paneKind(source);
  const targetKind = target.mode === 'sftp' ? 'sftp' : 'terminal';
  if (!source || source.contains(target.pane) || kind !== targetKind) return false;
  if (kind === 'sftp' && sourceRecord !== target.tabRecord) return false;
  const count = node => node.matches('.pane') ? 1 : node.querySelectorAll('.pane').length;
  const added = sourceRecord === target.tabRecord ? 0 : count(source);
  return count(target.tabRecord.root) + added <= 20;
}
function attachSplit(target, source, edge) {
  const marker = document.createComment('split');
  target.pane.before(marker);
  const reverse = edge === 'left' || edge === 'top';
  const axis = edge === 'top' || edge === 'bottom' ? 'column' : 'row';
  marker.replaceWith(makeSplit(reverse ? source : target.pane, reverse ? target.pane : source, axis));
}
function removeTabRecord(tab) {
  tabRecords.splice(tabRecords.indexOf(tab), 1);
  tab.root.remove();
}
function detachPane(session) {
  const { pane, tabRecord } = session;
  const parent = pane.parentElement;
  if (!parent.axis) {
    pane.remove();
    removeTabRecord(tabRecord);
    return;
  }
  const sibling = parent.firstElementChild === pane ? parent.lastElementChild : parent.firstElementChild;
  parent.replaceWith(sibling);
  pane.remove();
  if (tabRecord.focus === session.id) tabRecord.focus = sibling.dataset.session || sibling.querySelector('.pane').dataset.session;
}
function moveLayout(target, edge) {
  if (!canMoveInto(target)) return;
  const source = draggedTab;
  clearLayoutDrag();
  let node;
  let focus;
  if (source.pane) {
    node = source.pane;
    focus = source.id;
    detachPane(source);
    source.tabRecord = target.tabRecord;
  } else {
    const record = source.tab;
    node = record.root.firstElementChild;
    focus = record.focus;
    for (const session of sessions.values()) if (session.tabRecord === record) session.tabRecord = target.tabRecord;
    removeTabRecord(record);
  }
  attachSplit(target, node, edge);
  renderTabs();
  activate(focus);
}
function bindLayoutDrop(element, resolveDrop) {
  element.addEventListener('dragover', event => {
    const drop = resolveDrop(event);
    if (!drop) {
      delete element.dataset.layoutDrop;
      delete element.dataset.layoutOperation;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = drop.effect || 'move';
    for (const previous of document.querySelectorAll('[data-layout-drop]')) {
      if (previous !== element) delete previous.dataset.layoutDrop;
    }
    element.dataset.layoutDrop = drop.zone;
    if (drop.operation) element.dataset.layoutOperation = drop.operation;
    else delete element.dataset.layoutOperation;
  });
  element.addEventListener('dragleave', event => {
    if (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget)) {
      delete element.dataset.layoutDrop;
      delete element.dataset.layoutOperation;
    }
  });
  element.addEventListener('drop', event => {
    const drop = resolveDrop(event);
    delete element.dataset.layoutDrop;
    delete element.dataset.layoutOperation;
    if (!drop) return;
    event.preventDefault();
    event.stopPropagation();
    drop.apply();
    clearLayoutDrag();
  });
}
function bookmarkSplitDrop(session, edge) {
  if (!draggedBookmark || !session || session.agent || (session.mode === 'sftp' && !session.tabRecord.fileLayout) ||
      session.tabRecord.root.querySelectorAll('.pane').length >= 20) return;
  const bookmark = draggedBookmark;
  return { zone: edge, effect: 'copy', apply: () => {
    const axis = edge === 'top' || edge === 'bottom' ? 'column' : 'row';
    createSplit(session, axis, bookmark, session.mode === 'sftp' ? 'sftp' : 'ssh', undefined, edge);
  } };
}
function paneDrop(session, event) {
  if (session.agent) return;
  if (!draggedBookmark && !canMoveInto(session)) return;
  const rect = session.pane.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  const edge = [['left', x], ['right', 1 - x], ['top', y], ['bottom', 1 - y]].sort((a, b) => a[1] - b[1])[0][0];
  if (draggedBookmark) return bookmarkSplitDrop(session, edge);
  return { zone: edge, operation: 'move', apply: () => moveLayout(session, edge) };
}

function makeTab(input, mode, options) {
  const element = document.createElement('div');
  element.className = 'tab';
  element.draggable = true;
  const record = {
    element, mode, name: options.name || '',
    label: input.label || input.host, group: options.group || '', groupColor: options.groupColor || '', color: options.color || '',
    agent: options.agent === true,
  };
  // An agent tab already says AGENT in its label, so it has no mode suffix.
  const modeSuffix = record.agent ? '' : ' · ' + mode.toUpperCase();
  const select = button(t(''), () => activate(record.focus));
  select.setAttribute('role', 'tab');
  const caption = document.createElement('span');
  const modeIcon = icon(mode === 'sftp' ? 'folder' : 'terminal');
  modeIcon.setAttribute('aria-hidden', 'true');
  select.setAttribute('aria-label', (record.label || mode.toUpperCase()) + modeSuffix);
  select.append(modeIcon, caption);
  function updateCaption() {
    caption.textContent = record.name || record.label;
    select.title = caption.textContent + modeSuffix;
    const tint = validColor(record.color);
    element.style.setProperty('--tab-color', tint || 'transparent');
    record.root?.style.setProperty('--pane-tint', tint || 'transparent');
  }
  async function duplicateTab() {
    const root = record.fileLayout?.remotesRoot || record.root;
    const entries = [];
    let focus = null;
    function encode(node) {
      if (node.axis) return { axis: node.axis, ratio: node.ratio, first: encode(node.firstElementChild), second: encode(node.lastElementChild) };
      const session = sessions.get(node.dataset.session);
      if (!session) throw Error('A pane in this tab has closed.');
      const index = entries.length;
      entries.push({ mode: session.mode, input: session.input, local: session.fileLayout?.local?.directory ?? session.localDirectory,
        remote: session.remoteDirectory });
      if (session.id === record.focus) focus = index;
      return index;
    }
    const firstPane = root.firstElementChild;
    if (!firstPane) return;
    const tree = encode(firstPane);
    restoreWorkspace({ tabs: entries, panes: [{ name: record.name, group: record.group, groupColor: record.groupColor, color: record.color,
      tree, focus, localRatio: record.fileLayout?.localRatio, localSplit: record.fileLayout?.localSplitState?.() }], active: focus });
  }
  updateCaption();
  const menu = () => chooseMenu([
    ['Rename Tab…', async () => {
      const name = await askName(record.name || record.label, 'Tab name (blank to reset)', true);
      if (name !== undefined) { record.name = name.trim().slice(0, 80); updateCaption(); select.blur(); }
    }],
    ...(record.agent ? [] : [[t('Duplicate Tab'), () => duplicateTab().catch(showError)]]),
    ['Set Group…', async () => {
      const group = await askName(record.group, 'Tab group (blank to ungroup)', true);
      if (group !== undefined) {
        record.group = group.trim().slice(0, 40);
        record.groupColor = record.group ? tabRecords.find(tab => tab !== record && tab.group === record.group)?.groupColor || '' : '';
        renderTabs();
      }
    }],
    ...(record.group ? [['Group Color…', () => pickColor(record.groupColor, color => {
      for (const tab of tabRecords) if (tab.group === record.group) tab.groupColor = color;
      renderTabs();
    })]] : []),
    null,
    ['More Colors…', () => pickColor(record.color, color => { record.color = color; updateCaption(); })],
    ...['', ...Object.keys(tabColors)].map(color => [
      color ? color[0].toUpperCase() + color.slice(1) : 'Default Color',
      () => { record.color = color; updateCaption(); }, true, record.color === color,
    ]),
    null,
    ['Close Tab', () => closeTab(record)],
  ]).catch(showError);
  element.addEventListener('contextmenu', event => { event.preventDefault(); menu(); });
  const closeButton = iconButton('close', 'Close tab', () => closeTab(record));
  closeButton.classList.add('tab-close');
  element.append(select, closeButton);
  element.addEventListener('dragstart', event => dragStart(event, { tab: record }));
  element.addEventListener('dragend', clearLayoutDrag);
  bindLayoutDrop(element, event => {
    const source = draggedTab?.tab;
    const target = sessions.get(record.focus);
    const bounds = element.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    if (draggedBookmark) return bookmarkSplitDrop(target, y < 0.3 ? 'top' : y > 0.7 ? 'bottom' : x < 0.3 ? 'left' : 'right');
    if (!draggedTab || source === record) return;
    if (source && (x < 0.22 || x > 0.78)) {
      return { zone: x < 0.22 ? 'left' : 'right', apply: () => {
        source.group = record.group;
        source.groupColor = record.groupColor;
        tabRecords.splice(tabRecords.indexOf(source), 1);
        tabRecords.splice(tabRecords.indexOf(record) + Number(x > 0.78), 0, source);
        renderTabs();
      } };
    }
    if (canMoveInto(target) && (!source || y < 0.3 || y > 0.7)) {
      const edge = y < 0.3 ? 'top' : y > 0.7 ? 'bottom' : 'right';
      return { zone: edge, operation: 'move', apply: () => moveLayout(target, edge) };
    }
    if (source) return { zone: 'group', apply: () => {
      const names = new Set(tabRecords.map(tab => tab.group));
      if (!record.group) {
        const base = (record.name || record.label || 'Tabs').slice(0, 34);
        let group = base;
        for (let i = 2; names.has(group); i++) group = base + ' ' + i;
        record.group = group;
      }
      source.group = record.group;
      source.groupColor = record.groupColor;
      renderTabs();
    } };
  });
  record.root = document.createElement('div');
  record.root.className = 'tab-content';
  updateCaption();
  workspace.append(record.root);
  tabRecords.push(record);
  return record;
}

function closeSession(session) {
  api.disconnect(session.id).catch(() => {});
  sessions.delete(session.id);
  refreshTransferBanner();
  session.fileLayout?.connections.delete(session);
  session.fileLayout?.refreshLocalControls?.();
  session.observer?.disconnect();
  session.terminal?.dispose();
  session.pane.remove();
}

function closeTab(record) {
  const wasActive = sessions.get(active)?.tabRecord === record;
  for (const session of sessions.values()) if (session.tabRecord === record) closeSession(session);
  tabRecords.splice(tabRecords.indexOf(record), 1);
  record.root.remove();
  renderTabs();
  if (wasActive) activate(tabRecords.at(-1)?.focus);
}

// Keep in sync with MAX_LOCAL_PANES in state-rules.cjs
const MAX_LOCAL_PANES = 6;
function makeSplit(first, second, axis, initial = 0.5) {
  const node = document.createElement('div');
  node.className = 'split-node ' + axis;
  const divider = document.createElement('button');
  divider.type = 'button';
  divider.className = 'split-divider';
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-label', 'Resize panes');
  divider.setAttribute('aria-orientation', axis === 'row' ? 'vertical' : 'horizontal');
  divider.setAttribute('aria-valuemin', '10');
  divider.setAttribute('aria-valuemax', '90');
  function resize(value) {
    node.ratio = Math.max(0.1, Math.min(0.9, value));
    node.style.setProperty('--first', node.ratio * 100 + '%');
    divider.setAttribute('aria-valuenow', String(Math.round(node.ratio * 100)));
  }
  divider.addEventListener('pointerdown', event => divider.setPointerCapture(event.pointerId));
  divider.addEventListener('pointermove', event => {
    if (!divider.hasPointerCapture(event.pointerId)) return;
    const rect = node.getBoundingClientRect();
    resize(axis === 'row' ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height);
  });
  divider.addEventListener('keydown', event => {
    const keys = axis === 'row' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const index = keys.indexOf(event.key);
    if (index < 0) return;
    event.preventDefault();
    resize(node.ratio + (index ? 0.025 : -0.025));
  });
  node.axis = axis;
  node.append(first, divider, second);
  resize(initial);
  return node;
}

function createSplit(session, axis, input, mode, rules, edge = axis === 'row' ? 'right' : 'bottom', credentials = {}) {
  if (!sessions.has(session.id) || session.tabRecord.root.querySelectorAll('.pane').length >= 20) return;
  const id = start(input, mode, { tabRecord: session.tabRecord, deferActivation: true, rules, ...credentials });
  attachSplit(session, sessions.get(id).pane, edge);
  activate(id);
}

let splitDraft;
const splitDialog = byId('split-host-dialog');
keyboardChoices(splitDialog, byId('split-host-search'), byId('split-host-list'));
byId('close-split-host').addEventListener('click', () => splitDialog.close());
byId('cancel-split-connect').addEventListener('click', () => {
  const target = splitDraft?.session;
  edit();
  if (target && sessions.has(target.id)) activate(target.id);
});
async function splitSession(session, axis) {
  if (session.agent || !sessions.has(session.id) || session.tabRecord.root.querySelectorAll('.pane').length >= 20 || splitDialog.open) return;
  const list = byId('split-host-list');
  const search = byId('split-host-search');
  const configPath = session.input.configPath || '';
  const aliases = await api['config-aliases'](configPath).catch(() => []);
  if (!sessions.has(session.id) || splitDialog.open) return;
  const mode = session.mode === 'sftp' ? 'sftp' : 'ssh';
  function newConnection() {
    if (splitDialog.open) splitDialog.close();
    edit(configPath ? { configPath } : undefined, mode, { session, axis });
    destinationField.focus();
  }
  if (!profiles.length && !aliases.length) { newConnection(); return; }
  const addConnection = button(t('New Connection…'), newConnection);
  addConnection.className = 'new-split-connection';
  addConnection.dataset.keyboardSecondary = 'true';
  list.replaceChildren(addConnection);
  for (const profile of profiles) {
    const item = button(profile.label, () => { splitDialog.close(); createSplit(session, axis, profile, mode); });
    item.title = profile.hostname || profile.host;
    item.dataset.search = [profile.label, profile.host, profile.hostname, profile.username, profile.group].filter(Boolean).join(' ');
    list.append(item);
  }
  const aliasItems = new Map();
  const splitAliasDetails = new Map();
  for (const alias of aliases) {
    const item = button(alias, () => {
      splitDialog.close();
      createSplit(session, axis, { host: alias, configPath, usesAlias: true }, mode);
    });
    item.title = 'OpenSSH alias';
    item.dataset.search = alias;
    item.dataset.alias = alias;
    aliasItems.set(alias, item);
    list.append(item);
  }
  if (session.mode === 'local') list.append(button(t('Local Shell'), () => {
    splitDialog.close();
    createSplit(session, axis, session.input, 'local');
  }));
  const empty = document.createElement('p');
  empty.textContent = t('No matching hosts');
  empty.hidden = true;
  list.append(empty);
  search.value = '';
  search.oninput = () => {
    const query = search.value.trim().toLowerCase();
    const choices = [...list.querySelectorAll('[data-search]')];
    for (const item of choices) {
      item.hidden = item.dataset.alias !== undefined
        ? !aliasMatchesSearch(query, item.dataset.alias, splitAliasDetails.get(item.dataset.alias))
        : !item.dataset.search.toLowerCase().includes(query);
    }
    empty.hidden = choices.some(item => !item.hidden);
  };
  splitDialog.showModal();
  search.focus();
  // Details fill in after the dialog is shown. Items from an earlier dialog are no longer connected and are skipped.
  if (aliases.length) {
    api['config-aliases'](configPath, aliases).then(details => {
      let updated = false;
      for (const detail of details) {
        const item = aliasItems.get(detail.name);
        if (!item?.isConnected) continue;
        splitAliasDetails.set(detail.name, detail);
        if (detail.hostname && detail.hostname.toLowerCase() !== detail.name.toLowerCase()) {
          item.title = detail.hostname;
          // The tooltip script sets aria-description only once, from the first title, so it is updated here too.
          item.setAttribute('aria-description', detail.hostname);
        }
        updated = true;
      }
      if (updated && search.value.trim()) search.oninput();
    }, () => {});
  }
}
function bookmarkTabDrop() {
  const bookmark = draggedBookmark;
  if (!bookmark) return;
  return { zone: 'new-tab', effect: 'copy', apply: () => start(bookmark, 'ssh') };
}
bindLayoutDrop(workspace, event => editor.contains(event.target) ? bookmarkTabDrop() : undefined);
bindLayoutDrop(tabs, event => {
  if (draggedBookmark && !event.target.closest('.tab')) return bookmarkTabDrop();
  const source = draggedTab;
  if (!source?.pane || source.mode === 'sftp' || event.target.closest('.tab') || !source.pane.parentElement?.axis) return;
  return { zone: 'group', apply: () => {
    detachPane(source);
    source.tabRecord = makeTab(source.input, source.mode, {});
    source.tabRecord.focus = source.id;
    source.tabRecord.root.append(source.pane);
    renderTabs();
    activate(source.id);
  } };
});

function closePane(session) {
  const parent = session.pane.parentElement;
  if (!parent?.axis) { closeTab(session.tabRecord); return; }
  detachPane(session);
  closeSession(session);
  if (active === session.id) activate(session.tabRecord.focus);
}

function start(input, mode, options = {}) {
  const id = options.id || crypto.randomUUID();
  const label = options.agent ? input.label : (input.label || input.host) + ' · ' + mode.toUpperCase();
  const tabRecord = options.tabRecord || makeTab(input, mode, options);
  if (!options.tabRecord) includeTabInSelectedGroup(tabRecord);
  const pane = options.pane || document.createElement('section');
  pane.className = 'pane ' + (mode === 'sftp' ? 'files-pane' : 'terminal-pane');
  const line = document.createElement('p');
  line.className = 'status';
  line.setAttribute('role', 'status');
  pane.append(line);
  pane.dataset.session = id;
  let fileLayout;
  if (options.pane) {
    fileLayout = options.fileLayout;
  } else if (mode === 'sftp' && !options.standaloneFiles) {
    tabRecord.fileLayout ??= makeFileLayout(tabRecord.root, options.local, tabRecord.localRatio);
    fileLayout = tabRecord.fileLayout;
    fileLayout.remotesRoot.append(pane);
  } else tabRecord.root.append(pane);
  const session = {
    id, tabRecord, pane, status: line, ready: false, input, mode, fileLayout,
    localDirectory: options.local, remoteDirectory: options.remote, autoReplies: [],
    agent: options.agent ? { client: options.agent, mode: options.agentMode, ready: false } : undefined,
  };
  const auth = document.createElement('div');
  auth.className = 'auth-requests';
  pane.append(auth);
  session.auth = auth;
  session.prompts = new Map();
  sessions.set(id, session);
  bindLayoutDrop(pane, event => paneDrop(session, event));
  tabRecord.focus ??= id;
  if (!options.tabRecord) renderTabs();
  status(session, mode === 'local' ? 'Starting…' : 'Connecting…');
  setupTerminal(session, label);
  if (mode === 'sftp') setupFiles(session);
  if (!options.deferActivation) activate(id);
  // An agent tab shows a session the agent already opened. There is nothing to connect.
  if (options.agent) {
    session.status.hidden = true;
    return id;
  }
  api.connect(id, input, mode, { cols: session.terminal?.cols, rows: session.terminal?.rows }, options.rules || [],
    options.password || '', options.rememberPassword === true).then(() => {
    if (!sessions.has(id)) return api.disconnect(id);
  }).catch(error => {
    showPasswordResult(id, 'Password was not saved. Connection did not complete.');
    status(session, error.message, true);
  });
  return id;
}
// Another window saved bookmarks, workspaces or connection history: reload the lists this window shows.
function applySharedStateChange(keys) {
  if (!Array.isArray(keys)) return;
  if (keys.includes('profiles') || keys.includes('bookmarkFolders')) refresh().catch(showError);
  if (keys.includes('connectionHistory') && !historyPanel.hidden) refreshHistory();
  if (keys.includes('workspaces')) {
    refreshSidebarWorkspaces().catch(() => {});
    if (workspaceDialog.open) renderWorkspaces().catch(() => {});
  }
}
api.onSession(({ id, event, value }) => {
  if (event === 'state-changed' && id === '*') { applySharedStateChange(value); return; }
  if (event === 'history-changed' && !historyPanel.hidden) refreshHistory();
  const session = sessions.get(id);
  if (event === 'transfer-jobs') { renderTransferQueue(value); return; }
  if (event === 'compare-progress' && value.requestId === activeCompareRequest) { byId('compare-progress-count').textContent = `${value.count} ${t('items scanned')}`; return; }
  if (event === 'transfer-conflict-dismissed') { dismissTransferConflict(value); return; }
  if (event === 'transfer-conflict') {
    presentTransferConflict(value); return;
  }
  if (event === 'sftp-favorites') session?.applyFavorites?.(value.scope, value.items);
  if (event === 'agent-open') { startAgentView(id, value); return; }
  if (!session) return;
  if (session.agent && event.startsWith('agent-')) { showAgentEvent(session, event, value); return; }
  if (event === 'prompt') {
    const form = document.createElement('form');
    const label = document.createElement('label');
    label.textContent = value.prompt || 'Authentication';
    if (value.repeated) {
      const retry = document.createElement('small');
      retry.textContent = t('Already sent automatically. Check the answer and retry.');
      label.append(retry);
    }
    const field = document.createElement('input');
    field.type = value.hint === 'confirm' ? 'text' : 'password';
    field.autocomplete = 'off';
    field.value = value.savedAnswer ?? '';
    field.id = 'auth-' + value.id;
    label.htmlFor = field.id;
    const controls = document.createElement('div');
    controls.className = 'auth-controls';
    const remember = document.createElement('input');
    remember.type = 'checkbox';
    remember.checked = value.rememberChecked;
    if (value.canRemember) {
      const save = document.createElement('label');
      save.className = 'check remember-answer';
      save.title = 'Save reusable answers on this Mac. Leave off for one-time codes.';
      save.append(remember, 'Save answer');
      controls.append(save);
    }
    const actions = document.createElement('div');
    actions.className = 'auth-actions';
    const submit = document.createElement('button');
    submit.textContent = t('Reply');
    actions.append(submit, button(t('Cancel'), () => api.disconnect(id).then(() => {
      session.closed = true;
      session.auth.replaceChildren();
      session.prompts.clear();
      status(session, 'Canceled');
    }).catch(error => status(session, error.message, true))));
    controls.append(actions);
    form.append(label, value.hint === 'confirm' ? field : passwordField(field), controls);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const answer = field.value;
      field.value = '';
      form.remove();
      session.prompts.delete(value.id);
      try {
        await api['auth-answer'](id, value.id, answer, value.canRemember ? remember.checked : undefined);
      }
      catch (error) { status(session, error.message, true); }
    });
    session.prompts.set(value.id, form);
    session.auth.append(form);
    if (active === id) field.focus();
  }
  if (event === 'prompt-clear') {
    session.prompts.get(value)?.remove();
    session.prompts.delete(value);
  }
  if (event === 'auth-info') status(session, value);
  if (event === 'auth-storage-error' || event === 'history-error') status(session, value, true);
  if (event === 'auto-answer') {
    session.autoReplies.unshift({ ...value, time: Date.now() });
    if (session.autoReplies.length > 50) session.autoReplies.pop();
    session.authActivityButton.hidden = false;
    session.authActivityButton.title = t('Authentication activity') + ' · ' + session.autoReplies.length;
    if (authActivityDialog.open && activitySession === session) renderAuthActivity(session);
    status(session, 'Replied automatically');
  }
  if (event === 'terminal-trigger') {
    const matches = session.triggerMatches ??= [];
    matches.unshift({ ...value, time: Date.now() });
    if (matches.length > 50) matches.pop();
    if (triggerDialog.open && triggerSession === session) renderTriggerActivity();
    if (value.action === 'ask') promptForTrigger(session, value);
  }
  if (event === 'data') {
    session.terminal?.write(value);
    if (session.ready && session.mode !== 'sftp') session.log = ((session.log || '') + value).slice(-2_000_000);
    if (!session.kexNotice && session.mode !== 'local') {
      session.kexTail = ((session.kexTail || '') + value).slice(-4096);
      const visible = session.kexTail.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
      const match = /no matching key exchange method found[\s\S]{0,800}?Their offer:\s*([^\r\n]+)/i.exec(visible);
      if (match) {
        session.kexNotice = true;
        const offered = match[1].split(/[\s,]+/).filter(Boolean);
        const suggested = ['diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group1-sha1']
          .find(algorithm => offered.includes(algorithm));
        session.kexSuggestion = suggested || '';
        session.status.replaceChildren(document.createTextNode(t('Legacy key exchange offered') + ' '));
        const configure = button(t('Configure SSH…'), () => openSshConfigEditor(session.input.configPath || '', sshConfigHostForSession(session), session.kexSuggestion));
        configure.className = 'inline-action';
        session.status.append(configure);
        session.status.hidden = false;
      }
    }
  }
  if (event === 'ready') {
    session.ready = true;
    refreshTransferBanner();
    status(session, 'Connected');
    if (session.mode === 'sftp') {
      session.area.hidden = true;
      session.listing.hidden = false;
      session.toolbar.hidden = false;
      session.refreshFileControls?.();
    } else api.resize(id, session.terminal.cols, session.terminal.rows).catch(() => {});
    session.load?.(session.remoteDirectory || '.');
  }
  if (event === 'error') status(session, value, true);
  if (event === 'closed') {
    session.closed = true;
    session.auth.replaceChildren();
    session.prompts.clear();
    session.ready = false;
    refreshTransferBanner();
    if (session.mode === 'ssh' || session.mode === 'sftp') showReconnect(session);
    else status(session, 'Disconnected');
    session.refreshFileControls?.();
  }
});

// A terminal tab for an agent session (SSH or SFTP). Its id is the main process view id. The tab does not take focus.
function startAgentView(id, value) {
  if (sessions.has(id)) return;
  const name = agentText(value?.label) || 'SSH';
  const mode = value?.mode === 'sftp' ? 'sftp' : 'ssh';
  start({ label: name + ' · AGENT' + (mode === 'sftp' ? ' · SFTP' : ''), host: name }, 'ssh',
    { id, agent: agentText(value?.client) || t('Agent'), agentMode: mode, deferActivation: true });
  const session = sessions.get(id);
  // What the agent may do, written first so the tab says what the session is for before any status line.
  session?.terminal.write(agentNote(t('Client') + ': ' + (agentText(value?.client) || t('Agent')) + ' · ' + t('Bookmark') + ': ' +
    agentText(value?.label) + ' (' + (agentText(value?.user) ? agentText(value.user) + '@' : '') + agentText(value?.host) + ') · ' +
    t('Mode') + ': ' + mode.toUpperCase()) + agentNote(t('Access') + ': ' + agentAccessText(value?.access)));
  // The tab is added without being selected, so it stays hidden and shows a dot until the user opens it.
  const record = session?.tabRecord;
  if (record) {
    record.root.hidden = true;
    record.element.classList.add('agent-unseen');
  }
}
// A line in an agent tab, dimmed and prefixed so it reads apart from the user's shell output.
const agentNote = text => '\r\n\x1b[2m[agent] ' + text + '\x1b[0m\r\n';
function agentAccessText(access = {}) {
  const parts = [];
  if (access.sftp) parts.push(t('SFTP browsing') + (agentText(access.root) ? ' ' + agentText(access.root) : '') + (access.download ? ' · ' + t('downloads') : ''));
  if (access.task) parts.push(t('SSH task') + ' ' + agentText(access.task));
  if (access.commandApproval) parts.push(t('SSH commands') + ' · ' + (access.commandAutoApprove ? t('auto-approved') : t('approval')));
  if (access.savedAuth) parts.push(t('saved authentication'));
  if (access.pam) parts.push(access.pam + ' ' + t('PAM rules'));
  if (access.triggers) parts.push(access.triggers + ' ' + t('triggers'));
  return parts.join(' · ') || t('No access');
}
// The user's own shell on an SSH agent tab opens once the session is ready and the tab is on screen, one time only.
// SFTP sessions have no shell.
function requestAgentShell(session) {
  if (!session.agent || session.agent.mode !== 'ssh' || !session.agent.ready || session.shellRequested || session.closed ||
      session.area.hidden || !(session.terminal.cols > 0)) return;
  session.shellRequested = true;
  api.resize(session.id, session.terminal.cols, session.terminal.rows).catch(() => {});
}
// Text from the agent or the server is shown as plain text: no control characters.
const agentText = value => String(value ?? '').replace(/[\p{C}]/gu, '');
const agentOutputText = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '').replace(/\r?\n/g, '\r\n');
function agentEndText(reason) {
  return ({
    REMOTE_CLOSED: t('The server closed the connection'), IDLE_TIMEOUT: t('Idle for 10 minutes'), TIMEOUT: t('A request took too long'),
    CLIENT_CLOSED: t('The agent closed the session'), PERMISSION_CHANGED: t('Agent permissions changed'),
    SERVICE_DISABLED: t('Agent access turned off'), SERVICE_ERROR: t('Agent service stopped'),
    USER_CLOSED: t('You closed this tab'), AUTH_TIMEOUT: t('Authentication was not finished in time'),
    USER_CANCELLED: t('Authentication was cancelled'),
  })[reason] || agentText(reason);
}
function showAgentEvent(session, event, value) {
  const terminal = session.terminal;
  const client = session.agent.client;
  if (event === 'agent-approval') terminal.write('\r\n\x1b[33m[agent] ' + t('waiting for approval') + ': ' + agentText(value.command) + '\x1b[0m\r\n');
  if (event === 'agent-command') terminal.write('\r\n\x1b[1;35m[agent ' + agentText(client) + '] $ ' + agentText(value.command) + '\x1b[0m\r\n');
  if (event === 'agent-output') {
    const text = agentOutputText(value.text);
    terminal.write(value.stream === 'stderr' ? '\x1b[31m' + text + '\x1b[0m' : text);
  }
  if (event === 'agent-result') {
    terminal.write('\r\n\x1b[2m[agent] exit ' + (value.exitCode ?? '-') + (value.signal ? ' signal ' + agentText(value.signal) : '') +
      (value.truncated ? ' truncated' : '') + '\x1b[0m\r\n');
  }
  if (event === 'agent-failed') {
    const text = value.code === 'USER_DENIED' ? t('denied by user') : value.code === 'TIMEOUT' ? t('timed out') : agentText(value.code);
    terminal.write('\x1b[31m[agent] ' + text + '\x1b[0m\r\n');
  }
  if (event === 'agent-shell-closed') {
    session.shellEnded = true;
    status(session, t('Shell closed. The agent session stays open.'));
  }
  if (event === 'agent-status') {
    if (value?.status === 'ready') {
      session.agent.ready = true;
      terminal.write(agentNote(t('Connected') + (agentText(value.endpoint) ? ': ' + agentText(value.endpoint) : '')));
      requestAgentShell(session);
    } else if (value?.status === 'waiting_for_user') {
      terminal.write(agentNote(t('Waiting for an authentication answer. Answer it in Preferences → Authentication requests.') +
        (agentText(value.prompt).trim() ? ' ' + agentText(value.prompt).trim() : '')));
    } else if (value?.status === 'connecting') {
      terminal.write(agentNote(t('connecting…')));
    }
  }
  if (event === 'agent-auth') {
    terminal.write(agentNote(t('Signed in with a saved') + ' ' + (value?.how === 'saved-password' ? t('password') : t('PAM answer'))));
  }
  if (event === 'agent-hostkey') {
    terminal.write(agentNote(t('Host key') + ' ' + agentText(value?.fingerprint) + ' (' + agentText(value?.host) + ') ' +
      (value?.trust === 'automatic' ? t('trusted automatically') : t('trusted by you'))));
  }
  if (event === 'agent-sftp') {
    const operation = agentText(value?.operation).replace(/^sftp\./, '');
    const result = value?.ok
      ? [Number.isInteger(value.count) ? value.count + ' ' + t('items') + (value.truncated ? '+' : '') : '',
         Number.isInteger(value.bytes) ? value.bytes + ' B' : ''].filter(Boolean).join(' · ')
      : t('failed') + ': ' + agentText(value?.code);
    terminal.write(agentNote('SFTP ' + operation + ' ' + agentText(value?.path) + (result ? ' · ' + result : '')));
  }
  if (event === 'agent-closed') {
    session.closed = true;
    session.ready = false;
    const text = t('Agent session ended') + ': ' + agentEndText(value?.reason);
    terminal.write('\r\n\x1b[2m[agent] ' + text + '\x1b[0m\r\n');
    status(session, text, true);
  }
}

function terminalOptions() {
  const { font, size, scrollback, optionMeta } = terminalPreferences;
  return {
    fontFamily: terminalFont(font),
    fontSize: size, scrollback: terminalPreferences.unlimited ? Infinity : scrollback, macOptionIsMeta: optionMeta,
  };
}
function openPreferences(page = 'general') {
  return api['open-preferences'](page, terminalPreferences).catch(showError);
}
byId('terminal-preferences').addEventListener('click', () => openPreferences());
byId('rail-pam').addEventListener('click', () => openPreferences('authentication'));
function applyPreferences(settings) {
  setLocale(settings.locale);
  if (!settings.terminal) return;
  terminalPreferences = settings.terminal;
  syncTerminalTransparency();
  localStorage.setItem('terminal-preferences', JSON.stringify(terminalPreferences));
  for (const session of sessions.values()) {
    if (!session.terminal) continue;
    session.terminal.options = terminalOptions();
    session.terminal.options.theme = terminalTheme(session.pane);
    if (session.pane.getClientRects().length && !session.area.hidden) session.fit.fit();
  }
}
api.onPreferences(applyPreferences);
api['preferences-data']().then(applyPreferences).catch(showError);

const authActivityDialog = byId('auth-activity-dialog');
let activitySession;
function renderAuthActivity(session) {
  const list = byId('auth-activity-list');
  list.replaceChildren(...session.autoReplies.map(event => {
    const item = document.createElement('li');
    const detail = document.createElement('small');
    detail.textContent = new Date(event.time).toLocaleTimeString() + ' · ' + event.source;
    const question = document.createElement('div');
    question.textContent = event.question;
    item.append(detail, question);
    return item;
  }));
}
byId('close-auth-activity').addEventListener('click', () => authActivityDialog.close());
authActivityDialog.addEventListener('close', () => { activitySession = undefined; });
function authActivityButton(session) {
  const control = iconButton('history', 'Authentication activity', () => {
    activitySession = session;
    renderAuthActivity(session);
    if (!authActivityDialog.open) authActivityDialog.showModal();
  });
  control.hidden = true;
  session.authActivityButton = control;
  return control;
}

const darkAppearance = matchMedia('(prefers-color-scheme: dark)');
function terminalTheme(pane) {
  const dark = darkAppearance.matches;
  const background = getComputedStyle(pane).getPropertyValue('--terminal').trim();
  const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(background);
  const opacity = Math.max(55, Math.min(100, terminalPreferences.opacity ?? 100)) / 100;
  const terminalBackground = opacity === 1 || !rgb ? background
    : `rgba(${parseInt(rgb[1], 16)}, ${parseInt(rgb[2], 16)}, ${parseInt(rgb[3], 16)}, ${opacity})`;
  return {
    background: terminalBackground,
    foreground: dark ? '#e8e8e8' : '#25272b', cursor: dark ? '#d9d9d9' : '#25272b',
    selectionBackground: dark ? '#526780' : '#b9d7fa',
    scrollbarSliderBackground: '#64697499', scrollbarSliderHoverBackground: '#858b98cc',
    ...(dark ? {
      black: '#202227', red: '#ff777e', green: '#a4ce8f', yellow: '#e4ca85', blue: '#88aff2',
      magenta: '#cda5e9', cyan: '#8dc8cf', white: '#e5e5e8',
      brightBlack: '#6b6e78', brightRed: '#ff949a', brightGreen: '#b6dfa4', brightYellow: '#f2d991',
      brightBlue: '#a2c3ff', brightMagenta: '#e2b8ff', brightCyan: '#a6e1e6', brightWhite: '#ffffff',
    } : {
      black: '#25272b', red: '#ad2b3f', green: '#386c31', yellow: '#84600a', blue: '#245c9b',
      magenta: '#814793', cyan: '#28737b', white: '#595d66',
      brightBlack: '#656b74', brightRed: '#bd3048', brightGreen: '#3b7438', brightYellow: '#886313',
      brightBlue: '#245c9b', brightMagenta: '#864a99', brightCyan: '#266f77', brightWhite: '#32363e',
    }),
  };
}
darkAppearance.addEventListener('change', () => {
  for (const session of sessions.values()) {
    if (session.terminal) session.terminal.options.theme = terminalTheme(session.pane);
  }
});

function setupTerminal(session, label) {
  const { id, pane, mode } = session;
  const openLink = (event, uri) => {
    if (event.metaKey) api['open-link'](uri).catch(error => status(session, error.message, true));
  };
  const terminal = new Terminal({
    ...terminalOptions(), allowTransparency: true, allowProposedApi: true, cursorBlink: true, cursorStyle: 'block', lineHeight: 1.18,
    overviewRuler: { width: 5 },
    linkHandler: { activate: openLink },
    theme: terminalTheme(pane),
  });
  const fit = new FitAddon.FitAddon();
  const search = new SearchAddon.SearchAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(search);
  terminal.loadAddon(new WebLinksAddon.WebLinksAddon(openLink));
  terminal.loadAddon(new Unicode11Addon.Unicode11Addon());
  terminal.unicode.activeVersion = '11';
  const area = document.createElement('div');
  area.className = 'terminal-area';
  const markers = [];
  terminal.parser.registerOscHandler(133, data => {
    if (data.split(';')[0] !== 'A' || terminal.buffer.active.type !== 'normal') return false;
    const marker = terminal.registerMarker();
    if (marker) {
      markers.push(marker);
      if (markers.length > 2000) markers.shift().dispose();
    }
    return true;
  });
  function jump(direction) {
    const line = terminal.buffer.active.viewportY;
    const candidates = markers.filter(marker => !marker.isDisposed);
    const marker = direction < 0 ? candidates.findLast(marker => marker.line < line)
      : candidates.find(marker => marker.line > line);
    if (marker) terminal.scrollToLine(marker.line);
    else if (direction > 0) terminal.scrollToBottom();
  }
  const find = document.createElement('form');
  find.className = 'terminal-find';
  find.hidden = true;
  const field = document.createElement('input');
  field.type = 'search';
  field.placeholder = 'Find in terminal';
  field.setAttribute('aria-label', 'Find in terminal');
  function searchFor(previous, incremental = false) {
    if (!field.value) search.clearDecorations();
    else search[previous ? 'findPrevious' : 'findNext'](field.value, {
      incremental, decorations: {
        matchBackground: '#795d28', matchBorder: '#a88434', matchOverviewRuler: '#a88434',
        activeMatchBackground: '#b48126', activeMatchBorder: '#ffcb72', activeMatchColorOverviewRuler: '#ffcb72',
      },
    });
  }
  function hideSearch() {
    find.hidden = true;
    search.clearDecorations();
    terminal.clearSelection();
    terminal.focus();
  }
  function showSearch() {
    if (area.hidden) return;
    find.hidden = false;
    field.focus();
    field.select();
  }
  field.addEventListener('input', () => searchFor(false, true));
  find.addEventListener('submit', event => { event.preventDefault(); searchFor(false); });
  field.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); hideSearch(); }
    if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); searchFor(true); }
  });
  find.append(field, iconButton('up', 'Previous match', () => searchFor(true)),
    iconButton('chevronDown', 'Next match', () => searchFor(false)), iconButton('close', 'Close find', hideSearch));
  if (mode !== 'sftp') {
    const tools = document.createElement('div');
    tools.className = 'session-tools';
    const grip = iconButton('grip', 'Drag pane', () => {});
    grip.draggable = true;
    grip.addEventListener('dragstart', event => dragStart(event, session));
    grip.addEventListener('dragend', clearLayoutDrag);
    const leading = document.createElement('div');
    leading.className = 'session-tools-leading';
    leading.append(grip, authActivityButton(session));
    const name = document.createElement('span');
    name.className = 'terminal-session-name';
    name.textContent = session.input.label || session.input.host;
    name.title = name.textContent;
    const badge = document.createElement('span');
    badge.className = 'agent-badge';
    badge.hidden = !session.agent;
    badge.textContent = session.agent ? t('Agent') + ': ' + session.agent.client : '';
    const actions = document.createElement('div');
    actions.className = 'session-tools-actions';
    if (!session.agent) actions.append(iconButton('splitRight', 'Split right (⌘D)', () => splitSession(session, 'row')),
      iconButton('splitDown', 'Split down (⌘⇧D)', () => splitSession(session, 'column')));
    actions.append(iconButton('search', 'Find (⌘F)', showSearch),
      iconButton('code', 'Snippets (⌘P)', () => showSnippets(session)), iconButton('trigger', 'Terminal Triggers', () => showTriggers(session)),
    iconButton('download', 'Export session log', async () => {
      try { await api['export-log'](label, session.log || ''); }
      catch (error) { status(session, error.message, true); }
    }));
    actions.append(iconButton('close', 'Close pane', () => closePane(session)));
    leading.append(badge);
    tools.append(leading, name, actions);
    pane.append(tools);
    pane.append(find);
  }
  pane.append(area);
  const surface = document.createElement('div');
  surface.className = 'terminal-surface';
  area.append(surface);
  terminal.open(surface);
  if (mode !== 'sftp') {
    function selectPane() {
      if (active !== id && sessions.get(id) === session) activate(id, false);
    }
    pane.addEventListener('focusin', selectPane);
    area.addEventListener('contextmenu', event => {
      event.preventDefault();
      selectPane();
      const selectedText = terminal.getSelection();
      chooseMenu([
        ['Copy', () => api['write-clipboard'](terminal.getSelection()), terminal.hasSelection()],
        ['Paste', async () => terminal.paste(await api['read-clipboard']()), !session.closed],
        ['Select All', () => terminal.selectAll()],
        [selectedText.trim() ? t('Create Trigger from Selection…') : t('Terminal Triggers…'), () => showTriggers(session, selectedText)],
        null,
        ['Find…', showSearch],
        ['Clear Buffer', () => { search.clearDecorations(); terminal.clear(); terminal.focus(); }],
        ['Clear Scrollback', () => { search.clearDecorations(); terminal.write('\x1b[3J'); terminal.focus(); }],
        null,
        ...(session.agent ? [] : [['Split Right', () => splitSession(session, 'row')], ['Split Down', () => splitSession(session, 'column')]]),
        ['Close Pane', () => closePane(session)],
      ]).catch(error => status(session, error.message, true));
    });
  }

  terminal.attachCustomKeyEventHandler(event => {
    if (event.type !== 'keydown' || !event.metaKey) return true;
    // A Latin character wins, so Dvorak, Colemak and AZERTY keep their own letters.
    // Non-Latin input sources (Korean, Japanese, Russian) fall back to the physical key.
    const typed = /^[\x21-\x7e]$/.test(event.key) ? event.key.toLowerCase() : '';
    const physical = event.code?.startsWith('Key') ? event.code.slice(3).toLowerCase() : '';
    const letter = ['c', 'v'].includes(typed || physical) ? (typed || physical) : '';
    const key = event.key.toLowerCase();
    if (!letter && !(event.altKey && ['arrowup', 'arrowdown'].includes(key))) return true;
    event.preventDefault();
    event.stopPropagation();
    if (letter === 'c' && terminal.hasSelection()) api['write-clipboard'](terminal.getSelection()).catch(() => {});
    if (letter === 'v') api['read-clipboard']().then(text => terminal.paste(text)).catch(() => {});
    if (key === 'arrowup' || key === 'arrowdown') jump(key === 'arrowup' ? -1 : 1);
    return false;
  });
  terminal.onData(data => {
    if (!session.closed && !session.shellEnded && (mode !== 'sftp' || !session.ready)) api.input(id, data).catch(error => status(session, error.message, true));
  });
  terminal.onResize(({ cols, rows }) => {
    if (!session.closed) api.resize(id, cols, rows).catch(error => status(session, error.message, true));
  });
  const observer = new ResizeObserver(() => { if (pane.getClientRects().length && !area.hidden) fit.fit(); });
  observer.observe(surface);
  Object.assign(session, { terminal, fit, observer, area, showSearch, search });
}

const nameDialog = byId('name-dialog');
byId('cancel-name').addEventListener('click', () => nameDialog.close());
nameDialog.querySelector('form').addEventListener('submit', event => {
  event.preventDefault();
  nameDialog.close('ok');
});
function askName(initial, title = 'Name', allowEmpty = false) {
  byId('name-label').textContent = title;
  const field = byId('entry-name');
  field.required = !allowEmpty;
  field.value = initial;
  nameDialog.returnValue = '';
  return new Promise(resolve => {
    nameDialog.addEventListener('close', () => resolve(nameDialog.returnValue === 'ok' ? field.value : undefined), { once: true });
    nameDialog.showModal();
    field.select();
  });
}
const fileExtensions = {
  image: 'png jpg jpeg gif webp heic heif bmp svg ico avif tif tiff raw',
  archive: 'zip tar gz bz2 xz tgz rar 7z zst dmg',
  audio: 'mp3 m4a wav aac ogg flac aiff opus',
  video: 'mp4 mov mkv webm avi m4v mpeg',
  document: 'pdf txt md rtf doc docx odt pages ppt pptx key log',
  sheet: 'csv tsv xls xlsx ods numbers',
  code: 'js jsx ts tsx py rb go rs c cpp h swift java kt sh zsh bash html css scss json yaml yml xml toml ini conf sql',
};
const fileIconByExtension = new Map(Object.entries(fileExtensions).flatMap(([type, values]) =>
  values.split(' ').map(extension => [extension, type])));
const fileNameOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function fileIcon(entry) {
  if (entry.directory) return 'folder';
  if (entry.link) return 'link';
  const dot = entry.name.lastIndexOf('.');
  return dot > 0 ? fileIconByExtension.get(entry.name.slice(dot + 1).toLowerCase()) || 'file' : 'file';
}
const fileColumnVisibility = { size: true, modifiedAt: true, type: true };
try { Object.assign(fileColumnVisibility, JSON.parse(localStorage.getItem('sftp-columns'))); } catch {}
function fileType(entry) {
  if (entry.directory) return t('Folder');
  if (entry.link) return t('Link');
  // A backup copy shows the type of its original name, so "app.conf.20261118-170909" is CONF.
  const { extension, backup } = nameTypeOf(entry.name);
  return extension || (backup ? t('Backup') : t('File'));
}
function formatFileSize(size) {
  if (!Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return size + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = size / 1024, unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++; }
  return amount.toFixed(amount < 10 ? 1 : 0) + ' ' + units[unit];
}

function makeFileLayout(root, directory, ratio) {
  const container = document.createElement('div');
  container.className = 'listing file-panels';
  const remotesRoot = document.createElement('div');
  remotesRoot.className = 'remote-file-panes';
  // One local pane, or a tree of split local panes. It sits where the single local pane always sat.
  const localRoot = document.createElement('div');
  localRoot.className = 'local-file-panes';
  const layout = {
    container, localRoot, remotesRoot, localDirectory: directory, connections: new Set(), locals: [], activeLocal: undefined,
    get local() { return layout.locals[0]; },
    // The folder the active local pane shows. Transfers and the path bar in the file tools use it.
    get directory() { return (layout.activeLocal ?? layout.locals[0])?.directory ?? layout.localDirectory; },
  };
  // Serialized with a workspace: the split tree (directions, ratios, folders) and which pane was focused.
  layout.localSplitState = () => {
    if (layout.locals.length < 2) return undefined;
    const order = [];
    const save = element => {
      if (element.classList.contains('split-node')) {
        const [first, , second] = element.children;
        return { axis: element.axis, ratio: element.ratio, first: save(first), second: save(second) };
      }
      const side = layout.locals.find(pane => pane.element === element);
      order.push(side);
      return { directory: side?.directory || '' };
    };
    const tree = save(localRoot.firstElementChild);
    return { tree, focus: Math.max(0, order.indexOf(layout.activeLocal ?? layout.locals[0])) };
  };
  const divider = document.createElement('button');
  divider.type = 'button';
  divider.className = 'split-divider local-file-divider';
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-label', 'Resize local file pane');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.setAttribute('aria-valuemin', '20');
  divider.setAttribute('aria-valuemax', '75');
  function resize(value) {
    layout.localRatio = Math.max(0.2, Math.min(0.75, value));
    container.style.setProperty('--local-width', (layout.localRatio * 100) + '%');
    divider.setAttribute('aria-valuenow', Math.round(layout.localRatio * 100));
  }
  divider.addEventListener('pointerdown', event => divider.setPointerCapture(event.pointerId));
  divider.addEventListener('pointermove', event => {
    if (!divider.hasPointerCapture(event.pointerId)) return;
    const rect = container.getBoundingClientRect();
    resize((event.clientX - rect.left) / rect.width);
  });
  divider.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    resize((layout.localRatio ?? (remotesRoot.querySelector('.split-node') ? 0.4 : 0.5)) +
      (event.key === 'ArrowRight' ? 0.025 : -0.025));
  });
  if (Number.isFinite(ratio)) resize(ratio);
  else divider.setAttribute('aria-valuenow', '50');
  layout.refreshDivider = () => {
    if (layout.localRatio === undefined) divider.setAttribute('aria-valuenow', remotesRoot.querySelector('.split-node') ? '40' : '50');
  };
  container.append(localRoot, divider, remotesRoot);
  root.append(container);
  return layout;
}

// The file pane toolbars: which buttons show and in what order. One layout per pane kind (local, remote),
// shared by every pane. It lives in localStorage, so other windows pick a change up from the storage event.
const toolbarStorageKey = 'sftp-toolbar';
const fileToolbarSides = new Set();
const toolbarToggles = new Set(['filter', 'tree', 'hidden-files']);
function toolbarKind(side) { return side.side === 'local' ? 'local' : 'remote'; }
function savedToolbarLayouts() {
  try {
    const value = JSON.parse(localStorage.getItem(toolbarStorageKey));
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}
function toolbarLayout(kind) { return normalizeToolbarLayout(kind, savedToolbarLayouts()[kind]); }
// layout undefined restores the defaults for that kind.
function saveToolbarLayout(kind, layout) {
  const all = savedToolbarLayouts();
  if (layout) all[kind] = { order: layout.order, hidden: layout.hidden };
  else delete all[kind];
  try { localStorage.setItem(toolbarStorageKey, JSON.stringify(all)); } catch {}
  applyAllToolbars();
  if (toolbarDialog.open) renderToolbarDialog();
}
// Puts each button of a pane in the saved order and hides the ones the user hid. A hidden button stays in
// the DOM (display: none) so its state and handlers keep working, and the More menu clicks it.
function applyToolbar(side) {
  fileToolbarSides.add(side);
  const kind = toolbarKind(side);
  const layout = toolbarLayout(kind);
  const hidden = new Set(layout.hidden);
  for (const id of layout.order) {
    const control = side.toolbarControls.get(id);
    const group = toolbarItem(kind, id)?.group;
    const container = group === 'tools' ? side.tools : group === 'address' ? side.address : side.leading;
    if (!control || !container) continue;
    container.insertBefore(control, group === 'tools' && side.moreButton?.parentNode === container ? side.moreButton : null);
    control.classList.toggle('toolbar-user-hidden', hidden.has(id));
  }
}
function applyAllToolbars() {
  for (const side of fileToolbarSides) {
    if (side.element.isConnected) applyToolbar(side);
    else fileToolbarSides.delete(side);
  }
}
addEventListener('storage', event => { if (event.key === toolbarStorageKey || event.key === null) applyAllToolbars(); });
function toolbarControlEnabled(control) {
  return !control.disabled && !control.inert && !control.closest('[inert]');
}
// The More (…) button: the hidden buttons of this pane, then Customize.
function showToolbarMore(side) {
  applyToolbar(side);
  const kind = toolbarKind(side);
  const entries = toolbarLayout(kind).hidden.filter(id => side.toolbarControls.has(id)).map(id => {
    const control = side.toolbarControls.get(id);
    const toggle = toolbarToggles.has(id);
    return [toggle ? t(toolbarItem(kind, id).label) : control.getAttribute('aria-label') || control.title,
      () => control.click(), toolbarControlEnabled(control), toggle ? control.getAttribute('aria-pressed') === 'true' : undefined];
  });
  if (entries.length) entries.push(null);
  entries.push([t('Customize Toolbar…'), () => openToolbarDialog(kind), true]);
  return chooseMenu(entries);
}
// Right-clicking a toolbar: a checkmark per button to show or hide it.
function showToolbarChoices(side) {
  const kind = toolbarKind(side);
  const layout = toolbarLayout(kind);
  return chooseMenu([
    ...layout.order.filter(id => side.toolbarControls.has(id)).map(id => {
      const shown = !layout.hidden.includes(id);
      return [t(toolbarItem(kind, id).label), () => saveToolbarLayout(kind, setToolbarItemHidden(toolbarLayout(kind), id, shown)), true, shown];
    }),
    null,
    [t('Customize Toolbar…'), () => openToolbarDialog(kind), true],
    [t('Restore Default Toolbar'), () => saveToolbarLayout(kind, undefined), true],
  ]);
}
const toolbarDialog = byId('toolbar-dialog');
let toolbarDialogKind = 'remote';
function openToolbarDialog(kind) {
  toolbarDialogKind = kind;
  renderToolbarDialog();
  if (!toolbarDialog.open) toolbarDialog.showModal();
}
function renderToolbarDialog() {
  const kind = toolbarDialogKind;
  byId('toolbar-dialog-title').textContent = t(kind === 'local' ? 'Local Pane Buttons' : 'Remote Pane Buttons');
  const layout = toolbarLayout(kind);
  const list = byId('toolbar-items');
  const focused = document.activeElement?.closest?.('[data-toolbar-row]');
  const focusRow = focused?.dataset.toolbarRow;
  const focusPart = document.activeElement?.dataset?.toolbarPart;
  const groupNames = kind === 'local' ? { tools: 'Title bar', address: 'Path bar' }
    : { leading: 'Left of the name', tools: 'Right of the name', address: 'Path bar' };
  list.replaceChildren();
  for (const [group, name] of Object.entries(groupNames)) {
    const ids = layout.order.filter(id => toolbarItem(kind, id).group === group);
    const heading = document.createElement('h3');
    heading.textContent = t(name);
    list.append(heading);
    ids.forEach((id, index) => {
      const row = document.createElement('div');
      row.className = 'toolbar-item-row';
      row.dataset.toolbarRow = id;
      const label = document.createElement('label');
      label.className = 'settings-check';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = !layout.hidden.includes(id);
      check.dataset.toolbarPart = 'check';
      check.addEventListener('change', () => saveToolbarLayout(kind, setToolbarItemHidden(toolbarLayout(kind), id, !check.checked)));
      const text = document.createElement('span');
      text.textContent = t(toolbarItem(kind, id).label);
      label.append(check, text);
      const move = direction => saveToolbarLayout(kind, { ...toolbarLayout(kind), order: moveToolbarItem(kind, toolbarLayout(kind).order, id, direction) });
      const up = iconButton('up', 'Move Up', () => move(-1));
      up.dataset.toolbarPart = 'up';
      up.disabled = index === 0;
      const down = iconButton('down', 'Move Down', () => move(1));
      down.dataset.toolbarPart = 'down';
      down.disabled = index === ids.length - 1;
      row.append(label, up, down);
      list.append(row);
    });
  }
  // Moving a row re-renders the list: keep the keyboard on the same control of the same row.
  if (focusRow) {
    const row = list.querySelector(`[data-toolbar-row="${CSS.escape(focusRow)}"]`);
    const target = row?.querySelector(`[data-toolbar-part="${focusPart}"]:not(:disabled)`) || row?.querySelector('[data-toolbar-part]:not(:disabled)');
    target?.focus();
  }
}
byId('reset-toolbar').addEventListener('click', () => saveToolbarLayout(toolbarDialogKind, undefined));
byId('done-toolbar').addEventListener('click', () => toolbarDialog.close());
byId('close-toolbar-dialog').addEventListener('click', () => toolbarDialog.close());

function setupFiles(session) {
  const layout = session.fileLayout ??= makeFileLayout(session.pane, session.localDirectory);
  const first = !layout.local;
  const listing = layout.container;
  session.listing = listing;
  layout.connections.add(session);
  // Every local pane is a side with side.side === 'local'. Remote panes are the others.
  const isLocal = side => side?.side === 'local';
  const activeLocal = () => layout.activeLocal ?? layout.locals[0];
  const activeRemote = () => {
    const current = sessions.get(active);
    return layout.connections.has(current) ? current : layout.connections.values().next().value;
  };
  function localError(error) {
    const current = activeRemote();
    if (current) status(current, error.message, true);
  }
  function updateFileColumns(side) {
    for (const column of ['size', 'modifiedAt', 'type']) {
      side.element.dataset['show' + column[0].toUpperCase() + column.slice(1)] = String(fileColumnVisibility[column] !== false);
    }
  }
  function chooseFileColumns(side) {
    chooseMenu(['size', 'modifiedAt', 'type'].map(column => [
      t(column === 'modifiedAt' ? 'Modified' : column[0].toUpperCase() + column.slice(1)),
      () => {
        fileColumnVisibility[column] = fileColumnVisibility[column] === false;
        try { localStorage.setItem('sftp-columns', JSON.stringify(fileColumnVisibility)); } catch {}
        for (const panel of document.querySelectorAll('.file-panel')) if (panel._fileSide) updateFileColumns(panel._fileSide);
      }, true, fileColumnVisibility[column] !== false,
    ])).catch(error => status(session, error.message, true));
  }

  function panel(title, side) {
    const element = document.createElement('section');
    element.className = 'file-panel file-browser';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const address = document.createElement('form');
    address.className = 'file-address';
    const location = document.createElement('input');
    location.setAttribute('aria-label', title + ' path');
    location.title = 'Type a path and press Return';
    location.hidden = true;
    const breadcrumbs = document.createElement('nav');
    breadcrumbs.className = 'file-breadcrumbs';
    breadcrumbs.setAttribute('aria-label', title + ' folders');
    const pathBar = document.createElement('div');
    pathBar.className = 'file-path';
    const pathSpace = button(t(''), () => {
      location.value = currentDirectory(entry) || '';
      pathBar.hidden = true;
      location.hidden = false;
      location.focus();
      location.select();
    });
    pathSpace.className = 'file-path-space';
    pathSpace.setAttribute('aria-label', 'Edit folder path');
    pathBar.append(breadcrumbs, pathSpace);
    const favoriteToggle = iconButton('star', 'Add path to favorites', () => toggleFavorite(entry));
    favoriteToggle.setAttribute('aria-pressed', 'false');
    favoriteToggle.disabled = true;
    const favorites = iconButton('bookmark', 'Favorite folders', () => showFavorites(entry));
    favorites.addEventListener('contextmenu', event => { event.preventDefault(); manageFavorites(entry); });
    favorites.disabled = true;
    const history = iconButton('history', 'Recent folders', () => showHistory(entry));
    history.disabled = true;
    address.append(location, pathBar, favoriteToggle, favorites, history);
    // The name filter for the folder on screen (⌘F). It hides rows only; the folder is not listed again.
    const filterBar = document.createElement('form');
    filterBar.className = 'file-filter';
    filterBar.hidden = true;
    const filterField = document.createElement('input');
    filterField.type = 'search';
    filterField.placeholder = t('Filter by name');
    filterField.title = t('Words, or a pattern such as *.log');
    filterField.setAttribute('aria-label', t('Filter by name'));
    filterField.spellcheck = false;
    const filterCount = document.createElement('span');
    filterCount.className = 'file-filter-count';
    filterCount.setAttribute('role', 'status');
    const filterClose = iconButton('close', 'Close filter', () => closeFilter(entry));
    filterBar.append(icon('search'), filterField, filterCount, filterClose);
    const filterButton = iconButton('search', 'Filter by name', () => toggleFilter(entry));
    filterButton.setAttribute('aria-pressed', 'false');
    const sortBar = document.createElement('div');
    sortBar.className = 'file-sort';
    const sortName = button(t('Name'), () => setSort(entry, 'name'));
    sortName.dataset.column = 'name';
    const sortSize = button(t('Size'), () => setSort(entry, 'size'));
    sortSize.dataset.column = 'size';
    const sortModified = button(t('Modified'), () => setSort(entry, 'modifiedAt'));
    sortModified.dataset.column = 'modifiedAt';
    const sortType = button(t('Type'), () => setSort(entry, 'type'));
    sortType.dataset.column = 'type';
    sortBar.addEventListener('contextmenu', event => { event.preventDefault(); chooseFileColumns(entry); });
    sortBar.append(sortName, sortSize, sortModified, sortType);
    const tools = document.createElement('div');
    tools.className = 'file-tools';
    tools.append(filterButton);
    const body = document.createElement('div');
    body.className = 'file-browser-body';
    const tree = document.createElement('div');
    tree.className = 'file-tree';
    tree.setAttribute('aria-label', title + ' folder tree');
    tree.hidden = true;
    const items = document.createElement('div');
    items.className = 'file-items';
    items.setAttribute('aria-label', title + ' files');
    const header = document.createElement('div');
    header.className = 'file-heading';
    header.append(heading, tools);
    body.append(tree, items);
    element.append(header, address, filterBar, sortBar, body);
    // Local panes are placed by the caller, inside .local-file-panes (one, or two when split).
    if (side !== 'local') (session.tabRecord.fileLayout ? session.pane : layout.remotesRoot).append(element);
    const entry = {
      side, element, address, location, pathBar, pathSpace, breadcrumbs, favoriteToggle, favorites, history, tools, items, body, tree,
      folders: new Map(), expanded: new Set(['/']), entries: [], selected: new Set(), sortKey: 'name', sortDescending: false,
      sortName, sortSize, sortModified, sortType, pathHistory: [], pathHistoryIndex: -1, pendingPathIndex: undefined, localRequest: 0,
      filterBar, filterField, filterCount, filterButton, filterText: '',
      toolbarControls: new Map([['filter', filterButton], ['favorite', favoriteToggle], ['favorites', favorites], ['recent', history]]),
    };
    filterBar.addEventListener('submit', event => event.preventDefault());
    filterField.addEventListener('input', () => applyFilter(entry));
    filterField.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (filterField.value) { filterField.value = ''; applyFilter(entry); }
        else closeFilter(entry);
      } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
        const first = items.querySelector('.file-row:not(.file-parent) .file-name');
        if (first) { event.preventDefault(); first.focus(); }
      }
    });
    element._fileSide = entry;
    items.addEventListener('click', event => {
      if (event.target.closest('.file-name') || !entry.selected.size) return;
      entry.selected.clear();
      entry.selectionAnchor = undefined;
      for (const item of items.querySelectorAll('.file-name[aria-pressed]')) {
        item.setAttribute('aria-pressed', 'false');
        item.parentElement.classList.remove('selected');
      }
      updateControls();
    });
    element.addEventListener('auxclick', event => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      event.stopPropagation();
      movePathHistory(entry, event.button === 3 ? -1 : 1);
    }, true);
    updateFileColumns(entry);
    return entry;
  }
  if (first) {
    const side = panel('Local', 'local');
    side.directory = layout.localDirectory;
    layout.locals.push(side);
    layout.localRoot.append(side.element);
  }
  const local = layout.locals[0];
  const remote = panel('Remote', 'remote');
  const remoteHeading = remote.element.querySelector('h3');
  remoteHeading.classList.add('terminal-session-name');
  remoteHeading.textContent = session.input.label || session.input.host;
  remoteHeading.title = session.input.hostname || session.input.host;
  remote.element.querySelector('.file-heading').classList.add('session-tools', 'sftp-session-tools');
  for (const event of ['pointerdown', 'focusin']) session.pane.addEventListener(event, () => {
    if (active !== session.id && sessions.get(session.id) === session && !session.tabRecord.root.hidden) activate(session.id, false);
  });
  remote.breadcrumbs.textContent = t('Waiting for connection');
  remote.element.insertBefore(session.area, remote.body);
  remote.items.hidden = true;
  session.toolbar = remote.tools;
  const activity = authActivityButton(session);
  activity.dataset.connectionAction = 'true';
  const leading = document.createElement('div');
  leading.className = 'session-tools-leading';
  const dragPane = iconButton('grip', 'Drag remote pane to rearrange', () => {});
  dragPane.draggable = true;
  dragPane.addEventListener('dragstart', event => dragStart(event, session));
  dragPane.addEventListener('dragend', clearLayoutDrag);
  const transfers = iconButton('transfer', 'Transfers', toggleTransferDrawer);
  transfers.classList.add('transfer-toolbar-button');
  const compare = iconButton('compare', 'Compare folders', () => showFolderCompare(session, layout, remote));
  leading.append(dragPane, activity, transfers, compare);
  remote.element.querySelector('.file-heading').prepend(leading);
  remote.leading = leading;
  remote.toolbarControls.set('transfers', transfers).set('compare', compare);
  let busy = false;
  let localRequest = 0;
  const favoritesCache = new Map();
  let hiddenFiles = true;
  try { hiddenFiles = localStorage.getItem('sftp-show-hidden') !== 'false'; } catch {}

  function itemPath(side, name) {
    const directory = isLocal(side) ? side.directory : session.remoteDirectory;
    return directory.replace(/\/$/, '') + '/' + name;
  }

  function currentDirectory(side) {
    return isLocal(side) ? side.directory : session.remoteDirectory;
  }
  const { host, hostname, port, username, configPath } = session.input;
  const historyKey = side => 'sftp-folders:' + (isLocal(side) ? 'local' :
    JSON.stringify([configPath || '', host, hostname || '', port ?? null, username || '']));
  function recentFolders(side) {
    try {
      const paths = JSON.parse(localStorage.getItem(historyKey(side)));
      return Array.isArray(paths) ? paths.filter(path => typeof path === 'string' && path.startsWith('/')).slice(0, 20)
        .sort((a, b) => fileNameOrder.compare(a.split('/').filter(Boolean).at(-1) || '/', b.split('/').filter(Boolean).at(-1) || '/')
          || fileNameOrder.compare(a, b)) : [];
    } catch { return []; }
  }
  function favoriteFolders(side) { return favoritesCache.get(side) || []; }
  async function refreshFavorites(side) {
    let legacy = [];
    const key = historyKey(side).replace('sftp-folders:', 'sftp-favorites:');
    try { legacy = JSON.parse(localStorage.getItem(key)) || []; } catch {}
    const scope = isLocal(side) ? 'local' : session.input;
    const values = await api['sftp-favorites'](scope, legacy);
    favoritesCache.set(side, values);
    if (legacy.length) { try { localStorage.removeItem(key); } catch {} }
    syncFavoriteControl(side);
  }
  function syncFavoriteControl(side) {
    const current = currentDirectory(side);
    side.favoriteToggle.disabled = !current;
    side.favorites.disabled = !current;
    const saved = Boolean(current && favoriteFolders(side).some(item => item.path === current));
    side.favoriteToggle.setAttribute('aria-pressed', String(saved));
    const hint = saved ? 'Remove path from favorites' : 'Add path to favorites';
    side.favoriteToggle.title = t(hint);
    side.favoriteToggle.setAttribute('aria-label', t(hint));
  }
  async function mutateFavorite(side, change) {
    const result = await api['mutate-sftp-favorite'](isLocal(side) ? 'local' : session.input, change);
    favoritesCache.set(side, result); syncFavoriteControl(side); return result;
  }
  function toggleFavorite(side) {
    const current = currentDirectory(side);
    if (!current) return;
    const saved = favoriteFolders(side);
    const exists = saved.find(item => item.path === current);
    mutateFavorite(side, exists ? { action: 'remove', id: exists.id } : { action: 'add', path: current, displayName: current.split('/').filter(Boolean).at(-1) || '/' })
      .catch(() => status(session, t('Could not save folder favorite.'), true));
  }
  function showFavorites(side) {
    side.element.querySelector('.favorite-popover')?.remove();
    const popover = document.createElement('div'); popover.className = 'favorite-popover';
    const heading = document.createElement('strong'); heading.textContent = t('Favorite folders'); popover.append(heading);
    let dragging = -1;
    const render = () => {
      popover.querySelectorAll('.favorite-popover-row').forEach(row => row.remove());
      favoriteFolders(side).forEach((item, index) => {
        const row = document.createElement('button'); row.type = 'button'; row.className = 'favorite-popover-row'; row.draggable = true; row.title = item.path;
        const name = document.createElement('span'); name.textContent = item.displayName;
        const location = document.createElement('small'); location.textContent = item.path;
        row.append(icon('folder'), name, location);
        row.addEventListener('click', () => { navigate(side, item.path); popover.remove(); });
        row.addEventListener('contextmenu', async event => {
          event.preventDefault(); event.stopPropagation();
          try {
          const action = await api['context-menu']([
            { id: 'rename', label: t('Rename') }, { id: 'edit', label: t('Edit Path') },
            { id: 'up', label: t('Move Up'), enabled: index > 0 }, { id: 'down', label: t('Move Down'), enabled: index < favoriteFolders(side).length - 1 }, null,
            { id: 'remove', label: t('Remove from Favorites') },
          ]);
          if (!action) return;
          let values = favoriteFolders(side);
          if (action === 'rename' || action === 'edit') {
            const value = await askName(action === 'rename' ? item.displayName : item.path, action === 'rename' ? 'Rename Favorite' : 'Edit Favorite Path');
            if (value === undefined) return;
            await mutateFavorite(side, action === 'rename' ? { action, id: item.id, displayName: value } : { action: 'edit-path', id: item.id, path: value }); render(); return;
          } else if (action === 'remove') { await mutateFavorite(side, { action, id: item.id }); render(); return; }
          else if (action === 'up' || action === 'down') {
            const target = index + (action === 'up' ? -1 : 1); [values[index], values[target]] = [values[target], values[index]];
            await mutateFavorite(side, { action: 'reorder', ids: values.map(value => value.id) }); render(); return;
          }
          } catch (error) { status(session, error.message, true); }
        });
        row.addEventListener('dragstart', event => { dragging = index; event.dataTransfer.effectAllowed = 'move'; });
        row.addEventListener('dragover', event => { event.preventDefault(); });
        row.addEventListener('drop', async event => {
          event.preventDefault(); if (dragging < 0 || dragging === index) return;
          const values = [...favoriteFolders(side)]; const [moved] = values.splice(dragging, 1); values.splice(index, 0, moved); dragging = -1;
          try { await mutateFavorite(side, { action: 'reorder', ids: values.map(value => value.id) }); render(); }
          catch (error) { status(session, error.message, true); }
        });
        popover.append(row);
      });
      if (!favoriteFolders(side).length) { const empty = document.createElement('small'); empty.className = 'favorite-empty'; empty.textContent = t('No favorite folders'); popover.append(empty); }
    };
    render(); side.element.append(popover);
    // The Favorites button can be hidden in the More menu; the popover then opens under the More button.
    const anchor = (side.favorites.offsetParent ? side.favorites : side.moreButton ?? side.favorites).getBoundingClientRect();
    popover.style.position = 'fixed'; popover.style.top = `${Math.min(anchor.bottom + 4, window.innerHeight - 300)}px`;
    popover.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - 430))}px`; popover.style.right = 'auto';
    const dismiss = event => { if (!popover.contains(event.target) && !side.favorites.contains(event.target)) { popover.remove(); document.removeEventListener('pointerdown', dismiss, true); } };
    setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
  }
  async function manageFavorites(side) {
    try { await refreshFavorites(side); } catch (error) { status(session, error.message, true); return; }
    const items = favoriteFolders(side);
    if (!items.length) return showFavorites(side);
    const chosen = await api['context-menu'](items.map((item, id) => ({ id, label: `${item.displayName} — ${item.path}` })));
    if (chosen === null) return;
    const item = items[chosen];
    const action = await api['context-menu']([
      { id: 'rename', label: t('Rename') }, { id: 'edit', label: t('Edit Path') },
      { id: 'up', label: t('Move Up'), enabled: chosen > 0 }, { id: 'down', label: t('Move Down'), enabled: chosen < items.length - 1 },
      null, { id: 'remove', label: t('Remove from Favorites') },
    ]);
    if (action === null) return;
    if (!action) return;
    if (action === 'rename' || action === 'edit') {
      const value = await askName(action === 'rename' ? item.displayName : item.path, action === 'rename' ? 'Rename Favorite' : 'Edit Favorite Path');
      if (value === undefined) return;
      await mutateFavorite(side, action === 'rename' ? { action, id: item.id, displayName: value } : { action: 'edit-path', id: item.id, path: value });
    } else if (action === 'remove') await mutateFavorite(side, { action, id: item.id });
    else if (action === 'up' || action === 'down') {
      const values = [...items], target = action === 'up' ? chosen - 1 : chosen + 1;
      [values[chosen], values[target]] = [values[target], values[chosen]];
      await mutateFavorite(side, { action: 'reorder', ids: values.map(value => value.id) });
    }
  }
  function showHistory(side) {
    chooseMenu(recentFolders(side).map(path => [
      path, () => navigate(side, path), true, path === currentDirectory(side),
    ])).catch(error => status(session, error.message, true));
  }
  function movePathHistory(side, direction) {
    const index = side.pathHistoryIndex + direction;
    if (index < 0 || index >= side.pathHistory.length) return;
    const target = side.pathHistory[index];
    side.pendingPathIndex = index;
    const task = isLocal(side) ? loadLocal(side, target) : run(() => loadRemote(target));
    Promise.resolve(task).catch(error => status(session, error.message, true)).finally(() => {
      if (side.pendingPathIndex === index) side.pendingPathIndex = undefined;
    });
  }
  function setFileButtonIcon(control, name) {
    const label = document.createElement('span');
    label.textContent = control.textContent;
    control.classList.add('file-label-button');
    control.replaceChildren(icon(name), label);
  }
  function showPath(side, directory) {
    if (!favoritesCache.has(side)) refreshFavorites(side).catch(() => {});
    // A filter belongs to one folder: opening another folder empties it. The bar stays open for the next one.
    if (side.filterDirectory !== directory) {
      side.filterDirectory = directory;
      side.filterField.value = '';
      side.filterText = '';
    }
    if (side.pendingPathIndex !== undefined && side.pathHistory[side.pendingPathIndex] === directory) {
      side.pathHistoryIndex = side.pendingPathIndex;
      side.pendingPathIndex = undefined;
    } else if (side.pathHistory[side.pathHistoryIndex] !== directory) {
      side.pathHistory.splice(side.pathHistoryIndex + 1);
      side.pathHistory.push(directory);
      side.pathHistoryIndex = side.pathHistory.length - 1;
      side.pendingPathIndex = undefined;
    }
    side.location.value = directory;
    side.location.hidden = true;
    syncFavoriteControl(side);
    const nav = side.breadcrumbs;
    side.pathBar.hidden = false;
    nav.replaceChildren();
    const parts = directory.split('/').filter(Boolean);
    let path = '';
    for (const part of ['/', ...parts]) {
      if (part !== '/') path += '/' + part;
      const target = path || '/';
      const crumb = button(part, () => navigate(side, target));
      if (part === '/') crumb.classList.add('root-crumb');
      else setFileButtonIcon(crumb, 'folder');
      crumb.title = target;
      if (target === directory) crumb.setAttribute('aria-current', 'location');
      if (nav.childElementCount) {
        const separator = document.createElement('span');
        separator.className = 'file-breadcrumb-separator';
        separator.setAttribute('aria-hidden', 'true');
        separator.textContent = '›';
        nav.append(separator);
      }
      nav.append(crumb);
    }
    nav.scrollLeft = nav.scrollWidth;
    try {
      localStorage.setItem(historyKey(side), JSON.stringify([
        directory, ...recentFolders(side).filter(path => path !== directory),
      ].slice(0, 20)));
    } catch {}
    side.history.disabled = !recentFolders(side).length;
  }
  async function loadLocal(side, target) {
    const request = ++side.localRequest;
    const result = await api['local-list'](target);
    if (request !== side.localRequest) return;
    side.directory = result.directory;
    showPath(side, result.directory);
    render(side, hiddenFiles ? result.entries : result.entries.filter(entry => !entry.name.startsWith('.')));
  }

  async function loadRemote(target) {
    const result = await api.sftp(session.id, 'list', target);
    session.remoteDirectory = result.directory;
    showPath(remote, result.directory);
    render(remote, result.entries);
    remote.items.hidden = false;
  }

  function syncTree(side) {
    if (side.tree.hidden || !currentDirectory(side)) return;
    const directory = currentDirectory(side);
    const branches = new Map();
    let parent = '/';
    for (const part of directory.split('/').filter(Boolean)) {
      const child = parent === '/' ? '/' + part : parent + '/' + part;
      branches.set(parent, { name: part, path: child });
      side.expanded.add(parent);
      parent = child;
    }
    side.folders.set(directory, {
      children: (side.allEntries ?? side.entries).filter(entry => entry.directory && !entry.link).map(entry => ({
        name: entry.name, path: itemPath(side, entry.name),
      })),
    });
    renderTree(side, branches);
  }
  function renderTree(side, branches) {
    if (side.tree.hidden) return;
    const scroll = side.tree.scrollTop;
    const list = document.createElement('ul');
    function branch(folder, ancestors) {
      const item = document.createElement('li');
      const { path, name } = folder;
      const expanded = side.expanded.has(path);
      const row = document.createElement('div');
      row.className = 'file-tree-row';
      // The translated sentence holds {name}, so each language sets the word order.
      const label = (expanded ? t('Collapse {name}') : t('Expand {name}')).replace('{name}', () => name);
      const toggle = iconButton('chevron', label, () => {
        if (!side.expanded.delete(path)) side.expanded.add(path);
        renderTree(side, branches);
      });
      toggle.setAttribute('aria-expanded', String(expanded));
      const open = button(name, () => navigate(side, path));
      setFileButtonIcon(open, 'folder');
      open.title = path;
      if (path === currentDirectory(side)) open.setAttribute('aria-current', 'location');
      row.append(toggle, open);
      row.addEventListener('contextmenu', event => {
        event.preventDefault();
        chooseMenu([
          [t('Open Folder'), () => navigate(side, path)],
          [t('Refresh Folder'), () => refreshFolder(side, path)],
        ]).catch(error => status(session, error.message, true));
      });
      item.append(row);
      if (!expanded) return item;
      const children = document.createElement('ul');
      const cached = side.folders.get(path);
      const lineage = branches.get(path);
      const folders = [...(cached?.children ?? [])];
      if (lineage && !folders.some(folder => folder.path === lineage.path)) folders.push(lineage);
      folders.sort((a, b) => fileNameOrder.compare(a.name, b.name));
      for (const child of folders) {
        if (!ancestors.has(child.path)) children.append(branch(child, new Set([...ancestors, path])));
      }
      if (!cached) {
        const request = {};
        side.folders.set(path, request);
        const loading = isLocal(side) ? api['local-list'](path) : api.sftp(session.id, 'list', path);
        loading.then(result => {
          if (side.folders.get(path) !== request) return;
          request.children = result.entries.filter(entry => entry.directory && !entry.link &&
            (!isLocal(side) || hiddenFiles || !entry.name.startsWith('.'))).map(entry => ({
              name: entry.name, path: (path === '/' ? '' : path) + '/' + entry.name,
            }));
          renderTree(side, side.treeBranches);
        }).catch(() => {
          if (side.folders.get(path) !== request) return;
          request.failed = true;
          renderTree(side, side.treeBranches);
        });
      }
      if (cached?.failed) {
        const error = document.createElement('li');
        error.textContent = t('Folder unavailable');
        children.append(error);
      }
      item.append(children);
      return item;
    }
    side.treeBranches = branches;
    list.append(branch({ path: '/', name: '/' }, new Set()));
    side.tree.replaceChildren(list);
    side.tree.scrollTop = scroll;
  }

  function selectedRows(side) {
    return side.entries.filter(entry => side.selected.has(entry.name) && !entry.link);
  }
  function updateControls() {
    const canTransfer = session.ready && !busy && !layout.transferring && layout.directory && session.remoteDirectory;
    session.canUpload = Boolean(canTransfer);
    receive.disabled = !canTransfer || !selectedRows(remote).length;
    remote.address.inert = remote.items.inert = !session.ready || busy;
    for (const control of remote.tools.children) {
      if (!control.dataset.connectionAction) control.inert = !session.ready || busy;
    }
    layout.refreshLocalControls?.();
  }

  async function run(task) {
    if (busy || !session.ready) return;
    busy = true;
    updateControls();
    try {
      await task();
      if (session.ready) status(session, 'Connected');
    } catch (error) { status(session, error.message, true); }
    finally { busy = false; updateControls(); }
  }

  async function transfer(receiving, entries, remoteSource, localSide = activeLocal()) {
    if (!entries.length || !session.remoteDirectory || !session.ready) return;
    const localTarget = localSide.directory;
    const remoteTarget = session.remoteDirectory;
    // One request, one decision group: "apply to the remaining" answers only the conflicts of this request.
    const decisionGroup = crypto.randomUUID();
    for (const [index, entry] of entries.entries()) {
      const localPath = localTarget.replace(/\/$/, '') + '/' + entry.name;
      const remotePath = remoteTarget.replace(/\/$/, '') + '/' + entry.name;
      const job = remoteSource
        ? { operation: 'remote-copy', sessionId: remoteSource.id, sourcePath: remoteSource.directory.replace(/\/$/, '') + '/' + entry.name, targetSessionId: session.id, targetDirectory: remoteTarget, label: entry.name }
        : receiving
          ? { operation: 'download', sessionId: session.id, remotePath, localPath, label: entry.name }
          : { operation: 'upload', sessionId: session.id, localPath, remotePath, label: entry.name };
      // The total and this job's place let the first conflict know how many jobs follow, before they are queued.
      await api['transfer-enqueue']({ ...job, decisionGroup, decisionTotal: entries.length, decisionIndex: index });
    }
    status(session, `${entries.length} transfer job${entries.length === 1 ? '' : 's'} queued.`);
    showTransferDrawer();
  }

  function navigate(side, target) {
    if (isLocal(side)) loadLocal(side, target).catch(localError);
    else run(() => loadRemote(target));
  }

  async function refreshFolder(side, directory) {
    const prefix = directory.replace(/\/$/, '') + '/';
    for (const key of side.folders.keys()) if (key === directory || key.startsWith(prefix)) side.folders.delete(key);
    if (currentDirectory(side) === directory) {
      if (isLocal(side)) await loadLocal(side, directory);
      // Not through run(): a refresh must not be dropped while another remote action holds the busy flag.
      else if (session.ready) {
        try { await loadRemote(directory); } catch (error) { status(session, error.message, true); }
      }
    }
    if (!side.tree.hidden) syncTree(side);
  }

  // Backs up the named items of the current remote folder. Runs one backup at a time per session.
  async function backupItems(names) {
    if (!session.ready || session.backupRunning || !names.length) return;
    session.backupRunning = true;
    const directory = session.remoteDirectory;
    status(session, t('Backing up…'));
    try {
      const { results } = await api.sftp(session.id, 'backup', directory, names);
      const done = results.filter(item => item.backup && !item.queued);
      const failed = results.filter(item => item.error);
      const queued = results.some(item => item.queued);
      await refreshFolder(remote, directory);
      selectNames(remote, done.map(item => item.backup));
      const summary = !done.length ? '' : failed.length === 0 && done.length === 1 ? `${t('Backed up as')} ${done[0].backup}`
        : failed.length === 0 ? `${done.length} ${t('items backed up')}` : `${done.length} / ${results.length} ${t('items backed up')}`;
      const notes = queued ? [t('This server doesn\'t allow shell commands. Copying through PromeFTP instead.')] : [];
      if (queued) showTransferDrawer();
      status(session, [summary, ...notes, ...failed.map(item => `${item.name}: ${backupProblemText(item)}`)].filter(Boolean).join(' · '),
        failed.length > 0);
    } catch (error) {
      status(session, error.message, true);
    } finally { session.backupRunning = false; }
  }
  function selectNames(side, names) {
    side.selected.clear();
    for (const name of names) if (side.entries.some(entry => entry.name === name)) side.selected.add(name);
    side.selectionAnchor = undefined;
    let revealed = false;
    for (const item of side.items.querySelectorAll('.file-name[aria-pressed]')) {
      const selected = side.selected.has(item.dataset.name);
      item.setAttribute('aria-pressed', String(selected));
      item.parentElement.classList.toggle('selected', selected);
      if (selected && !revealed) { item.scrollIntoView({ block: 'nearest' }); revealed = true; }
    }
    updateControls();
  }

  function setSort(side, key) {
    if (side.sortKey === key) side.sortDescending = !side.sortDescending;
    else { side.sortKey = key; side.sortDescending = key === 'modifiedAt'; }
    render(side, side.allEntries ?? side.entries);
  }

  // The More button and the right-click menu of a pane's toolbar, then the saved layout.
  function finishToolbar(side) {
    side.moreButton = iconButton('more', 'More actions', () => showToolbarMore(side).catch(error => status(session, error.message, true)));
    // Usable while connecting, so the toolbar can be changed at any time; the menu disables what cannot run yet.
    side.moreButton.dataset.connectionAction = 'true';
    side.tools.insertBefore(side.moreButton, side.closeControl ?? null);
    side.element.querySelector('.file-heading').addEventListener('contextmenu', event => {
      event.preventDefault();
      showToolbarChoices(side).catch(error => status(session, error.message, true));
    });
    applyToolbar(side);
  }
  function openFilter(side) {
    side.filterBar.hidden = false;
    side.filterButton.setAttribute('aria-pressed', 'true');
    side.filterField.focus();
    side.filterField.select();
  }
  function closeFilter(side) {
    side.filterBar.hidden = true;
    side.filterButton.setAttribute('aria-pressed', 'false');
    if (side.filterField.value || side.filterText) { side.filterField.value = ''; applyFilter(side); }
    (side.items.querySelector('.file-row.selected .file-name') || side.items.querySelector('.file-row:not(.file-parent) .file-name') || side.pathSpace).focus();
  }
  function toggleFilter(side) {
    if (side.filterBar.hidden) openFilter(side);
    else closeFilter(side);
  }
  // Re-renders the folder with the current filter and keeps the selected items that still show.
  function applyFilter(side) {
    side.filterText = side.filterField.value;
    if (!side.allEntries) return;
    const keep = [...side.selected];
    render(side, side.allEntries);
    if (keep.length) selectNames(side, keep);
  }

  function render(side, entries) {
    side.selected.clear();
    side.selectionAnchor = undefined;
    side.allEntries = entries.sort((a, b) => {
      const folderOrder = Number(Boolean(b.directory)) - Number(Boolean(a.directory));
      if (folderOrder) return folderOrder;
      const value = side.sortKey === 'modifiedAt' ? ((a.modifiedAt ?? 0) - (b.modifiedAt ?? 0))
        : side.sortKey === 'size' ? ((a.size ?? -1) - (b.size ?? -1))
        : side.sortKey === 'type' ? (fileNameOrder.compare(fileType(a), fileType(b)) || fileNameOrder.compare(a.name, b.name))
        : (fileNameOrder.compare(a.name, b.name) || a.name.localeCompare(b.name));
      return side.sortDescending ? -value : value;
    });
    const filtering = Boolean(side.filterText?.trim());
    const matches = fileFilterMatcher(side.filterText || '');
    side.entries = filtering ? side.allEntries.filter(entry => matches(entry.name)) : side.allEntries;
    side.filterCount.textContent = filtering ? `${side.entries.length} / ${side.allEntries.length}` : '';
    side.element.classList.toggle('filtering', filtering);
    side.sortName.setAttribute('aria-sort', side.sortKey === 'name' ? (side.sortDescending ? 'descending' : 'ascending') : 'none');
    side.sortSize.setAttribute('aria-sort', side.sortKey === 'size' ? (side.sortDescending ? 'descending' : 'ascending') : 'none');
    side.sortModified.setAttribute('aria-sort', side.sortKey === 'modifiedAt' ? (side.sortDescending ? 'descending' : 'ascending') : 'none');
    side.sortType.setAttribute('aria-sort', side.sortKey === 'type' ? (side.sortDescending ? 'descending' : 'ascending') : 'none');
    side.items.replaceChildren();
    const directory = currentDirectory(side);
    if (directory !== '/') {
      const row = document.createElement('div');
      row.className = 'file-row file-parent';
      const parent = button(t('..'), () => navigate(side, directory.replace(/\/[^/]+\/?$/, '') || '/'));
      parent.className = 'file-name';
      parent.title = 'Parent folder';
      parent.setAttribute('aria-label', 'Parent folder (..)');
      setFileButtonIcon(parent, 'folder');
      row.append(parent);
      for (const [column, value] of [['size', '—'], ['modifiedAt', '—'], ['type', t('Folder')]]) {
        const cell = document.createElement('span');
        cell.className = column === 'size' ? 'file-size' : column === 'modifiedAt' ? 'file-modified' : 'file-type';
        cell.textContent = value;
        row.append(cell);
      }
      side.items.append(row);
    }
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'file-empty';
      empty.textContent = t('Empty folder');
      side.items.append(empty);
    } else if (!side.entries.length) {
      const empty = document.createElement('p');
      empty.className = 'file-empty';
      empty.textContent = t('No items match the filter');
      side.items.append(empty);
    }
    for (const entry of side.entries) {
      const row = document.createElement('div');
      row.className = 'file-row';
      const name = button(entry.name, event => {
        if (entry.link) {
          if (!event.shiftKey && !event.metaKey) navigate(side, itemPath(side, entry.name));
          return;
        }
        const index = side.entries.indexOf(entry);
        if (!event.metaKey) side.selected.clear();
        if (event.shiftKey && side.selectionAnchor !== undefined) {
          const first = Math.min(side.selectionAnchor, index);
          const last = Math.max(side.selectionAnchor, index);
          for (const item of side.entries.slice(first, last + 1)) if (!item.link) side.selected.add(item.name);
        } else {
          if (event.metaKey && side.selected.has(entry.name)) side.selected.delete(entry.name);
          else side.selected.add(entry.name);
          side.selectionAnchor = index;
        }
        for (const item of side.items.querySelectorAll('.file-name[aria-pressed]')) {
          const selected = side.selected.has(item.dataset.name);
          item.setAttribute('aria-pressed', String(selected));
          item.parentElement.classList.toggle('selected', selected);
        }
        updateControls();
      });
      name.className = 'file-name';
      name.title = entry.directory ? entry.name + ' · Double-click to open' : entry.name;
      name.dataset.name = entry.name;
      if (!entry.link) name.setAttribute('aria-pressed', 'false');
      const type = fileIcon(entry);
      name.dataset.fileIcon = type;
      setFileButtonIcon(name, type);
      row.append(name);
      const size = document.createElement('span');
      size.className = 'file-size';
      size.textContent = entry.directory ? '—' : formatFileSize(entry.size);
      row.append(size);
      const modified = document.createElement('time');
      modified.className = 'file-modified';
      if (Number.isFinite(entry.modifiedAt) && entry.modifiedAt > 0) {
        modified.dateTime = new Date(entry.modifiedAt).toISOString();
        modified.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(entry.modifiedAt);
        modified.title = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'medium' }).format(entry.modifiedAt);
      } else modified.textContent = '—';
      row.append(modified);
      const typeLabel = document.createElement('span');
      typeLabel.className = 'file-type';
      typeLabel.textContent = fileType(entry);
      typeLabel.title = typeLabel.textContent;
      row.append(typeLabel);
      if (entry.directory) {
        name.addEventListener('dblclick', event => {
          if (!event.shiftKey && !event.metaKey) navigate(side, itemPath(side, entry.name));
        });
        name.addEventListener('keydown', event => {
          if (event.key === 'Enter') { event.preventDefault(); navigate(side, itemPath(side, entry.name)); }
        });
      }
      const target = itemPath(side, entry.name);
      const reload = () => isLocal(side) ? loadLocal(side, currentDirectory(side)) : loadRemote(currentDirectory(side));
      const rename = async () => {
        const next = await askName(entry.name, t('Rename…'));
        if (next === undefined || next === entry.name || !next.trim()) return;
        if (isLocal(side)) await api['local-action']('rename', currentDirectory(side), entry.name, next.trim());
        else await api.sftp(session.id, 'rename', target, next.trim());
        await reload();
      };
      const remove = async () => {
        if (isLocal(side)) await api['local-action']('trash', currentDirectory(side), entry.name);
        else await api.sftp(session.id, 'delete', target);
        await reload();
      };
      // Keyboard equivalents of the context menu's Rename and Delete (Delete moves local items to Trash; remote deletes still confirm in main).
      name.addEventListener('keydown', event => {
        if (event.key === 'F2') { event.preventDefault(); rename().catch(error => status(session, error.message, true)); }
        else if (event.metaKey && (event.key === 'Backspace' || event.key === 'Delete')) {
          event.preventDefault();
          remove().catch(error => status(session, error.message, true));
        }
      });
      row.addEventListener('contextmenu', event => {
        event.preventDefault();
        const properties = async () => {
          if (isLocal(side)) await api['local-action']('info', currentDirectory(side), entry.name);
          else await api.sftp(session.id, 'info', target);
        };
        const backupNames = side.selected.has(entry.name) ? selectedRows(side).map(item => item.name) : [entry.name];
        const backupLabel = backupNames.length > 1 ? t('Backup') + ' (' + backupNames.length + ')' : t('Backup');
        const entries = isLocal(side) ? [
          ...(entry.directory ? [[t('Open Folder'), () => navigate(side, target)]] : [
            [t('Open'), () => api['local-action']('open', currentDirectory(side), entry.name)],
            [t('Edit'), () => api['local-action']('edit', currentDirectory(side), entry.name)],
          ]),
          [t('Reveal in Finder'), () => api['local-action']('reveal', currentDirectory(side), entry.name)],
          [t('Copy'), () => api['local-action']('copy', currentDirectory(side), entry.name)],
          [t('Copy Path'), () => api['write-clipboard'](target)],
          [t('Rename…'), rename],
          [t('Move to Trash'), remove],
          [t('Get Info'), properties],
          null,
          [t('Refresh Folder'), () => refreshFolder(side, currentDirectory(side))],
        ] : [
          ...(entry.directory ? [[t('Open Folder'), () => navigate(side, target)]] : entry.link ? [] : [
            [t('Download'), () => api.sftp(session.id, 'download', target)],
            [t('Edit…'), () => api.sftp(session.id, 'edit', target)],
          ]),
          // A selected item backs up the whole selection. Links are never backed up.
          ...(entry.link ? [] : [[backupLabel, () => backupItems(backupNames), !session.backupRunning]]),
          [t('Copy Path'), () => api['write-clipboard'](target)],
          [t('Rename…'), rename],
          [t('Delete'), remove],
          [t('Get Info'), properties],
          null,
          [t('Refresh Folder'), () => refreshFolder(side, currentDirectory(side))],
        ];
        chooseMenu(entries).catch(error => status(session, error.message, true));
      });
      if (!entry.link) {
        row.draggable = true;
        row.addEventListener('dragstart', event => {
          if (layout.transferring || (side === remote && (busy || !session.ready))) { event.preventDefault(); return; }
          layout.drag = { side, session, directory: currentDirectory(side), entries: side.selected.has(entry.name) ? selectedRows(side) : [entry] };
          event.dataTransfer.setData('text/plain', 'PromeFTP');
          event.dataTransfer.effectAllowed = 'copy';
        });
        row.addEventListener('dragend', () => {
          layout.drag = undefined;
          for (const target of listing.querySelectorAll('.drop-target')) target.classList.remove('drop-target');
        });
      }
      side.items.append(row);
    }
    syncTree(side);
    updateControls();
  }

  const wireSide = side => {
    if (isLocal(side)) for (const type of ['pointerdown', 'focusin']) side.element.addEventListener(type, () => setActiveLocal(side));
    side.location.addEventListener('focus', () => side.location.select());
    side.location.addEventListener('blur', () => {
      side.location.hidden = true;
      side.pathBar.hidden = false;
    });
    side.location.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      side.location.hidden = true;
      side.pathBar.hidden = false;
      side.pathSpace.focus();
    });
    side.address.addEventListener('submit', event => {
      event.preventDefault();
      side.location.hidden = true;
      side.pathBar.hidden = false;
      navigate(side, side.location.value);
    });
    const tree = iconButton('tree', 'Toggle folder tree', () => {
      side.tree.hidden = !side.tree.hidden;
      tree.setAttribute('aria-pressed', String(!side.tree.hidden));
      if (!side.tree.hidden) syncTree(side);
    });
    tree.setAttribute('aria-pressed', 'false');
    const refresh = iconButton('refresh', 'Refresh', () => {
      side.folders.clear();
      navigate(side, currentDirectory(side));
    });
    side.tools.append(tree, refresh);
    side.toolbarControls.set('tree', tree).set('refresh', refresh);
    const canDrop = () => {
      const source = layout.drag;
      if (!source || source.side === side || layout.transferring) return false;
      // Local panes never exchange files by dragging: both sides are on this Mac (D6).
      if (isLocal(source.side) && isLocal(side)) return false;
      if (!isLocal(source.side) && (!source.session.ready || !layout.connections.has(source.session))) return false;
      return isLocal(side) ? Boolean(side.directory) : session.ready && Boolean(session.remoteDirectory) && !busy;
    };
    side.element.addEventListener('dragover', event => {
      if (!canDrop()) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      side.element.classList.add('drop-target');
    });
    side.element.addEventListener('dragleave', event => {
      if (!(event.relatedTarget instanceof Node) || !side.element.contains(event.relatedTarget)) side.element.classList.remove('drop-target');
    });
    side.element.addEventListener('drop', event => {
      if (!canDrop()) return;
      event.preventDefault();
      side.element.classList.remove('drop-target');
      const { side: sourceSide, session: source, entries, directory } = layout.drag;
      layout.drag = undefined;
      if (isLocal(side)) source.transferFiles(true, entries, undefined, side);
      else if (isLocal(sourceSide)) transfer(false, entries, undefined, sourceSide);
      else transfer(false, entries, { id: source.id, directory });
    });
  };
  for (const side of first ? [...layout.locals, remote] : [remote]) wireSide(side);
  const receive = iconButton('left', 'Download selection', () => transfer(true, selectedRows(remote)));
  receive.classList.add('transfer-button');
  // The hidden-files state is app-wide, so every local pane's toggle shows the same state.
  const hiddenButtons = [];
  function syncHiddenButtons() {
    const hint = hiddenFiles ? 'Hide hidden files' : 'Show hidden files';
    for (const control of hiddenButtons) {
      control.title = t(hint);
      control.setAttribute('aria-label', t(hint));
      control.setAttribute('aria-pressed', String(hiddenFiles));
    }
  }
  // The tools every local pane has. Upload sends that pane's own selection.
  function addLocalTools(side) {
    const send = iconButton('right', 'Upload to selected remote', () => activeRemote()?.transferFiles(false, selectedRows(side), undefined, side));
    send.classList.add('transfer-button');
    side.send = send;
    const hidden = iconButton('eye', hiddenFiles ? 'Hide hidden files' : 'Show hidden files', () => {
      hiddenFiles = !hiddenFiles;
      try { localStorage.setItem('sftp-show-hidden', String(hiddenFiles)); } catch {}
      syncHiddenButtons();
      for (const pane of layout.locals) { pane.folders.clear(); navigate(pane, pane.directory); }
    });
    hiddenButtons.push(hidden);
    const chooseLocal = iconButton('folder', 'Choose local folder', async () => {
      try {
        const chosen = await api['local-directory'](side.directory);
        if (chosen) await loadLocal(side, chosen);
      } catch (error) { localError(error); }
    });
    side.address.append(chooseLocal);
    const newLocalFolder = iconButton('folderPlus', 'New local folder', async () => {
      const name = await askName('');
      if (name === undefined) return;
      try {
        await api['local-mkdir'](side.directory, name);
        await loadLocal(side, side.directory);
      } catch (error) { localError(error); }
    });
    side.split = iconButton('splitRight', 'Split local pane right', () => splitLocal(side, 'row'));
    side.splitDown = iconButton('splitDown', 'Split local pane down', () => splitLocal(side, 'column'));
    side.tools.append(hidden, newLocalFolder, send, side.split, side.splitDown);
    side.toolbarControls.set('hidden-files', hidden).set('new-folder', newLocalFolder).set('upload', send)
      .set('split-right', side.split).set('split-down', side.splitDown).set('choose-folder', chooseLocal);
    finishToolbar(side);
    // Right-clicking the empty part of a local pane offers the split directions.
    side.items.addEventListener('contextmenu', event => {
      if (event.target.closest('.file-row')) return;
      event.preventDefault();
      const full = layout.locals.length >= MAX_LOCAL_PANES;
      chooseMenu([
        [t('Split Right'), () => splitLocal(side, 'row'), !full],
        [t('Split Down'), () => splitLocal(side, 'column'), !full],
      ]).catch(error => status(session, error.message, true));
    });
    syncHiddenButtons();
  }
  function refreshLocalTools() {
    const current = activeRemote();
    for (const side of layout.locals) {
      if (!side.send) continue;
      side.send.disabled = !current?.canUpload || !selectedRows(side).length;
      side.address.inert = side.items.inert = layout.transferring;
      side.split.disabled = side.splitDown.disabled = layout.locals.length >= MAX_LOCAL_PANES;
    }
  }
  function setActiveLocal(side) {
    layout.activeLocal = side;
    for (const pane of layout.locals) pane.element.classList.toggle('active-local', pane === side);
  }
  // Splits a local pane in place: side by side (row) or stacked (column), up to MAX_LOCAL_PANES panes.
  // The new pane starts in the source folder, or in target when a workspace restores its folder.
  function splitLocal(source = activeLocal(), axis = 'row', ratio = 0.5, target, focusNew = true) {
    if (!source || layout.locals.length >= MAX_LOCAL_PANES) return undefined;
    const side = panel('Local', 'local');
    side.directory = source.directory;
    layout.locals.push(side);
    wireSide(side);
    addLocalTools(side);
    side.tools.append(iconButton('close', 'Close local pane', () => closeLocal(side)));
    const parent = source.element.parentNode;
    const next = source.element.nextSibling;
    parent.insertBefore(makeSplit(source.element, side.element, axis, ratio), next);
    setActiveLocal(side);
    refreshLocalTools();
    loadLocal(side, target ?? source.directory).catch(error => {
      localError(error);
      return loadLocal(side).catch(localError);
    }).then(() => {
      if (focusNew) (side.items.querySelector('.file-name') || side.pathSpace).focus();
    });
    return side;
  }
  // Closes a split-off local pane. Its neighbour takes the space; the first pane is never closed.
  function closeLocal(side) {
    const index = layout.locals.indexOf(side);
    if (index < 1) return;
    const node = side.element.parentNode;
    const sibling = [...node.children].find(child => child !== side.element && !child.classList.contains('split-divider'));
    node.replaceWith(sibling);
    layout.locals.splice(index, 1);
    const next = layout.locals.find(pane => sibling === pane.element || sibling.contains(pane.element)) ?? layout.locals[0];
    if (layout.activeLocal === side || !layout.locals.includes(layout.activeLocal)) setActiveLocal(next);
    refreshLocalTools();
    updateControls();
    (layout.activeLocal ?? next).pathSpace.focus();
  }
  // Rebuilds a saved split tree on top of the first local pane, then focuses the saved pane.
  function restoreLocalSplit(saved) {
    const firstFolder = node => node.directory !== undefined ? node.directory : firstFolder(node.first);
    const build = (node, side) => {
      if (!side || node.directory !== undefined) return;
      const added = splitLocal(side, node.axis, node.ratio ?? 0.5, firstFolder(node.second) || undefined, false);
      build(node.first, side);
      build(node.second, added);
    };
    build(saved.tree, layout.locals[0]);
    const order = [...layout.localRoot.querySelectorAll('.file-panel')];
    const focused = layout.locals.find(pane => pane.element === order[saved.focus]);
    setActiveLocal(focused ?? layout.locals[0]);
  }
  if (first) {
    for (const side of layout.locals) addLocalTools(side);
    layout.refreshLocalControls = refreshLocalTools;
  }
  session.applyFavorites = (scope, items) => {
    if (scope === 'local') for (const pane of layout.locals) { favoritesCache.set(pane, items || []); syncFavoriteControl(pane); }
    else { favoritesCache.set(remote, items || []); syncFavoriteControl(remote); }
  };
  const newRemoteFolder = iconButton('plus', 'New remote folder', async () => {
    const name = await askName('');
    if (name === undefined) return;
    await run(async () => {
      await api.sftp(session.id, 'mkdir', session.remoteDirectory, name);
      await loadRemote(session.remoteDirectory);
    });
  });
  remote.tools.append(newRemoteFolder, receive);
  remote.toolbarControls.set('new-folder', newRemoteFolder).set('download', receive);
  if (session.tabRecord.fileLayout) {
    const splitRight = iconButton('splitRight', 'Split SFTP right', () => splitSession(session, 'row'));
    const splitDown = iconButton('splitDown', 'Split SFTP down', () => splitSession(session, 'column'));
    const close = iconButton('close', 'Close remote panel', () => closePane(session));
    for (const control of [splitRight, splitDown, close]) control.dataset.connectionAction = 'true';
    remote.tools.append(splitRight, splitDown, close);
    remote.toolbarControls.set('split-right', splitRight).set('split-down', splitDown);
    remote.closeControl = close;
  }
  finishToolbar(remote);
  session.showFileFilter = () => {
    const focused = [remote, ...layout.locals].find(side => side.element.contains(document.activeElement));
    openFilter(focused || (session.ready ? remote : activeLocal()));
  };
  session.load = target => run(() => loadRemote(target));
  session.refreshRemote = () => session.remoteDirectory && refreshFolder(remote, session.remoteDirectory);
  session.refreshLocal = () => Promise.all(layout.locals.filter(side => side.directory).map(side => refreshFolder(side, side.directory)));
  session.transferFiles = transfer;
  session.refreshFileControls = updateControls;
  updateControls();
  if (first) {
    // A workspace saved with split local panes reopens with the same splits, folders and focused pane.
    const saved = session.tabRecord.localSplit;
    delete session.tabRecord.localSplit;
    let firstLeaf = saved?.tree;
    while (firstLeaf && firstLeaf.directory === undefined) firstLeaf = firstLeaf.first;
    const start = firstLeaf?.directory || local.directory;
    loadLocal(local, start).catch(error => {
      if (start) loadLocal(local).catch(localError);
      else localError(error);
    });
    if (saved) restoreLocalSplit(saved);
  }
}

let transferJobs = [];
let activeCompareRequest = null;
const transferConflictQueue = [];
function dismissTransferConflict(id) {
  const queued = transferConflictQueue.findIndex(item => item.id === id);
  if (queued !== -1) transferConflictQueue.splice(queued, 1);
  const dialog = byId('transfer-conflict-dialog');
  if (dialog.dataset.requestId !== id) return;
  delete dialog.dataset.requestId;
  dialog.close();
  const next = transferConflictQueue.shift();
  if (next) presentTransferConflict(next);
}
// One line per file: size, modification time, and "Newer" on the more recent side (compared in whole seconds).
function conflictFileLine(file, newer) {
  if (!file) return '';
  const date = Number.isFinite(file.modifiedAt) && file.modifiedAt > 0
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(file.modifiedAt) : '—';
  return [formatFileSize(file.size), date, newer ? t('Newer') : ''].filter(Boolean).join(' · ');
}
function presentTransferConflict(value) {
  const dialog = byId('transfer-conflict-dialog');
  if (dialog.open) { transferConflictQueue.push(value); return; }
  dialog.dataset.requestId = value.id;
  byId('transfer-conflict-title').textContent = t(value.message);
  byId('transfer-conflict-detail').textContent = value.detail;
  const incomingSeconds = Math.floor((value.source?.modifiedAt ?? NaN) / 1000);
  const existingSeconds = Math.floor((value.destination?.modifiedAt ?? NaN) / 1000);
  byId('transfer-conflict-incoming').textContent = conflictFileLine(value.source, incomingSeconds > existingSeconds);
  byId('transfer-conflict-existing').textContent = conflictFileLine(value.destination, existingSeconds > incomingSeconds);
  // Every conflict starts with both options off.
  const remaining = value.remaining || 0;
  const all = byId('transfer-conflict-all'), remember = byId('transfer-conflict-remember');
  const note = byId('transfer-conflict-remember-note');
  byId('transfer-conflict-all-row').hidden = remaining < 1;
  byId('transfer-conflict-all-label').textContent = t('Apply to the rest of this transfer');
  all.checked = false;
  remember.checked = false;
  note.hidden = true;
  remember.onchange = () => { note.hidden = !remember.checked; };
  const answer = async (choice, { ignoreOptions = false } = {}) => {
    const applyToGroup = !ignoreOptions && all.checked && remaining > 0;
    const rememberChoice = !ignoreOptions && remember.checked;
    try {
      await api['transfer-resolve-conflict'](value.id, { choice, applyToGroup, remember: rememberChoice });
      dismissTransferConflict(value.id);
    } catch (error) { showTransferError(error); }
  };
  // Escape skips this file only, whatever the options say.
  dialog.oncancel = event => { event.preventDefault(); void answer('skip', { ignoreOptions: true }); };
  for (const control of dialog.querySelectorAll('[data-conflict-choice]')) {
    control.onclick = () => answer(control.dataset.conflictChoice);
  }
  dialog.show();
}
function showTransferError(error) {
  const message = byId('transfer-message');
  message.textContent = error.message;
  message.hidden = false;
}
async function runTransferControl(method, id, action) {
  byId('transfer-message').hidden = true;
  try { await api[method](id, action); }
  catch (error) { showTransferError(error); }
}
const transferDrawer = byId('transfer-drawer');
async function showFolderCompare(session, layout, remote) {
  try {
    const remotePeers = [...sessions.values()].filter(item => item.id !== session.id && item.mode === 'sftp' && item.remoteDirectory);
    const choices = [{ id: 'upload', label: t('Local to Remote') }, { id: 'download', label: t('Remote to Local') }, ...remotePeers.map(peer => ({ id: `remote:${peer.id}`, label: `${t('Compare with')} ${peer.input.label || peer.input.host}` }))];
    const direction = await api['context-menu'](choices);
    if (!direction) return;
    const remoteEndpoint = { kind: 'remote', sessionId: session.id, path: session.remoteDirectory };
    let source, destination;
    if (direction === 'upload' || direction === 'download') {
      const localRoot = layout.directory || await api['local-directory']();
      if (!localRoot) return;
      const localEndpoint = { kind: 'local', path: localRoot };
      [source, destination] = direction === 'upload' ? [localEndpoint, remoteEndpoint] : [remoteEndpoint, localEndpoint];
    } else {
      const peer = sessions.get(String(direction).slice(7));
      if (!peer?.remoteDirectory) throw Error(t('Reconnect the SFTP session before comparing.'));
      source = remoteEndpoint;
      destination = { kind: 'remote', sessionId: peer.id, path: peer.remoteDirectory };
    }
    const dialog = byId('compare-dialog'), rows = byId('compare-rows');
    if (dialog.open || activeCompareRequest) return;
    const requestId = crypto.randomUUID();
    activeCompareRequest = requestId;
    dialog.classList.add('scanning');
    byId('compare-progress-count').textContent = t('Comparing folders');
    const abort = () => api['compare-cancel'](requestId).catch(error => status(session, error.message, true));
    byId('compare-cancel').onclick = () => { dialog.close(); void abort(); };
    dialog.onclose = () => { if (activeCompareRequest === requestId) void abort(); };
    api['transfer-conflict-policy']().then(policy => { byId('compare-conflict-policy').value = policy; }).catch(() => {});
    dialog.show();
    let plan;
    try {
      plan = await api['compare-start'](source, destination, requestId);
    } catch (error) {
      if (dialog.open) { dialog.close(); throw error; }
      return;
    } finally {
      activeCompareRequest = null;
      dialog.classList.remove('scanning');
      dialog.onclose = null;
    }
    if (!dialog.open) return;
    rows.replaceChildren();
    byId('compare-error').hidden = true;
    const all = byId('compare-select-all');
    const detailsToggle = byId('compare-details');
    detailsToggle.textContent = t('Show details'); detailsToggle.setAttribute('aria-pressed', 'false');
    detailsToggle.onclick = () => {
      const open = detailsToggle.getAttribute('aria-pressed') !== 'true';
      rows.querySelectorAll('details').forEach(detail => { detail.open = open; });
      detailsToggle.setAttribute('aria-pressed', String(open));
      detailsToggle.textContent = t(open ? 'Hide details' : 'Show details');
    };
    const summary = byId('compare-summary');
    const actionable = plan.entries.filter(row => row.operation && row.operation !== 'conflict' && (row.source?.type === 'file' || row.source?.emptyDirectory));
    const selectedCount = actionable.filter(row => row.selected).length;
    const apply = byId('compare-apply');
    apply.disabled = selectedCount === 0;
    summary.textContent = `${plan.source} → ${plan.destination} · ${selectedCount} / ${actionable.length} ${t('items selected')}. ${t('Destination-only items are preserved.')}`;
    const updateCount = () => {
      const count = rows.querySelectorAll('input[type=checkbox]:checked').length;
      apply.disabled = count === 0;
      all.checked = count > 0 && count === actionable.length;
      all.indeterminate = count > 0 && count < actionable.length;
      all.disabled = actionable.length === 0;
      summary.dataset.selection = `${count} / ${actionable.length}`;
      summary.querySelector('.compare-selected-count')?.replaceChildren(document.createTextNode(`${count} / ${actionable.length} ${t('items selected')}`));
    };
    const instructions = document.createElement('span'); instructions.className = 'compare-selected-count'; instructions.textContent = `${selectedCount} / ${actionable.length} ${t('items selected')}`;
    summary.replaceChildren(document.createTextNode(`${plan.source} → ${plan.destination} · `), instructions, document.createElement('br'), document.createTextNode(t('Destination-only items are preserved.')));
    if (!plan.entries.some(entry => entry.reason !== 'probably-equal')) {
      const empty = document.createElement('p'); empty.textContent = t('Folders are probably equal.'); rows.append(empty);
    }
    for (const entry of plan.entries) {
      const row = document.createElement('div'); row.className = 'compare-row';
      const selectable = entry.source?.type === 'file' || entry.source?.emptyDirectory;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = Boolean(entry.selected && selectable); checkbox.disabled = !entry.operation || entry.operation === 'conflict' || !selectable; checkbox.dataset.path = entry.relativePath; checkbox.id = `compare-item-${rows.childElementCount}`;
      const name = document.createElement('label'); name.htmlFor = checkbox.id; name.className = 'compare-entry-name'; name.title = entry.relativePath;
      if (entry.source?.type === 'directory') name.append(icon('folder'));
      const filename = document.createElement('span'); filename.textContent = entry.relativePath; name.append(filename);
      const status = document.createElement('span'); status.textContent = t(entry.reason);
      const sizes = document.createElement('small'); sizes.className = 'compare-metadata';
      const sourceInfo = entry.source ? `${t('Source')}: ${entry.source.type === 'directory' ? t('Folder') : formatFileSize(entry.source.size)} · ${entry.source.modifiedAt ? new Date(entry.source.modifiedAt).toLocaleString() : '—'}` : `${t('Source')}: —`;
      const destinationInfo = entry.destination ? `${t('Destination')}: ${entry.destination.type === 'directory' ? t('Folder') : formatFileSize(entry.destination.size)} · ${entry.destination.modifiedAt ? new Date(entry.destination.modifiedAt).toLocaleString() : '—'}` : `${t('Destination')}: —`;
      for (const info of [sourceInfo, destinationInfo]) {
        const line = document.createElement('span');
        line.textContent = info;
        sizes.append(line);
      }
      const detail = document.createElement('details');
      const heading = document.createElement('summary');
      heading.textContent = t('Details');
      detail.append(heading, sizes);
      row.append(checkbox, name, status, detail); rows.append(row);
      checkbox.addEventListener('change', updateCount);
    }
    all.onchange = () => { rows.querySelectorAll('input[type=checkbox]:not(:disabled)').forEach(input => { input.checked = all.checked; }); updateCount(); };
    updateCount();
    apply.onclick = async () => {
      const selected = [...rows.querySelectorAll('input:checked')].map(input => input.dataset.path);
      if (!selected.length) { dialog.close(); return; }
      apply.disabled = true;
      byId('compare-error').hidden = true;
      const applyRequest = crypto.randomUUID(); activeCompareRequest = applyRequest;
      dialog.classList.add('scanning'); byId('compare-progress-count').textContent = t('Checking for changes');
      const cancelApply = () => api['compare-cancel'](applyRequest).catch(error => status(session, error.message, true));
      byId('compare-cancel').onclick = () => { dialog.close(); void cancelApply(); };
      dialog.onclose = () => { if (activeCompareRequest === applyRequest) void cancelApply(); };
      try {
        const jobs = await api['compare-apply'](plan.id, selected, byId('compare-conflict-policy').value, applyRequest);
        dialog.close();
        if (jobs.length) {
          showTransferDrawer();
          renderTransferQueue(await api['transfer-list']());
          status(session, `${jobs.length} transfer jobs queued.`);
        }
      } catch (error) {
        if (dialog.open) { byId('compare-error').textContent = error.message; byId('compare-error').hidden = false; }
      } finally {
        activeCompareRequest = null; dialog.onclose = null; dialog.classList.remove('scanning'); updateCount();
      }
    };
  } catch (error) { status(session, error.message, true); }
}
// The drawer lists only queued, running, paused, failed and interrupted work.
// Finished transfers leave the queue and are kept in the History tab.
const transferActiveStates = ['queued', 'running', 'paused', 'waiting-auth', 'waiting-conflict'];
const transferStateIcons = { queued: 'history', running: 'refresh', paused: 'pause', 'waiting-auth': 'alert', 'waiting-conflict': 'alert', failed: 'alert', interrupted: 'alert', completed: 'check', skipped: 'check', cancelled: 'close' };
const transferTracker = new Map(); // job id -> { batchId, state: 'active' | 'failed' | 'interrupted' | 'done' }
const expandedTransfers = new Set();
let transferOpen = false;
let transferView = 'active';
let transferCollapseTimer = 0;
// The startup banner lists only transfers that were unfinished when PromeFTP launched.
// undefined: not decided yet; null: finished or dismissed for this run; Set: ids still waiting for retry or removal.
let transferStartupIds;
let transferHistoryTimer = 0;
const transferIsActive = job => transferActiveStates.includes(job.state);
// Returns how many jobs failed since the last snapshot, so the user hears about them with the drawer closed.
function trackTransfers(jobs) {
  let newlyFailed = 0;
  const present = new Set(jobs.map(job => job.id));
  for (const [id, entry] of transferTracker) {
    if (present.has(id)) continue;
    // A job that leaves the queue while active has finished (or was cancelled).
    if (entry.state === 'active') {
      entry.state = 'done';
      scheduleTransferRefresh(entry);
    } else transferTracker.delete(id);
  }
  for (const job of jobs) {
    const state = transferIsActive(job) ? 'active' : job.state === 'failed' ? 'failed' : 'interrupted';
    if (state === 'failed' && transferTracker.get(job.id)?.state === 'active') newlyFailed += 1;
    transferTracker.set(job.id, { batchId: job.batchId || '', state, operation: job.operation, sessionId: job.sessionId, targetSessionId: job.targetSessionId });
  }
  return newlyFailed;
}
// A finished job changed its destination folder: reload that pane once the burst of finishing jobs settles.
const pendingTransferRefresh = new Set();
let transferRefreshTimer = 0;
function scheduleTransferRefresh(entry) {
  const remoteTargets = { upload: entry.sessionId, 'mkdir-remote': entry.sessionId, 'remote-duplicate': entry.sessionId, 'remote-copy': entry.targetSessionId };
  if (remoteTargets[entry.operation]) pendingTransferRefresh.add(`remote:${remoteTargets[entry.operation]}`);
  // A local job without a session id (mkdir-local from main.cjs) refreshes every open local pane.
  else if (entry.operation === 'download' || entry.operation === 'mkdir-local') pendingTransferRefresh.add(`local:${entry.sessionId || '*'}`);
  else return;
  clearTimeout(transferRefreshTimer);
  transferRefreshTimer = setTimeout(() => {
    const keys = [...pendingTransferRefresh];
    pendingTransferRefresh.clear();
    const refreshedLayouts = new Set();
    for (const key of keys) {
      const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      if (kind === 'remote') {
        Promise.resolve(sessions.get(id)?.refreshRemote?.()).catch(() => {});
        continue;
      }
      for (const target of id === '*' ? [...sessions.values()] : [sessions.get(id)]) {
        // Sessions that share a file layout show the same local folders, so each layout is refreshed once.
        const layout = target?.fileLayout || target;
        if (!target || refreshedLayouts.has(layout)) continue;
        refreshedLayouts.add(layout);
        Promise.resolve(target.refreshLocal?.()).catch(() => {});
      }
    }
  }, 300);
}
// When the last active transfer ends, report the result and close the drawer if nothing failed.
function finishTransferRun() {
  const entries = [...transferTracker.values()];
  if (entries.some(entry => entry.state === 'active')) return;
  const finished = entries.filter(entry => entry.state === 'done').length;
  if (!finished) return;
  const failed = entries.filter(entry => entry.state === 'failed').length;
  for (const [id, entry] of transferTracker) if (entry.state === 'done') transferTracker.delete(id);
  const session = sessions.get(active);
  if (session) status(session, `${finished} ${t('transfers finished')}${failed ? ` · ${failed} ${t('Failed')}` : ''}`, failed > 0);
  if (!failed && transferOpen) transferCollapseTimer = setTimeout(hideTransferDrawer, 4000);
}
function showTransferDrawer() {
  clearTimeout(transferCollapseTimer);
  transferOpen = true;
  renderTransferQueue(transferJobs);
}
function hideTransferDrawer() {
  clearTimeout(transferCollapseTimer);
  transferOpen = false;
  renderTransferQueue(transferJobs);
}
function toggleTransferDrawer() {
  if (transferOpen) hideTransferDrawer();
  else showTransferDrawer();
}
function transferRoute(job) {
  if (job.operation.startsWith('mkdir-')) return t('Create folder');
  return `${job.sourceName || (job.operation === 'upload' ? t('Local') : t('Remote'))} → ${job.targetName || (job.operation === 'download' ? t('Local') : t('Remote'))}`;
}
function transferStatusIcon(state) {
  const mark = document.createElement('span');
  mark.className = `transfer-status state-${state}`;
  mark.title = t(state);
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', t(state));
  mark.append(icon(transferStateIcons[state] || 'history'));
  return mark;
}
function transferSpeedText(progress) {
  if (!progress?.speed) return '—';
  const remaining = Math.max(0, Math.ceil((progress.total - (progress.bytes || 0)) / progress.speed));
  return `${formatFileSize(progress.speed)}/s · ${remaining}s`;
}
function transferRow(job) {
  const row = document.createElement('article');
  row.className = 'transfer-row';
  row.dataset.state = job.state;
  const main = document.createElement('div');
  main.className = 'transfer-main';
  main.tabIndex = 0;
  const name = document.createElement('strong');
  name.textContent = job.label || job.id;
  name.title = name.textContent;
  const route = document.createElement('small');
  route.textContent = job.state === 'failed' && job.error ? job.error : transferRoute(job);
  route.classList.toggle('transfer-error', job.state === 'failed');
  main.append(name, route);
  const progressCell = document.createElement('div');
  progressCell.className = 'transfer-progress';
  const metrics = document.createElement('div');
  metrics.className = 'transfer-metrics';
  if (job.progress?.total) {
    const progress = document.createElement('progress');
    progress.max = job.progress.total;
    progress.value = Math.min(job.progress.bytes || 0, job.progress.total);
    progress.setAttribute('aria-label', t('Transfer progress'));
    progressCell.append(progress);
    metrics.textContent = transferSpeedText(job.progress);
  }
  const actions = document.createElement('div');
  actions.className = 'transfer-actions';
  const action = (iconName, hint, control) => {
    const element = iconButton(iconName, hint, () => runTransferControl('transfer-control', job.id, control));
    element.dataset.transferFocus = `job:${job.id}:${control}`;
    return element;
  };
  if (['queued', 'running'].includes(job.state)) actions.append(action('pause', 'Pause transfer', 'pause'));
  if (job.state === 'paused') actions.append(action('play', 'Resume transfer', 'resume'));
  if (['queued', 'running', 'paused', 'waiting-conflict'].includes(job.state)) actions.append(action('close', 'Cancel transfer', 'cancel'));
  if (['failed', 'interrupted'].includes(job.state)) actions.append(action('refresh', 'Retry', 'retry'), action('close', 'Remove from list', 'clear'));
  const detail = document.createElement('div');
  detail.className = 'transfer-detail';
  const expanded = expandedTransfers.has(String(job.id));
  detail.hidden = !expanded;
  main.setAttribute('aria-expanded', String(expanded));
  for (const line of transferDetailLines(job)) {
    const text = document.createElement('div');
    text.textContent = line;
    detail.append(text);
  }
  const toggle = () => {
    const open = detail.hidden;
    detail.hidden = !open;
    main.setAttribute('aria-expanded', String(open));
    if (open) expandedTransfers.add(String(job.id)); else expandedTransfers.delete(String(job.id));
  };
  main.addEventListener('click', toggle);
  main.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
  row.append(transferStatusIcon(job.state), main, progressCell, metrics, actions, detail);
  return row;
}
function transferBatchRow(batchId, items) {
  const members = [...transferTracker.values()].filter(entry => entry.batchId === String(batchId));
  const total = Math.max(members.length, items.length);
  const done = members.filter(entry => entry.state === 'done').length;
  const failedCount = items.filter(job => job.state === 'failed').length;
  const activeCount = items.filter(transferIsActive).length;
  const state = failedCount ? 'failed' : activeCount ? (items.find(transferIsActive)?.state || 'queued') : 'interrupted';
  const row = document.createElement('summary');
  row.className = 'transfer-row transfer-batch-row';
  row.dataset.state = state;
  row.dataset.transferFocus = `batch:${batchId}`;
  const main = document.createElement('div');
  main.className = 'transfer-main';
  const title = document.createElement('strong');
  title.textContent = items[0].batchLabel || t('Folder comparison batch');
  title.title = title.textContent;
  const count = document.createElement('small');
  count.textContent = [`${done} / ${total} ${t('completed')}`, failedCount && `${failedCount} ${t('Failed')}`].filter(Boolean).join(' · ');
  main.append(title, count);
  const progressCell = document.createElement('div');
  progressCell.className = 'transfer-progress';
  const progress = document.createElement('progress');
  progress.max = total || 1;
  progress.value = done;
  progress.setAttribute('aria-label', t('Transfer progress'));
  progressCell.append(progress);
  const metrics = document.createElement('div');
  metrics.className = 'transfer-metrics';
  metrics.textContent = `${done} / ${total}`;
  const actions = document.createElement('div');
  actions.className = 'transfer-actions';
  const batchAction = (iconName, hint, control) => {
    const element = iconButton(iconName, hint, () => runTransferControl('transfer-batch-control', String(batchId), control));
    element.dataset.transferFocus = `batch:${batchId}:${control}`;
    element.addEventListener('click', event => event.stopPropagation());
    return element;
  };
  if (items.some(job => ['queued', 'running'].includes(job.state))) actions.append(batchAction('pause', 'Pause batch', 'pause'));
  if (items.some(job => job.state === 'paused')) actions.append(batchAction('play', 'Resume batch', 'resume'));
  if (items.some(job => ['queued', 'running', 'paused', 'waiting-conflict'].includes(job.state))) actions.append(batchAction('close', 'Cancel batch', 'cancel'));
  if (failedCount) actions.append(batchAction('refresh', 'Retry failed', 'retry'));
  row.append(transferStatusIcon(state), main, progressCell, metrics, actions);
  return row;
}
// Transfer rows are kept per job id. A kept row is patched in place while its structure (state, progress bar, error) is unchanged.
const transferRowCache = new Map();
function transferDetailLines(job) {
  return [job.localPath, job.remotePath || job.sourcePath, job.progress?.total && `${formatFileSize(job.progress.bytes || 0)} / ${formatFileSize(job.progress.total)}`, job.error].filter(Boolean);
}
function transferRowStructure(job) {
  return [job.state, job.progress?.total ? 'progress' : '', job.state === 'failed' && job.error ? 'error' : ''].join('|');
}
function updateTransferRow(row, job) {
  const name = row.querySelector('.transfer-main strong');
  name.textContent = job.label || job.id;
  name.title = name.textContent;
  const route = row.querySelector('.transfer-main small');
  route.textContent = job.state === 'failed' && job.error ? job.error : transferRoute(job);
  route.classList.toggle('transfer-error', job.state === 'failed');
  if (job.progress?.total) {
    const progress = row.querySelector('.transfer-progress progress');
    progress.max = job.progress.total;
    progress.value = Math.min(job.progress.bytes || 0, job.progress.total);
    row.querySelector('.transfer-metrics').textContent = transferSpeedText(job.progress);
  }
  row.querySelector('.transfer-detail').replaceChildren(...transferDetailLines(job).map(line => {
    const text = document.createElement('div');
    text.textContent = line;
    return text;
  }));
}
function transferRowFor(job) {
  const key = String(job.id);
  const structure = transferRowStructure(job);
  const cached = transferRowCache.get(key);
  if (cached?.structure === structure) {
    updateTransferRow(cached.element, job);
    return cached.element;
  }
  const element = transferRow(job);
  transferRowCache.set(key, { structure, element });
  return element;
}
function renderTransferQueue(jobs) {
  let newlyFailed = 0;
  if (Array.isArray(jobs)) {
    transferJobs = jobs;
    newlyFailed = trackTransfers(jobs);
  }
  const list = byId('transfer-list');
  if (!list) return;
  const scrollTop = transferDrawer.scrollTop;
  const focusedControl = document.activeElement?.matches?.('[data-transfer-focus]') ? document.activeElement : document.activeElement?.closest?.('[data-transfer-focus]');
  const focusKey = focusedControl?.dataset.transferFocus || '';
  const openBatches = new Set([...list.querySelectorAll('.transfer-batch[open]')].map(node => node.dataset.batchId));
  const groups = new Map();
  for (const job of transferJobs) {
    const key = job.batchId || job.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(job);
  }
  const liveIds = new Set(transferJobs.map(job => String(job.id)));
  for (const key of transferRowCache.keys()) if (!liveIds.has(key)) transferRowCache.delete(key);
  list.replaceChildren();
  for (const [key, items] of groups) {
    if (!items[0].batchId) { list.append(transferRowFor(items[0])); continue; }
    const container = document.createElement('details');
    container.className = 'transfer-batch';
    container.dataset.batchId = String(key);
    container.open = openBatches.has(String(key)) || items.some(transferIsActive);
    const children = document.createElement('div');
    children.className = 'transfer-children';
    children.append(...items.map(transferRowFor));
    container.append(transferBatchRow(key, items), children);
    list.append(container);
  }
  const activeCount = transferJobs.filter(transferIsActive).length;
  const failedCount = transferJobs.filter(job => job.state === 'failed').length;
  const interruptedCount = transferJobs.filter(job => job.state === 'interrupted').length;
  byId('transfer-summary').textContent = [`${activeCount} ${t('Active')}`, failedCount && `${failedCount} ${t('Failed')}`,
    interruptedCount && `${interruptedCount} ${t('interrupted')}`].filter(Boolean).join(' · ');
  refreshTransferBanner();
  byId('transfer-clear-failed').hidden = !failedCount;
  // The toolbar badge counts unfinished work; a red badge means something needs the user's attention.
  const attentionCount = transferJobs.filter(job => ['failed', 'interrupted'].includes(job.state)).length;
  for (const button of document.querySelectorAll('.transfer-toolbar-button')) {
    button.dataset.count = activeCount + attentionCount ? String(activeCount + attentionCount) : '';
    button.classList.toggle('has-failed', attentionCount > 0);
  }
  if (newlyFailed) {
    const session = sessions.get(active);
    if (session) status(session, `${newlyFailed} ${t('Failed')}`, true);
  }
  if (focusKey) [...list.querySelectorAll('[data-transfer-focus]')].find(node => node.dataset.transferFocus === focusKey)?.focus({ preventScroll: true });
  transferDrawer.scrollTop = scrollTop;
  transferDrawer.hidden = !transferOpen;
  const height = transferDrawer.hidden ? 0 : Math.min(transferDrawer.scrollHeight || 220, Math.round(workspace.clientHeight * 0.38));
  workspace.style.setProperty('--transfer-drawer-height', `${height}px`);
  if (Array.isArray(jobs)) finishTransferRun();
}
function setTransferView(view) {
  transferView = view;
  byId('transfer-tab-live').setAttribute('aria-selected', String(view === 'active'));
  byId('transfer-tab-history').setAttribute('aria-selected', String(view === 'history'));
  byId('transfer-list').hidden = view !== 'active';
  byId('transfer-history').hidden = view !== 'history';
  if (view === 'history') loadTransferHistory().catch(showError);
}
async function loadTransferHistory() {
  const query = byId('transfer-history-search').value;
  const rows = await api['transfer-history'](query, 300);
  const list = byId('transfer-history-list');
  list.replaceChildren(...rows.map(entry => {
    const row = document.createElement('article');
    row.className = 'transfer-history-row';
    row.dataset.state = entry.state;
    const main = document.createElement('div');
    main.className = 'transfer-main';
    const name = document.createElement('strong');
    name.textContent = entry.label || entry.id;
    name.title = name.textContent;
    const route = document.createElement('small');
    route.textContent = entry.error || transferRoute(entry);
    route.classList.toggle('transfer-error', entry.state === 'failed');
    main.append(name, route);
    const meta = document.createElement('div');
    meta.className = 'transfer-metrics';
    meta.textContent = `${t(entry.state)} · ${new Date(entry.finishedAt || entry.createdAt).toLocaleString()}`;
    row.append(transferStatusIcon(entry.state), main, meta);
    return row;
  }));
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'transfer-empty';
    empty.textContent = t(query.trim() ? 'No matching transfers.' : 'No transfers yet.');
    list.append(empty);
  }
}
// Recomputed when the queue or the SFTP connection changes, so the retry button appears once SFTP is connected.
function refreshTransferBanner() {
  const banner = byId('transfer-banner');
  // While the drawer is open it lists these transfers with their own retry and remove buttons, so the banner steps aside.
  if (!transferStartupIds || transferOpen) { banner.hidden = true; return; }
  const remaining = transferJobs.filter(job => transferStartupIds.has(job.id) && ['interrupted', 'failed'].includes(job.state)).length;
  // Once every startup transfer has been retried or removed, the banner never returns during this run.
  if (!remaining) { transferStartupIds = null; banner.hidden = true; return; }
  const sftpReady = [...sessions.values()].some(item => item.mode === 'sftp' && item.ready);
  byId('transfer-banner-text').textContent = `${t('Unfinished transfers')}: ${remaining}` + (sftpReady ? '' : ` · ${t('Reconnect SFTP, then retry.')}`);
  byId('transfer-banner-retry').hidden = !sftpReady;
  banner.hidden = false;
}
function showTransferBanner(jobs) {
  if (transferStartupIds !== undefined) return;
  const ids = jobs.filter(job => ['interrupted', 'failed'].includes(job.state)).map(job => job.id);
  transferStartupIds = ids.length ? new Set(ids) : null;
  refreshTransferBanner();
}
byId('transfer-banner-retry').addEventListener('click', async () => {
  byId('transfer-banner').hidden = true;
  try {
    for (const job of transferJobs.filter(item => ['interrupted', 'failed'].includes(item.state))) await api['transfer-control'](job.id, 'retry');
  } catch (error) { showTransferError(error); }
  showTransferDrawer();
});
byId('transfer-banner-dismiss').addEventListener('click', () => { transferStartupIds = null; byId('transfer-banner').hidden = true; });
byId('transfer-clear-failed').addEventListener('click', async () => {
  for (const job of transferJobs.filter(item => item.state === 'failed')) await runTransferControl('transfer-control', job.id, 'clear');
});
byId('transfer-tab-live').addEventListener('click', () => setTransferView('active'));
byId('transfer-tab-history').addEventListener('click', () => setTransferView('history'));
byId('transfer-history-search').addEventListener('input', () => {
  clearTimeout(transferHistoryTimer);
  transferHistoryTimer = setTimeout(() => loadTransferHistory().catch(showError), 150);
});
// The queue must be rendered first: the banner counts from the rendered list.
api['transfer-list']().then(jobs => { renderTransferQueue(jobs); showTransferBanner(jobs); }).catch(() => {});
byId('transfer-toggle').addEventListener('click', hideTransferDrawer);
const workspaceDialog = byId('workspaces-dialog');
const workspaceForm = byId('workspace-form');
const workspaceMessage = byId('workspace-message');
function restoreWorkspace(saved) {
  let layout = saved.panes;
  if (!layout) {
    layout = saved.tabs.map(({ group }, tree) => ({ group, tree }));
    if (Number.isInteger(saved.pinned) && Number.isInteger(saved.active) && saved.pinned !== saved.active) {
      layout[saved.active].tree = { axis: 'row', ratio: saved.ratio, first: saved.pinned, second: saved.active };
      layout.splice(saved.pinned, 1);
    }
  }
  const ids = [];
  for (const entry of layout) {
    let first = entry.tree;
    while (typeof first !== 'number') first = first.first;
    const tab = saved.tabs[first];
    const record = makeTab(tab.input, tab.mode, entry);
    record.localRatio = entry.localRatio;
    record.localSplit = entry.localSplit;
    function onlySftp(tree) {
      return typeof tree === 'number' ? saved.tabs[tree].mode === 'sftp' : onlySftp(tree.first) && onlySftp(tree.second);
    }
    const sharedFiles = onlySftp(entry.tree);
    function decode(tree) {
      if (typeof tree !== 'number') return makeSplit(decode(tree.first), decode(tree.second), tree.axis, tree.ratio);
      const leaf = saved.tabs[tree];
      const id = start(leaf.input, leaf.mode, { ...leaf, tabRecord: record, deferActivation: true, standaloneFiles: !sharedFiles });
      ids[tree] = id;
      return sessions.get(id).pane;
    }
    const content = decode(entry.tree);
    (record.fileLayout?.remotesRoot || record.root).replaceChildren(content);
    record.focus = ids[entry.focus] || record.focus;
  }
  renderTabs();
  activate(ids[saved.active] || ids.filter(Boolean).at(-1));
}

let workspaceTabChoices = [];
function renderWorkspaceTabChoices() {
  const list = byId('workspace-tabs');
  list.replaceChildren();
  workspaceTabChoices = tabRecords.filter(tab => !tab.agent);
  const groups = new Map();
  for (const [index, tab] of workspaceTabChoices.entries()) {
    const name = tab.group || '';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ index, tab });
  }
  for (const [groupName, entries] of groups) {
    const container = document.createElement(groupName ? 'fieldset' : 'div');
    container.className = groupName ? 'workspace-group-choice' : 'workspace-ungrouped-choice';
    if (groupName) {
      const legend = document.createElement('legend');
      const groupCheck = document.createElement('input');
      groupCheck.type = 'checkbox';
      groupCheck.name = 'tab-group';
      groupCheck.value = encodeURIComponent(groupName);
      const label = document.createElement('label');
      label.className = 'check';
      label.append(groupCheck, t('Entire group') + ': ' + groupName);
      legend.append(label);
      container.append(legend);
    }
    for (const { index, tab } of entries) {
      const label = document.createElement('label');
      label.className = 'check';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.name = 'tab';
      check.value = String(index);
      check.checked = sessions.get(active)?.tabRecord === tab;
      label.append(check, (tab.name || tab.label) + ' · ' + tab.mode.toUpperCase());
      container.append(label);
    }
    list.append(container);
  }
  if (!list.childElementCount) list.textContent = t('No tabs open');
  byId('save-workspace-layout').disabled = !workspaceTabChoices.length;
}

async function renderWorkspaces(list = byId('workspace-list')) {
  const sidebar = list.id === 'sidebar-workspace-list';
  const query = sidebar ? byId('workspace-search').value.trim().toLowerCase() : '';
  const savedWorkspaces = orderedItems(await api.workspaces(), 'workspaces', item => item.id);
  list.replaceChildren();
  const filtered = savedWorkspaces.filter(saved => !query || saved.name.toLowerCase().includes(query));
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = sidebar ? 'empty-hosts' : 'file-empty';
    empty.textContent = query ? t('No matching workspaces') : t('No saved workspaces');
    list.append(empty);
  }
  for (const saved of filtered) {
    const row = document.createElement('div');
    row.className = sidebar ? 'bookmark-row workspace-sidebar-row' : 'snippet-row workspace-manager-row';
    const count = saved.panes?.length ?? saved.tabs.length;
    const title = button(saved.name, () => {
      if (!sidebar) workspaceDialog.close();
      restoreWorkspace(saved);
    });
    title.className = 'host';
    const detail = document.createElement('small');
    detail.textContent = count + (count === 1 ? ' tab' : ' tabs');
    title.append(detail);
    row.append(title);
    const menu = () => chooseMenu([
      ['Open Workspace', () => {
        if (!sidebar) workspaceDialog.close();
        restoreWorkspace(saved);
      }],
      ['Rename Workspace…', async () => {
        const name = await askName(saved.name, 'Rename workspace');
        if (name === undefined) return;
        await api['rename-workspace'](saved.id, name);
        await renderWorkspaces();
        await refreshSidebarWorkspaces();
      }],
      null,
      ['Delete Workspace', async () => {
        if (!await api['confirm-remove-workspace'](saved.id)) return;
        await renderWorkspaces();
        await refreshSidebarWorkspaces();
      }],
    ]).catch(error => { sidebar ? showError(error) : workspaceMessage.textContent = error.message; });
    row.addEventListener('contextmenu', event => { event.preventDefault(); menu(); });
    bindOrderedRow(row, 'workspaces', saved.id, () => savedWorkspaces, () => renderWorkspaces(list));
    list.append(row);
  }
}
async function refreshSidebarWorkspaces() {
  await renderWorkspaces(byId('sidebar-workspace-list'));
}
byId('workspace-search').addEventListener('input', refreshSidebarWorkspaces);
async function openWorkspaceManager() {
  try {
    await renderWorkspaces();
    renderWorkspaceTabChoices();
    workspaceMessage.textContent = '';
    if (!workspaceDialog.open) workspaceDialog.showModal();
  } catch (error) { showError(error); }
}
byId('rail-workspaces').addEventListener('click', openWorkspaceManager);
byId('save-workspace-shortcut').addEventListener('click', openWorkspaceManager);
byId('close-workspaces').addEventListener('click', () => workspaceDialog.close());
const guideDialog = byId('guide-dialog');
const guideTopics = [
  ['Connect', 'Use + or ⌘N to enter a host. Choose SSH for a terminal or SFTP for file transfer. Select an OpenSSH alias to inherit its hostname, user, port, and identity.'],
  ['OpenSSH config', 'Use Edit directives to manage global options and Host sections in the app. Match sections are preserved. If a server offers a legacy key exchange, use Configure SSH and add the suggested KEX to that host only.'],
  ['SFTP files', 'Local files are on the left and remote files are on the right. Drag files between panels to transfer. Use the grip in a remote panel toolbar to move that panel within the same tab. Shift selects a range; ⌘ toggles individual items. Right-click files for actions. Remote-to-remote copies work between remote panels in the same tab.'],
  ['File navigation', 'Use the star to save the current folder and the bookmark button to open saved paths. Local favorites are shared across local panels; remote favorites are saved per connection on this Mac. Use the clock for recent paths. Mouse Back and Forward navigate visited paths. Right-click any file or folder and choose Copy Path to copy its full path.'],
  ['Transfer queue and folder compare', 'Open Compare folders from a remote pane to compare the current folders. Select files and queue them for transfer. The Transfers drawer shows progress with pause, cancel, and retry controls. Reconnect this SFTP session before retrying interrupted work.'],
  ['Tabs and splits', 'Drag tabs to reorder, group them, or drop a terminal on an edge to split. Right-click a tab to rename it, set its tab color, duplicate it, group it, or close it. Right-click a group name to rename the group or set its separate group color. ⌘D splits right; ⌘⇧D splits down.'],
  ['Workspaces', 'Save selected open tabs or entire tab groups, including split layout and SFTP paths. Opening a workspace adds its tabs and keeps current sessions open. Restored connections authenticate again. Right-click a saved workspace to rename or delete it.'],
  ['PAM authentication', 'Keyboard-interactive questions appear in the session. Save reusable answers after a successful login, or create global exact-match and regular-expression rules in Preferences → Authentication. Saved values are plain text in the local profile file. Turn off automatic sending if you want to review answers first.'],
  ['Terminal triggers', 'Select recent terminal output and right-click to create a trigger. Choose notify, ask for input in the matching pane, or send a saved response when new output matches. Saved responses can contain multiple lines; each line is sent with Return. Enable or disable rules in the manager beside Snippets.'],
  ['Snippets and search', '⌘P opens snippets; choose one to paste it into the focused terminal. ⌘F searches terminal output. Return moves to the next match and Shift+Return moves to the previous match.'],
  ['Preferences and shortcuts', 'Open Preferences with ⌘,. Choose installed terminal fonts, theme, transparency, and scrollback behavior. ⌘+ and ⌘− adjust terminal text; ⌘0 resets its size. Preferences → Shortcuts lists available key bindings.'],
];
// Split only at sentence ends followed by a capital, CJK/Hangul letter or ⌘, so abbreviations like "e.g. lower" stay intact.
const guideSentenceBreak = /(?<=[.!?。！？])\s+(?=[^\s\p{Ll}])/u;
let guideSections = [];
let guideEmpty;
function buildGuide() {
  guideSections = guideTopics.map(([heading, copy]) => {
    const section = document.createElement('section');
    section.className = 'guide-section';
    const title = document.createElement('h3');
    title.textContent = t(heading);
    const body = document.createElement('p');
    const sentences = t(copy).split(guideSentenceBreak);
    body.replaceChildren(...sentences.flatMap((sentence, index) =>
      index < sentences.length - 1 ? [document.createTextNode(sentence), document.createElement('br')] : [document.createTextNode(sentence)]));
    section.append(title, body);
    section.dataset.search = (title.textContent + ' ' + body.textContent).toLocaleLowerCase();
    return section;
  });
  guideEmpty = document.createElement('p');
  guideEmpty.className = 'empty-hosts';
  guideEmpty.setAttribute('role', 'status');
  guideEmpty.textContent = t('No guide results');
  byId('guide-sections').replaceChildren(...guideSections, guideEmpty);
}
// Search only toggles visibility; the sections are built once per open.
function filterGuide() {
  const query = byId('guide-search').value.trim().toLocaleLowerCase();
  for (const section of guideSections) section.hidden = Boolean(query) && !section.dataset.search.includes(query);
  guideEmpty.hidden = guideSections.some(section => !section.hidden);
}
byId('rail-guide').addEventListener('click', () => {
  byId('guide-search').value = '';
  buildGuide();
  filterGuide();
  if (!guideDialog.open) guideDialog.showModal();
  byId('guide-search').focus();
});
byId('guide-search').addEventListener('input', filterGuide);
byId('close-guide').addEventListener('click', () => guideDialog.close());
workspaceForm.addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(workspaceForm);
  const name = data.get('name');
  const chosen = new Set(data.getAll('tab').map(index => workspaceTabChoices[Number(index)]?.element));
  for (const value of data.getAll('tab-group')) {
    const group = decodeURIComponent(value);
    for (const tab of workspaceTabChoices) if (tab.group === group) chosen.add(tab.element);
  }
  if (!chosen.size) {
    workspaceMessage.textContent = t('Select at least one tab.');
    return;
  }
  const controls = [...workspaceForm.querySelectorAll('button')];
  for (const control of controls) control.disabled = true;
  try {
    const entries = [];
    const indices = new Map();
    let activeIndex = null;
    function encode(node) {
      if (node.axis) return {
        axis: node.axis, ratio: node.ratio,
        first: encode(node.firstElementChild), second: encode(node.lastElementChild),
      };
      const session = sessions.get(node.dataset.session);
      const { mode, input, localDirectory, remoteDirectory } = session;
      const index = entries.length;
      indices.set(session.id, index);
      entries.push({ mode, input, local: session.fileLayout?.local?.directory ?? localDirectory, remote: remoteDirectory });
      if (session.id === active) activeIndex = index;
      return index;
    }
    const visibleTabs = new Map(tabRecords.map(tab => [tab.element, tab]));
    const panes = [...tabGroups.querySelectorAll('.tab')].filter(element => chosen.has(element)).map(element => {
      const { name, group, color, root, focus, fileLayout } = visibleTabs.get(element);
      const tree = encode((fileLayout?.remotesRoot || root).firstElementChild);
      const { groupColor } = visibleTabs.get(element);
      return { name, group, groupColor, color, tree, focus: indices.get(focus), localRatio: fileLayout?.localRatio, localSplit: fileLayout?.localSplitState?.() };
    });
    await api['save-workspace'](name, entries, { active: activeIndex, panes });
    workspaceForm.elements.name.value = '';
    await renderWorkspaces();
    await refreshSidebarWorkspaces();
    workspaceMessage.textContent = t('Layout saved');
  } catch (error) { workspaceMessage.textContent = error.message; }
  finally { for (const control of controls) control.disabled = false; }
});

const triggerDialog = byId('terminal-trigger-dialog');
const triggerEditor = byId('terminal-trigger-editor');
const triggerForm = byId('terminal-trigger-form');
const triggerMessage = byId('terminal-trigger-message');
const triggerEditorMessage = byId('trigger-editor-message');
let triggerSession;
let editingTrigger;

function terminalContext(session) {
  return session && { mode: session.mode, input: session.input };
}
function editTrigger(rule) {
  editingTrigger = rule?.id;
  byId('terminal-trigger-editor-title').textContent = rule ? 'Edit Trigger' : 'Add Trigger';
  triggerForm.elements.name.value = rule?.name || '';
  triggerForm.elements.pattern.value = rule?.pattern || '';
  triggerForm.elements.action.value = rule?.action || 'notify';
  triggerForm.elements.response.value = rule?.response || '';
  triggerForm.elements.scope.value = rule ? (!rule.scope ? 'global' : 'session') : (triggerSession ? 'session' : 'global');
  triggerEditorMessage.textContent = '';
  updateTriggerActionFields();
}
function updateTriggerActionFields() {
  const action = triggerForm.elements.action.value;
  const response = triggerForm.elements.response;
  byId('trigger-response-field').hidden = action !== 'send';
  response.required = action === 'send';
}
triggerForm.elements.action.addEventListener('change', updateTriggerActionFields);
function promptForTrigger(session, value) {
  session.pendingTriggerPrompts ??= new Set();
  if (session.pendingTriggerPrompts.has(value.id)) return;
  session.pendingTriggerPrompts.add(value.id);
  const form = document.createElement('form');
  form.className = 'trigger-prompt';
  const title = document.createElement('strong');
  title.textContent = value.name;
  const field = document.createElement('input');
  field.type = 'text';
  field.maxLength = 1023;
  field.autocomplete = 'off';
  field.setAttribute('aria-label', 'Trigger response');
  field.placeholder = 'Type a response';
  field.required = true;
  const send = button(t('Send'), () => {});
  send.type = 'submit';
  const cancel = button(t('Cancel'), () => {
    session.pendingTriggerPrompts.delete(value.id);
    form.remove();
  });
  const actions = document.createElement('div');
  actions.className = 'trigger-prompt-actions';
  actions.append(send, cancel);
  form.append(title, field, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const response = field.value;
    if (!response || /[\r\n\0]/.test(response) || new TextEncoder().encode(response).length > 1023) return;
    session.pendingTriggerPrompts.delete(value.id);
    form.remove();
    try {
      await api.input(session.id, response + '\r');
    } catch (error) { status(session, error.message, true); }
  });
  session.auth.append(form);
  if (active === session.id) field.focus();
}
function renderTriggerActivity() {
  byId('terminal-trigger-activity').replaceChildren(...(triggerSession?.triggerMatches || []).map(({ name, time, action }) => {
    const item = document.createElement('li');
    const result = action === 'sent' ? t('Response sent') : action === 'ask' ? t('Input requested') : t('Matched');
    item.textContent = new Date(time).toLocaleTimeString() + ' · ' + name + ' · ' + result;
    return item;
  }));
}
async function refreshTriggerRules() {
  const context = terminalContext(triggerSession);
  const rules = await api['terminal-triggers'](context);
  if (!rules.length) {
    const empty = document.createElement('p');
    empty.className = 'trigger-empty';
    empty.textContent = 'No triggers yet.';
    byId('terminal-trigger-rules').replaceChildren(empty);
    return;
  }
  const rows = rules.map(rule => {
    const row = document.createElement('div');
    row.className = 'snippet-row';
    const details = document.createElement('div');
    details.className = 'trigger-rule-details';
    const name = document.createElement('strong');
    const enabled = rule.enabled !== false;
    name.textContent = rule.name;
    const summary = document.createElement('small');
    summary.textContent = rule.pattern + ' · ' + (rule.action === 'ask' ? 'Ask for input' : rule.action === 'send' ? 'Auto-send response' : 'Notify') + ' · ' + (rule.scope ? 'This connection' : 'All sessions');
    details.append(name, summary);
    const toggle = button(t(enabled ? 'On' : 'Off'), async () => {
      toggle.disabled = true;
      try {
        await api['set-terminal-trigger-enabled'](rule.id, !enabled);
        await refreshTriggerRules();
        triggerMessage.textContent = t(enabled ? 'Trigger disabled' : 'Trigger enabled');
      } catch (error) { triggerMessage.textContent = error.message; }
      finally { toggle.disabled = false; }
    });
    toggle.className = 'trigger-toggle' + (enabled ? ' is-enabled' : '');
    toggle.title = t(enabled ? 'Disable trigger' : 'Enable trigger');
    toggle.setAttribute('aria-pressed', String(enabled));
    row.append(details, toggle, iconButton('edit', 'Edit trigger', () => {
      editTrigger(rule);
      triggerEditor.showModal();
      triggerForm.elements.name.focus();
    }), iconButton('trash', 'Remove trigger', async () => {
      try {
        await api['remove-terminal-trigger'](rule.id);
        if (editingTrigger === rule.id) editTrigger();
        await refreshTriggerRules();
      } catch (error) { triggerMessage.textContent = error.message; }
    }));
    return row;
  });
  byId('terminal-trigger-rules').replaceChildren(...rows);
}
async function showTriggers(session, selection) {
  triggerSession = session;
  renderTriggerActivity();
  await refreshTriggerRules();
  if (!triggerDialog.open) triggerDialog.showModal();
  if (selection?.trim()) openTriggerEditor(undefined, selection);
}
function openTriggerEditor(rule, selection) {
  editTrigger(rule);
  if (selection?.trim()) {
    const pattern = selection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\r?\n/g, '\\n');
    triggerForm.elements.name.value = selection.trim().split(/\r?\n/)[0].slice(0, 80);
    if (pattern.length <= 512) triggerForm.elements.pattern.value = pattern;
    else triggerEditorMessage.textContent = t('Select a shorter excerpt or enter a pattern.');
  }
  if (!triggerEditor.open) triggerEditor.showModal();
  triggerForm.elements.name.focus();
}
byId('close-trigger-dialog').addEventListener('click', () => triggerDialog.close());
byId('new-terminal-trigger').addEventListener('click', () => {
  openTriggerEditor();
});
byId('close-trigger-editor').addEventListener('click', () => triggerEditor.close());
byId('cancel-trigger-editor').addEventListener('click', () => triggerEditor.close());
triggerDialog.addEventListener('close', () => { triggerSession = undefined; });
triggerForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  const { name, pattern, action, response, scope } = Object.fromEntries(new FormData(triggerForm));
  try {
    await api['save-terminal-trigger'](name, pattern, action, response, scope === 'session' ? terminalContext(triggerSession) : undefined, editingTrigger);
    await refreshTriggerRules();
    triggerEditor.close();
  } catch (error) { triggerEditorMessage.textContent = error.message; }
  finally { if (submit) submit.disabled = false; }
});

const snippetDialog = byId('snippets-dialog');
const snippetEditor = byId('snippet-editor-dialog');
const snippetForm = byId('snippet-form');
const snippetSearch = byId('snippet-search');
const snippetList = byId('snippet-list');
let snippetSession;
let editingSnippet;
let snippetActive;
// Higher scores come first: name prefix, then a word start in the name, then anywhere in the name, then the command.
function snippetScore(snippet, query) {
  if (!query) return 0;
  const name = snippet.name.toLowerCase();
  if (name.startsWith(query)) return 4;
  if (name.split(/[\s._/-]+/).some(word => word.startsWith(query))) return 3;
  if (name.includes(query)) return 2;
  return snippet.command.toLowerCase().includes(query) ? 1 : -1;
}
// The highlighted row is announced through aria-activedescendant; keyboard focus stays in the search field.
function highlightSnippet(row) {
  snippetActive = row;
  for (const item of snippetList.children) item.setAttribute('aria-selected', String(item === row));
  snippetSearch.setAttribute('aria-activedescendant', row ? row.id : '');
  row?.scrollIntoView({ block: 'nearest' });
}
function filterSnippets() {
  const query = snippetSearch.value.trim().toLowerCase();
  const rows = [...snippetList.children];
  const ranked = rows
    .map(row => ({ row, score: snippetScore(row.snippet, query), used: row.snippet.lastUsedAt || 0 }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score || b.used - a.used || a.row.snippet.name.localeCompare(b.row.snippet.name));
  for (const row of rows) row.hidden = true;
  for (const { row } of ranked) { row.hidden = false; snippetList.append(row); }
  for (const row of rows.filter(item => item.hidden)) snippetList.append(row);
  const empty = byId('snippet-empty');
  empty.hidden = ranked.length > 0;
  empty.textContent = rows.length ? t('No matching snippets. Use + to add one.') : t('No snippets yet. Use + to add one.');
  snippetSearch.setAttribute('aria-expanded', String(ranked.length > 0));
  highlightSnippet(query && ranked[0] ? ranked[0].row : undefined);
}
snippetSearch.addEventListener('input', filterSnippets);
function setSnippetEditor(snippet) {
  editingSnippet = snippet?.id;
  snippetForm.elements.name.value = snippet?.name || '';
  snippetForm.elements.command.value = snippet?.command || '';
  snippetForm.elements.scope.value = snippet ? (snippet.scope ? 'session' : 'global') : (snippetSession ? 'session' : 'global');
  byId('save-snippet').textContent = t(snippet ? 'Save Changes' : 'Save');
  byId('snippet-error').textContent = '';
}
function openSnippetEditor(snippet) {
  setSnippetEditor(snippet);
  if (!snippetEditor.open) snippetEditor.showModal();
  snippetForm.elements.name.focus();
}
// Pastes into the connection when one is ready; otherwise the snippet can only be edited.
function runSnippet(snippet) {
  const target = snippetSession;
  if (!target?.ready || !sessions.has(target.id)) { openSnippetEditor(snippet); return; }
  api['use-snippet'](snippet.id).catch(() => {});
  snippetDialog.close();
  target.terminal.paste(snippet.command);
  target.terminal.focus();
}
async function refreshSnippets() {
  const context = snippetSession && { mode: snippetSession.mode, input: snippetSession.input };
  const snippets = await api.snippets(context);
  snippetList.replaceChildren(...snippets.map(snippet => {
    const row = document.createElement('div');
    row.className = 'snippet-row';
    row.id = 'snippet-option-' + snippet.id;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.snippet = snippet;
    const text = document.createElement('span');
    text.className = 'snippet-text';
    const title = document.createElement('strong');
    title.textContent = snippet.name;
    if (snippet.scope) title.title = t('This connection');
    const preview = document.createElement('small');
    preview.textContent = snippet.command.split('\n')[0];
    text.append(title, preview);
    row.append(text);
    if (snippetSession?.ready) {
      const paste = button(t('Paste into terminal'), () => runSnippet(snippet));
      paste.className = 'paste-snippet';
      row.append(paste);
    }
    row.append(iconButton('edit', 'Edit snippet', () => openSnippetEditor(snippet)), iconButton('trash', 'Remove snippet', async () => {
      try {
        await api['remove-snippet'](snippet.id);
        await refreshSnippets();
      }
      catch (error) { showError(error); }
    }));
    row.addEventListener('click', event => { if (!event.target.closest('button')) highlightSnippet(row); });
    return row;
  }));
  filterSnippets();
}
function showSnippets(session) {
  snippetSession = session && session.mode !== 'sftp' ? session : undefined;
  snippetForm.elements.scope.options[1].disabled = !snippetSession;
  byId('snippet-hint').textContent = snippetSession
    ? 'Paste into ' + (snippetSession.input.label || snippetSession.input.host)
    : 'Open a terminal to use connection snippets.';
  snippetSearch.value = '';
  refreshSnippets().then(() => {
    if (!snippetDialog.open) snippetDialog.showModal();
    snippetSearch.focus();
  }).catch(showError);
}
// Snippets opens as a modal on top of any open dialog, so an unsaved editor is never closed.
// Prompts that wait for a decision (name, conflict, compare, color) keep the shortcut out.
function openSnippetsFromShortcut(session) {
  if (document.querySelector('dialog[open][data-blocking]')) return;
  showSnippets(session);
}
snippetSearch.addEventListener('keydown', event => {
  const rows = [...snippetList.children].filter(row => !row.hidden);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!rows.length) return;
    const index = rows.indexOf(snippetActive);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    highlightSnippet(rows[index < 0 ? (step > 0 ? 0 : rows.length - 1) : (index + step + rows.length) % rows.length]);
  } else if (event.key === 'Enter' && event.metaKey && snippetActive && !event.isComposing) {
    event.preventDefault();
    openSnippetEditor(snippetActive.snippet);
  } else if (event.key === 'Enter' && !event.isComposing) {
    // Enter while an input method is still composing text must not paste.
    event.preventDefault();
    if (snippetActive) runSnippet(snippetActive.snippet);
  }
});
byId('rail-snippets').addEventListener('click', () => showSnippets(sessions.get(active)));
byId('close-snippets').addEventListener('click', () => snippetDialog.close());
byId('add-snippet').addEventListener('click', () => openSnippetEditor());
byId('cancel-snippet-edit').addEventListener('click', () => snippetEditor.close());
snippetEditor.addEventListener('close', () => setSnippetEditor());
snippetForm.addEventListener('submit', async event => {
  event.preventDefault();
  const { name, command, scope } = Object.fromEntries(new FormData(snippetForm));
  const context = scope === 'session' && snippetSession ? { mode: snippetSession.mode, input: snippetSession.input } : undefined;
  try {
    await api['save-snippet'](name, command, context, editingSnippet);
    snippetEditor.close();
    await refreshSnippets();
  } catch (error) { byId('snippet-error').textContent = error.message; }
});
refresh().catch(showError);
activate();

api.onCommand(command => {
  const session = sessions.get(active);
  if (command === 'new-host') { byId('new-host').click(); return; }
  if (command === 'local') { byId('rail-local').click(); return; }
  if (command === 'snippets' || command === 'snippets-alt') { openSnippetsFromShortcut(session); return; }
  if (command === 'triggers') { showTriggers(session); return; }
  if (command === 'open-config') { byId('rail-config').click(); return; }
  if (command === 'preferences') { openPreferences(); return; }
  if (command === 'close-tab') { if (session) closeTab(session.tabRecord); return; }
  if (session?.mode === 'sftp' && command === 'find') { session.showFileFilter?.(); return; }
  if (!session || session.mode === 'sftp') return;
  if (command === 'find') session.showSearch();
  if (command === 'clear') session.terminal.clear();
  if (command === 'split' || command === 'split-down') splitSession(session, command === 'split' ? 'row' : 'column');
  if (command.startsWith('zoom-')) {
    const size = session.terminal.options.fontSize;
    session.terminal.options.fontSize = command === 'zoom-reset' ? terminalPreferences.size
      : Math.max(9, Math.min(30, size + (command === 'zoom-in' ? 1 : -1)));
    session.fit.fit();
  }
});
