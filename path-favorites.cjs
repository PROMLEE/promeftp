const path = require('node:path').posix;
const { createHash, randomUUID } = require('node:crypto');
function scopeFor(input = {}) {
  return createHash('sha256').update(JSON.stringify([input.configPath || '', input.host || '', input.hostname || '', input.port ?? null, input.username || ''])).digest('hex');
}
function normalizePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0')) throw Error('Favorite path must be absolute.');
  return path.normalize(value);
}
function makeFavorite(scope, input, order) {
  const target = normalizePath(input.path);
  const fallback = target.split('/').filter(Boolean).at(-1) || '/';
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim().slice(0, 80) : '';
  return { id: typeof input.id === 'string' && input.id.length <= 80 ? input.id : randomUUID(), scope, path: target, displayName: displayName || fallback, order, createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(), updatedAt: Date.now() };
}
function list(state, scope) {
  const items = (state.sftpPathFavorites || []).filter(item => item.scope === scope);
  return items.sort(state.sftpFavoriteManual?.[scope] ? (a, b) => a.order - b.order : (a, b) => a.displayName.localeCompare(b.displayName) || a.path.localeCompare(b.path));
}
function replace(state, scope, values, manualOrder = false) {
  if (!Array.isArray(values) || values.length > 200) throw Error('Invalid folder favorites.');
  const seen = new Set();
  const items = values.map((item, order) => { const favorite = makeFavorite(scope, item, order); if (seen.has(favorite.path)) throw Error('A folder can only be saved once.'); seen.add(favorite.path); return favorite; });
  state.sftpFavoriteManual ??= {};
  if (manualOrder) state.sftpFavoriteManual[scope] = true;
  state.sftpPathFavorites = (state.sftpPathFavorites || []).filter(item => item.scope !== scope).concat(items);
}
function mutate(state, scope, change) {
  const current = list(state, scope);
  const index = current.findIndex(item => item.id === change?.id);
  let next = [...current];
  switch (change?.action) {
    case 'add': {
      const target = normalizePath(change.path);
      if (next.some(item => item.path === target)) throw Error('A folder can only be saved once.');
      next.push(makeFavorite(scope, { path: target, displayName: change.displayName }, next.length)); break;
    }
    case 'rename':
      if (index < 0 || typeof change.displayName !== 'string') throw Error('Favorite no longer exists.');
      next[index] = { ...next[index], displayName: change.displayName.trim().slice(0, 80) || path.basename(next[index].path) || '/', updatedAt: Date.now() }; break;
    case 'edit-path': {
      if (index < 0) throw Error('Favorite no longer exists.');
      const target = normalizePath(change.path);
      if (next.some((item, itemIndex) => itemIndex !== index && item.path === target)) throw Error('A folder can only be saved once.');
      next[index] = { ...next[index], path: target, updatedAt: Date.now() }; break;
    }
    case 'remove':
      if (index < 0) throw Error('Favorite no longer exists.');
      next.splice(index, 1); break;
    case 'reorder': {
      if (!Array.isArray(change.ids) || change.ids.length !== next.length || new Set(change.ids).size !== next.length || next.some(item => !change.ids.includes(item.id))) throw Error('Favorite list changed. Refresh it and try again.');
      next = change.ids.map(id => next.find(item => item.id === id));
      state.sftpFavoriteManual ??= {}; state.sftpFavoriteManual[scope] = true; break;
    }
    default: throw Error('Unsupported favorite action.');
  }
  state.sftpPathFavorites = (state.sftpPathFavorites || []).filter(item => item.scope !== scope).concat(next.map((item, order) => ({ ...item, order })));
}
function migrate(state, scope, paths) {
  if (list(state, scope).length || !Array.isArray(paths)) return false;
  const unique = [...new Set(paths.slice(0, 200).map(normalizePath))].sort((a, b) => a.split('/').at(-1).localeCompare(b.split('/').at(-1)) || a.localeCompare(b));
  if (!unique.length) return false;
  replace(state, scope, unique.map(path => ({ path })));
  return true;
}
module.exports = { scopeFor, normalizePath, list, replace, mutate, migrate };
