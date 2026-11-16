const path = require('node:path');

async function scan(root, adapter, { maxEntries = 20_000, maxDepth = 40, signal, onProgress = () => {} } = {}) {
  const rows = new Map();
  const visit = async (absolute, relative, depth) => {
    if (signal?.aborted) throw Error('Comparison cancelled.');
    if (depth > maxDepth) throw Error(`Comparison exceeds ${maxDepth} folder levels.`);
    const children = await adapter.list(absolute);
    if (signal?.aborted) throw Error('Comparison cancelled.');
    for (const entry of children) {
      if (signal?.aborted) throw Error('Comparison cancelled.');
      if (entry.name === '.' || entry.name === '..') continue;
      const rel = relative ? path.posix.join(relative, entry.name) : entry.name;
      const target = adapter.join(absolute, entry.name);
      if (entry.link) { rows.set(rel, { relativePath: rel, type: 'link', size: entry.size, modifiedAt: entry.modifiedAt }); continue; }
      const row = { relativePath: rel, type: entry.directory ? 'directory' : 'file', size: entry.size, modifiedAt: entry.modifiedAt };
      rows.set(rel, row);
      onProgress(rows.size);
      if (rows.size > maxEntries) throw Error(`Comparison exceeds ${maxEntries} items.`);
      if (entry.directory) await visit(target, rel, depth + 1);
    }
  };
  await visit(root, '', 0);
  return rows;
}

async function compare({ sourceRoot, destinationRoot, source, destination, timestampPrecisionMs = 2000, limits, signal, onProgress }) {
  const counts = [0, 0];
  const track = side => count => {
    counts[side] = count;
    onProgress?.(counts[0] + counts[1]);
  };
  const [left, right] = await Promise.all([
    scan(sourceRoot, source, { ...limits, signal, onProgress: track(0) }),
    scan(destinationRoot, destination, { ...limits, signal, onProgress: track(1) }),
  ]);
  for (const [name, entry] of left) if (entry.type === 'directory') entry.emptyDirectory = ![...left.keys()].some(child => child.startsWith(name + '/'));
  const normalizeCollision = value => value.normalize('NFC').toLocaleLowerCase('en-US');
  const indexNames = rows => {
    const index = new Map();
    for (const name of rows.keys()) {
      const key = normalizeCollision(name);
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(name);
    }
    return index;
  };
  const targetNames = indexNames(right), sourceNames = indexNames(left);
  const names = [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const result = names.map(relativePath => {
    const sourceEntry = left.get(relativePath) || null;
    const destinationEntry = right.get(relativePath) || null;
    let reason; let operation = null;
    const collisionTarget = targetNames.get(normalizeCollision(relativePath));
    const collisionSource = sourceNames.get(normalizeCollision(relativePath));
    if ((collisionTarget && (collisionTarget.size > 1 || !collisionTarget.has(relativePath))) || collisionSource?.size > 1) { reason = 'path-conflict'; operation = 'conflict'; }
    else if (!destinationEntry) { reason = 'source-only'; operation = 'copy'; }
    else if (!sourceEntry) reason = 'destination-only';
    else if (sourceEntry.type !== destinationEntry.type) { reason = 'type-conflict'; operation = 'conflict'; }
    else if (sourceEntry.type !== 'file') reason = 'probably-equal';
    else if (sourceEntry.size === destinationEntry.size && Math.abs(sourceEntry.modifiedAt - destinationEntry.modifiedAt) <= timestampPrecisionMs) reason = 'probably-equal';
    else { reason = 'different'; operation = 'update'; }
    return { relativePath, source: sourceEntry, destination: destinationEntry, reason, operation, selected: operation === 'copy' || operation === 'update' };
  });
  const conflicts = new Set(result.filter(row => row.operation === 'conflict').map(row => row.relativePath));
  for (const row of result) {
    const parts = row.relativePath.split('/');
    if (parts.slice(0, -1).some((_, i) => conflicts.has(parts.slice(0, i + 1).join('/')))) {
      row.reason = 'path-conflict'; row.operation = 'conflict'; row.selected = false;
    }
  }
  return result;
}

function selectedFilePlan(entries, selectedPaths) {
  const conflicts = new Set(entries.filter(row => row.operation === 'conflict').map(row => row.relativePath));
  const selected = new Set(selectedPaths.filter(name => {
    const parts = name.split('/');
    return !parts.some((_, i) => conflicts.has(parts.slice(0, i + 1).join('/')));
  }));
  const files = entries.filter(row => selected.has(row.relativePath) && row.source?.type === 'file' && row.operation && row.operation !== 'conflict');
  const emptyDirectories = entries.filter(row => selected.has(row.relativePath) && row.source?.type === 'directory' && row.source.emptyDirectory && row.operation === 'copy');
  const directories = new Set();
  for (const row of files) {
    const components = row.relativePath.split('/').slice(0, -1);
    for (let depth = 1; depth <= components.length; depth++) directories.add(components.slice(0, depth).join('/'));
  }
  for (const row of emptyDirectories) {
    const components = row.relativePath.split('/');
    for (let depth = 1; depth <= components.length; depth++) directories.add(components.slice(0, depth).join('/'));
  }
  return { files, emptyDirectories, directories: [...directories].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)) };
}

module.exports = { compare, selectedFilePlan };
