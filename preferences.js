const api = window.promeftp;
const byId = id => document.getElementById(id);
const terminalDialog = byId('preferences-window');
const terminalForm = byId('terminal-form');
let terminalPreferences = defaultTerminal;
function showError(error) {
  const message = byId('preferences-error');
  message.textContent = error.message;
  message.hidden = false;
}
// Saved answers and global rules are rows. Editing happens in a sheet, and a deleted global rule can be restored for five seconds.
let authUndoTimer = 0;
const authDescribe = entry => entry.prompt || '';
function authRow(entry, kind) {
  const row = document.createElement('div');
  row.className = 'auth-row';
  const text = document.createElement('div');
  text.className = 'auth-row-text';
  if (kind === 'global') {
    const badge = document.createElement('span');
    badge.className = 'auth-badge';
    badge.textContent = t(entry.match === 'regex' ? 'Regular expression' : 'Exact match');
    text.append(badge);
  }
  const question = document.createElement('strong');
  question.textContent = authDescribe(entry);
  question.title = question.textContent;
  text.append(question);
  if (kind === 'host') {
    const host = document.createElement('small');
    host.textContent = entry.host;
    text.append(host);
  }
  const actions = document.createElement('div');
  actions.className = 'auth-row-actions';
  const menu = document.createElement('div');
  menu.className = 'auth-menu';
  menu.hidden = true;
  const more = iconButton('more', 'More actions', () => { menu.hidden = !menu.hidden; });
  more.setAttribute('aria-expanded', 'false');
  more.addEventListener('click', () => more.setAttribute('aria-expanded', String(!menu.hidden)));
  if (kind === 'host') menu.append(button(t('Move to All Hosts'), () => moveAuthReply(entry)));
  menu.append(button(t('Delete'), () => deleteAuthEntry(kind, entry)));
  actions.append(button(t('Edit'), () => openAuthEditor(kind, entry)), more, menu);
  row.append(text, actions);
  return row;
}
function authEmpty(message) {
  const empty = document.createElement('p');
  empty.className = 'auth-empty';
  empty.textContent = t(message);
  return empty;
}
async function refreshAuthLists() {
  await Promise.all([renderSavedAuthReplies(), renderGlobalAuthRules()]);
}
async function renderSavedAuthReplies(isCurrent = isAuthenticationVisible) {
  const entries = await api['saved-auth-replies']();
  if (!isCurrent()) return;
  byId('saved-auth-list').replaceChildren(...(entries.length
    ? entries.map(entry => authRow(entry, 'host'))
    : [authEmpty('No saved answers. After a successful sign-in, choose Save Answer to add one here.')]));
}
async function renderGlobalAuthRules(isCurrent = isAuthenticationVisible) {
  const rules = await api['global-auth-rules']();
  if (!isCurrent()) return;
  byId('global-auth-list').replaceChildren(...(rules.length
    ? rules.map(rule => authRow(rule, 'global'))
    : [authEmpty('No rules yet. Add a rule to answer a question on every connection.')]));
}
async function moveAuthReply(entry) {
  try {
    if (await api['move-auth-reply-to-global'](entry.id)) await refreshAuthLists();
  } catch (error) { byId('saved-auth-message').textContent = error.message; }
}
async function deleteAuthEntry(kind, entry) {
  const message = byId('saved-auth-message');
  // Keep the answer only long enough to restore a deleted global rule.
  const answer = kind === 'global' ? await api['reveal-auth-answer']('global', entry.id).catch(() => null) : null;
  try {
    if (kind === 'global') await api['remove-global-auth-rule'](entry.id);
    else await api['remove-auth-reply'](entry.id);
  } catch (error) { message.textContent = error.message; return; }
  await refreshAuthLists();
  const undo = answer === null ? null : async () => {
    await api['save-global-auth-rule'](entry.prompt, answer, undefined, entry.match || 'exact');
    await refreshAuthLists();
  };
  showAuthUndo(t('Deleted'), undo);
}
function showAuthUndo(text, undo) {
  const box = byId('auth-undo');
  clearTimeout(authUndoTimer);
  box.replaceChildren();
  const label = document.createElement('span');
  label.textContent = text;
  box.append(label);
  if (undo) box.append(button(t('Undo'), async () => { box.hidden = true; await undo(); }));
  box.hidden = false;
  authUndoTimer = setTimeout(() => { box.hidden = true; }, 5000);
}
// True when the test question matches the pattern, false when it does not, and null when the pattern is not valid.
function authPatternMatches(pattern, sample) {
  try {
    const ignoreCase = pattern.startsWith('(?i)');
    return new RegExp(ignoreCase ? pattern.slice(4) : pattern, ignoreCase ? 'i' : '').test(sample);
  } catch { return null; }
}
function openAuthEditor(kind, entry) {
  const dialog = byId('auth-editor-dialog');
  const form = byId('auth-editor-form');
  const isNew = !entry;
  byId('auth-editor-title').textContent = kind === 'global'
    ? t(isNew ? 'New Rule' : 'Edit Rule') : t('Edit Saved Answer');
  form.replaceChildren();
  const message = document.createElement('p');
  message.className = 'error';
  message.setAttribute('role', 'status');
  const match = document.createElement('select');
  match.setAttribute('aria-label', t('Question matching'));
  match.append(new Option(t('Exact match'), 'exact'), new Option(t('Regular expression'), 'regex'));
  match.value = entry?.match === 'regex' ? 'regex' : 'exact';
  match.disabled = kind !== 'global';
  const question = document.createElement('input');
  question.value = entry?.prompt || '';
  question.maxLength = 1000;
  question.required = kind === 'global';
  question.readOnly = kind !== 'global';
  question.setAttribute('aria-label', t('PAM question or pattern'));
  question.placeholder = match.value === 'regex' ? t('Question pattern, e.g. ^OTP code.*:$') : t('Exact PAM question');
  const answer = document.createElement('input');
  answer.type = 'password';
  answer.autocomplete = 'off';
  answer.required = isNew;
  answer.placeholder = isNew ? t('Answer') : t('New answer (optional)');
  answer.setAttribute('aria-label', t('Global PAM answer'));
  const sample = document.createElement('input');
  sample.placeholder = t('Test question');
  sample.setAttribute('aria-label', t('Test question'));
  const result = document.createElement('small');
  result.setAttribute('aria-live', 'polite');
  const updateTest = () => {
    question.placeholder = match.value === 'regex' ? t('Question pattern, e.g. ^OTP code.*:$') : t('Exact PAM question');
    if (match.value !== 'regex' || !sample.value) { result.textContent = ''; return; }
    const outcome = authPatternMatches(question.value, sample.value);
    result.textContent = outcome === null ? t('Not a valid pattern') : t(outcome ? 'Matches' : 'Does not match');
  };
  match.addEventListener('change', updateTest);
  question.addEventListener('input', updateTest);
  sample.addEventListener('input', updateTest);
  const cancel = button(t('Cancel'), () => dialog.close());
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'primary';
  save.textContent = t('Save');
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(cancel, save);
  const fields = kind === 'global'
    ? [['Question matching', match], ['PAM question or pattern', question]]
    : [['PAM question or pattern', question]];
  for (const [label, control] of fields) {
    const row = document.createElement('label');
    row.textContent = t(label);
    row.append(control);
    form.append(row);
  }
  form.append(passwordField(answer));
  if (kind === 'global') {
    const test = document.createElement('label');
    test.textContent = t('Test question');
    test.append(sample, result);
    form.append(test);
  }
  form.append(message, actions);
  form.onsubmit = async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      if (kind === 'global') {
        if (match.value === 'regex' && authPatternMatches(question.value, '') === null) throw Error(t('Not a valid pattern'));
        await api['save-global-auth-rule'](question.value, answer.value, entry?.id, match.value);
      } else if (answer.value) {
        await api['update-auth-reply'](entry.id, answer.value);
      } else {
        dialog.close();
        return;
      }
      dialog.close();
      await refreshAuthLists();
      byId('saved-auth-message').textContent = t('Saved');
    } catch (error) { message.textContent = error.message; }
    finally { save.disabled = false; }
  };
  dialog.showModal();
  (kind === 'global' ? question : answer).focus();
}
byId('add-global-auth').addEventListener('click', () => openAuthEditor('global'));
byId('auth-editor-dialog').addEventListener('close', () => { byId('auth-editor-form').replaceChildren(); });

const settingsPages = [...terminalDialog.querySelectorAll('[data-settings-page]')];
function showSettingsPage(page) {
  for (const button of settingsPages) {
    const selected = button.dataset.settingsPage === page;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  for (const panel of terminalDialog.querySelectorAll('[data-settings-panel]')) {
    panel.hidden = panel.dataset.settingsPanel !== page;
  }
  byId('settings-content').scrollTop = 0;
  byId('settings-actions').hidden = !['general', 'terminal'].includes(page);
  if (page === 'authentication') refreshPamPreferences();
  else clearPamPreferences();
  if (page === 'general') refreshConflictPolicy().catch(showError);
  if (page === 'about') refreshUpdateStatus().catch(showError);
  if (page === 'shortcuts') renderShortcutPreferences().catch(showError);
  if (page === 'agent') byId('settings-agent').dispatchEvent(new Event('agent-visible'));
}
for (const [index, button] of settingsPages.entries()) {
  button.addEventListener('click', () => showSettingsPage(button.dataset.settingsPage));
  button.addEventListener('keydown', event => {
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!delta && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? settingsPages.length - 1
      : (index + delta + settingsPages.length) % settingsPages.length;
    settingsPages[next].focus();
    showSettingsPage(settingsPages[next].dataset.settingsPage);
  });
}
for (const button of document.querySelectorAll('[data-about-link]')) {
  button.addEventListener('click', () => api['open-link'](
    'https://github.com/PROMLEE/promeftp/' + button.dataset.aboutLink
  ).catch(showError));
}
byId('preferences-sponsors').addEventListener('click', () => api['open-sponsors']().catch(showError));
byId('preferences-project-license').addEventListener('click', () => api['open-project-license']().then(error => {
  if (error) showError(error);
}).catch(showError));
byId('preferences-license-notices').addEventListener('click', () => api['open-license-notices']().then(error => {
  if (error) showError(error);
}).catch(showError));
let aboutCopyText = '';
function renderAbout(info) {
  const architecture = info.architecture === 'arm64' ? 'Apple Silicon' : info.architecture;
  byId('preferences-version').textContent = `${t('Version')} ${info.version} (${architecture})`;
  // Bug reports need the version, build, macOS release and CPU type in one paste.
  aboutCopyText = `PromeFTP ${info.version} (${info.build}) · macOS ${info.systemVersion} · ${info.architecture}`;
}
byId('preferences-copy-info').addEventListener('click', async event => {
  const button = event.currentTarget;
  try {
    await api['write-clipboard'](aboutCopyText);
    button.textContent = t('Copied');
    setTimeout(() => { button.textContent = t('Copy'); }, 1500);
  } catch (error) { showError(error); }
});
let aboutInfo;
async function refreshUpdateStatus() {
  if (!aboutInfo || aboutInfo.automatic === null) return;
  const { lastCheck } = await api['update-status']();
  const label = byId('preferences-last-check');
  label.textContent = lastCheck
    ? t('Last update check') + ' · ' + new Date(lastCheck).toLocaleString(document.documentElement.lang)
    : t('No update checks yet');
}
window.addEventListener('focus', () => {
  if (!byId('settings-about').hidden) refreshUpdateStatus().catch(showError);
});
const updateAutomatic = byId('preferences-automatic');
updateAutomatic.addEventListener('change', async () => {
  updateAutomatic.disabled = true;
  try { updateAutomatic.checked = await api['set-automatic-updates'](updateAutomatic.checked); }
  catch (error) { updateAutomatic.checked = !updateAutomatic.checked; showError(error); }
  finally { updateAutomatic.disabled = false; }
});
byId('preferences-check').addEventListener('click', async () => {
  try {
    await api['check-for-updates']();
    await refreshUpdateStatus();
  } catch (error) { showError(error); }
});
byId('preferences-config').addEventListener('click', () => {
  api['open-config-from-preferences']().catch(showError);
});
const fontSelect = byId('terminal-fonts');
const customFont = terminalForm.elements.font;
function selectedFont() { return fontSelect.value || customFont.value.trim() || defaultTerminal.font; }
function renderFontChoices(fonts, preferred) {
  const system = new Option(t('System Monospace'), 'system-monospace');
  const custom = new Option(t('Custom font…'), '');
  fontSelect.replaceChildren(system, ...fonts.map(font => new Option(font, font)), custom);
  fontSelect.value = Array.from(fontSelect.options).some(option => option.value === preferred) ? preferred : '';
  customFont.value = preferred === 'system-monospace' ? '' : preferred;
  refreshTerminalControls();
}
function refreshTerminalControls() {
  byId('custom-font-row').hidden = fontSelect.value !== '';
  const unlimited = terminalForm.elements.scrollbackMode.value === 'unlimited';
  terminalForm.elements.scrollback.disabled = unlimited;
  byId('scrollback-limit-row').hidden = unlimited;
  byId('scrollback-help').textContent = t(unlimited
    ? 'Output stays in memory while the session is open and is never discarded. Closing the session clears it.'
    : 'Keeps the newest lines in memory. Older lines are discarded at the limit. Output is cleared when the session closes.');
  byId('opacity-value').value = terminalForm.elements.opacity.value + '%';
  byId('terminal-font-preview').style.fontFamily = terminalFont(selectedFont());
}
customFont.addEventListener('input', refreshTerminalControls);
fontSelect.addEventListener('change', refreshTerminalControls);
for (const radio of terminalForm.elements.scrollbackMode) radio.addEventListener('change', refreshTerminalControls);
terminalForm.elements.opacity.addEventListener('input', refreshTerminalControls);

async function initializePreferences() {
  const [appearance, info, settings] = await Promise.all([
    api.appearance(), api['application-info'](), api['preferences-data'](),
  ]);
  setLocale(settings.locale);
  terminalPreferences = { ...defaultTerminal, ...settings.terminal };
  terminalForm.elements.appearance.value = appearance;
  terminalForm.elements.language.value = settings.language;
  aboutInfo = info;
  renderAbout(info);
  renderFontChoices(info.fonts, terminalPreferences.font);
  byId('preferences-check').hidden = info.automatic === null;
  byId('preferences-updates').hidden = info.automatic === null;
  updateAutomatic.checked = info.automatic === true;
  for (const key of ['size', 'scrollback']) terminalForm.elements[key].value = terminalPreferences[key];
  terminalForm.elements.opacity.value = terminalPreferences.opacity;
  terminalForm.elements.optionMeta.checked = terminalPreferences.optionMeta;
  terminalForm.elements.scrollbackMode.value = terminalPreferences.unlimited ? 'unlimited' : 'limit';
  refreshTerminalControls();
  openPage(settings.page);
}
function openPage(page) {
  const tab = settingsPages.find(button => button.dataset.settingsPage === page) || settingsPages[0];
  showSettingsPage(tab.dataset.settingsPage);
}
api.onCommand(command => {
  if (command === 'preferences-authentication') openPage('authentication');
  if (command === 'preferences-about') openPage('about');
  if (command === 'preferences-agent') openPage('agent');
});
const keychainControls = { openssh: byId('openssh-keychain'), pam: byId('pam-keychain') };
// The master switch dims the rules and answers it governs.
function refreshAuthControls() { byId('pam-controls').classList.toggle('dimmed', !keychainControls.pam.checked); }
keychainControls.pam.addEventListener('change', refreshAuthControls);
attachInfoTips(document);
for (const [kind, control] of Object.entries(keychainControls)) {
  control.addEventListener('change', async () => {
    control.disabled = true;
    try { await api['set-keychain-preferences'](kind, control.checked); }
    catch (error) { control.checked = !control.checked; showError(error); }
    finally { control.disabled = false; }
  });
}
// Same-name conflicts: the choice is saved as soon as it changes, because transfers read it when they start.
const conflictPolicy = byId('preferences-conflict-policy');
const conflictNote = byId('preferences-conflict-note');
function showConflictPolicy(value) {
  conflictPolicy.value = value;
  conflictPolicy.dataset.saved = value;
  conflictNote.hidden = value === 'ask';
}
async function refreshConflictPolicy() {
  showConflictPolicy(await api['transfer-conflict-policy']());
}
conflictPolicy.addEventListener('change', async () => {
  conflictPolicy.disabled = true;
  try { showConflictPolicy(await api['set-transfer-conflict-policy'](conflictPolicy.value)); }
  catch (error) { showConflictPolicy(conflictPolicy.dataset.saved || 'ask'); showError(error); }
  finally { conflictPolicy.disabled = false; }
});
refreshConflictPolicy().catch(showError);
const savedAuto = byId('saved-auto');
let pamLoad = 0;
function clearPamPreferences() {
  pamLoad++;
  byId('saved-auth-list').replaceChildren();
  byId('global-auth-list').replaceChildren();
}
async function refreshPamPreferences() {
  const load = ++pamLoad;
  const isCurrent = () => load === pamLoad;
  const message = byId('saved-auth-message');
  message.textContent = t('');
  const add = byId('add-global-auth');
  add.disabled = savedAuto.disabled = true;
  try {
    const [automatic, keychain] = await Promise.all([
      api['saved-auto-setting'](), api['keychain-preferences'](),
      renderSavedAuthReplies(isCurrent), renderGlobalAuthRules(isCurrent),
    ]);
    if (isCurrent()) {
      savedAuto.checked = automatic;
      for (const [kind, control] of Object.entries(keychainControls)) control.checked = keychain[kind];
      refreshAuthControls();
    }
  } catch (error) {
    if (isCurrent()) message.textContent = error.message;
  } finally {
    if (isCurrent()) add.disabled = savedAuto.disabled = false;
  }
}
savedAuto.addEventListener('change', async () => {
  savedAuto.disabled = true;
  try { await api['set-saved-auto-setting'](savedAuto.checked); }
  catch (error) {
    savedAuto.checked = !savedAuto.checked;
    byId('saved-auth-message').textContent = error.message;
  } finally { savedAuto.disabled = false; }
});
// Shortcut settings: change a key by pressing it, reset it, and read key diagnostics.
function formatAccelerator(accelerator) {
  if (!accelerator) return '';
  const parts = accelerator.split('+');
  const key = parts.pop();
  const symbols = { Control: '⌃', Alt: '⌥', Shift: '⇧', CmdOrCtrl: '⌘' };
  const keys = { Up: '↑', Down: '↓', Left: '←', Right: '→' };
  return parts.map(part => symbols[part] || part).sort((a, b) => ['⌃', '⌥', '⇧', '⌘'].indexOf(a) - ['⌃', '⌥', '⇧', '⌘'].indexOf(b)).join('') + (keys[key] || key);
}
// Builds the accelerator string for a key press, using the same rules as the main process.
function acceleratorFromEvent(event) {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return null;
  const parts = [];
  if (event.metaKey) parts.push('CmdOrCtrl');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  const names = { Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backquote: '`', NumpadAdd: '=', NumpadSubtract: '-' };
  let key;
  if (/^[\x21-\x7e]$/.test(event.key) && !/^[+_]$/.test(event.key)) key = /^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : event.key;
  else if (event.code.startsWith('Key')) key = event.code.slice(3);
  else if (event.code.startsWith('Digit')) key = event.code.slice(5);
  else if (event.key.startsWith('Arrow')) key = event.key.slice(5);
  else if (/^F\d+$/.test(event.code)) key = event.code;
  else key = names[event.code] ?? event.key;
  return [...parts, key].join('+');
}
const shortcutErrors = {
  'macOS reserves this shortcut.': 'macOS reserves this shortcut.',
  'A shortcut needs a modifier key.': 'A shortcut needs a modifier key.',
  'This key cannot be used.': 'This key cannot be used.',
};
async function renderShortcutPreferences() {
  const groups = await api['keyboard-shortcuts']();
  const list = byId('shortcuts-list');
  list.replaceChildren();
  const message = byId('shortcut-message');
  for (const { title, shortcuts } of groups) {
    const heading = document.createElement('h3');
    heading.textContent = t(title);
    const table = document.createElement('dl');
    for (const item of shortcuts) {
      const term = document.createElement('dt');
      term.textContent = t(item.label);
      const definition = document.createElement('dd');
      const keys = document.createElement('kbd');
      keys.textContent = item.accelerator ? formatAccelerator(item.accelerator) : t('No shortcut');
      definition.append(keys);
      if (item.editable) {
        definition.append(button(t('Change'), () => captureShortcut(item)));
        if (item.custom) definition.append(button(t('Reset'), async () => {
          await api['shortcut-reset'](item.id).catch(error => { message.textContent = error.message; });
          await renderShortcutPreferences();
        }));
      } else {
        term.title = t('Fixed');
      }
      table.append(term, definition);
    }
    list.append(heading, table);
  }
  const reset = button(t('Reset All to Defaults'), async () => {
    await api['shortcut-reset']('*');
    await renderShortcutPreferences();
  });
  list.append(reset);
  const diagnostics = await api['shortcut-diagnostics']();
  byId('shortcut-diagnostics').checked = diagnostics.enabled;
}
// Pressing a key sets the shortcut. Escape cancels, Delete clears it. While capturing, the app's own shortcuts do not run.
// Only one capture runs at a time: starting another one cancels the previous, so a key cannot be saved twice.
let cancelShortcutCapture = null;
async function captureShortcut(item) {
  cancelShortcutCapture?.();
  const message = byId('shortcut-message');
  message.textContent = t('Press keys… (Esc cancels, Delete clears)');
  const stop = () => {
    document.removeEventListener('keydown', onKey, true);
    if (cancelShortcutCapture === stop) cancelShortcutCapture = null;
    api['shortcut-capture'](false).catch(() => {});
  };
  const onKey = event => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { stop(); message.textContent = ''; return; }
    if (event.key === 'Backspace' || event.key === 'Delete') { stop(); save(''); return; }
    const value = acceleratorFromEvent(event);
    if (value) { stop(); save(value); }
  };
  cancelShortcutCapture = stop;
  document.addEventListener('keydown', onKey, true);
  await api['shortcut-capture'](true);
  async function save(value, options = {}) {
    try {
      await api['shortcut-set'](item.id, value, options);
      message.textContent = t('Shortcut saved');
      await renderShortcutPreferences();
    } catch (error) {
      const text = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
      const conflict = /^CONFLICT:([a-z-]+)$/.exec(text);
      if (conflict) {
        const other = (await api['keyboard-shortcuts']()).flatMap(group => group.shortcuts).find(entry => entry.id === conflict[1]);
        if (window.confirm(`${t('This key is already used by')} ${t(other?.label || '')}. ${t('Replace it?')}`)) return save(value, { ...options, replace: true });
        message.textContent = '';
        return;
      }
      if (text === 'EDITING') {
        if (window.confirm(t('This shortcut is used for editing. Use it anyway?'))) return save(value, { ...options, allowEditing: true });
        message.textContent = '';
        return;
      }
      if (text.startsWith('FIXED:')) {
        message.textContent = `${t('This key is fixed for')} ${t(text.slice(6))}.`;
        return;
      }
      message.textContent = t(shortcutErrors[text] || text);
    }
  }
}
byId('shortcut-diagnostics').addEventListener('change', event => {
  api['shortcut-diagnostics'](event.currentTarget.checked).catch(showError);
});
byId('shortcut-log').addEventListener('click', async () => {
  const { lines } = await api['shortcut-diagnostics']();
  const log = byId('shortcut-log-output');
  log.textContent = lines.length ? lines.join('\n') : t('No key events recorded yet.');
  log.hidden = false;
});
terminalForm.addEventListener('submit', async event => {
  event.preventDefault();
  const invalid = [...terminalForm.elements].find(control => control.willValidate && !control.validity.valid);
  if (invalid) {
    showSettingsPage(invalid.closest('[data-settings-panel]').dataset.settingsPanel);
    invalid.reportValidity();
    return;
  }
  const { size, scrollback, scrollbackMode, optionMeta, appearance, language } = terminalForm.elements;
  const unlimited = scrollbackMode.value === 'unlimited';
  const actions = [...byId('settings-actions').querySelectorAll('button')];
  for (const control of actions) control.disabled = true;
  try {
    const settings = await api['save-preferences']({
      appearance: appearance.value,
      language: language.value,
      terminal: {
        font: selectedFont(),
        size: Number(size.value),
        scrollback: unlimited ? terminalPreferences.scrollback : Number(scrollback.value),
        unlimited,
        optionMeta: optionMeta.checked,
        opacity: Number(terminalForm.elements.opacity.value),
      },
    });
    terminalPreferences = settings.terminal;
    setLocale(settings.locale);
    renderAbout(aboutInfo);
    renderFontChoices(aboutInfo.fonts, terminalPreferences.font);
    byId('preferences-error').hidden = true;
    if (event.submitter?.value === 'save') await api['close-preferences']();
  } catch (error) {
    showError(error);
  } finally {
    for (const control of actions) control.disabled = false;
  }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  api['close-preferences']().catch(showError);
});
const aboutIcon = document.querySelector('.about-identity img');
aboutIcon.addEventListener('error', () => { aboutIcon.src = 'app-icon.svg'; }, { once: true });
initializePreferences().catch(showError);
