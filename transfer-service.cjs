const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const terminal = new Set(['completed', 'failed', 'cancelled', 'skipped', 'interrupted']);
function createTransferService({ file, execute, emit, onBusy = () => {} }) {
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
  const persist = () => {
    writes = writes.then(async () => {
      const temp = file + '.tmp';
      await fs.writeFile(temp, JSON.stringify({ version: 1, jobs: [...jobs.values()].map(({ cancel, active, progressSample, ...job }) => job) }), { mode: 0o600 });
      await fs.rename(temp, file);
    });
    return writes;
  };
  const snapshot = () => [...jobs.values()].map(({ cancel, active, progressSample, ...job }) => ({ ...job }));
  const publish = async job => { await persist(); emit(snapshot(), job && { ...job }); };
  async function start() {
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      for (const job of saved.jobs || []) {
        if (['running', 'queued', 'waiting-conflict'].includes(job.state)) job.state = 'interrupted';
        job.active = false;
        jobs.set(job.id, job);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
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
      job.finishedAt = Date.now(); job.error = undefined;
    } catch (error) {
      job.state = job.cancel ? 'cancelled' : 'failed'; job.finishedAt = Date.now(); job.error = String(error.message || error).slice(0, 500);
    } finally {
      occupied.delete(job.id); ready.delete(job.id);
      job.active = false; controllers.delete(job.id); keys.forEach(key => activeEndpoints.delete(key));
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
    async enqueue(input) {
      if (!input || !['upload', 'download', 'remote-copy', 'mkdir-local', 'mkdir-remote'].includes(input.operation)) throw Error('Invalid transfer request.');
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
      await publish(job); void pump(); return snapshot();
    },
    async stop() { stopping = true; for (const job of jobs.values()) if (job.active) { job.cancel = true; controllers.get(job.id)?.abort(); } await Promise.allSettled([...workers.values()]); await writes; },
  };
}
module.exports = { createTransferService };
