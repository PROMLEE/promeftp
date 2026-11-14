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
function savedAnswerViewer(kind, entry, row) {
  const view = document.createElement('div');
  view.className = 'saved-answer-view';
  const answer = document.createElement('output');
  answer.hidden = true;
  let generation = 0;
  const hide = () => {
    generation++;
    answer.value = '';
    answer.hidden = true;
    eye.title = t('Show saved answer');
    eye.setAttribute('aria-label', eye.title);
    eye.setAttribute('aria-pressed', 'false');
    eye.replaceChildren(icon('eye'));
  };
  const eye = iconButton('eye', 'Show saved answer', async () => {
    if (!answer.hidden) { hide(); return; }
    const request = ++generation;
    eye.disabled = true;
    try {
      const value = await api['reveal-auth-answer'](kind, entry.id);
      if (request !== generation || !row.isConnected || !row.open || !isAuthenticationVisible()) return;
      answer.value = value;
      answer.hidden = false;
      eye.title = t('Hide saved answer');
      eye.setAttribute('aria-label', eye.title);
      eye.setAttribute('aria-pressed', 'true');
      eye.replaceChildren(icon('eyeOff'));
    } catch { byId('saved-auth-message').textContent = t('Could not read the saved answer.'); }
    finally { eye.disabled = false; }
  });
  eye.setAttribute('aria-pressed', 'false');
  row.addEventListener('toggle', () => { if (!row.open) hide(); });
  view.append(eye, answer);
  return view;
}
async function renderSavedAuthReplies(isCurrent = isAuthenticationVisible) {
  const list = byId('saved-auth-list');
  const entries = await api['saved-auth-replies']();
  if (!isCurrent()) return;
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.textContent = t('No saved answers');
    list.append(empty);
  }
  for (const entry of entries) {
    const row = document.createElement('details');
    const title = document.createElement('summary');
    const host = document.createElement('span');
    host.className = 'saved-auth-host';
    host.textContent = entry.host;
    const question = document.createElement('span');
    question.className = 'saved-auth-question';
    question.textContent = entry.prompt;
    title.append(host, question);
    const form = document.createElement('form');
    const replacement = document.createElement('input');
    replacement.type = 'password';
    replacement.placeholder = t('New answer (optional)');
    replacement.setAttribute('aria-label', t('New answer'));
    replacement.autocomplete = 'off';
    const save = document.createElement('button');
    save.textContent = t('Save');
    save.classList.add('primary');
    const controls = document.createElement('div');
    controls.className = 'actions';
    const message = byId('saved-auth-message');
    controls.append(button(t('Move to Global'), async () => {
      try {
        if (!await api['move-auth-reply-to-global'](entry.id)) return;
        await Promise.all([renderSavedAuthReplies(), renderGlobalAuthRules()]);
        message.textContent = t('Moved to Global PAM Rules');
      } catch (error) { message.textContent = error.message; }
    }));
    controls.append(button(t('Remove'), async () => {
      try {
        await api['remove-auth-reply'](entry.id);
        await renderSavedAuthReplies();
        message.textContent = t('Answer removed');
      } catch (error) { message.textContent = error.message; }
    }), save);
    form.append(passwordField(replacement), savedAnswerViewer('saved', entry, row), controls);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      save.disabled = true;
      try {
        await api['update-auth-reply'](entry.id, replacement.value);
        replacement.value = '';
        row.open = false;
        message.textContent = t('Answer updated');
      } catch (error) { message.textContent = error.message; }
      finally { save.disabled = false; }
    });
    row.append(title, form);
    list.append(row);
  }
}

function globalAuthEditor(entry = {}) {
  const row = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = (entry.match === 'regex' ? 'Regex · ' : '') + (entry.prompt || t('New global rule'));
  const form = document.createElement('form');
  const match = document.createElement('select');
  match.setAttribute('aria-label', t('Question matching'));
  match.append(new Option(t('Exact match'), 'exact'), new Option(t('Regular expression'), 'regex'));
  match.value = entry.match || 'exact';
  const question = document.createElement('input');
  question.setAttribute('aria-label', t('PAM question or pattern'));
  const updatePlaceholder = () => {
    question.placeholder = match.value === 'regex' ? t('Question pattern, e.g. ^OTP code.*:$') : t('Exact PAM question');
  };
  match.addEventListener('change', updatePlaceholder);
  updatePlaceholder();
  question.value = entry.prompt || '';
  question.maxLength = 1000;
  question.required = true;
  const answer = document.createElement('input');
  answer.type = 'password';
  answer.placeholder = entry.id ? t('New answer (optional)') : t('Answer');
  answer.setAttribute('aria-label', t('Global PAM answer'));
  answer.autocomplete = 'off';
  answer.required = !entry.id;
  const controls = document.createElement('div');
  controls.className = 'actions';
  const message = byId('saved-auth-message');
  const save = document.createElement('button');
  save.textContent = t('Save');
  save.classList.add('primary');
  controls.append(button(t(entry.id ? 'Remove' : 'Cancel'), async () => {
    try {
      if (entry.id) await api['remove-global-auth-rule'](entry.id);
      row.remove();
    } catch (error) { message.textContent = error.message; }
  }), save);
  form.append(match, question, passwordField(answer));
  if (entry.id) form.append(savedAnswerViewer('global', entry, row));
  form.append(controls);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      await api['save-global-auth-rule'](question.value, answer.value, entry.id, match.value);
      answer.value = '';
      await renderGlobalAuthRules();
      message.textContent = t('Global rule saved');
    } catch (error) { message.textContent = error.message; }
    finally { save.disabled = false; }
  });
  row.append(summary, form);
  return row;
}
function isAuthenticationVisible() {
  return !byId('settings-authentication').hidden;
}
async function renderGlobalAuthRules(isCurrent = isAuthenticationVisible) {
  const rules = await api['global-auth-rules']();
  if (!isCurrent()) return;
  byId('global-auth-list').replaceChildren(...rules.map(globalAuthEditor));
}
byId('add-global-auth').addEventListener('click', () => {
  const row = globalAuthEditor();
  byId('global-auth-list').append(row);
  row.open = true;
  row.querySelector('input').focus();
});

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
function renderAbout(info) {
  byId('preferences-version').textContent = t('Version') + ' ' + info.version + ' · ' + t('Build') + ' ' + info.build;
  byId('preferences-platform').textContent = (info.architecture === 'arm64' ? 'Apple Silicon' : info.architecture)
    + ' · macOS ' + info.systemVersion;
}
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
  terminalForm.elements.scrollback.disabled = terminalForm.elements.unlimited.checked;
  byId('opacity-value').value = terminalForm.elements.opacity.value + '%';
  byId('terminal-font-preview').style.fontFamily = terminalFont(selectedFont());
}
customFont.addEventListener('input', refreshTerminalControls);
fontSelect.addEventListener('change', refreshTerminalControls);
terminalForm.elements.unlimited.addEventListener('change', refreshTerminalControls);
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
  for (const key of ['optionMeta', 'unlimited']) terminalForm.elements[key].checked = terminalPreferences[key];
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
for (const [kind, control] of Object.entries(keychainControls)) {
  control.addEventListener('change', async () => {
    control.disabled = true;
    try { await api['set-keychain-preferences'](kind, control.checked); }
    catch (error) { control.checked = !control.checked; showError(error); }
    finally { control.disabled = false; }
  });
}
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
async function renderShortcutPreferences() {
  const groups = await api['keyboard-shortcuts']();
  const list = byId('shortcuts-list');
  list.replaceChildren();
  for (const { title, shortcuts } of groups) {
    const heading = document.createElement('h3');
    heading.textContent = t(title);
    const rows = document.createElement('dl');
    for (const [label, accelerator] of shortcuts) {
      const term = document.createElement('dt');
      term.textContent = t(label);
      const definition = document.createElement('dd');
      const keys = document.createElement('kbd');
      keys.textContent = accelerator.replace('CmdOrCtrl+', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥');
      definition.append(keys);
      rows.append(term, definition);
    }
    list.append(heading, rows);
  }
}
terminalForm.addEventListener('submit', async event => {
  event.preventDefault();
  const invalid = [...terminalForm.elements].find(control => control.willValidate && !control.validity.valid);
  if (invalid) {
    showSettingsPage(invalid.closest('[data-settings-panel]').dataset.settingsPanel);
    invalid.reportValidity();
    return;
  }
  const { size, scrollback, unlimited, optionMeta, appearance, language } = terminalForm.elements;
  const actions = [...byId('settings-actions').querySelectorAll('button')];
  for (const control of actions) control.disabled = true;
  try {
    const settings = await api['save-preferences']({
      appearance: appearance.value,
      language: language.value,
      terminal: {
        font: selectedFont(),
        size: Number(size.value),
        scrollback: unlimited.checked ? terminalPreferences.scrollback : Number(scrollback.value),
        unlimited: unlimited.checked,
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
  if (event.key !== 'Escape') return;
  event.preventDefault();
  api['close-preferences']().catch(showError);
});
const aboutIcon = document.querySelector('.about-identity img');
aboutIcon.addEventListener('error', () => { aboutIcon.src = 'app-icon.svg'; }, { once: true });
initializePreferences().catch(showError);
