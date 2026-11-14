const net = require('node:net');
const fs = require('node:fs/promises');
const { DatabaseSync } = require('node:sqlite');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');

const protocol = 1;
const socketLimit = 16384;
const idle = 10 * 60_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 512);
const problem = code => Object.assign(Error(code), { agentCode: code });
function socketDirectory(uid = process.getuid()) { return '/tmp/promeftp-agent-' + uid; }
const fields = 'id, time, request, client, profile, session, operation, result, reason, detail';

async function createAgentService({ directory, state, save, profiles, transport, sftpCall, busy, onPrompt = () => {} }) {
  const dir = socketDirectory();
  const socketPath = path.join(dir, 'api.sock');
  const clients = new Set();
  const sessions = new Map();
  let server, starting, stopping, db;
  let storageFailed = false;
  const day = 86400000;
  const settings = () => state().agent || {};
  const scopeFor = (client, id) => settings().clients?.find(item => item.id === client)?.grants?.[id];
  const profileFor = id => profiles().find(p => p.id === id);
  const stamp = p => hash(JSON.stringify(p));
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
  function close(s) {
    if (s.closed) return;
    s.closed = true;
    sessions.delete(s.id);
    s.connection?.close();
    s.controller.abort();
    busy(sessions.size);
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
    const s = { id: randomUUID(), request, client, profile: p.id, grant, mode,
      status: 'connecting', authDeadline: Date.now() + 120_000, touched: Date.now(), controller: new AbortController() };
    sessions.set(s.id, s);
    busy(sessions.size);
    const notify = (event, value) => {
      if (s.closed) return;
      if (event === 'ready') {
        s.status = 'ready';
        s.prompt = undefined;
        note(s, 'session.ready', 'success');
      }
      if (event === 'prompt') {
        s.status = 'waiting_for_user';
        s.prompt = { id: value.id, text: clean(value.prompt) };
        note(s, 'auth.prompt', 'waiting_for_user');
        if (!s.closed) onPrompt();
      }
      if (event === 'prompt-clear' && s.prompt?.id === value) {
        s.prompt = undefined;
        s.status = 'connecting';
      }
      if (event === 'auth.rule') audit(base(s, event, 'submitted', null, clean(value)));
      if (event === 'error') note(s, 'session.error', 'failed', value === 'HOST_KEY_REJECTED' ? value : 'CONNECTION_FAILED');
      if (event === 'closed') end(s, 'REMOTE_CLOSED');
    };
    Promise.resolve().then(() => transport.connect(p, grant, mode, notify, () => current(s), s.controller.signal))
      .then(connection => { s.connection = connection; if (s.closed) connection.close(); })
      .catch(error => {
        if (s.closed) return;
        note(s, 'session.error', 'failed', error.agentCode || 'CONNECTION_FAILED');
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
  async function checkedPath(s, value) {
    const target = remotePath(value);
    const root = s.grant.root;
    if (!inside(root, target)) throw problem('PATH_NOT_ALLOWED');
    const channel = s.connection.channel;
    const canonical = await sftpCall(channel, 'realpath', target);
    if (canonical !== target) throw problem('PATH_NOT_ALLOWED');
    let name = '/';
    let attrs = target === '/' ? await sftpCall(channel, 'lstat', '/') : null;
    for (const part of target.split('/').filter(Boolean)) {
      name = path.posix.join(name, part);
      attrs = await sftpCall(channel, 'lstat', name);
      if (attrs.isSymbolicLink()) throw problem('PATH_NOT_ALLOWED');
    }
    current(s);
    return { channel, attrs, target };
  }

  function sessionEvents(id, client, after = 0) {
    if (!Number.isSafeInteger(after) || after < 0) throw problem('INVALID_REQUEST');
    return db.prepare(`SELECT id,time,request,operation,result,reason,detail FROM events
      WHERE session=? AND client=? AND id>? AND operation IN ('session.ready','session.ended','session.error','auth.prompt','auth.rule','trigger.match','ssh.approval')
      ORDER BY id LIMIT 100`).all(id, client, after);
  }
  const operations = new Set(['profiles.list', 'session.open', 'session.status', 'session.close', 'sftp.list', 'sftp.stat', 'sftp.download', 'events.list', 'ssh.run', 'ssh.command']);
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
        'sftp.list': ['session','path'], 'sftp.stat': ['session','path'], 'sftp.download': ['session','path'],
        'events.list': ['session','after'], 'ssh.run': ['session','task'], 'ssh.command': ['session','command'],
      }[method];
      if (Object.keys(params).some(key => !allowed.includes(key))) throw problem('INVALID_REQUEST');
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
        if (['events.list', 'session.status'].includes(method) && !sessions.has(params.session)) {
          const ended = typeof params.session === 'string' && db.prepare("SELECT reason FROM events WHERE session=? AND client=? AND operation='session.ended' ORDER BY id DESC LIMIT 1").get(params.session, clientId);
          if (!ended) throw problem('SESSION_NOT_FOUND');
          event.session = params.session;
          work = method === 'events.list' ? () => sessionEvents(params.session, clientId, params.after)
            : () => ({ session: params.session, status: 'closed', reason: ended.reason });
        }
        const s = sessions.get(params.session);
        if (!work) {
          if (!s || s.client !== clientId) throw problem('SESSION_NOT_FOUND');
          const grant = current(s);
          event.profile = s.profile;
          event.session = s.id;
          s.touched = Date.now();
          if (method === 'session.status') work = () => ({ session: s.id, status: s.status, ...(s.status !== 'ready' && { expires: s.authDeadline }) });
          else if (method === 'session.close') work = () => { end(s, 'CLIENT_CLOSED'); return { closed: true }; };
          else if (method === 'events.list') {
            work = () => sessionEvents(s.id, clientId, params.after);
          } else {
            if (s.status !== 'ready') throw problem(s.status === 'waiting_for_user' ? 'USER_ACTION_REQUIRED' : 'SESSION_NOT_READY');
            if (s.inFlight) throw problem('SESSION_BUSY');
            activeSession = s;
            if (method === 'ssh.run' || method === 'ssh.command') {
              const arbitrary = method === 'ssh.command';
              if (s.mode !== 'ssh') throw problem('ACCESS_DENIED');
              if (arbitrary ? !grant.commandApproval : !grant.task || params.task !== grant.task.name) throw problem('ACCESS_DENIED');
              const command = arbitrary ? transport.command(params.command) : grant.task.command;
              event.detail = arbitrary ? 'user-approved command' : grant.task.name;
              work = async () => {
                let approval;
                if (arbitrary) {
                  approval = randomUUID();
                  audit(base(s, 'ssh.approval', 'waiting_for_user', null, approval, request));
                  const approved = await transport.approve(s, command, profileFor(s.profile), client.name);
                  current(s);
                  audit(base(s, 'ssh.approval', approved ? 'allowed' : 'denied', null, approval, request));
                  if (!approved) throw problem('USER_DENIED');
                }
                const result = await transport.run(s, command, (kind, detail) => {
                  try { audit(base(s, kind, 'success', null, clean(detail), request)); }
                  catch { close(s); }
                });
                if (approval) event.detail = JSON.stringify({ approval });
                return result;
              };
            } else {
              if (s.mode !== 'sftp' || (method === 'sftp.download' && !grant.download)) throw problem('ACCESS_DENIED');
              const target = remotePath(params.path);
              if (!inside(grant.root, target)) throw problem('PATH_NOT_ALLOWED');
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
      throw problem(reason);
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
      } catch (error) { response = { error: error.agentCode || 'INVALID_REQUEST' }; }
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
    try { await starting; } finally { starting = undefined; }
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
  return {
    listen, stop, reconcile, history, audit,
    verify() { if (storageFailed) throw problem('AUDIT_UNAVAILABLE'); },
    info() {
      return { enabled: settings().enabled === true, online: Boolean(server) && !storageFailed, days: settings().days || 30,
        clients: (settings().clients || []).map(({ id, name, grants }) => ({
          id, name, grants: Object.fromEntries(Object.entries(grants || {}).map(([id, { fingerprint, task, ...g }]) =>
            [id, { ...g, task, stale: !profileFor(id) || fingerprint !== stamp(profileFor(id)) }])),
        })),
        profiles: profiles().map(p => ({ id: p.id, name: clean(p.label), eligible: transport.eligible(p), host: clean(p.host), username: clean(p.username), port: p.port || 22 })),
        prompts: [...sessions.values()].filter(s => s.prompt).map(s => ({ session: s.id, profile: s.profile, client: s.client, expires: s.authDeadline, ...s.prompt })),
      };
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
    async grant(clientId, id, grant) {
      const p = profileFor(id);
      if (!p || !transport.eligible(p)) throw problem('PROFILE_NOT_ELIGIBLE');
      const checked = grant && { root: grant.sftp === false ? null : remotePath(grant.root),
        fingerprint: stamp(p), ...transport.validateGrant(grant, p) };
      audit({ client: clientId, profile: id, operation: grant ? 'grant.set' : 'grant.remove', result: 'allowed' });
      await save(g => {
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
      note(s, 'auth.user', 'submitted');
    },
  };
}

module.exports = { createAgentService, socketDirectory, protocol, problem };
