const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const pty = require('node-pty');
const askpass = require('./askpass.cjs');
const { SFTP } = require('ssh2/lib/protocol/SFTP.js');

const ssh = '/usr/bin/ssh';
const execute = promisify(execFile);

function configArgs(config) {
  const args = [];
  if (config.configPath) args.push('-F', config.configPath);
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

async function effective(config) {
  const { stdout } = await execute(ssh, [...configArgs(config), '-G', '--', config.host], {
    timeout: 10000, maxBuffer: 256 * 1024,
  });
  const safe = /^(hostname|user|port|proxyjump|kbdinteractiveauthentication|preferredauthentications|identityfile|identityagent|controlmaster|controlpath|kexalgorithms|stricthostkeychecking|userknownhostsfile) /;
  return stdout.split('\n').filter(line => safe.test(line)).join('\n');
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
    const restricted = agent ? ['-F', '/dev/null', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
      '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'VerifyHostKeyDNS=no', '-o', 'UpdateHostKeys=no',
      ...(config.knownHosts ? ['-o', 'UserKnownHostsFile=' + config.knownHosts] : [])] : [];
    terminal = pty.spawn(ssh, [...restricted, ...masterOptions, ...modeOptions, ...authOptions, ...configArgs(config), '--', config.host], {
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

module.exports = { aliases, effective, inspectIdentityFile, start, startLocal };
