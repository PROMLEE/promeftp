// Same-name conflict rules (test plan T1-T9): the newer-file choice, the batch store, the validity checks, and the
// order in which an answer is found. Pure functions only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CHOICES, POLICIES, validChoice, validPolicy, validGroup, resolveChoice, pickChoice, createDecisionStore } = require('../transfer-conflicts.cjs');

test('T1 replace-if-newer replaces when the incoming file is newer, and skips when it is older', () => {
  assert.equal(resolveChoice('replace-if-newer', { modifiedAt: 2_000_000 }, { modifiedAt: 1_000_000 }), 'replace');
  assert.equal(resolveChoice('replace-if-newer', { modifiedAt: 1_000_000 }, { modifiedAt: 2_000_000 }), 'skip');
});

test('T2 skip, replace and keep-both are returned as they are, whatever the times', () => {
  for (const choice of ['skip', 'replace', 'keep-both']) {
    assert.equal(resolveChoice(choice, { modifiedAt: 1 }, { modifiedAt: 2_000_000 }), choice);
  }
});

test('T3 the store keeps a batch answer until it is cleared', () => {
  const store = createDecisionStore();
  store.set('g', 'skip');
  assert.equal(store.get('g'), 'skip');
  store.clear('g');
  assert.equal(store.get('g'), undefined);
});

test('T4 times are compared in whole seconds: 400 ms apart within one second is not newer', () => {
  assert.equal(resolveChoice('replace-if-newer', { modifiedAt: 1_000_400 }, { modifiedAt: 1_000_100 }), 'skip');
});

test('T5 the store keeps at most 200 batches and drops the oldest first', () => {
  const store = createDecisionStore();
  for (let index = 0; index < 201; index++) store.set(`g${index}`, 'skip');
  assert.equal(store.size(), 200);
  assert.equal(store.get('g0'), undefined);
  assert.equal(store.get('g200'), 'skip');
});

test('T6 "ask" is a policy but not a choice; an unknown policy is invalid', () => {
  assert.equal(validChoice('ask'), false);
  assert.equal(validPolicy('ask'), true);
  assert.equal(validPolicy('overwrite'), false);
  assert.deepEqual(CHOICES, ['skip', 'replace', 'keep-both', 'replace-if-newer']);
  assert.deepEqual(POLICIES, ['ask', 'skip', 'replace', 'keep-both', 'replace-if-newer']);
});

test('T7 a file without a time is never replaced by replace-if-newer', () => {
  assert.equal(resolveChoice('replace-if-newer', { modifiedAt: NaN }, { modifiedAt: 1 }), 'skip');
  assert.equal(resolveChoice('replace-if-newer', { modifiedAt: 2_000_000 }, { modifiedAt: undefined }), 'skip');
});

test('T8 an empty choice is refused, and the store gives nothing for an empty group', () => {
  assert.throws(() => resolveChoice(undefined, { modifiedAt: 1 }, { modifiedAt: 1 }), { message: 'Invalid conflict choice.' });
  assert.equal(createDecisionStore().get(undefined), undefined);
});

test('T9 the answer is found in order: the job policy, then the batch answer, then the saved setting', () => {
  assert.equal(pickChoice({ jobPolicy: 'replace', groupChoice: 'skip', savedPolicy: 'keep-both' }), 'replace');
  assert.equal(pickChoice({ jobPolicy: 'ask', groupChoice: 'skip' }), 'skip');
  assert.equal(pickChoice({ jobPolicy: 'ask', savedPolicy: 'keep-both' }), 'keep-both');
  assert.equal(pickChoice({ jobPolicy: 'ask', groupChoice: 'ask', savedPolicy: 'ask' }), undefined);
  assert.equal(pickChoice({}), undefined);
});

test('a decision group has the expected form: lowercase hex and dashes, up to 36 characters', () => {
  assert.equal(validGroup('0f8b8f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'), true);
  assert.equal(validGroup('../etc'), false);
  assert.equal(validGroup('A'.repeat(4)), false);
  assert.equal(validGroup('a'.repeat(37)), false);
  assert.equal(validGroup(''), false);
  assert.equal(validGroup(undefined), false);
});

// Progress of a request's jobs (review item 1): the count comes from the request, not from the queue.
const { validCount, validIndex, remainingAfter, createDecisionGroups } = require('../transfer-conflicts.cjs');

test('the first conflict of a 5-file request knows 4 jobs follow, even when only the first job is queued', () => {
  const groups = createDecisionGroups();
  groups.add('g', 5, 'job-0');   // only the first job has been enqueued so far
  assert.equal(remainingAfter(5, 0), 4);
  assert.equal(remainingAfter(5, 4), 0);
  assert.equal(remainingAfter(undefined, 0), 0);
  assert.equal(remainingAfter(5, 7), 0);
});

test('validCount and validIndex accept whole numbers only, within the limits', () => {
  assert.equal(validCount(1), true);
  assert.equal(validCount(10000), true);
  assert.equal(validCount(0), false);
  assert.equal(validCount(10001), false);
  assert.equal(validCount(2.5), false);
  assert.equal(validIndex(0, 1), true);
  assert.equal(validIndex(3, 3), false);
  assert.equal(validIndex(-1, 3), false);
});

test('a request is not finished while jobs are still to be queued, even when all queued jobs are processed', () => {
  const groups = createDecisionGroups();
  groups.add('g', 3, 'a');
  assert.deepEqual(groups.settle([{ id: 'a', decisionGroup: 'g', state: 'running' }]), []);
  // The first job completes and leaves the queue; the other two are not queued yet.
  assert.deepEqual(groups.settle([]), []);
  groups.add('g', 3, 'b');
  groups.add('g', 3, 'c');
  assert.deepEqual(groups.settle([{ id: 'b', decisionGroup: 'g', state: 'queued' }, { id: 'c', decisionGroup: 'g', state: 'queued' }]), []);
  assert.deepEqual(groups.settle([]), ['g']);
  assert.equal(groups.size(), 0);
});

test('a failed job still in the queue keeps its request until it is removed', () => {
  const groups = createDecisionGroups();
  groups.add('g', 1, 'a');
  assert.deepEqual(groups.settle([{ id: 'a', decisionGroup: 'g', state: 'failed' }]), []);
  assert.deepEqual(groups.settle([]), ['g']);
});

test('a job that is retried after failing counts as unprocessed again', () => {
  const groups = createDecisionGroups();
  groups.add('g', 1, 'a');
  groups.settle([{ id: 'a', decisionGroup: 'g', state: 'failed' }]);
  assert.deepEqual(groups.settle([{ id: 'a', decisionGroup: 'g', state: 'queued' }]), []);
  assert.deepEqual(groups.settle([{ id: 'a', decisionGroup: 'g', state: 'completed' }]), []);
  assert.deepEqual(groups.settle([]), ['g']);
});

test('the tracker keeps at most 200 requests and reports the oldest it drops', () => {
  const groups = createDecisionGroups();
  let dropped = [];
  for (let index = 0; index < 201; index++) dropped = dropped.concat(groups.add(`r${index}`, 2, `j${index}`));
  assert.deepEqual(dropped, ['r0']);
  assert.equal(groups.size(), 200);
});
