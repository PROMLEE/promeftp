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
// The order the user dragged bookmark folders and bookmarks into: { folders: [name], bookmarks: [id] }. Only strings
// that still name a folder or a bookmark are kept, each once, so a stale or malformed value cannot grow the state file.
// Folders and bookmarks missing from the lists are shown after the ordered ones (folders by name, bookmarks as saved).
function bookmarkOrder(value, snapshot) {
  const pick = (list, known) => {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).filter(item => typeof item === 'string' && known.has(item) && !seen.has(item) && seen.add(item));
  };
  return {
    folders: pick(value?.folders, bookmarkFolderNames(snapshot)),
    bookmarks: pick(value?.bookmarks, new Set(snapshot.profiles.map(entry => entry.id))),
  };
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

// The local split saved with a workspace pane: a tree of up to MAX_LOCAL_PANES panes. A malformed value is dropped
// (undefined), so the pane still opens with one local pane. The ratio is kept within 0.1 to 0.9. Each directory must be
// a string and is cut to 4096 characters. A node is { directory } or { axis, ratio, first, second }; focus is the index
// of the focused pane in tree order. The 1.1.10 shape { axis, ratio, directories: [a, b], focus } is read as a two-pane tree.
// Keep in sync with MAX_LOCAL_PANES in renderer.js
const MAX_LOCAL_PANES = 6;
function workspaceLocalSplit(value) {
  if (!value || typeof value !== 'object') return undefined;
  let tree = value.tree;
  if ((tree === undefined || tree === null) && Array.isArray(value.directories)) {
    if (value.directories.length !== 2) return undefined;
    tree = { axis: value.axis, ratio: value.ratio, first: { directory: value.directories[0] }, second: { directory: value.directories[1] } };
  }
  let leaves = 0;
  const clean = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > MAX_LOCAL_PANES) return undefined;
    if (typeof node.directory === 'string') {
      leaves += 1;
      return leaves > MAX_LOCAL_PANES ? undefined : { directory: node.directory.slice(0, 4096) };
    }
    if (!['row', 'column'].includes(node.axis)) return undefined;
    const first = clean(node.first, depth + 1);
    const second = first && clean(node.second, depth + 1);
    if (!second) return undefined;
    const ratio = Number.isFinite(node.ratio) ? Math.max(0.1, Math.min(0.9, node.ratio)) : 0.5;
    return { axis: node.axis, ratio, first, second };
  };
  const cleaned = clean(tree, 0);
  if (!cleaned || cleaned.directory !== undefined) return undefined;
  const focus = Number.isInteger(value.focus) && value.focus >= 0 && value.focus < leaves ? value.focus : 0;
  return { tree: cleaned, focus };
}

module.exports = { expandHome, profile, bookmarkFolderNames, bookmarkFolderName, bookmarkOrder, workspaceName, snippetScope, workspaceLocalSplit, MAX_LOCAL_PANES };
