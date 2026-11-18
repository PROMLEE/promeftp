const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const pty = require('node-pty');
const askpass = require('./askpass.cjs');
const { SFTP } = require('ssh2/lib/protocol/SFTP.js');

const ssh = '/usr/bin/ssh';
// OpenSSH splits option values on spaces unless each path is double-quoted.
const sshQuote = value => '"' + value.replace(/["\\]/g, '\\$&') + '"';

// Parses OpenSSH's host-key confirmation. Shared by the app prompt and the agent pinning check.
// Returns { host, fingerprint, accept, keyType } or null when the text is not a host-key question.
// keyType is the upper-case key type in the question, such as ED25519, or '' when the question does not name one.
function parseHostKeyPrompt(prompt) {
  const fingerprint = /^(?:[\w-]+ )?key fingerprint is:? (SHA256:[A-Za-z0-9+/]+={0,2}|MD5:(?:[a-f0-9]{2}:){15}[a-f0-9]{2})\.?$/mi.exec(prompt)?.[1];
  const raw = /^The authenticity of host '(.+)' can't be established\.$/m.exec(prompt)?.[1];
  if (!raw) return null;
  const host = raw.replace(/ \([^()]+\)$/, '').toLowerCase();
  const accept = fingerprint && prompt.endsWith('(yes/no/[fingerprint])?') ? fingerprint : 'yes';
  const keyType = /^([\w-]+) key fingerprint is/mi.exec(prompt)?.[1]?.toUpperCase() ?? '';
  return { host, fingerprint, accept, keyType };
}
// known_hosts lines name hosts as "host", "host,ip" or "[host]:port". Entries are compared as written, case-insensitively.
function knownHostEntries(line) {
  return line.split(' ')[0].split(',').map(entry => entry.toLowerCase());
}
// ssh-keygen understands hashed entries (HashKnownHosts yes) and [host]:port forms, so it is the matcher.
const sshKeygen = '/usr/bin/ssh-keygen';
const execute = promisify(execFile);
// ssh-keygen -l -F prints "# Host ... found" comments and one line per matching key. Two layouts occur:
// "host TYPE SHA256:..." (-F) and "256 SHA256:... host (TYPE)" (-f). Both give the fingerprint and the upper-case type.
function parseKeygenEntries(stdout) {
  const found = [];
  for (const line of String(stdout).split('\n')) {
    if (line.startsWith('#')) continue;
    const fingerprint = /SHA256:[A-Za-z0-9+/]+={0,2}/.exec(line)?.[0];
    if (!fingerprint) continue;
    const parenthesized = /\(([A-Za-z0-9-]+)\)\s*$/.exec(line)?.[1];
    const beforeFingerprint = line.slice(0, line.indexOf(fingerprint)).trim().split(/\s+/).at(-1);
    const bare = /^[A-Za-z][A-Za-z0-9-]*$/.test(beforeFingerprint) ? beforeFingerprint : '';
    const type = (parenthesized || bare).toUpperCase();
    if (!found.some(entry => entry.fingerprint === fingerprint)) found.push({ fingerprint, type });
  }
  return found;
}
function parseKeygenFingerprints(stdout) {
  return parseKeygenEntries(stdout).map(entry => entry.fingerprint);
}
// The keys a known_hosts file holds for a host, with their types. A missing file or host gives [].
// Only a missing file, or ssh-keygen's exit 1 with nothing on stderr, means "no entry". Any other failure, such as an
// unreadable file or a directory, throws, so the caller can tell a read failure from an empty file.
async function knownHostKeyEntries(file, host) {
  const info = await fs.stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info) return [];
  if (!info.isFile()) throw Error('known_hosts is not a regular file.');
  try {
    const { stdout } = await execute(sshKeygen, ['-l', '-F', host, '-f', file]);
    return parseKeygenEntries(stdout);
  } catch (error) {
    if (error.code === 1 && !String(error.stderr ?? '').trim()) return [];
    throw error;
  }
}
async function knownHostFingerprints(file, host) {
  return (await knownHostKeyEntries(file, host)).map(entry => entry.fingerprint);
}
// The options that keep an agent connection to its own settings. The known_hosts file is the connection's own file.
// The system-wide file is disabled and ~/.ssh/known_hosts is never named, so no stored key can stop the agent before
// PromeFTP decides about the key.
function agentRestrictedOptions(config) {
  if (!config.knownHosts) throw Error('Agent connections need their own known_hosts file.');
  return [...(config.configPath ? ['-F', config.configPath] : []), '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
    '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'VerifyHostKeyDNS=no', '-o', 'UpdateHostKeys=no',
    '-o', 'UserKnownHostsFile=' + sshQuote(config.knownHosts), '-o', 'GlobalKnownHostsFile=/dev/null'];
}

function configArgs(config, includeConfigPath = true) {
  const args = [];
  if (includeConfigPath && config.configPath) args.push('-F', config.configPath);
  if (config.hostname) args.push('-o', 'HostName=' + config.hostname.replaceAll('%', '%%'));
  if (config.username) args.push('-l', config.username);
  if (config.port) args.push('-p', String(config.port));
  if (config.keyPath) args.push('-i', config.keyPath);
  if (config.pam) args.push('-o', 'KbdInteractiveAuthentication=yes');
  return args;
}

async function aliases(configPath) {
  const sshDirectory = path.join(os.homedir(), '.ssh');
  const seen = new Set();
  const names = new Set();
  const patterns = /"([^"]*)"|([^\s"]+)/g;
  async function read(file, depth) {
    if (depth > 16 || seen.size >= 200 || seen.has(file)) return;
    seen.add(file);
    let content;
    try { content = await fs.readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const line of content.split(/\r?\n/)) {
      const directive = /^\s*(Host|Include)\s*(?:=\s*|\s+)(.*)$/i.exec(line);
      if (!directive) continue;
      for (const token of directive[2].matchAll(patterns)) {
        const value = token[1] ?? token[2];
        if (value.startsWith('#')) break;
        if (directive[1].toLowerCase() === 'host') {
          if (value && !/[?*!\s]/.test(value)) names.add(value);
        } else {
          const absolute = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2))
            : path.resolve(sshDirectory, value);
          for await (const match of fs.glob(absolute)) {
            if (seen.size >= 200) break;
            await read(match, depth + 1);
          }
        }
      }
    }
  }
  await read(configPath || path.join(sshDirectory, 'config'), 0);
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function effectiveOutput(config) {
  const { stdout } = await execute(ssh, [...configArgs(config), '-G', '--', config.host], {
    timeout: 10000, maxBuffer: 256 * 1024,
  });
  return stdout;
}

function authEndpoint(stdout) {
  const safe = /^(hostname|user|port|proxyjump|proxycommand|kbdinteractiveauthentication|preferredauthentications|identityfile|identityagent|controlmaster|controlpath|kexalgorithms|stricthostkeychecking|userknownhostsfile) /;
  return stdout.split('\n').filter(line => safe.test(line)).join('\n');
}

async function effective(config) {
  return authEndpoint(await effectiveOutput(config));
}

async function inspectIdentityFile(value) {
  const file = String(value || '').trim();
  if (!file || file === 'none') return null;
  const expanded = file === '~' ? os.homedir()
    : file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file;
  const resolved = path.isAbsolute(expanded) ? expanded : path.resolve(os.homedir(), expanded);
  for (const candidate of [resolved, resolved + '.pub']) {
    try { if ((await fs.stat(candidate)).isFile()) return { path: resolved, available: true }; }
    catch {}
  }
  return { path: resolved, available: false };
}

function subsystem(socket, onError) {
  const child = spawn(ssh, [
    '-F', '/dev/null', '-S', socket, '-o', 'ProxyCommand=false',
    '-o', 'BatchMode=yes', '-T', '-s', '--', 'localhost', 'sftp',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  // ssh2's SFTP packet engine runs over an already authenticated byte stream.
  const channel = new SFTP({ _protocol: {
    channelData: (_id, bytes) => child.stdin.write(bytes),
    channelClose: () => child.kill(),
  } }, { type: 'session', outgoing: { id: 0, state: 'open', window: Infinity, packetSize: 262144 } });
  child.stdout.on('data', bytes => {
    try { channel.push(bytes); } catch (error) { onError(error.message); child.kill(); }
  });
  child.stderr.on('data', bytes => onError(bytes.toString().trim()));
  child.on('error', error => onError(error.message));
  child.stdin.on('error', error => {
    if (error.code !== 'EPIPE') onError(error.message);
    child.kill();
  });
  channel.on('error', error => { onError(error.message); child.kill(); });
  child.once('close', code => {
    channel.outgoing.state = 'closed';
    channel.push(null);
    if (code) onError('SFTP subsystem exited (' + code + ')');
    channel.emit('close');
  });
  channel._init();
  return channel;
}

async function start(config, mode, size, notify, responseRules, strictHostKey = '', useKeychain = false, password = '', onPasswordUsed, agent = false) {
  // Keep the Unix socket path short and private.
  const directory = await fs.mkdtemp('/tmp/promeftp-');
  const socket = path.join(directory, 'mux');
  const masterOptions = [
    '-S', socket, '-o', 'ControlMaster=yes', '-o', 'ControlPersist=no',
    '-o', 'ForkAfterAuthentication=no', '-o', 'ClearAllForwardings=yes',
  ];
  let terminal;
  let auth;
  let timer;
  let channel;
  let stopped = false;
  let isReady = false;
  let checking = false;

  function close() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    channel?.destroy();
    auth?.close();
    try { terminal?.kill(); } catch {}
    fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
  function ready() {
    if (stopped || isReady) return;
    isReady = true;
    auth?.clear();
    notify('ready');
  }
  function failed(message) {
    if (!stopped && message) notify('error', message);
  }
  function exited(code) {
    if (stopped) return;
    if (code) failed('OpenSSH exited (' + code + '). See terminal output.');
    close();
    notify('closed');
  }
  async function check() {
    if (checking || stopped) return;
    checking = true;
    try {
      const info = await fs.stat(socket);
      if (stopped || !info.isSocket()) return;
      clearInterval(timer);
      if (mode !== 'sftp') ready();
      else {
        channel = subsystem(socket, failed);
        channel.once('ready', ready);
        channel.once('close', () => exited());
      }
    } catch (error) {
      if (error.code !== 'ENOENT') { failed(error.message); exited(); }
    } finally { checking = false; }
  }
  try {
    const rules = askpass.validateRules(responseRules);
    const authOptions = process.platform === 'darwin' && !useKeychain ? ['-o', 'UseKeychain=no'] : [];
    auth = await askpass.open(directory, rules, () => terminal?.pid, notify, password, onPasswordUsed);
    if (rules.size || strictHostKey) authOptions.push(
      '-o', 'StrictHostKeyChecking=' + (strictHostKey || 'ask'), '-o', 'NoHostAuthenticationForLocalhost=no',
    );
    if (rules.size) authOptions.push('-o', 'PreferredAuthentications=publickey,keyboard-interactive');
    const modeOptions = mode === 'ssh' ? ['-tt'] :
      ['-N', '-o', 'RemoteCommand=none', '-o', 'PermitLocalCommand=no'];
    // Each agent connection gets its own empty known_hosts in the connection directory, removed on close.
    const restricted = agent ? agentRestrictedOptions({ ...config, knownHosts: path.join(directory, 'known_hosts') }) : [];
    terminal = pty.spawn(ssh, [...restricted, ...masterOptions, ...modeOptions, ...authOptions, ...configArgs(config, !agent), '--', config.host], {
      name: 'xterm-256color', cols: size.cols || 80, rows: size.rows || 24,
      cwd: os.homedir(), env: { ...process.env, ...auth?.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    terminal.onData(data => notify('data', data));
    terminal.onExit(({ exitCode }) => exited(exitCode));
    timer = setInterval(check, 100);
  } catch (error) {
    close();
    throw error;
  }

  return {
    close,
    answer(id, value) { return auth?.reply(id, value); },
    get channel() { return channel; },
    ...(agent && mode === 'exec' && { exec(command, signal) {
      if (stopped || !isReady) throw Error('SSH session is unavailable.');
      return spawn(ssh, ['-F', '/dev/null', '-S', socket, '-o', 'ProxyCommand=/usr/bin/false',
        '-o', 'BatchMode=yes', '-T', '--', 'localhost', command], { signal, stdio: ['ignore', 'pipe', 'pipe'] });
    } }),
    input(data) { if (!stopped) terminal.write(data); },
    resize(cols, rows) { if (!stopped && cols > 0 && rows > 0) terminal.resize(cols, rows); },

  };
}

function startLocal(size, notify) {
  const user = os.userInfo();
  const shell = user.shell || '/bin/zsh';
  const terminal = pty.spawn(shell, ['-l'], {
    name: 'xterm-256color', cols: size.cols || 80, rows: size.rows || 24,
    cwd: user.homedir,
    env: { ...process.env, SHELL: shell, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });
  let closed = false;
  terminal.onData(data => { if (!closed) notify('data', data); });
  terminal.onExit(({ exitCode }) => {
    if (closed) return;
    closed = true;
    if (exitCode) notify('error', 'Shell exited (' + exitCode + ').');
    notify('closed');
  });
  setImmediate(() => { if (!closed) notify('ready'); });
  return {
    close() { if (!closed) { closed = true; terminal.kill(); } },
    input(data) { if (!closed) terminal.write(data); },
    resize(cols, rows) { if (!closed && cols > 0 && rows > 0) terminal.resize(cols, rows); },
  };
}

module.exports = { aliases, effective, effectiveOutput, authEndpoint, inspectIdentityFile, start, startLocal,
  parseHostKeyPrompt, parseKeygenEntries, parseKeygenFingerprints, knownHostKeyEntries, knownHostFingerprints, agentRestrictedOptions };
