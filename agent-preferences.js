let agentInfo;
let agentRefresh = 0;
let agentBusy = false;
const agentElement = name => byId('agent-' + name);
const agentValue = name => agentElement(name).value;
const agentChecked = name => agentElement(name).checked;
const agentStatus = message => { agentElement('message').textContent = t(message); };

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
function showAgentGrant() {
  const client = agentInfo?.clients.find(c => c.id === agentValue('client'));
  const p = selectedProfile();
  const grant = client?.grants[p?.id];
  agentElement('grant-fields').disabled = !client || !p?.eligible;
  agentElement('save-grant').disabled = !client || !p?.eligible;
  agentElement('remove-grant').disabled = !grant;
  agentElement('revoke').disabled = !client;
  agentElement('endpoint').textContent = p ? `${p.username}@${p.host}:${p.port}` +
    (grant?.stale ? ' · ' + t('Save access again after a bookmark change.') : '') : t('Choose a direct bookmark with an explicit username.');
  agentElement('root').value = grant?.root || '';
  agentElement('sftp').checked = grant?.sftp !== false;
  agentElement('download').checked = grant?.download === true;
  agentElement('saved-auth').checked = grant?.savedAuth === true;
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
  for (const name of ['root', 'download']) agentElement(name).disabled = !agentChecked('sftp');
}
function renderAgentPrompts(prompts) {
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
  agentOptions('client', info.clients, 'Choose client');
  agentOptions('profile', info.profiles.map(p => ({ ...p, disabled: !p.eligible, name: p.eligible ? p.name : p.name + ' · ' + t('Direct connection required') })), 'Choose bookmark');
  agentOptions('skill-engine', [...info.targets].sort((a, b) => Number(b.detected) - Number(a.detected))
    .map(target => ({ ...target, name: target.name + (target.detected ? ' · ' + t('Detected') : '') })));
  agentOptions('filter-client', info.clients, 'All');
  agentOptions('filter-profile', info.profiles, 'All');
  agentElement('days').value = info.days;
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
  list.replaceChildren(...rows.map(event => {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const client = agentInfo?.clients.find(c => c.id === event.client)?.name;
    const profile = agentInfo?.profiles.find(p => p.id === event.profile)?.name;
    summary.textContent = [new Date(event.time).toLocaleString(), client || event.client, profile || event.profile,
      event.operation, event.result, event.reason].filter(Boolean).join(' · ');
    const text = document.createElement('p');
    text.textContent = [event.request && 'Request: ' + event.request, event.session && 'Session: ' + event.session, event.detail].filter(Boolean).join('\n');
    details.append(summary, text);
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
async function agentAction(work, full = true) {
  if (agentBusy) return;
  agentBusy = true;
  agentStatus('');
  try { await work(); await refreshAgents(full); }
  catch (error) { agentStatus(error.message); }
  finally { agentBusy = false; }
}
function agentButton(name, work, full = true) {
  agentElement(name).addEventListener('click', () => agentAction(work, full));
}
agentElement('enabled').addEventListener('change', () => agentAction(async () => {
  try { await api['agent-enable'](agentChecked('enabled')); }
  catch (error) { agentElement('enabled').checked = !agentChecked('enabled'); throw error; }
}));
agentElement('client').addEventListener('change', showAgentGrant);
agentElement('profile').addEventListener('change', showAgentGrant);
agentElement('sftp').addEventListener('change', updateAgentSftpFields);
agentButton('register', async () => {
  if (!agentValue('client-name').trim()) throw Error(t('Enter a client name.'));
  if (await api['agent-register'](agentValue('client-name').trim())) {
    agentElement('client-name').value = '';
    agentStatus('Token copied. The clipboard clears after 30 seconds.');
  }
});
agentButton('revoke', () => api['agent-revoke'](agentValue('client')));
const selectedIds = field => [...agentElement(field).selectedOptions].map(option => option.value);
agentButton('save-grant', () => {
  const name = agentValue('task').trim();
  const command = agentValue('task-command');
  return api['agent-grant'](agentValue('client'), agentValue('profile'), {
    root: agentValue('root').trim(), sftp: agentChecked('sftp'), download: agentChecked('download'), savedAuth: agentChecked('saved-auth'),
    commandApproval: agentChecked('approve-commands'), pam: selectedIds('pam'), triggers: selectedIds('triggers'),
    ...(name || command ? { task: { name, command } } : {}),
  });
});
agentButton('remove-grant', () => api['agent-grant'](agentValue('client'), agentValue('profile'), null));
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
