// Keeps track of the open main windows. Each SSH, SFTP or agent tab belongs to the window that opened it, and its
// output goes only there. Plain objects with isDestroyed() stand in for BrowserWindow in the tests.
const alive = window => Boolean(window) && !window.isDestroyed();

function createWindowRegistry() {
  const windows = new Set();
  let lastFocused;
  return {
    add(window) { windows.add(window); lastFocused = window; },
    remove(window) {
      windows.delete(window);
      if (lastFocused === window) lastFocused = undefined;
    },
    focused(window) { if (windows.has(window)) lastFocused = window; },
    has(window) { return alive(window) && windows.has(window); },
    list() { return [...windows].filter(alive); },
    get size() { return this.list().length; },
    // The window an action without a window of its own goes to: the focused main window, else the one focused last,
    // else the newest one still open.
    primary(focused) {
      if (this.has(focused)) return focused;
      if (this.has(lastFocused)) return lastFocused;
      return this.list().at(-1);
    },
    // True when the sender is the top frame of one of the main windows.
    owns(webContents) { return this.list().some(window => window.webContents === webContents); },
  };
}

// The ids in `entries` (a Map of id → record with an `owner`) that belong to `window`.
function ownedBy(entries, window) {
  return [...entries].filter(([, record]) => record?.owner === window).map(([id]) => id);
}

// Where a new window opens: a little below and to the right of `from`, so it does not cover it exactly.
function cascadeBounds(from, offset = 24) {
  if (!from) return {};
  return { x: from.x + offset, y: from.y + offset };
}

module.exports = { createWindowRegistry, ownedBy, cascadeBounds, alive };
