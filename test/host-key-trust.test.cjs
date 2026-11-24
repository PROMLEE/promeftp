// The saved host-key decision for the app's own SSH and SFTP connections (showHostKeyPrompt in main.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const { savedHostKeyDecision, rememberHostKey } = require('../host-key-trust.cjs');

const scope = 'host:[127.0.0.1]:2222';
const oldKey = 'SHA256:DDGe0QxNA3pAbDzSN+I0Fxo7an7+OpMDtgs/NMsj7bk';
const newKey = 'SHA256:9mQq2C0bX8m3m1yB7nC8tM2yPq0jz8c1hA4bQwq0v1A';

test('a key trusted with "don\'t ask again" is accepted without a dialog', () => {
  const state = {};
  rememberHostKey(state, scope, oldKey, true);
  assert.deepEqual(savedHostKeyDecision({ ...state, scope, fingerprint: oldKey }), { kind: 'verified', save: '' });
});

test('regression: "don\'t ask again" still applies after the server key changes', () => {
  const state = {};
  rememberHostKey(state, scope, oldKey, true);
  const decision = savedHostKeyDecision({ ...state, scope, fingerprint: newKey });
  assert.deepEqual(decision, { kind: 'changed', save: newKey });
  // The new key is recorded, so the agent and later checks see the key that was accepted.
  rememberHostKey(state, scope, decision.save, false);
  assert.equal(state.trustedHostKeys[scope], newKey);
  assert.equal(state.hostKeyAutoAccept[scope], true);
  assert.deepEqual(savedHostKeyDecision({ ...state, scope, fingerprint: newKey }), { kind: 'verified', save: '' });
});

test('a changed key is asked about when the user did not choose "don\'t ask again"', () => {
  // Keys saved before this option existed, and keys trusted from the agent dialog, keep the per-key rule.
  assert.equal(savedHostKeyDecision({ trustedHostKeys: { [scope]: oldKey }, scope, fingerprint: newKey }), null);
});

test('"don\'t ask again" for one server does not cover another address or port', () => {
  const state = {};
  rememberHostKey(state, scope, oldKey, true);
  assert.equal(savedHostKeyDecision({ ...state, scope: 'host:[127.0.0.1]:2223', fingerprint: newKey }), null);
  assert.equal(savedHostKeyDecision({ ...state, scope: 'host:127.0.0.1', fingerprint: newKey }), null);
});

test('an unknown server, or a question without a fingerprint, is asked about', () => {
  assert.equal(savedHostKeyDecision({ scope, fingerprint: oldKey }), null);
  assert.equal(savedHostKeyDecision({ hostKeyAutoAccept: { [scope]: true }, scope: '', fingerprint: oldKey }), null);
  assert.equal(savedHostKeyDecision({ hostKeyAutoAccept: { [scope]: true }, scope, fingerprint: undefined }), null);
});

test('a key saved under the legacy endpoint scope is verified and moved to the host scope', () => {
  const legacyScope = 'legacy-endpoint';
  assert.deepEqual(savedHostKeyDecision({ trustedHostKeys: { [legacyScope]: oldKey }, scope, legacyScope, fingerprint: oldKey }),
    { kind: 'verified', save: oldKey });
  assert.equal(savedHostKeyDecision({ trustedHostKeys: { [legacyScope]: oldKey }, scope, legacyScope, fingerprint: newKey }), null);
});
