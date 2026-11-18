// File names for the type column. A backup copy is named <original>.YYYYMMDD-HHMMSS, optionally with -N after the
// time (see remote-backup.cjs), so its type is the type of the original. Loaded as a browser script and, in tests, as a module.
const backupCopySuffix = /\.\d{8}-\d{6}(?:-\d+)?$/;

// { extension, backup }: extension is the upper-case type from the original name (empty if there is none), and backup
// is true when the name is a backup copy without an extension of its own (shown as "Backup").
function nameTypeOf(name) {
  const backup = backupCopySuffix.test(name);
  const original = backup ? name.replace(backupCopySuffix, '') : name;
  const dot = original.lastIndexOf('.');
  if (dot > 0) return { extension: original.slice(dot + 1).toUpperCase(), backup };
  return { extension: '', backup };
}

if (typeof module !== 'undefined') module.exports = { nameTypeOf };
