const net = require('node:net');
const fs = require('node:fs/promises');
const { DatabaseSync } = require('node:sqlite');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');
const { SAVED_AUTH_REASONS } = require('./saved-auth.cjs');

const protocol = 1;
const socketLimit = 16384;
const idle = 10 * 60_000;
// Authentication windows. A question from OpenSSH (such as an OTP) extends the deadline, never past authCeiling.
const authWindow = 120_000, promptWindow = 180_000, authCeiling = 600_000, waitLimit = 25_000;
// Next steps for a session that is still starting. Polling status until expires is the expected behaviour.
const WAIT_MESSAGES = {
  connecting: 'Connecting. Keep polling session status every 2-5 seconds until expires. Do not close or reopen the session.',
  waiting_for_user: 'Waiting for the user to answer an authentication prompt (such as an OTP) in PromeFTP. Tell the user once, then keep polling until expires. Do not close or reopen the session.',
};
// Next steps for a closed session, by reason. A failure's own error.next takes precedence.
const endNext = {
  AUTH_TIMEOUT: [{ action: 'ask_user', message: 'The user did not finish authentication in time. Ask whether PromeFTP is ready, then open one new session.' }],
  USER_CANCELLED: [{ action: 'ask_user', message: 'The user cancelled authentication. Do not retry without asking the user.' }],
  IDLE_TIMEOUT: [{ action: 'retry', message: 'The session closed after 10 minutes without requests. Open a new session if you still need it; the user may be asked for a new OTP.' }],
  CLIENT_CLOSED: [],
  TIMEOUT: [{ action: 'retry', message: 'A request took longer than 30 seconds and closed the session. Open a new session and use smaller requests.' }],
  CONNECT_FAILED: [{ action: 'ask_user', message: 'The connection failed. Follow error.next if it is present.' }],
  REMOTE_CLOSED: [{ action: 'retry', message: 'The server closed the connection. Retry once with a new session.' }],
  PERMISSION_CHANGED: [{ action: 'ask_user', message: 'The user changed this client permissions. Ask the user before doing anything else.' }],
  SERVICE_DISABLED: [{ action: 'ask_user', message: 'Agent access is turned off in PromeFTP. Ask the user to turn it on.' }],
};
const fallbackNext = [{ action: 'ask_user', message: 'Ask the user to check PromeFTP, then open a new session.' }];
const hash = value => createHash('sha256').update(value).digest('hex');
// The grant fingerprint covers only what decides where a connection goes and how it logs in. A label or folder change
// keeps the grant. legacyStamp is the old whole-bookmark fingerprint, kept only to migrate grants made before this.
const stampFields = p => ({ host: p.host, hostname: p.hostname || '', port: p.port ?? null, username: p.username || '',
  keyPath: p.keyPath || '', configPath: p.configPath || '', usesAlias: p.usesAlias === true, pam: p.pam === true });
const stamp = p => hash(JSON.stringify(stampFields(p)));
const legacyStamp = p => hash(JSON.stringify(p));
const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 512);
const problem = (code, reason) => Object.assign(Error(code), { agentCode: code, ...(reason && { agentReason: reason }) });
function socketDirectory(uid = process.getuid()) { return '/tmp/promeftp-agent-' + uid; }
const fields = 'id, time, request, client, profile, session, operation, result, reason, detail';

async function createAgentService({ directory, state, save, profiles, transport, sftpCall, busy, onPrompt = () => {},
  socketDir = socketDirectory() }) {
  const dir = socketDir;
  const socketPath = path.join(dir, 'api.sock');
  const clients = new Set();
  const sessions = new Map();
  const diagnostics = new Map();
  let server, starting, stopping, db;
  let storageFailed = false;
  // The code of the last failed listen(), shown as the reason the service is offline. Empty after a successful listen.
  let lastListenError = '';
  const day = 86400000;
  const settings = () => state().agent || {};
  const scopeFor = (client, id) => settings().clients?.find(item => item.id === client)?.grants?.[id];
  const profileFor = id => profiles().find(p => p.id === id);
  const base = (session, operation, result, reason, detail, request = session.request) => ({
    request, client: session.client, profile: session.profile, session: session.id,
    operation, result, reason, detail,
  });
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await fs.lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.uid !== process.getuid() || (directoryInfo.mode & 0o077)) throw problem('AUDIT_UNAVAILABLE');
  const dbPath = path.join(directory, 'activity.sqlite');
  const { O_NOFOLLOW, O_WRONLY, O_CREAT } = require('node:fs').constants;
  const file = await fs.open(dbPath, O_NOFOLLOW | O_WRONLY | O_CREAT, 0o600);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1) throw problem('AUDIT_UNAVAILABLE');
    await file.chmod(0o600);
  } finally { await file.close(); }
  db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, request TEXT,
      client TEXT, profile TEXT, session TEXT, operation TEXT NOT NULL, result TEXT NOT NULL,
      reason TEXT, detail TEXT
    );
    CREATE INDEX IF NOT EXISTS events_session ON events(session, id);
    CREATE INDEX IF NOT EXISTS events_time ON events(time);
    CREATE TABLE IF NOT EXISTS pending (
      request TEXT PRIMARY KEY, client TEXT, profile TEXT, session TEXT, operation TEXT NOT NULL
    );`);
  const append = db.prepare('INSERT INTO events(time,request,client,profile,session,operation,result,reason,detail) VALUES (?,?,?,?,?,?,?,?,?)');
  function prune() {
    db.prepare('DELETE FROM events WHERE time < ?').run(Date.now() - (settings().days || 30) * day);
    db.exec('DELETE FROM events WHERE id <= (SELECT id FROM events ORDER BY id DESC LIMIT 1 OFFSET 50000)');
  }
  let lastPrune = 0;
  function writeEvent(event) {
    append.run(Date.now(), event.request ?? null, event.client ?? null, event.profile ?? null,
      event.session ?? null, event.operation, event.result, event.reason ?? null, event.detail ?? null);
  }
  function transaction(callback) {
    if (storageFailed) throw problem('AUDIT_UNAVAILABLE');
    try {
      db.exec('BEGIN IMMEDIATE');
      callback();
      db.exec('COMMIT');
    } catch {
      try { db.exec('ROLLBACK'); } catch {}
      storageFailed = true;
      for (const s of sessions.values()) close(s);
      throw problem('AUDIT_UNAVAILABLE');
    }
  }
  transaction(() => {
    const unclosed = db.prepare(`SELECT request,client,profile,session FROM events AS opened
      WHERE opened.operation='session.open' AND opened.result='success' AND opened.session IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM events AS ended WHERE ended.session=opened.session AND ended.operation='session.ended')`).all();
    for (const e of unclosed) writeEvent({ ...e, operation: 'session.ended', result: 'unknown', reason: 'APP_RESTART' });
    prune();
    for (const e of db.prepare('SELECT * FROM pending').all()) writeEvent({ ...e, result: 'unknown', reason: 'APP_RESTART' });
    db.exec('DELETE FROM pending');
  });
  function audit(event) {
    transaction(() => {
      writeEvent(event);
      if (Date.now() - lastPrune > 60_000) { prune(); lastPrune = Date.now(); }
    });
  }
  function begin(event) {
    transaction(() => {
      writeEvent({ ...event, result: 'allowed' });
      db.prepare('INSERT INTO pending VALUES(?,?,?,?,?)').run(event.request, event.client ?? null,
        event.profile ?? null, event.session ?? null, event.operation);
      if (Date.now() - lastPrune > 60_000) { prune(); lastPrune = Date.now(); }
    });
  }
  function finish(event, result, reason, detail = event.detail) {
    transaction(() => {
      writeEvent({ ...event, result, reason, detail });
      db.prepare('DELETE FROM pending WHERE request=?').run(event.request);
    });
  }
  // Wakes every session.wait call waiting on this session, so it answers at once with the new state.
  function wake(s) {
    const waiters = [...s.waiters];
    s.waiters.clear();
    for (const finish of waiters) finish();
  }
  function close(s) {
    if (s.closed) return;
    s.closed = true;
    sessions.delete(s.id);
    s.connection?.close();
    s.controller.abort();
    busy(sessions.size);
    wake(s);
  }
  function note(s, operation, result, reason, detail) {
    try { audit(base(s, operation, result, reason, detail)); }
    catch { close(s); }
  }
  function end(s, reason) {
    close(s);
    note(s, 'session.ended', 'closed', reason);
  }
  function current(s) {
    const grant = scopeFor(s.client, s.profile);
    const p = profileFor(s.profile);
    if (s.closed || !settings().enabled || (grant !== s.grant && JSON.stringify(grant) !== JSON.stringify(s.grant)) ||
        !p || stamp(p) !== s.grant.fingerprint) throw problem('ACCESS_DENIED');
    return grant;
  }
  function reconcile() {
    for (const s of sessions.values()) {
      try { current(s); }
      catch { end(s, 'PERMISSION_CHANGED'); }
    }
  }
  const timer = setInterval(() => {
    reconcile();
    const now = Date.now();
    for (const s of sessions.values()) {
      if (s.status !== 'ready' && now >= s.authDeadline) end(s, 'AUTH_TIMEOUT');
      else if (now - s.touched > idle) end(s, 'IDLE_TIMEOUT');
    }
  }, 1000);
  timer.unref();

  function startSession(client, p, grant, mode, request) {
    if (sessions.size >= 12 || [...sessions.values()].filter(s => s.client === client).length >= 4) throw problem('SESSION_LIMIT');
    const opened = Date.now();
    const s = { id: randomUUID(), request, client, profile: p.id, grant, mode, opened,
      status: 'connecting', authDeadline: opened + authWindow, touched: opened, controller: new AbortController(), waiters: new Set() };
    sessions.set(s.id, s);
    busy(sessions.size);
    const notify = (event, value) => {
      if (s.closed) return;
      if (event === 'ready') {
        s.status = 'ready';
        wake(s);
        s.endpoint = typeof value?.endpoint === 'string' ? value.endpoint : '';
        s.prompt = undefined;
        note(s, 'session.ready', 'success');
        if (s.mode === 'sftp') resolveRoot(s);
      }
      if (event === 'prompt') {
        s.authDeadline = Math.min(s.opened + authCeiling, Math.max(s.authDeadline, Date.now() + promptWindow));
        s.status = 'waiting_for_user';
        wake(s);
        s.prompt = { id: value.id, text: clean(value.prompt) };
        // Only the reason code and the fixed next steps. The question, the reply and any password stay out of the log.
        const promptDetail = {};
        if (SAVED_AUTH_REASONS.includes(value.savedAuth)) promptDetail.savedAuth = value.savedAuth;
        if (Array.isArray(value.next)) promptDetail.next = value.next;
        note(s, 'auth.prompt', 'waiting_for_user', null, Object.keys(promptDetail).length ? JSON.stringify(promptDetail) : undefined);
        if (!s.closed) onPrompt();
      }
      if (event === 'prompt-clear' && s.prompt?.id === value) {
        s.prompt = undefined;
        s.status = 'connecting';
        wake(s);
      }
      if (event === 'auth.rule') audit(base(s, event, 'submitted', null, clean(value)));
      if (event === 'hostkey.pinned' || event === 'hostkey.autotrusted') audit(base(s, event, 'success', null, JSON.stringify(value)));
      if (event === 'error') {
        // The first failure is the final reason. Later noise from the same OpenSSH exit is not recorded.
        if (s.failure) return;
        const failure = typeof value === 'string' ? { code: 'CONNECTION_FAILED', stage: 'connect' } : value;
        s.failure = { code: failure.code || 'CONNECTION_FAILED', stage: failure.stage || 'connect', hint: failure.hint, exit: failure.exit ?? null };
        // Only the classification is recorded and returned to clients. The raw log stays in memory for the app's own view.
        if (failure.log) diagnostics.set(s.id, { time: Date.now(), log: failure.log });
        if (diagnostics.size > 50) diagnostics.delete(diagnostics.keys().next().value);
        note(s, 'session.error', 'failed', s.failure.code, JSON.stringify({ ...failure.detail, stage: s.failure.stage, exit: s.failure.exit, hint: s.failure.hint, next: failure.next }));
      }
      if (event === 'closed') end(s, s.status === 'ready' ? 'REMOTE_CLOSED' : 'CONNECT_FAILED');
    };
    Promise.resolve().then(() => transport.connect(p, grant, mode, notify, () => current(s), s.controller.signal))
      .then(connection => { s.connection = connection; if (s.closed) connection.close(); })
      .catch(error => {
        if (s.closed) return;
        if (!s.failure) {
          const code = error.agentCode || 'CONNECTION_FAILED';
          note(s, 'session.error', 'failed', code, JSON.stringify({ next: transport.nextFor(code) }));
        }
        end(s, 'CONNECT_FAILED');
      });
    return s;
  }

  const inside = (root, p) => root === '/' || p === root || p.startsWith(root + '/');
  function remotePath(value) {
    if (typeof value !== 'string' || value.length > 1024 || !value.startsWith('/') ||
        /[\x00-\x1f\x7f]/.test(value) || value.split('/').some(part => part === '..' || part === '.')) throw problem('INVALID_PATH');
    return path.posix.normalize(value).replace(/\/$/, '') || '/';
  }
  // The root may itself be a symbolic link (for example /tmp on macOS). It is resolved once when the session is ready.
  function resolveRoot(s) {
    const root = s.grant.root;
    const channel = s.connection?.channel;
    s.rootReady = channel ? sftpCall(channel, 'realpath', root).then(resolved => {
      if (resolved !== root) note(s, 'session.root', 'success', null, JSON.stringify({ configured: root, resolved }));
      return resolved;
    }, () => root) : Promise.resolve(root);
  }
  const lstatOrReason = (channel, name) => sftpCall(channel, 'lstat', name).catch(error => {
    throw error.code === 2 ? problem('PATH_NOT_ALLOWED', 'PATH_NOT_FOUND') : error;
  });
  // Paths outside the root are refused from the text alone, so the answer never depends on what the server holds.
  // Inside the root, the path is mapped onto the resolved root and every component is checked for links.
  async function checkedPath(s, value) {
    const target = remotePath(value);
    const root = s.grant.root;
    if (!inside(root, target)) throw problem('PATH_NOT_ALLOWED', 'PATH_OUTSIDE_ROOT');
    const channel = s.connection.channel;
    const resolvedRoot = await (s.rootReady || Promise.resolve(root));
    const mapped = path.posix.join(resolvedRoot, path.posix.relative(root, target));
    let name = '/';
    let attrs = null;
    for (const part of mapped.split('/').filter(Boolean)) {
      name = path.posix.join(name, part);
      attrs = await lstatOrReason(channel, name);
      if (attrs.isSymbolicLink()) throw problem('PATH_NOT_ALLOWED', 'PATH_SYMLINK');
    }
    attrs ??= await lstatOrReason(channel, '/');
    current(s);
    return { channel, attrs, target };
  }

  // The classification of a session's failure, for clients: code, stage, hint and exit status only.
  function failureOf(id, client) {
    const row = db.prepare("SELECT reason, detail FROM events WHERE session=? AND client=? AND operation='session.error' ORDER BY id DESC LIMIT 1").get(id, client);
    if (!row) return {};
    let detail = {};
    try { detail = JSON.parse(row.detail || '{}'); } catch { detail = {}; }
    const next = Array.isArray(detail.next) ? detail.next : [{ action: 'ask_user', message: 'Ask the user to check this bookmark in PromeFTP.' }];
    return { error: { code: row.reason, stage: detail.stage, hint: detail.hint, next, ...(Number.isInteger(detail.exit) && { exit: detail.exit }) } };
  }
  function sessionEvents(id, client, after = 0) {
    if (!Number.isSafeInteger(after) || after < 0) throw problem('INVALID_REQUEST');
    return db.prepare(`SELECT id,time,request,operation,result,reason,detail FROM events
      WHERE session=? AND client=? AND id>? AND operation IN ('session.ready','session.ended','session.error','auth.prompt','auth.rule','trigger.match','ssh.approval','hostkey.pinned','hostkey.autotrusted')
      ORDER BY id LIMIT 100`).all(id, client, after);
  }
  const operations = new Set(['profiles.list', 'session.open', 'session.status', 'session.close', 'session.wait', 'sftp.list', 'sftp.stat', 'sftp.download', 'events.list', 'ssh.run', 'ssh.command']);
  // The status of a live session: ready, or a waiting status with the expiry and the next step.
  function statusOf(s) {
    if (s.status === 'ready') return { session: s.id, status: 'ready' };
    return { session: s.id, status: s.status, expires: s.authDeadline, retryAfter: 2,
      next: [{ action: 'wait', message: WAIT_MESSAGES[s.status] }] };
  }
  function endedReason(id, client) {
    return db.prepare("SELECT reason FROM events WHERE session=? AND client=? AND operation='session.ended' ORDER BY id DESC LIMIT 1").get(id, client)?.reason;
  }
  // A closed session. error.next wins; otherwise the next step follows the reason.
  function closedOf(id, client, reason) {
    const failure = failureOf(id, client);
    return { session: id, status: 'closed', reason, next: failure.error?.next ?? endNext[reason] ?? fallbackNext, ...failure };
  }
  function waitMilliseconds(value) {
    if (value === undefined) return waitLimit;
    if (!Number.isSafeInteger(value) || value < 1000 || value > waitLimit) throw problem('INVALID_REQUEST');
    return value;
  }
  // Resolves when the session changes state or the timeout passes, whichever comes first.
  function waitForChange(s, milliseconds) {
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); s.waiters.delete(finish); resolve(); };
      const timer = setTimeout(finish, milliseconds);
      s.waiters.add(finish);
    });
  }
  async function execute(client, req, request) {
    const { method, params = {} } = req;
    const clientId = client.id;
    const event = { request, client: clientId, operation: operations.has(method) ? method : 'unknown' };
    let started = false;
    let activeSession;
    let timeout;
    try {
      if (!operations.has(method) || !params || typeof params !== 'object' || Array.isArray(params)) throw problem('INVALID_REQUEST');
      const allowed = {
        'profiles.list': [], 'session.open': ['profile','mode'], 'session.status': ['session'], 'session.close': ['session'],
        'session.wait': ['session','timeout'],
        'sftp.list': ['session','path'], 'sftp.stat': ['session','path'], 'sftp.download': ['session','path'],
        'events.list': ['session','after'], 'ssh.run': ['session','task'], 'ssh.command': ['session','command'],
      }[method];
      if (Object.keys(params).some(key => !allowed.includes(key))) throw problem('INVALID_REQUEST');
      const waitMs = method === 'session.wait' ? waitMilliseconds(params.timeout) : undefined;
      let work;
      if (method === 'profiles.list') {
        work = () => profiles().filter(p => scopeFor(clientId, p.id)?.fingerprint === stamp(p))
          .map(p => { const g = scopeFor(clientId, p.id); return { id: p.id, name: clean(p.label), root: g.root,
            modes: [...(g.sftp !== false ? ['sftp'] : []), ...(g.task || g.commandApproval ? ['ssh'] : [])], download: g.download,
            tasks: g.task ? [g.task.name] : [], commandApproval: g.commandApproval }; });
      } else if (method === 'session.open') {
        const p = profileFor(params.profile);
        const grant = p && scopeFor(clientId, p.id);
        if (p && grant) event.profile = p.id;
        if (!grant || stamp(p) !== grant.fingerprint) throw problem('ACCESS_DENIED');
        const allowedMode = params.mode === 'sftp' ? grant.sftp !== false : params.mode === 'ssh' && (grant.task || grant.commandApproval);
        if (!allowedMode) throw problem('ACCESS_DENIED');
        event.profile = p.id;
        event.detail = params.mode;
        work = () => {
          const s = startSession(clientId, p, grant, params.mode, request);
          event.session = s.id;
          return { session: s.id, status: s.status };
        };
      } else {
        if (['events.list', 'session.status', 'session.wait'].includes(method) && !sessions.has(params.session)) {
          const ended = typeof params.session === 'string' && db.prepare("SELECT reason FROM events WHERE session=? AND client=? AND operation='session.ended' ORDER BY id DESC LIMIT 1").get(params.session, clientId);
          if (!ended) throw problem('SESSION_NOT_FOUND');
          event.session = params.session;
          work = method === 'events.list' ? () => sessionEvents(params.session, clientId, params.after)
            : () => closedOf(params.session, clientId, ended.reason);
        }
        const s = sessions.get(params.session);
        if (!work) {
          if (!s || s.client !== clientId) throw problem('SESSION_NOT_FOUND');
          const grant = current(s);
          event.profile = s.profile;
          event.session = s.id;
          s.touched = Date.now();
          if (method === 'session.status') work = () => statusOf(s);
          else if (method === 'session.close') work = () => { end(s, 'CLIENT_CLOSED'); return { closed: true }; };
          else if (method === 'events.list') {
            work = () => sessionEvents(s.id, clientId, params.after);
          } else if (method === 'session.wait') {
            // Waits without becoming the active request, so the 30 second request limit never closes the session.
            work = async () => {
              if (s.status !== 'ready') await waitForChange(s, waitMs);
              return s.closed ? closedOf(s.id, clientId, endedReason(s.id, clientId)) : statusOf(s);
            };
          } else {
            if (s.status !== 'ready') throw problem(s.status === 'waiting_for_user' ? 'USER_ACTION_REQUIRED' : 'SESSION_NOT_READY');
            if (s.inFlight) throw problem('SESSION_BUSY');
            activeSession = s;
            if (method === 'ssh.run' || method === 'ssh.command') {
              const arbitrary = method === 'ssh.command';
              if (s.mode !== 'ssh') throw problem('ACCESS_DENIED');
              if (arbitrary ? !grant.commandApproval : !grant.task || params.task !== grant.task.name) throw problem('ACCESS_DENIED');
              const command = arbitrary ? transport.command(params.command) : grant.task.command;
              // An auto-approved command is recorded as such. Its approval id stays in the ssh.approval row.
              const autoApproved = arbitrary && grant.commandAutoApprove === true;
              event.detail = arbitrary ? (autoApproved ? 'auto-approved command' : 'user-approved command') : grant.task.name;
              work = async () => {
                let approval;
                if (arbitrary) {
                  approval = randomUUID();
                  if (autoApproved) {
                    // The user chose to run commands without asking. The command is still recorded.
                    audit(base(s, 'ssh.approval', 'allowed', 'AUTO_APPROVED', approval, request));
                  } else {
                    audit(base(s, 'ssh.approval', 'waiting_for_user', null, approval, request));
                    const approved = await transport.approve(s, command, profileFor(s.profile), client.name);
                    current(s);
                    audit(base(s, 'ssh.approval', approved ? 'allowed' : 'denied', null, approval, request));
                    if (!approved) throw problem('USER_DENIED');
                  }
                }
                const result = await transport.run(s, command, (kind, detail) => {
                  try { audit(base(s, kind, 'success', null, clean(detail), request)); }
                  catch { close(s); }
                });
                if (approval && !autoApproved) event.detail = JSON.stringify({ approval });
                return result;
              };
            } else {
              if (s.mode !== 'sftp' || (method === 'sftp.download' && !grant.download)) throw problem('ACCESS_DENIED');
              const target = remotePath(params.path);
              if (!inside(grant.root, target)) throw problem('PATH_NOT_ALLOWED', 'PATH_OUTSIDE_ROOT');
              event.detail = target;
              work = async () => {
                const { channel, attrs } = await checkedPath(s, target);
                const stat = a => ({ directory: a.isDirectory(), link: a.isSymbolicLink(), size: a.size, modified: a.mtime });
                if (method === 'sftp.stat') return stat(attrs);
                if (method === 'sftp.list') {
                  if (!attrs.isDirectory()) throw problem('INVALID_PATH');
                  const list = await sftpCall(channel, 'readdir', target);
                  current(s);
                  return { entries: list.filter(x => x.filename && !/[\/\x00-\x1f\x7f]/.test(x.filename) && !['.','..'].includes(x.filename))
                    .slice(0, 500).map(x => ({ name: x.filename, ...stat(x.attrs) })), truncated: list.length > 500 };
                }
                if (!attrs.isFile() || attrs.size > 16 * 1024 * 1024) throw problem('FILE_LIMIT');
                const result = await transport.download(s, target, channel);
                event.detail = JSON.stringify({ path: target, bytes: result.bytes });
                return result;
              };
            }
          }
        }
      }
      const startedAt = Date.now();
      begin(event);
      started = true;
      if (activeSession) activeSession.inFlight = true;
      const data = await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
        timeout = setTimeout(() => {
          if (activeSession) end(activeSession, 'TIMEOUT');
          reject(problem('TIMEOUT'));
        }, 30_000);
      })]);
      if (activeSession) current(activeSession);
      const ranCommand = method === 'ssh.run' || method === 'ssh.command';
      finish(event, ranCommand && (data.exitCode !== 0 || data.truncated) ? 'failed' : 'success', null,
        JSON.stringify({ target: event.detail, durationMs: Date.now() - startedAt,
        ...(Number.isInteger(data?.exitCode) && { exitCode: data.exitCode }) }));
      return data;
    } catch (error) {
      const reason = error.agentCode || 'OPERATION_FAILED';
      if (started) finish(event, reason === 'TIMEOUT' ? 'unknown' : 'failed', reason);
      else audit({ ...event, result: 'denied', reason });
      throw problem(reason, error.agentReason);
    } finally {
      clearTimeout(timeout);
      if (activeSession) activeSession.inFlight = false;
    }
  }
  let unauthenticated = { count: 0, start: 0 };
  function accept(socket) {
    if (clients.size >= 32) return socket.destroy();
    clients.add(socket);
    socket.once('close', () => clients.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.setTimeout(35_000, () => socket.destroy());
    let chunks = [];
    let size = 0;
    socket.on('data', async function receive(chunk) {
      size += chunk.length;
      if (size > socketLimit) return socket.destroy();
      chunks.push(chunk);
      if (!chunk.includes(10)) return;
      socket.removeListener('data', receive);
      const request = randomUUID();
      let response;
      try {
        const req = JSON.parse(Buffer.concat(chunks).toString());
        chunks = [];
        if (req.version !== protocol) throw problem('VERSION_MISMATCH');
        const client = typeof req.token === 'string' && req.token.length === 43 &&
          settings().clients?.find(c => c.digest === hash(req.token));
        if (!settings().enabled || !client) {
          const now = Date.now();
          unauthenticated.count++;
          if (now - unauthenticated.start >= 60_000) {
            audit({ request, operation: 'authenticate', result: 'denied', reason: 'UNAUTHENTICATED', detail: JSON.stringify({ attemptsSinceLastRecord: unauthenticated.count }) });
            unauthenticated = { count: 0, start: now };
          }
          throw problem('UNAUTHENTICATED');
        }
        response = { data: await execute(client, req, request) };
      } catch (error) { response = { error: error.agentCode || 'INVALID_REQUEST', ...(error.agentReason && { reason: error.agentReason }) }; }
      socket.end(JSON.stringify({ version: protocol, request, ...response }) + '\n');
    });
  }

  async function listen() {
    if (stopping) await stopping;
    if (starting) return starting;
    if (server) return;
    starting = (async () => {
      await fs.mkdir(dir, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
      const info = await fs.lstat(dir);
      if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) throw problem('UNSAFE_SOCKET');
      const existing = await fs.lstat(socketPath).catch(e => { if (e.code !== 'ENOENT') throw e; });
      if (existing) {
        if (!existing.isSocket() || existing.uid !== process.getuid()) throw problem('UNSAFE_SOCKET');
        const live = await new Promise((resolve, reject) => {
          const probe = net.createConnection(socketPath);
          probe.once('connect', () => { probe.destroy(); resolve(true); });
          probe.once('error', error => error.code === 'ECONNREFUSED' || error.code === 'ENOENT' ? resolve(false) : reject(error));
        });
        if (live) throw problem('SOCKET_IN_USE');
        await fs.unlink(socketPath);
      }
      const listener = net.createServer(accept);
      await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(socketPath, resolve); });
      listener.removeAllListeners('error');
      try { await fs.chmod(socketPath, 0o600); }
      catch (error) { listener.close(); throw error; }
      listener.on('error', () => { storageFailed = true; for (const s of sessions.values()) close(s); });
      server = listener;
    })();
    try {
      await starting;
      lastListenError = '';
    } catch (error) {
      lastListenError = error.agentCode || 'STARTUP_FAILED';
      throw error;
    } finally { starting = undefined; }
  }
  function stop() {
    if (server) {
      for (const client of clients) client.destroy();
      const listener = server;
      server = undefined;
      stopping = new Promise(resolve => listener.close(resolve));
    }
    for (const s of sessions.values()) end(s, 'SERVICE_DISABLED');
  }

  function history(filter = {}, maximum = 250) {
    const conditions = ['time >= ?'];
    const args = [Number.isSafeInteger(filter.since) ? filter.since : Date.now() - (settings().days || 30) * day];
    for (const key of ['client','profile','operation','result','request','session']) {
      if (typeof filter[key] === 'string' && filter[key]) { conditions.push(key + '=?'); args.push(filter[key]); }
    }
    const order = typeof filter.session === 'string' && filter.session ? 'ASC' : 'DESC';
    return db.prepare(`SELECT ${fields} FROM events WHERE ${conditions.join(' AND ')} ORDER BY id ${order} LIMIT ?`).all(...args, maximum);
  }
  // Runs once at startup. A grant that matches the old whole-bookmark fingerprint is moved to the new one. A grant that
  // is already stale under both fingerprints stays stale, so the user saves it again. Saved only when something changed.
  const migrations = [];
  for (const client of settings().clients || []) {
    for (const [id, grant] of Object.entries(client.grants || {})) {
      const p = profileFor(id);
      if (p && grant.fingerprint === legacyStamp(p) && grant.fingerprint !== stamp(p)) migrations.push([client.id, id, stamp(p)]);
    }
  }
  if (migrations.length) {
    await save(g => {
      for (const [client, id, fingerprint] of migrations) {
        const grant = g.clients?.find(c => c.id === client)?.grants?.[id];
        if (grant) grant.fingerprint = fingerprint;
      }
    });
  }
  return {
    listen, stop, reconcile, history, audit,
    verify() { if (storageFailed) throw problem('AUDIT_UNAVAILABLE'); },
    info() {
      const enabled = settings().enabled === true;
      const online = Boolean(server) && !storageFailed;
      // enabled is the saved setting. A failed start shows here as the reason the service is offline.
      const offlineReason = online || !enabled ? '' : storageFailed ? 'AUDIT_UNAVAILABLE' : lastListenError || 'STARTUP_FAILED';
      return { enabled, online, offlineReason, days: settings().days || 30,
        clients: (settings().clients || []).map(({ id, name, grants }) => ({
          id, name, grants: Object.fromEntries(Object.entries(grants || {}).map(([id, { fingerprint, task, ...g }]) =>
            [id, { ...g, task, stale: !profileFor(id) || fingerprint !== stamp(profileFor(id)) }])),
        })),
        profiles: profiles().map(p => ({ id: p.id, name: clean(p.label), eligible: transport.eligible(p), host: clean(p.host), username: clean(p.username), port: p.port })),
        prompts: [...sessions.values()].filter(s => s.prompt).map(s => ({ session: s.id, profile: s.profile, client: s.client, expires: s.authDeadline, ...s.prompt })),
      };
    },
    // App-only view of OpenSSH output for a failed session. Never returned through the client API.
    diagnostic(id) {
      return diagnostics.get(id) || null;
    },
    async enable(enabled) {
      if (typeof enabled !== 'boolean') throw problem('INVALID_REQUEST');
      if (enabled) { this.verify(); await listen(); }
      try {
        audit({ operation: 'service.set', result: 'success', detail: enabled ? 'enabled' : 'disabled' });
        await save(g => { g.enabled = enabled; });
      } catch (error) { if (enabled && !settings().enabled) stop(); throw error; }
      if (!enabled) stop();
    },
    async register(name) {
      if (typeof name !== 'string' || !clean(name).trim() || name.length > 80) throw problem('INVALID_REQUEST');
      const id = randomUUID();
      const token = randomBytes(32).toString('base64url');
      audit({ client: id, operation: 'client.register', result: 'allowed', detail: clean(name) });
      await save(g => {
        g.clients ??= [];
        if (g.clients.length >= 25) throw problem('CLIENT_LIMIT');
        g.clients.push({ id, name: clean(name.trim()), digest: hash(token), grants: {} });
      });
      audit({ client: id, operation: 'client.register', result: 'success', detail: clean(name) });
      return { id, token };
    },
    async revoke(id) {
      audit({ client: id, operation: 'client.revoke', result: 'allowed' });
      await save(g => { g.clients = (g.clients || []).filter(c => c.id !== id); });
      reconcile();
      audit({ client: id, operation: 'client.revoke', result: 'success' });
    },
    // Applies one grant to several bookmarks. PAM rules and triggers can be host-scoped, so for each bookmark only the ids
    // that bookmark offers are kept; the rest are reported as skipped. Each bookmark is then checked again on its own.
    async grantMany(clientId, ids, grant) {
      const results = [];
      for (const id of ids) {
        const p = profileFor(id);
        const choices = p && transport.eligible(p) ? transport.catalog(p) : { pam: [], triggers: [] };
        const filtered = { ...grant };
        const skipped = {};
        for (const field of ['pam', 'triggers']) {
          const requested = Array.isArray(grant[field]) ? grant[field] : [];
          const allowed = new Set(choices[field].map(item => item.id));
          filtered[field] = requested.filter(value => allowed.has(value));
          if (filtered[field].length !== requested.length) skipped[field] = requested.length - filtered[field].length;
        }
        const note = Object.keys(skipped).length ? { skipped } : {};
        try { await this.grant(clientId, id, filtered); results.push({ id, ok: true, ...note }); }
        catch (error) { results.push({ id, ok: false, reason: error.agentCode || 'OPERATION_FAILED', ...note }); }
      }
      return results;
    },
    async grant(clientId, id, grant) {
      const p = profileFor(id);
      if (grant && (!p || !transport.eligible(p))) throw problem('PROFILE_NOT_ELIGIBLE');
      const checked = grant && { root: grant.sftp === false ? null : remotePath(grant.root),
        fingerprint: stamp(p), route: (await transport.resolve(p)).route, ...transport.validateGrant(grant, p) };
      audit({ client: clientId, profile: id, operation: grant ? 'grant.set' : 'grant.remove', result: 'allowed' });
      await save(g => {
        if (checked && (!profileFor(id) || stamp(profileFor(id)) !== checked.fingerprint)) throw problem('ACCESS_DENIED');
        const c = g.clients?.find(c => c.id === clientId);
        if (!c) throw problem('INVALID_REQUEST');
        if (checked) c.grants[id] = checked;
        else delete c.grants[id];
      });
      reconcile();
      audit({ client: clientId, profile: id, operation: grant ? 'grant.set' : 'grant.remove', result: 'success' });
    },
    async retention(days) {
      if (!Number.isInteger(days) || days < 1 || days > 90) throw problem('INVALID_REQUEST');
      audit({ operation: 'history.retention', result: 'allowed', detail: String(days) });
      await save(g => { g.days = days; });
      transaction(prune);
      audit({ operation: 'history.retention', result: 'success', detail: String(days) });
    },
    answer(session, id, value) {
      const s = sessions.get(session);
      if (!s) throw problem('SESSION_NOT_FOUND');
      current(s);
      if (s.prompt?.id !== id || Date.now() >= s.authDeadline || (value !== null &&
          (typeof value !== 'string' || !value || Buffer.byteLength(value) > 1023 || /[\r\n\0]/.test(value)))) throw problem('INVALID_REQUEST');
      audit(base(s, 'auth.user', value === null ? 'denied' : 'allowed'));
      if (value === null) { end(s, 'USER_CANCELLED'); return; }
      if (!s.connection?.answer(id, value)) throw problem('PROMPT_EXPIRED');
      s.prompt = undefined;
      s.status = 'connecting';
      wake(s);
      note(s, 'auth.user', 'submitted');
    },
  };
}

// History for the preferences window. Without a service (startup failed) there is nothing to read, so it is empty.
function historyOf(service, filter) { return service ? service.history(filter) : []; }

module.exports = { createAgentService, socketDirectory, protocol, problem, historyOf };
