// Validation and normalization for saved profiles, folder and workspace names, and snippet scopes. No Electron dependency.
const path = require('node:path');

function expandHome(value, home) {
  const trimmed = value.trim();
  return trimmed.startsWith('~/') ? path.join(home, trimmed.slice(2)) : trimmed;
}
function profile(input, home) {
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
    keyPath: expandHome(keyPath, home), group: group.trim(), configPath: expandHome(configPath, home), pam: Boolean(pam),
    usesAlias: input.usesAlias === true,
  };
}
function bookmarkFolderNames(snapshot) {
  return new Set([...(snapshot.bookmarkFolders || []), ...snapshot.profiles.map(entry => entry.group).filter(Boolean)]);
}
function bookmarkFolderName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 80) throw Error('Enter a folder name (1–80 characters).');
  return name;
}
function workspaceName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 80) throw Error('Enter a workspace name (1–80 characters).');
  return name;
}
function snippetScope(context, home) {
  if (!context) return '';
  if (context.mode === 'local') return 'local';
  if (context.mode !== 'ssh') throw Error('Choose an SSH or local terminal.');
  const { host, hostname, username, port, configPath } = profile(context.input, home);
  return JSON.stringify(['ssh', host.toLowerCase(), hostname || '', username, port, configPath]);
}

module.exports = { expandHome, profile, bookmarkFolderNames, bookmarkFolderName, workspaceName, snippetScope };
