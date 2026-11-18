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

// The local split saved with a workspace pane. A malformed value is dropped (undefined), so the pane still opens with
// one local pane. The ratio is kept within 0.1 to 0.9 and the folders are validated like the single local folder.
function workspaceLocalSplit(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (!['row', 'column'].includes(value.axis)) return undefined;
  if (!Array.isArray(value.directories) || value.directories.length !== 2) return undefined;
  if (!value.directories.every(item => typeof item === 'string')) return undefined;
  const ratio = Number.isFinite(value.ratio) ? Math.max(0.1, Math.min(0.9, value.ratio)) : 0.5;
  return { axis: value.axis, ratio, directories: value.directories.map(item => item.slice(0, 4096)), focus: value.focus === 1 ? 1 : 0 };
}

module.exports = { expandHome, profile, bookmarkFolderNames, bookmarkFolderName, workspaceName, snippetScope, workspaceLocalSplit };
