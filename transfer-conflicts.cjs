// Same-name conflicts in file transfers: the choices, the saved and per-batch decisions, and how a choice applies to one
// file. No Electron dependency, so the rules are tested directly.

// The answers a user can give, and the policies that can be saved or chosen in the comparison window.
const CHOICES = ['skip', 'replace', 'keep-both', 'replace-if-newer'];
const POLICIES = ['ask', ...CHOICES];
const validChoice = value => CHOICES.includes(value);
const validPolicy = value => POLICIES.includes(value);
// A decision group is the random id of one transfer request. Only lowercase hex and dashes, up to 36 characters.
const validGroup = value => typeof value === 'string' && /^[0-9a-f-]{1,36}$/.test(value);

// Turns a choice into skip, replace or keep-both for one file. replace-if-newer compares whole seconds, because SFTP
// times have one-second precision. A file without a time is never replaced by that choice.
function resolveChoice(choice, source, destination) {
  if (!validChoice(choice)) throw Error('Invalid conflict choice.');
  if (choice !== 'replace-if-newer') return choice;
  const incoming = Math.floor(source?.modifiedAt / 1000);
  const existing = Math.floor(destination?.modifiedAt / 1000);
  if (!Number.isFinite(incoming) || !Number.isFinite(existing)) return 'skip';
  return incoming > existing ? 'replace' : 'skip';
}

// The order in which an answer is found. The first valid one wins; undefined means the question must be asked.
// 1. the policy the job carries (set by the comparison window); 2. the answer given for this batch;
// 3. the saved setting. "ask" is not an answer.
function pickChoice({ jobPolicy, groupChoice, savedPolicy } = {}) {
  if (validChoice(jobPolicy)) return jobPolicy;
  if (validChoice(groupChoice)) return groupChoice;
  if (validChoice(savedPolicy)) return savedPolicy;
  return undefined;
}

// Answers given for one batch, kept in memory only. The oldest batch is dropped past the limit.
function createDecisionStore(limit = 200) {
  const choices = new Map();
  return {
    get(group) { return group === undefined ? undefined : choices.get(group); },
    set(group, choice) {
      if (group === undefined || !validChoice(choice)) throw Error('Invalid conflict decision.');
      choices.delete(group);
      choices.set(group, choice);
      while (choices.size > limit) choices.delete(choices.keys().next().value);
    },
    clear(group) { choices.delete(group); },
    size() { return choices.size; },
  };
}

// A request's size and a job's place in it. Both are whole numbers from 1 to 10000; the index counts from 0.
const validCount = value => Number.isInteger(value) && value >= 1 && value <= 10000;
const validIndex = (value, total) => Number.isInteger(value) && value >= 0 && value < total && value < 10000;
// The jobs of one request that come after this one. The count comes from the request, not from the queue, so the
// first conflict knows the rest even before those jobs have been queued.
function remainingAfter(total, index) {
  if (!validCount(total) || !validIndex(index, total)) return 0;
  return total - index - 1;
}

// Progress of each request, from its jobs as the queue reports them. A request is finished (its answers are dropped)
// only when it has no job left in the queue and every one of its total jobs has been processed. A job counts as
// processed when it has left the queue or reached a final state. Requests are kept up to a limit; the oldest are dropped.
const finishedStates = ['completed', 'skipped', 'failed', 'cancelled', 'interrupted'];
function createDecisionGroups(limit = 200) {
  const groups = new Map();
  const entryFor = (group, total) => {
    let entry = groups.get(group);
    if (!entry) {
      entry = { total: undefined, known: new Set(), done: new Set() };
      groups.set(group, entry);
    }
    if (validCount(total)) entry.total = total;
    return entry;
  };
  return {
    // Records a job of a request. Returns the groups dropped to stay within the limit, so their answers can be cleared.
    add(group, total, id) {
      const dropped = [];
      if (!groups.has(group)) {
        entryFor(group, total);
        while (groups.size > limit) {
          const oldest = groups.keys().next().value;
          groups.delete(oldest);
          dropped.push(oldest);
        }
      }
      entryFor(group, total).known.add(id);
      return dropped;
    },
    // Called with the queue's list of jobs. Returns the requests that are now finished.
    settle(jobs) {
      const live = new Map(jobs.map(job => [job.id, job]));
      const cleared = [];
      for (const [group, entry] of groups) {
        for (const id of entry.known) {
          const job = live.get(id);
          if (!job || finishedStates.includes(job.state)) entry.done.add(id);
          else entry.done.delete(id);
        }
        const queued = jobs.some(job => job.decisionGroup === group);
        if (!queued && entry.total !== undefined && entry.done.size >= entry.total) {
          groups.delete(group);
          cleared.push(group);
        }
      }
      return cleared;
    },
    size() { return groups.size; },
  };
}

module.exports = { CHOICES, POLICIES, validChoice, validPolicy, validGroup, validCount, validIndex, remainingAfter,
  resolveChoice, pickChoice, createDecisionStore, createDecisionGroups };
