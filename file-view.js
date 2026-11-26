// File pane helpers shared by the renderer and the tests: the name filter, and the user's toolbar layout
// (which buttons show and in what order). Pure functions, no DOM and no storage.

// Every toolbar button the user can hide or move, per pane kind, in the default order.
// group is where the button lives: 'leading' (left of the remote pane's title), 'tools' (right of the title)
// or 'address' (end of the path bar). A button only moves inside its own group.
const fileToolbarItems = {
  remote: [
    { id: 'transfers', label: 'Transfers', group: 'leading' },
    { id: 'compare', label: 'Compare folders', group: 'leading' },
    { id: 'filter', label: 'Filter by name', group: 'tools' },
    { id: 'tree', label: 'Toggle folder tree', group: 'tools' },
    { id: 'refresh', label: 'Refresh', group: 'tools' },
    { id: 'new-folder', label: 'New remote folder', group: 'tools' },
    { id: 'download', label: 'Download selection', group: 'tools' },
    { id: 'split-right', label: 'Split SFTP right', group: 'tools' },
    { id: 'split-down', label: 'Split SFTP down', group: 'tools' },
    { id: 'back', label: 'Back', group: 'address' },
    { id: 'forward', label: 'Forward', group: 'address' },
    { id: 'favorite', label: 'Add path to favorites', group: 'address' },
    { id: 'favorites', label: 'Favorite folders', group: 'address' },
    { id: 'recent', label: 'Recent folders', group: 'address' },
  ],
  local: [
    { id: 'filter', label: 'Filter by name', group: 'tools' },
    { id: 'tree', label: 'Toggle folder tree', group: 'tools' },
    { id: 'refresh', label: 'Refresh', group: 'tools' },
    { id: 'hidden-files', label: 'Show hidden files', group: 'tools' },
    { id: 'new-folder', label: 'New local folder', group: 'tools' },
    { id: 'upload', label: 'Upload to selected remote', group: 'tools' },
    { id: 'split-right', label: 'Split local pane right', group: 'tools' },
    { id: 'split-down', label: 'Split local pane down', group: 'tools' },
    { id: 'back', label: 'Back', group: 'address' },
    { id: 'forward', label: 'Forward', group: 'address' },
    { id: 'favorite', label: 'Add path to favorites', group: 'address' },
    { id: 'favorites', label: 'Favorite folders', group: 'address' },
    { id: 'recent', label: 'Recent folders', group: 'address' },
    { id: 'choose-folder', label: 'Choose local folder', group: 'address' },
  ],
};
// Shown in the More menu (…) until the user puts them back. These are also reachable another way:
// splits from the pane's right-click menu, new folders and the rest from the More menu.
const defaultHiddenToolbarItems = {
  remote: ['compare', 'new-folder', 'split-right', 'split-down'],
  local: ['hidden-files', 'new-folder', 'split-right', 'split-down'],
};

// The saved value is { order: [id…], hidden: [id…] } per kind. Unknown ids are dropped. A button added
// in a later version, which the saved order does not list, takes its default place and default visibility.
function normalizeToolbarLayout(kind, saved) {
  const items = fileToolbarItems[kind] || [];
  const known = new Set(items.map(item => item.id));
  const savedOrder = Array.isArray(saved?.order) ? saved.order.filter((id, index, list) => known.has(id) && list.indexOf(id) === index) : [];
  const order = [...savedOrder];
  items.forEach((item, index) => {
    if (order.includes(item.id)) return;
    const before = items.slice(0, index).reverse().find(previous => order.includes(previous.id));
    order.splice(before ? order.indexOf(before.id) + 1 : 0, 0, item.id);
  });
  const savedHidden = Array.isArray(saved?.hidden) ? saved.hidden.filter(id => known.has(id)) : [];
  const hidden = new Set(savedHidden);
  for (const id of defaultHiddenToolbarItems[kind] || []) if (!savedOrder.includes(id)) hidden.add(id);
  return { order, hidden: order.filter(id => hidden.has(id)) };
}

function toolbarItem(kind, id) {
  return (fileToolbarItems[kind] || []).find(item => item.id === id);
}

// Moves a button one place up (-1) or down (1) among the buttons of its own group. Returns a new order.
function moveToolbarItem(kind, order, id, direction) {
  const group = toolbarItem(kind, id)?.group;
  const peers = order.filter(other => toolbarItem(kind, other)?.group === group);
  const index = peers.indexOf(id);
  const target = peers[index + direction];
  if (index < 0 || !target) return [...order];
  const next = [...order];
  const from = next.indexOf(id);
  const to = next.indexOf(target);
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

function setToolbarItemHidden(layout, id, hidden) {
  const set = new Set(layout.hidden);
  if (hidden) set.add(id); else set.delete(id);
  return { order: [...layout.order], hidden: layout.order.filter(other => set.has(other)) };
}

// The name filter. Plain text matches names that contain every word, ignoring case and Unicode form
// (macOS stores decomposed Hangul and accents). * and ? turn the query into a whole-name pattern.
function foldFileName(value) {
  return String(value).normalize('NFC').toLocaleLowerCase();
}
function fileFilterMatcher(query) {
  const text = foldFileName(query).trim();
  if (!text) return () => true;
  if (/[*?]/.test(text)) {
    const source = text.split(/(\*+|\?)/).map(part => part.startsWith('*') ? '.*' : part === '?' ? '.'
      : part.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('');
    const pattern = new RegExp('^' + source + '$', 'su');
    return name => pattern.test(foldFileName(name));
  }
  const words = text.split(/\s+/);
  return name => {
    const folded = foldFileName(name);
    return words.every(word => folded.includes(word));
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    fileToolbarItems, defaultHiddenToolbarItems, normalizeToolbarLayout, moveToolbarItem, setToolbarItemHidden, fileFilterMatcher,
  };
}
