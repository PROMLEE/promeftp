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
  for (const tab of tabRecords) {
    const inFilter = selectedTabGroup === '*' || (selectedTabGroup === '_' ? !tab.group : tab.group === selectedTabGroup);
    tab.root.hidden = tab !== selectedTab || !inFilter;
    tab.element.classList.toggle('active', tab === selectedTab);
    tab.element.firstElementChild.setAttribute('aria-selected', String(tab === selectedTab));
  }
  for (const pane of sessions.values()) pane.pane.classList.toggle('focused', pane === session);
  if (session && !session.area.hidden) {
    session.fit.fit();
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
  const query = byId('alias-search').value.toLowerCase();
  const list = byId('aliases');
  const configPath = editor.elements.namedItem('configPath').value;
  list.replaceChildren();
  for (const alias of configAliases.filter(name => name.toLowerCase().includes(query))) {
    const item = button(alias, () => {
      configDialog.addEventListener('close', () => {
        destinationField.focus();
        destinationField.setSelectionRange(alias.length, alias.length);
      }, { once: true });
      configDialog.close();
      edit({ label: alias, host: alias, configPath, usesAlias: true }, editor.dataset.intent === 'sftp' ? 'sftp' : 'ssh', splitDraft);
    });
    item.className = 'host alias';
    list.append(item);
  }
}
async function refreshAliases() {
  const request = ++aliasRequest;
  const file = editor.elements.namedItem('configPath').value;
  const names = await api['config-aliases'](file);
  if (request !== aliasRequest) return;
  configAliases = names;
  renderAliases();
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
  pane.replaceChildren();
  return start(input, mode, { tabRecord, pane, fileLayout, local: localDirectory, remote: remoteDirectory });
}
const tabColors = { red: '#ef626b', orange: '#e68c45', yellow: '#d5a631', green: '#55ab73', blue: '#559cf2', purple: '#a582e5', pink: '#e879a8', cyan: '#48b9c7', indigo: '#7777e8', teal: '#32a995', lime: '#98b94d', brown: '#b17a57' };
function validColor(value) {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : tabColors[value] || '';
}
function pickColor(current, onPick) {
  const dialog = document.createElement('dialog');
  dialog.className = 'color-picker-dialog';
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
  if (!draggedBookmark || !session || (session.mode === 'sftp' && !session.tabRecord.fileLayout) ||
      session.tabRecord.root.querySelectorAll('.pane').length >= 20) return;
  const bookmark = draggedBookmark;
  return { zone: edge, effect: 'copy', apply: () => {
    const axis = edge === 'top' || edge === 'bottom' ? 'column' : 'row';
    createSplit(session, axis, bookmark, session.mode === 'sftp' ? 'sftp' : 'ssh', undefined, edge);
  } };
}
function paneDrop(session, event) {
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
  };
  const select = button(t(''), () => activate(record.focus));
  select.setAttribute('role', 'tab');
  const caption = document.createElement('span');
  const modeIcon = icon(mode === 'sftp' ? 'folder' : 'terminal');
  modeIcon.setAttribute('aria-hidden', 'true');
  select.setAttribute('aria-label', (record.label || mode.toUpperCase()) + ' · ' + mode.toUpperCase());
  select.append(modeIcon, caption);
  function updateCaption() {
    caption.textContent = record.name || record.label;
    select.title = caption.textContent + ' · ' + mode.toUpperCase();
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
      entries.push({ mode: session.mode, input: session.input, local: session.fileLayout?.directory ?? session.localDirectory,
        remote: session.remoteDirectory });
      if (session.id === record.focus) focus = index;
      return index;
    }
    const firstPane = root.firstElementChild;
    if (!firstPane) return;
    const tree = encode(firstPane);
    restoreWorkspace({ tabs: entries, panes: [{ name: record.name, group: record.group, groupColor: record.groupColor, color: record.color,
      tree, focus, localRatio: record.fileLayout?.localRatio }], active: focus });
  }
  updateCaption();
  const menu = () => chooseMenu([
    ['Rename Tab…', async () => {
      const name = await askName(record.name || record.label, 'Tab name (blank to reset)', true);
      if (name !== undefined) { record.name = name.trim().slice(0, 80); updateCaption(); select.blur(); }
    }],
    [t('Duplicate Tab'), () => duplicateTab().catch(showError)],
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
  if (!sessions.has(session.id) || session.tabRecord.root.querySelectorAll('.pane').length >= 20 || splitDialog.open) return;
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
  for (const alias of aliases) {
    const item = button(alias, () => {
      splitDialog.close();
      createSplit(session, axis, { host: alias, configPath, usesAlias: true }, mode);
    });
    item.title = 'OpenSSH alias';
    item.dataset.search = alias;
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
    for (const item of choices) item.hidden = !item.dataset.search.toLowerCase().includes(query);
    empty.hidden = choices.some(item => !item.hidden);
  };
  splitDialog.showModal();
  search.focus();
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
  const id = crypto.randomUUID();
  const label = (input.label || input.host) + ' · ' + mode.toUpperCase();
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
  api.connect(id, input, mode, { cols: session.terminal?.cols, rows: session.terminal?.rows }, options.rules || [],
    options.password || '', options.rememberPassword === true).then(() => {
    if (!sessions.has(id)) return api.disconnect(id);
  }).catch(error => {
    showPasswordResult(id, 'Password was not saved. Connection did not complete.');
    status(session, error.message, true);
  });
  return id;
}
api.onSession(({ id, event, value }) => {
  if (event === 'history-changed' && !historyPanel.hidden) refreshHistory();
  const session = sessions.get(id);
  if (!session) return;
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
    session.authActivityButton.title = 'Authentication activity · ' + session.autoReplies.length;
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
    if (session.mode === 'ssh' || session.mode === 'sftp') showReconnect(session);
    else status(session, 'Disconnected');
    session.refreshFileControls?.();
  }
});

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
    const actions = document.createElement('div');
    actions.className = 'session-tools-actions';
    actions.append(iconButton('splitRight', 'Split right (⌘D)', () => splitSession(session, 'row')),
      iconButton('splitDown', 'Split down (⌘⇧D)', () => splitSession(session, 'column')), iconButton('search', 'Find (⌘F)', showSearch),
      iconButton('code', 'Snippets', () => showSnippets(session)), iconButton('trigger', 'Terminal Triggers (⌘P)', () => showTriggers(session)),
    iconButton('download', 'Export session log', async () => {
      try { await api['export-log'](label, session.log || ''); }
      catch (error) { status(session, error.message, true); }
    }));
    actions.append(iconButton('close', 'Close pane', () => closePane(session)));
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
      if (active !== id) activate(id, false);
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
        ['Split Right', () => splitSession(session, 'row')],
        ['Split Down', () => splitSession(session, 'column')],
        ['Close Pane', () => closePane(session)],
      ]).catch(error => status(session, error.message, true));
    });
  }

  terminal.attachCustomKeyEventHandler(event => {
    if (event.type !== 'keydown' || !event.metaKey) return true;
    const key = event.key.toLowerCase();
    if (key === 'p' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      showTriggers(session);
      return false;
    }
    if (!['c', 'v'].includes(key) && !(event.altKey && ['arrowup', 'arrowdown'].includes(key))) return true;
    event.preventDefault();
    event.stopPropagation();
    if (key === 'c' && terminal.hasSelection()) api['write-clipboard'](terminal.getSelection()).catch(() => {});
    if (key === 'v') api['read-clipboard']().then(text => terminal.paste(text)).catch(() => {});
    if (key === 'arrowup' || key === 'arrowdown') jump(key === 'arrowup' ? -1 : 1);
    return false;
  });
  terminal.onData(data => {
    if (!session.closed && (mode !== 'sftp' || !session.ready)) api.input(id, data).catch(error => status(session, error.message, true));
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
  const dot = entry.name.lastIndexOf('.');
  return dot > 0 ? entry.name.slice(dot + 1).toUpperCase() : t('File');
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
  const layout = { container, remotesRoot, directory, connections: new Set() };
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
  container.append(divider, remotesRoot);
  root.append(container);
  return layout;
}

function setupFiles(session) {
  const layout = session.fileLayout ??= makeFileLayout(session.pane, session.localDirectory);
  const first = !layout.local;
  const listing = layout.container;
  session.listing = listing;
  layout.connections.add(session);
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
    element.className = 'file-panel';
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
    const history = iconButton('history', 'Recent folders', () => showHistory(entry));
    history.disabled = true;
    address.append(location, pathBar, history);
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
    element.append(header, address, sortBar, body);
    if (side === 'local') listing.prepend(element);
    else (session.tabRecord.fileLayout ? session.pane : layout.remotesRoot).append(element);
    const entry = {
      side, element, address, location, pathBar, pathSpace, breadcrumbs, history, tools, items, body, tree,
      folders: new Map(), expanded: new Set(['/']), entries: [], selected: new Set(), sortKey: 'name', sortDescending: false,
      sortName, sortSize, sortModified, sortType, pathHistory: [], pathHistoryIndex: -1, pendingPathIndex: undefined,
    };
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
  const local = layout.local ??= panel('Local', 'local');
  const remote = panel('Remote', 'remote');
  const remoteHeading = remote.element.querySelector('h3');
  remoteHeading.classList.add('terminal-session-name');
  remoteHeading.textContent = session.input.label || session.input.host;
  remoteHeading.title = session.input.hostname || session.input.host;
  remote.element.querySelector('.file-heading').classList.add('session-tools', 'sftp-session-tools');
  for (const event of ['pointerdown', 'focusin']) session.pane.addEventListener(event, () => {
    if (active !== session.id && !session.tabRecord.root.hidden) activate(session.id, false);
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
  leading.append(dragPane, activity);
  remote.element.querySelector('.file-heading').prepend(leading);
  let busy = false;
  let localRequest = 0;
  let hiddenFiles = true;
  try { hiddenFiles = localStorage.getItem('sftp-show-hidden') !== 'false'; } catch {}

  function itemPath(side, name) {
    const directory = side === local ? layout.directory : session.remoteDirectory;
    return directory.replace(/\/$/, '') + '/' + name;
  }

  function currentDirectory(side) {
    return side === local ? layout.directory : session.remoteDirectory;
  }
  const { host, hostname, port, username, configPath } = session.input;
  const historyKey = side => 'sftp-folders:' + (side === local ? 'local' :
    JSON.stringify([configPath || '', host, hostname || '', port ?? null, username || '']));
  function recentFolders(side) {
    try {
      const paths = JSON.parse(localStorage.getItem(historyKey(side)));
      return Array.isArray(paths) ? paths.filter(path => typeof path === 'string' && path.startsWith('/')).slice(0, 20)
        .sort((a, b) => fileNameOrder.compare(a.split('/').filter(Boolean).at(-1) || '/', b.split('/').filter(Boolean).at(-1) || '/')
          || fileNameOrder.compare(a, b)) : [];
    } catch { return []; }
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
    const task = side === local ? layout.loadLocal(target) : run(() => loadRemote(target));
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
  async function loadLocal(target) {
    const request = ++localRequest;
    const result = await api['local-list'](target);
    if (request !== localRequest) return;
    layout.directory = result.directory;
    showPath(local, result.directory);
    render(local, hiddenFiles ? result.entries : result.entries.filter(entry => !entry.name.startsWith('.')));
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
      children: side.entries.filter(entry => entry.directory && !entry.link).map(entry => ({
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
      const toggle = iconButton('chevron', (expanded ? 'Collapse ' : 'Expand ') + name, () => {
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
        const loading = side === local ? api['local-list'](path) : api.sftp(session.id, 'list', path);
        loading.then(result => {
          if (side.folders.get(path) !== request) return;
          request.children = result.entries.filter(entry => entry.directory && !entry.link &&
            (side !== local || hiddenFiles || !entry.name.startsWith('.'))).map(entry => ({
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

  async function transfer(receiving, entries, remoteSource) {
    if (!entries.length || (!remoteSource && !layout.directory) || !session.remoteDirectory ||
      layout.transferring || busy || !session.ready) return;
    layout.transferring = true;
    const updateAll = () => {
      for (const connection of layout.connections) connection.refreshFileControls?.();
    };
    updateAll();
    try {
      await run(async () => {
        const localTarget = layout.directory;
        const remoteTarget = session.remoteDirectory;
        const join = (folder, name) => folder.replace(/\/$/, '') + '/' + name;
        try {
          for (const [index, entry] of entries.entries()) {
            status(session, `${index + 1}/${entries.length} · ${entry.name} · Transferring…`);
            if (remoteSource) {
              await api['copy-remote'](remoteSource.id, join(remoteSource.directory, entry.name), session.id, remoteTarget);
            } else if (receiving) await api.sftp(session.id, 'download-local', join(remoteTarget, entry.name), localTarget);
            else await api.sftp(session.id, 'upload-local', remoteTarget, join(localTarget, entry.name));
          }
        } finally {
          if (receiving && layout.directory === localTarget) await layout.loadLocal(localTarget).catch(() => {});
          else if (!receiving && session.ready) await loadRemote(remoteTarget).catch(() => {});
        }
      });
    } finally {
      layout.transferring = false;
      updateAll();
    }
  }

  function navigate(side, target) {
    if (side === local) layout.loadLocal(target).catch(localError);
    else run(() => loadRemote(target));
  }

  async function refreshFolder(side, directory) {
    const prefix = directory.replace(/\/$/, '') + '/';
    for (const key of side.folders.keys()) if (key === directory || key.startsWith(prefix)) side.folders.delete(key);
    if (currentDirectory(side) === directory) {
      if (side === local) await loadLocal(directory);
      else await run(() => loadRemote(directory));
    }
    if (!side.tree.hidden) syncTree(side);
  }

  function setSort(side, key) {
    if (side.sortKey === key) side.sortDescending = !side.sortDescending;
    else { side.sortKey = key; side.sortDescending = key === 'modifiedAt'; }
    render(side, side.entries);
  }

  function render(side, entries) {
    side.selected.clear();
    side.selectionAnchor = undefined;
    side.entries = entries.sort((a, b) => {
      const folderOrder = Number(Boolean(b.directory)) - Number(Boolean(a.directory));
      if (folderOrder) return folderOrder;
      const value = side.sortKey === 'modifiedAt' ? ((a.modifiedAt ?? 0) - (b.modifiedAt ?? 0))
        : side.sortKey === 'size' ? ((a.size ?? -1) - (b.size ?? -1))
        : side.sortKey === 'type' ? (fileNameOrder.compare(fileType(a), fileType(b)) || fileNameOrder.compare(a.name, b.name))
        : (fileNameOrder.compare(a.name, b.name) || a.name.localeCompare(b.name));
      return side.sortDescending ? -value : value;
    });
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
      row.addEventListener('contextmenu', event => {
        event.preventDefault();
        const target = itemPath(side, entry.name);
        const reload = () => side === local ? loadLocal(currentDirectory(side)) : loadRemote(currentDirectory(side));
        const rename = async () => {
          const next = await askName(entry.name, t('Rename…'));
          if (next === undefined || next === entry.name || !next.trim()) return;
          if (side === local) await api['local-action']('rename', currentDirectory(side), entry.name, next.trim());
          else await api.sftp(session.id, 'rename', target, next.trim());
          await reload();
        };
        const remove = async () => {
          if (side === local) await api['local-action']('trash', currentDirectory(side), entry.name);
          else await api.sftp(session.id, 'delete', target);
          await reload();
        };
        const properties = async () => {
          if (side === local) await api['local-action']('info', currentDirectory(side), entry.name);
          else await api.sftp(session.id, 'info', target);
        };
        const entries = side === local ? [
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
          [t('Copy Path'), () => api['write-clipboard'](target)],
          [t('Rename…'), rename],
          [t('Delete'), remove],
          [t('Get Info'), properties],
          null,
          [t('Refresh Folder'), () => refreshFolder(side, currentDirectory(side))],
        ];
        chooseMenu(entries).catch(error => status(session, error.message, true));
      });
      if (side === remote) {
        const rename = iconButton('edit', 'Rename', async () => {
          const next = await askName(entry.name);
          if (next === undefined) return;
          await run(async () => {
            await api.sftp(session.id, 'rename', itemPath(remote, entry.name), next);
            await loadRemote(session.remoteDirectory);
          });
        });
        const remove = iconButton('trash', 'Delete', () => run(async () => {
          await api.sftp(session.id, 'delete', itemPath(remote, entry.name));
          await loadRemote(session.remoteDirectory);
        }));
        rename.classList.add('file-action');
        remove.classList.add('file-action');
        row.append(rename, remove);
      }
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

  for (const side of first ? [local, remote] : [remote]) {
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
    side.tools.append(tree, iconButton('refresh', 'Refresh', () => {
      side.folders.clear();
      navigate(side, currentDirectory(side));
    }));
    const canDrop = () => {
      const source = layout.drag;
      if (!source || source.side === side || layout.transferring) return false;
      if (source.side !== local && (!source.session.ready || !layout.connections.has(source.session))) return false;
      return side === local ? Boolean(layout.directory) : session.ready && Boolean(session.remoteDirectory) && !busy;
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
      if (side === local) source.transferFiles(true, entries);
      else if (sourceSide === local) transfer(false, entries);
      else transfer(false, entries, { id: source.id, directory });
    });
  }
  const receive = iconButton('left', 'Download selection', () => transfer(true, selectedRows(remote)));
  receive.classList.add('transfer-button');
  if (first) {
    layout.loadLocal = loadLocal;
    const send = iconButton('right', 'Upload to selected remote', () => activeRemote()?.transferFiles(false, selectedRows(local)));
    send.classList.add('transfer-button');
    layout.refreshLocalControls = () => {
      const current = activeRemote();
      send.disabled = !current?.canUpload || !selectedRows(local).length;
      local.address.inert = local.items.inert = layout.transferring;
    };
    const hidden = iconButton('eye', hiddenFiles ? 'Hide hidden files' : 'Show hidden files', () => {
      hiddenFiles = !hiddenFiles;
      try { localStorage.setItem('sftp-show-hidden', String(hiddenFiles)); } catch {}
      const hint = hiddenFiles ? 'Hide hidden files' : 'Show hidden files';
      hidden.title = t(hint);
      hidden.setAttribute('aria-label', t(hint));
      hidden.setAttribute('aria-pressed', String(hiddenFiles));
      local.folders.clear();
      navigate(local, layout.directory);
    });
    hidden.setAttribute('aria-pressed', String(hiddenFiles));
    const chooseLocal = iconButton('folder', 'Choose local folder', async () => {
      try {
        const chosen = await api['local-directory'](layout.directory);
        if (chosen) await loadLocal(chosen);
      } catch (error) { localError(error); }
    });
    local.address.append(chooseLocal);
    const newLocalFolder = iconButton('folderPlus', 'New local folder', async () => {
      const name = await askName('');
      if (name === undefined) return;
      try {
        await api['local-mkdir'](layout.directory, name);
        await loadLocal(layout.directory);
      } catch (error) { localError(error); }
    });
    local.tools.append(hidden, newLocalFolder, send);
  }
  remote.tools.append(iconButton('plus', 'New remote folder', async () => {
    const name = await askName('');
    if (name === undefined) return;
    await run(async () => {
      await api.sftp(session.id, 'mkdir', session.remoteDirectory, name);
      await loadRemote(session.remoteDirectory);
    });
  }), receive);
  if (session.tabRecord.fileLayout) {
    const splitRight = iconButton('splitRight', 'Split SFTP right', () => splitSession(session, 'row'));
    const splitDown = iconButton('splitDown', 'Split SFTP down', () => splitSession(session, 'column'));
    const close = iconButton('close', 'Close remote panel', () => closePane(session));
    for (const control of [splitRight, splitDown, close]) control.dataset.connectionAction = 'true';
    remote.tools.append(splitRight, splitDown, close);
  }
  session.load = target => run(() => loadRemote(target));
  session.transferFiles = transfer;
  session.refreshFileControls = updateControls;
  updateControls();
  if (first) loadLocal(layout.directory).catch(error => {
    if (layout.directory) loadLocal().catch(localError);
    else localError(error);
  });
}

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
  workspaceTabChoices = [...tabRecords];
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
  ['File navigation', 'Use the mouse Back and Forward buttons over a local or remote file panel to navigate that panel’s visited paths. Right-click any file or folder and choose Copy Path to copy its full path.'],
  ['Tabs and splits', 'Drag tabs to reorder, group them, or drop a terminal on an edge to split. Right-click a tab to rename it, set its tab color, duplicate it, group it, or close it. Right-click a group name to rename the group or set its separate group color. ⌘D splits right; ⌘⇧D splits down.'],
  ['Workspaces', 'Save selected open tabs or entire tab groups, including split layout and SFTP paths. Opening a workspace adds its tabs and keeps current sessions open. Restored connections authenticate again. Right-click a saved workspace to rename or delete it.'],
  ['PAM authentication', 'Keyboard-interactive questions appear in the session. Save reusable answers after a successful login, or create global exact-match and regular-expression rules in Preferences → Authentication. Saved values are plain text in the local profile file. Turn off automatic sending if you want to review answers first.'],
  ['Terminal triggers', 'Select recent terminal output and right-click to create a trigger. Choose notify, ask for input in the matching pane, or send a saved response when new output matches. Saved responses can contain multiple lines; each line is sent with Return. Enable or disable rules in the manager beside Snippets.'],
  ['Snippets and search', '⌘P opens snippets; choose one to paste it into the focused terminal. ⌘F searches terminal output. Return moves to the next match and Shift+Return moves to the previous match.'],
  ['Preferences and shortcuts', 'Open Preferences with ⌘,. Choose installed terminal fonts, theme, transparency, and scrollback behavior. ⌘+ and ⌘− adjust terminal text; ⌘0 resets its size. Preferences → Shortcuts lists available key bindings.'],
];
function renderGuide() {
  const query = byId('guide-search').value.trim().toLocaleLowerCase();
  const sections = guideTopics.map(([heading, copy]) => {
    const section = document.createElement('section');
    section.className = 'guide-section';
    const title = document.createElement('h3');
    title.textContent = t(heading);
    const body = document.createElement('p');
    body.textContent = t(copy);
    section.append(title, body);
    section.hidden = query && !(title.textContent + ' ' + body.textContent).toLocaleLowerCase().includes(query);
    return section;
  });
  if (!sections.some(section => !section.hidden)) {
    const empty = document.createElement('p');
    empty.className = 'empty-hosts';
    empty.textContent = t('No guide results');
    sections.push(empty);
  }
  byId('guide-sections').replaceChildren(...sections);
}
byId('rail-guide').addEventListener('click', () => {
  byId('guide-search').value = '';
  renderGuide();
  if (!guideDialog.open) guideDialog.showModal();
  byId('guide-search').focus();
});
byId('guide-search').addEventListener('input', renderGuide);
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
      entries.push({ mode, input, local: session.fileLayout?.directory ?? localDirectory, remote: remoteDirectory });
      if (session.id === active) activeIndex = index;
      return index;
    }
    const visibleTabs = new Map(tabRecords.map(tab => [tab.element, tab]));
    const panes = [...tabGroups.querySelectorAll('.tab')].filter(element => chosen.has(element)).map(element => {
      const { name, group, color, root, focus, fileLayout } = visibleTabs.get(element);
      const tree = encode((fileLayout?.remotesRoot || root).firstElementChild);
      const { groupColor } = visibleTabs.get(element);
      return { name, group, groupColor, color, tree, focus: indices.get(focus), localRatio: fileLayout?.localRatio };
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
const snippetForm = byId('snippet-form');
const snippetSearch = byId('snippet-search');
const snippetList = byId('snippet-list');
keyboardChoices(snippetDialog, snippetSearch, snippetList, '.paste-snippet');
function filterSnippets() {
  const query = snippetSearch.value.trim().toLowerCase();
  for (const row of snippetList.children) row.hidden = !row.dataset.search.includes(query);
}
snippetSearch.addEventListener('input', filterSnippets);
let snippetSession;
let editingSnippet;
function setSnippetEditor(snippet) {
  editingSnippet = snippet?.id;
  snippetForm.elements.name.value = snippet?.name || '';
  snippetForm.elements.command.value = snippet?.command || '';
  snippetForm.elements.scope.value = snippet ? (snippet.scope ? 'session' : 'global') : (snippetSession ? 'session' : 'global');
  byId('cancel-snippet-edit').hidden = !snippet;
  byId('save-snippet').textContent = t(snippet ? 'Save Changes' : 'Save');
  byId('snippet-error').textContent = '';
}
byId('cancel-snippet-edit').addEventListener('click', () => setSnippetEditor());
async function refreshSnippets() {
  const list = byId('snippet-list');
  list.replaceChildren();
  const context = snippetSession && { mode: snippetSession.mode, input: snippetSession.input };
  for (const snippet of await api.snippets(context)) {
    const row = document.createElement('div');
    row.className = 'snippet-row';
    row.dataset.search = (snippet.name + ' ' + snippet.command).toLowerCase();
    const title = document.createElement('span');
    title.textContent = snippet.name;
    if (snippet.scope) title.title = 'This connection';
    row.append(title);
    if (snippetSession?.ready) {
      const target = snippetSession;
      const paste = button(t('Paste into terminal'), () => {
        if (!sessions.has(target.id) || !target.ready) return;
        snippetDialog.close();
        target.terminal.paste(snippet.command);
        target.terminal.focus();
      });
      paste.className = 'paste-snippet';
      row.append(paste);
    }
    row.append(iconButton('edit', 'Edit snippet', () => {
      setSnippetEditor(snippet);
      snippetForm.elements.name.focus();
    }), iconButton('trash', 'Remove snippet', async () => {
      try {
        await api['remove-snippet'](snippet.id);
        if (editingSnippet === snippet.id) setSnippetEditor();
        await refreshSnippets();
      }
      catch (error) { showError(error); }
    }));
    list.append(row);
  }
  filterSnippets();
}
function showSnippets(session) {
  snippetSession = session && session.mode !== 'sftp' ? session : undefined;
  const scope = snippetForm.elements.scope;
  scope.options[1].disabled = !snippetSession;
  setSnippetEditor();
  byId('snippet-hint').textContent = snippetSession
    ? 'Paste into ' + (snippetSession.input.label || snippetSession.input.host)
    : 'Open a terminal to use connection snippets.';
  snippetSearch.value = '';
  refreshSnippets().then(() => {
    if (!snippetDialog.open) snippetDialog.showModal();
    snippetSearch.focus();
  }).catch(showError);
}
byId('rail-snippets').addEventListener('click', () => showSnippets(sessions.get(active)));
byId('close-snippets').addEventListener('click', () => snippetDialog.close());
snippetForm.addEventListener('submit', async event => {
  event.preventDefault();
  const { name, command, scope } = Object.fromEntries(new FormData(snippetForm));
  const context = scope === 'session' && snippetSession ? { mode: snippetSession.mode, input: snippetSession.input } : undefined;
  try {
    await api['save-snippet'](name, command, context, editingSnippet);
    setSnippetEditor();
    await refreshSnippets();
  } catch (error) { byId('snippet-error').textContent = error.message; }
});
refresh().catch(showError);
activate();

api.onCommand(command => {
  const session = sessions.get(active);
  if (command === 'new-host') { byId('new-host').click(); return; }
  if (command === 'local') { byId('rail-local').click(); return; }
  if (command === 'snippets') {
    if (!document.querySelector('dialog[open]') || snippetDialog.open) showSnippets(session);
    return;
  }
  if (command === 'triggers') { showTriggers(session); return; }
  if (command === 'open-config') { byId('rail-config').click(); return; }
  if (command === 'preferences') { openPreferences(); return; }
  if (command === 'close-tab') { if (session) closeTab(session.tabRecord); return; }
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
