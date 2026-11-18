// Remote backup helpers: names, shell quoting, the cp command, and failure classes. No Electron dependency, so the
// rules can be tested directly. The main process runs the command; nothing here touches the network.

const controlCharacters = /[\x00-\x1f\x7f]/;
const failure = code => Object.assign(Error(code), { agentCode: code });

// The stamp is the Mac's local time, so names sort in the order the backups were made: YYYYMMDD-HHMMSS.
function backupStamp(date = new Date()) {
  const two = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

// The backup goes after the whole name, so a web server never sees a new script extension (.php.<stamp>).
// Names that are taken in the same second get -2 to -99. Past that the caller must try again later.
function backupName(name, stamp, taken) {
  if (typeof name !== 'string' || !name || name.includes('/') || controlCharacters.test(name)) throw failure('INVALID_NAME');
  const base = `${name}.${stamp}`;
  if (!taken.has(base)) return base;
  for (let n = 2; n <= 99; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw failure('BACKUP_NAME_TAKEN');
}

// POSIX single-quote form. Everything inside is literal, so $(...), spaces and quotes stay inside the argument.
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

// cp -p keeps mode, owner and modification time. -R copies a folder with everything in it.
function backupCommand(source, target, directory) {
  for (const value of [source, target]) {
    if (typeof value !== 'string' || !value.startsWith('/') || controlCharacters.test(value)) throw failure('INVALID_PATH');
  }
  return `cp ${directory ? '-pR' : '-p'} -- ${shellQuote(source)} ${shellQuote(target)}`;
}

// Sorts a failed command into the messages the app can act on. Order matters: the most specific cause comes first.
// A refused shell prints its message to stdout or stderr. Exit 1 with no output at all is treated as a refused shell
// too, because cp always explains its own failures on stderr.
function classifyBackupFailure({ code, stdout = '', stderr = '' } = {}) {
  const text = `${stdout}\n${stderr}`;
  if (/only.*sftp|sftp connections only|internal-sftp|not allowed|restricted|This account is currently not available/i.test(text)) return 'NO_SHELL';
  if (code === 1 && !String(stdout).trim() && !String(stderr).trim()) return 'NO_SHELL';
  if (code === 127 || /cp: (command )?not found/i.test(text)) return 'NO_CP';
  if (/Permission denied|Operation not permitted|Read-only file system/i.test(text)) return 'PERMISSION';
  if (/No space left|Disk quota exceeded/i.test(text)) return 'NO_SPACE';
  return 'FAILED';
}

// Runs a spawned command and collects its output (up to limit bytes each for stdout and stderr). When the timeout
// fires, the controller aborts the command; the abort may arrive as an 'error' event, so a timed-out command resolves
// with timedOut: true whichever event comes first. Resolves once: { code, stdout, stderr, timedOut }.
function collectCommand(child, { controller, timeout, limit = 4096 }) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (action, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action(value);
    };
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    const take = (text, chunk) => text.length >= limit ? text : text + String(chunk).slice(0, limit - text.length);
    child.stdout.on('data', chunk => { stdout = take(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = take(stderr, chunk); });
    child.on('error', error => {
      if (timedOut) finish(resolve, { code: null, stdout, stderr, timedOut: true });
      else finish(reject, error);
    });
    child.on('close', code => finish(resolve, { code, stdout, stderr, timedOut }));
  });
}

// Copies the mode and the access and modification times of a remote item to its copy, and of every item inside a
// folder (symbolic links are skipped). It never throws for one item: each problem is added to failures, so a copy is
// still made when its permissions cannot be set. ops = { lstat, readdir, chmod, utimes } returning promises.
async function copyAttributes(ops, source, target, failures = [], depth = 0) {
  if (depth > 64) { failures.push(`${target}: folder too deep`); return failures; }
  let attrs;
  try { attrs = await ops.lstat(source); }
  catch (error) { failures.push(`${source}: ${error.message}`); return failures; }
  if (attrs.isSymbolicLink()) return failures;
  if (attrs.isDirectory()) {
    let names = [];
    try { names = await ops.readdir(source); }
    catch (error) { failures.push(`${source}: ${error.message}`); }
    for (const name of names) {
      if (!name || name === '.' || name === '..' || name.includes('/')) continue;
      await copyAttributes(ops, `${source}/${name}`, `${target}/${name}`, failures, depth + 1);
    }
  }
  // A folder's own times are set last, because writing its children changes them.
  try {
    await ops.chmod(target, attrs.mode & 0o7777);
    await ops.utimes(target, attrs.atime, attrs.mtime);
  } catch (error) { failures.push(`${target}: ${error.message}`); }
  return failures;
}

module.exports = { backupStamp, backupName, shellQuote, backupCommand, classifyBackupFailure, collectCommand, copyAttributes };
