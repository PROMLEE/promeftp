const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
// Finished jobs leave the queue and are written to the history log.
const finishedStates = new Set(['completed', 'skipped', 'cancelled']);
// Failed jobs stay in the queue until the user retries or clears them.
const terminal = new Set(['completed', 'failed', 'cancelled', 'skipped', 'interrupted']);
const historyLimit = 500;
const historyDays = 30;
function createTransferService({ file, historyFile, execute, emit, onBusy = () => {} }) {
  const jobs = new Map();
  const controllers = new Map();
  const workers = new Map();
  const activeEndpoints = new Set();
  const occupied = new Set();
  const ready = new Map();
  const maxParallel = 3;
  let stopping = false;
  let lastProgressEmit = 0;
  let writes = Promise.resolve();
  let historyWrites = Promise.resolve();
  let historyAppends = 0;
  const persist = () => {
    writes = writes.then(async () => {
      const temp = file + '.tmp';
      await fs.writeFile(temp, JSON.stringify({ version: 2, jobs: [...jobs.values()].map(({ cancel, active, progressSample, shutdown, ...job }) => job) }), { mode: 0o600 });
      await fs.rename(temp, file);
    });
    return writes;
  };
  const snapshot = () => [...jobs.values()].map(({ cancel, active, progressSample, shutdown, ...job }) => ({ ...job }));
  const publish = async job => { await persist(); emit(snapshot(), job && { ...job }); };
  const historyRecord = job => ({
    id: job.id, operation: job.operation, state: job.state, label: job.label, batchLabel: job.batchLabel,
    sourceName: job.sourceName, targetName: job.targetName, localPath: job.localPath, remotePath: job.remotePath,
    createdAt: job.createdAt, finishedAt: job.finishedAt || Date.now(), error: job.error,
    bytes: job.progress?.bytes, total: job.progress?.total,
  });
  async function readHistory() {
    let text = '';
    try { text = await fs.readFile(historyFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return text.split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  }
  async function trimHistory() {
    const entries = await readHistory();
    const cutoff = Date.now() - historyDays * 86_400_000;
    const kept = entries.filter(entry => (entry.finishedAt || 0) >= cutoff).slice(-historyLimit);
    if (kept.length === entries.length) return;
    const temp = historyFile + '.tmp';
    await fs.writeFile(temp, kept.map(entry => JSON.stringify(entry) + '\n').join(''), { mode: 0o600 });
    await fs.rename(temp, historyFile);
  }
  const trimSoon = () => {
    historyWrites = historyWrites.then(trimHistory).catch(error => console.error('Could not trim transfer history:', error.message));
  };
  const recordHistory = job => {
    if (!historyFile) return;
    const line = JSON.stringify(historyRecord(job)) + '\n';
    historyAppends += 1;
    historyWrites = historyWrites.then(async () => {
      await fs.appendFile(historyFile, line, { mode: 0o600 });
      if (historyAppends % 50 === 0) await trimHistory();
    }).catch(error => console.error('Could not write transfer history:', error.message));
  };
  // Moves a finished job out of the queue; failed jobs are only logged.
  const settle = job => {
    if (job.state === 'failed') recordHistory(job);
    if (!finishedStates.has(job.state)) return;
    recordHistory(job);
    jobs.delete(job.id);
  };
  async function start() {
    let migrated = false;
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      for (const job of saved.jobs || []) {
        // Version 1 kept finished jobs in the queue file; move them to the history log.
        if (finishedStates.has(job.state)) { recordHistory(job); migrated = true; continue; }
        if (['running', 'queued', 'waiting-conflict'].includes(job.state)) job.state = 'interrupted';
        job.active = false;
        jobs.set(job.id, job);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (migrated) await persist();
    if (historyFile) trimSoon();
    emit(snapshot());
  }
  const endpointKeys = job => [...new Set([job.connectionScope || job.sessionId, job.operation === 'remote-copy' ? (job.targetScope || job.targetSessionId) : null].filter(Boolean).map(String))];
  const eligible = job => {
    if (job.state !== 'queued') return false;
    const keys = endpointKeys(job);
    if (keys.some(key => activeEndpoints.has(key))) return false;
    if (job.batchId) {
      for (const other of jobs.values()) {
        if (other.id === job.id) break;
        if (other.batchId === job.batchId && ['queued','running','paused','waiting-conflict'].includes(other.state)) return false;
      }
    }
    return true;
  };
  async function runJob(job) {
    occupied.add(job.id);
    const keys = endpointKeys(job);
    keys.forEach(key => activeEndpoints.add(key));
    job.state = 'running'; job.startedAt = Date.now(); job.active = true;
    const controller = new AbortController(); controllers.set(job.id, controller);
    controller.signal.waitForDecision = async request => {
      job.state = 'waiting-conflict'; occupied.delete(job.id);
      await publish(job); pump();
      const answer = await request();
      if (controller.signal.aborted) throw Error('Transfer cancelled.');
      await new Promise((resolve, reject) => {
        const abort = () => { ready.delete(job.id); reject(Error('Transfer cancelled.')); };
        controller.signal.addEventListener('abort', abort, { once: true });
        ready.set(job.id, () => { controller.signal.removeEventListener('abort', abort); resolve(); });
        pump();
      });
      job.state = 'running'; await publish(job);
      return answer;
    };
    controller.signal.pausePoint = async () => {
      while (job.state === 'paused' && !controller.signal.aborted) await new Promise(resolve => setTimeout(resolve, 120));
      if (controller.signal.aborted) throw Error('Transfer cancelled.');
    };
    await publish(job);
    try {
      const result = await execute(job, controller.signal, progress => {
        const now = Date.now(); job.progress = { ...progress, updatedAt: now };
        const previous = job.progressSample;
        if (previous && now > previous.at) job.progress.speed = Math.max(0, (job.progress.bytes - previous.bytes) * 1000 / (now - previous.at));
        job.progressSample = { bytes: job.progress.bytes || 0, at: now };
        if (now - lastProgressEmit >= 120) { lastProgressEmit = now; emit(snapshot(), { ...job }); }
      });
      job.state = job.cancel && !controller.signal.committed ? 'cancelled' : result?.status === 'skipped' ? 'skipped' : 'completed';
      if (result?.skippedCount) job.skippedCount = result.skippedCount;
      if (result?.note) job.note = String(result.note).slice(0, 500);
      job.finishedAt = Date.now(); job.error = undefined;
    } catch (error) {
      const stoppedByQuit = job.shutdown && !controller.signal.committed;
      job.state = job.cancel ? 'cancelled' : stoppedByQuit ? 'interrupted' : 'failed'; job.finishedAt = Date.now();
      job.error = stoppedByQuit ? 'PromeFTP quit before this transfer finished.' : String(error.message || error).slice(0, 500);
    } finally {
      occupied.delete(job.id); ready.delete(job.id);
      job.active = false; controllers.delete(job.id); keys.forEach(key => activeEndpoints.delete(key));
      settle(job);
      await publish(job); workers.delete(job.id); onBusy(workers.size > 0); void pump();
    }
  }
  function pump() {
    if (stopping) return;
    for (const [id, resume] of ready) {
      if (occupied.size >= maxParallel) break;
      ready.delete(id); occupied.add(id); resume();
    }
    for (const job of jobs.values()) {
      if (occupied.size >= maxParallel) break;
      if (!eligible(job)) continue;
      const promise = runJob(job); workers.set(job.id, promise); onBusy(true);
    }
  }
  return {
    start,
    list: snapshot,
    async history(query = '', limit = 300) {
      if (!historyFile) return [];
      await historyWrites;
      const needle = String(query || '').trim().toLowerCase();
      return (await readHistory()).reverse().filter(entry => !needle || [entry.label, entry.batchLabel, entry.sourceName, entry.targetName,
        entry.localPath, entry.remotePath, entry.error, entry.operation, entry.state].some(value => String(value || '').toLowerCase().includes(needle))).slice(0, limit);
    },
    async enqueue(input) {
      if (!input || !['upload', 'download', 'remote-copy', 'remote-duplicate', 'mkdir-local', 'mkdir-remote'].includes(input.operation)) throw Error('Invalid transfer request.');
      const job = { ...input, id: randomUUID(), state: 'queued', createdAt: Date.now(), attempt: 0 };
      delete job.cancel; jobs.set(job.id, job); await publish(job); void pump(); return job.id;
    },
    async control(id, action, binding) {
      const job = jobs.get(id); if (!job) throw Error('Transfer no longer exists.');
      if (action === 'cancel') {
        if (job.active) { job.cancel = true; controllers.get(job.id)?.abort(); }
        else if (job.state === 'queued' || job.state === 'paused' || job.state === 'failed' || job.state === 'interrupted') job.state = 'cancelled';
      } else if (action === 'retry' && ['failed', 'interrupted'].includes(job.state)) {
        if (binding) Object.assign(job, binding);
        job.state = 'queued'; job.cancel = false; job.attempt = (job.attempt || 0) + 1; job.error = undefined;
      } else if (action === 'pause' && ['queued', 'running'].includes(job.state)) job.state = 'paused';
      else if (action === 'resume' && job.state === 'paused') job.state = job.active ? 'running' : 'queued';
      else if (action === 'clear' && terminal.has(job.state)) jobs.delete(id);
      else throw Error('Unsupported transfer action.');
      if (!job.active && finishedStates.has(job.state)) settle(job);
      await publish(job); void pump(); return snapshot();
    },
    async stop() { stopping = true; for (const job of jobs.values()) if (job.active) { job.shutdown = true; controllers.get(job.id)?.abort(); } await Promise.allSettled([...workers.values()]); await writes; await historyWrites; },
  };
}
module.exports = { createTransferService };
