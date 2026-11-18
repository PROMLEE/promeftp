let agentInfo;
let agentRefresh = 0;
let agentBusy = false;
const agentElement = name => byId('agent-' + name);
const agentValue = name => agentElement(name).value;
const agentChecked = name => agentElement(name).checked;
const agentStatus = message => { agentElement('message').textContent = t(message); };
const agentFieldErrors = { root: 'agent-root-error', task: 'agent-task-error', 'task-command': 'agent-task-command-error' };
const tokenDialog = byId('agent-token-dialog');
const tokenField = byId('agent-token-value');
let tokenClientId;
function showOneTimeToken(token, clientId) {
  tokenField.value = token;
  tokenClientId = clientId;
  byId('agent-token-message').textContent = '';
  tokenDialog.showModal();
  tokenField.select();
}
tokenDialog.addEventListener('close', () => {
  tokenField.value = '';
  tokenClientId = undefined;
  byId('agent-token-message').textContent = '';
  agentStatus('Token hidden. Revoke and register a new client if you need another token.');
});
byId('agent-token-copy').addEventListener('click', async () => {
  const message = byId('agent-token-message');
  try {
    await api['write-clipboard'](tokenField.value);
    message.textContent = t('Token copied to clipboard.');
  } catch (error) { message.textContent = error.message; }
});
byId('agent-token-save').addEventListener('click', async () => {
  const message = byId('agent-token-message');
  try {
    await api['agent-save-token'](tokenClientId, tokenField.value);
    message.textContent = t('Token saved for installed skills.');
    await refreshAgents();
  } catch (error) { message.textContent = error.message; }
});

function agentOptions(name, entries, empty) {
  const select = agentElement(name);
  const previous = new Set([...select.selectedOptions].map(option => option.value));
  const options = entries.map(entry => {
    const option = new Option(entry.name, entry.id);
    option.disabled = entry.disabled === true;
    option.selected = previous.has(entry.id);
    return option;
  });
  if (empty !== undefined) options.unshift(new Option(t(empty), '', false, previous.has('')));
  select.replaceChildren(...options);
  if (!select.multiple && !select.value && empty === undefined && options.some(o => !o.disabled)) {
    select.value = options.find(o => !o.disabled).value;
  }
}
function selectedProfile() {
  return agentInfo?.profiles.find(p => p.id === agentValue('profile'));
}
// The first thing that blocks the grant form, in order. Only blockers that stop editing disable the fields.
function grantBlocker(client, p) {
  if (!agentChecked('enabled')) return { text: 'Local agent access is off.', action: 'Turn On', run: () => { agentElement('enabled').checked = true; agentElement('enabled').dispatchEvent(new Event('change')); }, stops: true };
  if (!agentInfo?.clients.length) return { text: 'Register an agent client first.', action: 'Register Client', run: () => agentElement('client-name').focus(), stops: true };
  if (!client) return { text: 'Choose the client that will receive this access.', action: 'Choose Client', run: () => agentElement('client').focus(), stops: true };
  if (!p) return { text: 'Choose a bookmark.', action: 'Choose Bookmark', run: () => agentElement('profile').focus(), stops: true };
  if (!p.eligible) return { text: p.reason || 'Use a valid SSH host name or alias.', stops: true };
  if (p.trusted === false) return { text: "This server's host key is not trusted yet. Connect to it once in PromeFTP to trust it.", stops: false };
  return null;
}
function renderGrantBlocker(blocker) {
  agentElement('grant-blocker').hidden = !blocker;
  agentElement('grant-blocker-text').textContent = blocker ? t(blocker.text) : '';
  const action = agentElement('grant-blocker-action');
  action.hidden = !blocker?.action;
  action.textContent = blocker?.action ? t(blocker.action) : '';
  action.onclick = blocker?.run || null;
}
// Automatic host key trust. 'changed' needs a confirmation before it can be selected. The warning names the risk.
const hostKeyTrustWarnings = {
  new: 'PromeFTP will trust a server key it has not seen before without asking. If the first connection is intercepted (man-in-the-middle), saved passwords and answers can be sent to the attacker automatically. You are responsible for this choice.',
  changed: 'PromeFTP will also trust a key that differs from the one you trusted, without asking. A changed key is the main sign of a man-in-the-middle attack. Saved passwords and answers can be sent to the attacker automatically. You are responsible for this choice.',
};
let agentHostKeyTrustConfirmed = 'off';
function setHostKeyTrust(mode) {
  agentElement('host-key-trust').value = mode;
  agentHostKeyTrustConfirmed = mode;
  updateHostKeyTrustWarning();
}
function updateHostKeyTrustWarning() {
  const mode = agentValue('host-key-trust');
  const warning = agentElement('host-key-trust-warning');
  warning.hidden = mode === 'off';
  warning.textContent = mode === 'off' ? '' : t(hostKeyTrustWarnings[mode]);
}
function confirmHostKeyTrustChanged() {
  return new Promise(resolve => {
    const dialog = byId('agent-host-key-dialog');
    const cancel = byId('agent-host-key-cancel');
    byId('agent-host-key-detail').textContent = t(hostKeyTrustWarnings.changed);
    cancel.onclick = () => { dialog.close(); resolve(false); };
    byId('agent-host-key-confirm').onclick = () => { dialog.close(); resolve(true); };
    dialog.addEventListener('close', () => resolve(false), { once: true });
    dialog.showModal();
    cancel.focus();
  });
}
agentElement('host-key-trust').addEventListener('change', async () => {
  const mode = agentValue('host-key-trust');
  if (mode === 'changed' && !(await confirmHostKeyTrustChanged())) {
    setHostKeyTrust(agentHostKeyTrustConfirmed);
    return;
  }
  agentHostKeyTrustConfirmed = mode;
  updateHostKeyTrustWarning();
});
// Automatic trust is listed with its warning colour and the keys it involved.
function autoTrustDetail(event) {
  let value = {};
  try { value = JSON.parse(event.detail || '{}'); } catch {}
  return [t('Host key trusted automatically'), 'Host: ' + value.host, t('New fingerprint') + ': ' + value.fingerprint,
    value.previous ? t('Previous fingerprint') + ': ' + value.previous + ' (' + (value.source || '') + ')' : '',
    'Mode: ' + value.mode].filter(Boolean).join('\n');
}
// Presets only fill the form. Nothing is saved until the user saves it.
const agentPresets = {
  read: { sftp: true, root: '/', download: false, commandApproval: false, savedAuth: false, pam: false, triggers: false, hostKeyTrust: 'off' },
  browse: { sftp: true, root: '/', download: true, commandApproval: false, savedAuth: false, pam: false, triggers: false, hostKeyTrust: 'off' },
  commands: { sftp: true, root: '/', download: true, commandApproval: true, savedAuth: false, pam: false, triggers: false, hostKeyTrust: 'off' },
  maximum: { sftp: true, root: '/', download: true, commandApproval: true, savedAuth: true, pam: true, triggers: true, hostKeyTrust: 'off' },
};
function applyAgentPreset(name) {
  const preset = agentPresets[name];
  if (!preset) return;
  agentElement('sftp').checked = preset.sftp;
  agentElement('root').value = preset.root;
  agentElement('download').checked = preset.download;
  agentElement('approve-commands').checked = preset.commandApproval;
  agentElement('saved-auth').checked = preset.savedAuth;
  setHostKeyTrust(preset.hostKeyTrust);
  for (const field of ['pam', 'triggers']) {
    for (const option of agentElement(field).options) option.selected = preset[field];
  }
  updateAgentSftpFields();
}
// The broadest preset needs a deliberate acknowledgement. Resolves true only when the user confirms.
function confirmMaximumGrant(bookmarkCount) {
  return new Promise(resolve => {
    const dialog = byId('agent-maximum-dialog');
    const ack = byId('agent-maximum-ack');
    const save = byId('agent-maximum-save');
    ack.checked = false;
    save.disabled = true;
    byId('agent-maximum-detail').textContent = t('This client gets browsing, downloads, approved commands, saved authentication and every rule and trigger, for') + ' ' + (bookmarkCount || 1) + ' ' + t('bookmark(s).');
    ack.onchange = () => { save.disabled = !ack.checked; };
    byId('agent-maximum-cancel').onclick = () => { dialog.close(); resolve(false); };
    save.onclick = () => { dialog.close(); resolve(true); };
    dialog.addEventListener('close', () => resolve(false), { once: true });
    dialog.showModal();
    byId('agent-maximum-cancel').focus();
  });
}
function rememberAgentChoice() {
  try { sessionStorage.setItem('agent-grant-choice', JSON.stringify({ client: agentValue('client'), profile: agentValue('profile') })); } catch {}
}
function restoreAgentChoice() {
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem('agent-grant-choice') || '{}'); } catch {}
  const pick = (name, ids) => {
    const element = agentElement(name);
    if (!element.value && ids.includes(saved[name === 'client' ? 'client' : 'profile'])) element.value = saved[name === 'client' ? 'client' : 'profile'];
  };
  pick('client', agentInfo?.clients.map(c => c.id) || []);
  pick('profile', agentInfo?.profiles.map(p => p.id) || []);
  // With a single client there is nothing to choose.
  if (!agentValue('client') && agentInfo?.clients.length === 1) agentElement('client').value = agentInfo.clients[0].id;
}
// The current client, bookmark, and saved grant for the selection.
function currentAgentGrant() {
  const client = agentInfo?.clients.find(c => c.id === agentValue('client'));
  const p = selectedProfile();
  return { client, p, grant: client?.grants[p?.id] };
}
// Choosing a bookmark or client fills the form from the saved grant.
function showAgentGrant() {
  const { client, p, grant } = currentAgentGrant();
  agentElement('preset').value = '';
  loadAgentGrantForm(p, grant);
  refreshAgentGrantState(client, p, grant);
}
// Changing the preset only changes the form. It never reloads the saved values over the choice.
function refreshAgentGrantState(client, p, grant) {
  const blocker = grantBlocker(client, p);
  renderGrantBlocker(blocker);
  const stops = Boolean(blocker?.stops);
  agentElement('grant-fields').disabled = stops;
  agentElement('grant-fields').title = stops ? t(blocker.text) : '';
  agentElement('save-grant').disabled = stops;
  agentElement('preset').disabled = stops;
  agentElement('preset-all').hidden = !agentValue('preset');
  agentElement('preset-all').disabled = stops;
  agentElement('remove-grant').disabled = !grant;
  agentElement('revoke').disabled = !client;
  agentElement('endpoint').textContent = p ? `${p.username ? p.username + '@' : ''}${p.host}${p.port ? ':' + p.port : ''}` +
    (grant?.stale ? ' · ' + t('Save access again after a bookmark change.') : '') : '';
  agentElement('profile-summary').textContent = p && !p.eligible ? t(p.reason || 'Use a valid SSH host name or alias.') : t("Uses this bookmark's SSH settings.");
}
function loadAgentGrantForm(p, grant) {
  agentElement('root').value = grant?.root || '';
  agentElement('sftp').checked = grant ? grant.sftp !== false : false;
  for (const field of Object.keys(agentFieldErrors)) setAgentFieldError(field, '');
  agentElement('download').checked = grant?.download === true;
  agentElement('saved-auth').checked = grant?.savedAuth === true;
  setHostKeyTrust(grant?.hostKeyTrust || 'off');
  agentElement('approve-commands').checked = grant?.commandApproval === true;
  agentElement('task').value = grant?.task?.name || '';
  agentElement('task-command').value = grant?.task?.command || '';
  for (const field of ['pam', 'triggers']) {
    agentOptions(field, p?.[field] || []);
    for (const option of agentElement(field).options) option.selected = grant?.[field]?.includes(option.value) === true;
  }
  updateAgentSftpFields();
}
function updateAgentSftpFields() {
  agentElement('sftp-fields').hidden = !agentChecked('sftp');
  if (!agentChecked('sftp')) setAgentFieldError('root', '');
}
function renderAgentPrompts(prompts) {
  agentElement('prompts').closest('section').hidden = prompts.length === 0;
  const list = agentElement('prompts');
  const existing = new Map([...list.children].map(form => [form.dataset.prompt, form]));
  if (prompts.length === existing.size && prompts.every(p => existing.has(p.id))) return;
  list.replaceChildren(...prompts.map(prompt => {
    if (existing.has(prompt.id)) return existing.get(prompt.id);
    const form = document.createElement('form');
    form.dataset.prompt = prompt.id;
    const title = document.createElement('strong');
    const profile = agentInfo.profiles.find(p => p.id === prompt.profile)?.name || prompt.profile;
    const client = agentInfo.clients.find(c => c.id === prompt.client)?.name || prompt.client;
    title.textContent = client + ' · ' + profile + '\n' + prompt.text;
    const field = document.createElement('input');
    field.type = 'password';
    field.autocomplete = 'off';
    field.setAttribute('aria-label', t('Authentication response'));
    field.required = true;
    const send = button(t('Send'), () => {});
    send.type = 'submit';
    const cancel = button(t('Cancel'), () => agentAction(() => api['agent-answer'](prompt.session, prompt.id, null), false));
    const controls = document.createElement('div');
    controls.className = 'agent-controls';
    controls.append(field, send, cancel);
    form.append(title, controls);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const answer = field.value;
      field.value = '';
      agentAction(() => api['agent-answer'](prompt.session, prompt.id, answer), false);
    });
    return form;
  }));
}
async function refreshAgents(full = true) {
  const turn = ++agentRefresh;
  const info = await api['agent-info']();
  if (turn !== agentRefresh || agentElement('enabled').closest('[hidden]')) return;
  agentInfo = info;
  renderAgentPrompts(info.prompts);
  if (!full) return;
  agentElement('enabled').checked = info.enabled;
  agentElement('cli-path').textContent = info.cli || t('The installed app provides the CLI.');
  if (info.enabled && !info.online) agentStatus('Agent service is offline.');
  agentOptions('client', info.clients.map(client => ({ ...client, name: `${client.name} · ${Object.keys(client.grants || {}).length} ${t('bookmark(s)')}` })), 'Choose client');
  restoreAgentChoice();
  agentOptions('profile', info.profiles.map(p => ({ ...p, disabled: !p.eligible,
    name: p.eligible ? p.name : p.name + ' · ' + t(p.reason || 'Use a valid SSH host name or alias.') })), 'Choose bookmark');
  agentOptions('skill-engine', [...info.targets].sort((a, b) => Number(b.detected) - Number(a.detected))
    .map(target => ({ ...target, name: target.name + (target.detected ? ' · ' + t('Detected') : '') })));
  agentOptions('filter-client', info.clients, 'All');
  agentOptions('filter-profile', info.profiles, 'All');
  agentElement('days').value = info.days;
  agentElement('saved-token-status').hidden = !info.hasSavedToken;
  agentElement('clear-token').hidden = !info.hasSavedToken;
  const skills = info.skills.map(skill => {
    const li = document.createElement('li');
    li.textContent = `${info.targets.find(x => x.id === skill.target)?.name || skill.target} · ${skill.version}` +
      (skill.project ? ' · ' + skill.base.split('/').at(-1) : '') + (skill.automatic ? ' · ' + t('Automatic updates') : '');
    return li;
  });
  agentElement('installed-skills').replaceChildren(...skills);
  showAgentGrant();
  await refreshAgentHistory();
}
function agentFilter() {
  const result = {};
  for (const key of ['client', 'profile', 'result', 'operation', 'request', 'session']) {
    const value = agentValue('filter-' + key).trim();
    if (value) result[key] = value;
  }
  const since = agentValue('filter-since');
  if (since) result.since = new Date(since + 'T00:00:00').valueOf();
  return result;
}
async function refreshAgentHistory() {
  const rows = await api['agent-history'](agentFilter());
  const list = agentElement('history');
  const visibleRows = agentValue('filter-session') ? rows.slice(-5) : rows.slice(0, 5);
  agentElement('history-count').textContent = rows.length > 5 ? t('Showing the 5 most recent activities.') : '';
  list.replaceChildren(...visibleRows.map(event => {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const client = agentInfo?.clients.find(c => c.id === event.client)?.name;
    const profile = agentInfo?.profiles.find(p => p.id === event.profile)?.name;
    const autoTrusted = event.operation === 'hostkey.autotrusted';
    summary.textContent = [new Date(event.time).toLocaleString(), client || event.client, profile || event.profile,
      autoTrusted ? t('Host key trusted automatically') : event.operation, event.result, event.reason].filter(Boolean).join(' · ');
    const text = document.createElement('p');
    text.textContent = autoTrusted ? autoTrustDetail(event)
      : [event.request && 'Request: ' + event.request, event.session && 'Session: ' + event.session, event.detail].filter(Boolean).join('\n');
    details.append(summary, text);
    if (autoTrusted) details.classList.add('error');
    if (event.operation === 'session.error' && event.session) {
      // The raw OpenSSH output is shown here only, and only on request.
      details.append(button(t('Show log'), async () => {
        const diagnostic = await api['agent-diagnostic'](event.session).catch(() => null);
        const log = document.createElement('pre');
        log.className = 'agent-log';
        log.textContent = diagnostic ? diagnostic.log.join('\n') : t('No log is kept for this session.');
        details.append(log, button(t('Copy'), () => api['write-clipboard'](log.textContent).catch(showError)));
      }));
    }
    if (event.session && !agentValue('filter-session')) {
      details.append(button(t('Show session timeline'), () => {
        agentElement('filter-session').value = event.session;
        refreshAgentHistory().catch(showError);
      }));
    }
    return details;
  }));
  if (!rows.length) list.textContent = t('No matching activity.');
}
attachInfoTips(byId('settings-agent'));
// Error codes returned by the main process, written as sentences a user can act on.
const agentCodeMessages = {
  INVALID_PATH: 'Enter an absolute remote path that starts with /.',
  INVALID_TASK: 'Use lowercase letters, numbers, hyphens, and underscores, up to 64 characters.',
  PROFILE_NOT_ELIGIBLE: "This bookmark can't be used by agents. Check its SSH settings.",
  ACCESS_DENIED: 'The bookmark changed after this page loaded. Choose it again and save.',
  INVALID_REQUEST: 'Choose at least one permission: SFTP browsing, approved SSH commands, or a task.',
};
function agentErrorText(error) {
  const text = String(error?.message || error);
  const code = text.match(/([A-Z_]+)$/)?.[1];
  if (code && agentCodeMessages[code]) return t(agentCodeMessages[code]);
  return text.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}
async function agentAction(work, full = true) {
  if (agentBusy) return;
  agentBusy = true;
  agentStatus('');
  try { await work(); await refreshAgents(full); }
  catch (error) { agentStatus(agentErrorText(error)); }
  finally { agentBusy = false; }
}
function agentButton(name, work, full = true) {
  agentElement(name).addEventListener('click', () => agentAction(work, full));
}
agentElement('enabled').addEventListener('change', () => agentAction(async () => {
  try { await api['agent-enable'](agentChecked('enabled')); }
  catch (error) { agentElement('enabled').checked = !agentChecked('enabled'); throw error; }
}));
agentElement('client').addEventListener('change', () => { setGrantStatus(''); rememberAgentChoice(); showAgentGrant(); });
agentElement('profile').addEventListener('change', () => { setGrantStatus(''); rememberAgentChoice(); showAgentGrant(); });
agentElement('sftp').addEventListener('change', updateAgentSftpFields);
for (const field of Object.keys(agentFieldErrors)) agentElement(field).addEventListener('input', () => setAgentFieldError(field, ''));
agentButton('register', async () => {
  if (!agentValue('client-name').trim()) throw Error(t('Enter a client name.'));
  const result = await api['agent-register'](agentValue('client-name').trim());
  if (result?.token) {
    agentElement('client-name').value = '';
    showOneTimeToken(result.token, result.id);
  }
});
agentButton('revoke', () => api['agent-revoke'](agentValue('client')));
agentButton('clear-token', () => api['agent-clear-token']());
const selectedIds = field => [...agentElement(field).selectedOptions].map(option => option.value);
function setGrantStatus(message, ok = false) {
  const status = agentElement('grant-status');
  status.textContent = message;
  status.classList.toggle('error', Boolean(message) && !ok);
  status.classList.toggle('ok', ok);
}
function setAgentFieldError(field, message) {
  const input = agentElement(field);
  const error = byId(agentFieldErrors[field]);
  error.textContent = message ? t(message) : '';
  error.hidden = !message;
  input.setAttribute('aria-invalid', String(Boolean(message)));
  return message ? input : undefined;
}
// Checks the same rules the main process enforces, so each problem is shown next to its field.
function checkAgentGrant() {
  const name = agentValue('task').trim();
  const command = agentValue('task-command').trim();
  const sftp = agentChecked('sftp');
  const pairMessage = 'Enter a task name and a fixed command together.';
  const root = agentValue('root').trim();
  const rootOk = root.startsWith('/') && !/[\x00-\x1f\x7f]/.test(root) && !root.split('/').some(part => part === '.' || part === '..');
  const rootProblem = sftp && !rootOk ? 'To allow SFTP browsing, enter a remote path that starts with /.' : '';
  const taskProblem = name && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)
    ? 'Use lowercase letters, numbers, hyphens, and underscores, up to 64 characters.' : '';
  const invalid = [
    setAgentFieldError('root', rootProblem),
    setAgentFieldError('task', taskProblem || (command && !name ? pairMessage : '')),
    setAgentFieldError('task-command', name && !command ? pairMessage : ''),
  ].find(Boolean);
  if (invalid) { invalid.focus(); return false; }
  const hasTask = Boolean(name && command && !taskProblem);
  if (!sftp && !hasTask && !agentChecked('approve-commands')) {
    setGrantStatus(t(agentCodeMessages.INVALID_REQUEST), false);
    return false;
  }
  return true;
}
function agentGrantFields() {
  const name = agentValue('task').trim();
  const command = agentValue('task-command');
  return {
    root: agentValue('root').trim(), sftp: agentChecked('sftp'), download: agentChecked('download'), savedAuth: agentChecked('saved-auth'),
    commandApproval: agentChecked('approve-commands'), pam: selectedIds('pam'), triggers: selectedIds('triggers'),
    hostKeyTrust: agentValue('host-key-trust'),
    ...(name || command ? { task: { name, command } } : {}),
  };
}
async function saveAgentGrant(remove) {
  if (agentBusy || (!remove && !checkAgentGrant())) return;
  if (!remove && agentElement('preset').value === 'maximum' && !(await confirmMaximumGrant(1))) return;
  agentBusy = true;
  setGrantStatus('');
  try {
    await api['agent-grant'](agentValue('client'), agentValue('profile'), remove ? null : agentGrantFields());
    await refreshAgents();
    setGrantStatus(t(remove ? 'Access removed' : 'Access saved') + ' · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), true);
  } catch (error) {
    setGrantStatus(t('Save failed') + ': ' + agentErrorText(error), false);
  } finally { agentBusy = false; }
}
agentElement('save-grant').addEventListener('click', () => saveAgentGrant(false));
agentElement('preset').addEventListener('change', () => {
  applyAgentPreset(agentValue('preset'));
  const { client, p, grant } = currentAgentGrant();
  refreshAgentGrantState(client, p, grant);
});
// Applies the current form to every eligible bookmark of the client. Each one is checked again on the server.
agentElement('preset-all').addEventListener('click', async () => {
  const client = agentValue('client');
  const eligible = (agentInfo?.profiles || []).filter(profile => profile.eligible).map(profile => profile.id);
  if (!client || !eligible.length) return;
  if (agentValue('preset') === 'maximum' && !(await confirmMaximumGrant(eligible.length))) return;
  try {
    const results = await api['agent-grant-bulk'](client, eligible, agentGrantFields());
    const saved = results.filter(item => item.ok).length;
    const notes = results.filter(item => item.skipped).map(item => {
      const name = agentInfo.profiles.find(p => p.id === item.id)?.name || item.id;
      return `${name}: ${t('PAM rules and triggers are per bookmark and were left out here.')}`;
    });
    const failed = results.filter(item => !item.ok).map(item => `${agentInfo.profiles.find(p => p.id === item.id)?.name || item.id}: ${agentErrorText({ message: item.reason })}`);
    setGrantStatus(`${t('Access saved')}: ${saved} / ${results.length}` + [...notes, ...failed].map(line => ' · ' + line).join(''), saved === results.length && !notes.length);
    await refreshAgents();
  } catch (error) { setGrantStatus(t('Save failed') + ': ' + agentErrorText(error), false); }
});
agentElement('remove-grant').addEventListener('click', () => saveAgentGrant(true));
function skill(action) {
  return api['agent-skill']({ target: agentValue('skill-engine'), action, project: agentValue('skill-scope') === 'project',
    automatic: agentChecked('skill-auto') });
}
agentButton('install', async () => {
  if (await skill('install')) agentStatus('Skill installed. Reload skills or start a new agent session.');
});
agentButton('remove-skill', () => skill('remove'));
agentButton('save-days', () => api['agent-retention'](Number(agentValue('days'))));
agentButton('refresh-history', refreshAgentHistory, false);
agentButton('export', () => api['agent-export'](agentFilter(), agentChecked('export-paths')), false);
agentElement('enabled').closest('section').addEventListener('agent-visible', () => refreshAgents().catch(showError));
setInterval(() => {
  if (!agentBusy && !agentElement('enabled').closest('[hidden]')) refreshAgents(false).catch(() => {});
}, 1500);
