// Saved-reply decisions shared by the app and agent connections. Inputs are invented example values.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const saved = require('../saved-auth.cjs');
const stateRules = require('../state-rules.cjs');
const { matchesGlobalPattern } = require('../auth-rules.cjs');

const HOME = '/var/empty-home';
const endpointApp = 'hostname example.invalid\nuser alice\nport 22\nidentityagent ~/.1password/agent.sock';
const endpointLegacy = 'hostname example.invalid\nuser alice\nport 22';
const p = { id: 'b1', host: 'example.invalid', username: 'alice', port: null, keyPath: '', configPath: '' };
// An old profile saved without keyPath and configPath.
const pOld = { id: 'b1', host: 'example.invalid', username: 'alice' };
const prompt = '(alice@example.invalid) Verification code: ';
const question = 'Verification code: ';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalized = input => stateRules.profile(input, HOME);

test('an old profile without keyPath or configPath gets the same scope as the normalized profile', () => {
  const scope = saved.authScope(normalized(pOld), endpointApp);
  assert.equal(scope, saved.authScope(p, endpointApp));
  // The agent used to pass keyPath as undefined, which JSON.stringify turns into null. That digest differed.
  assert.notEqual(digest([pOld.host, '', undefined, endpointApp]), scope);
});

test('the scope and the reply key hash the same fields in the same order as the app', () => {
  assert.equal(saved.authScope(p, endpointApp), digest([p.host, p.configPath, p.keyPath, endpointApp]));
  assert.equal(saved.replyKey(p, endpointApp, prompt), digest([p.host, p.configPath, p.keyPath, endpointApp, prompt]));
  assert.notEqual(saved.replyKey(p, endpointLegacy, prompt), saved.replyKey(p, endpointApp, prompt));
});

test('autoSavedReply needs an answer or ciphertext, a scope, and the setting turned on', () => {
  assert.equal(saved.autoSavedReply({}, { answer: '1', scope: 's' }), true);
  assert.equal(saved.autoSavedReply({}, { ciphertext: 'c', scope: 's' }), true);
  assert.equal(saved.autoSavedReply({}, { answer: '1' }), false);
  assert.equal(saved.autoSavedReply({ useSavedRepliesAutomatically: false }, { answer: '1', scope: 's' }), false);
  assert.equal(saved.autoSavedReply({}, 'old-ciphertext-string'), false);
});

test('a global rule matches the exact prompt first, then the question, then a regular expression', () => {
  const regex = { id: 'r', prompt: '^Verification code: $', match: 'regex', answer: '0' };
  const plainQuestion = { id: 'q', prompt: question, answer: '1' };
  const exact = { id: 'e', prompt, answer: '2' };
  assert.equal(saved.findGlobalRule([regex, plainQuestion, exact], prompt, matchesGlobalPattern).id, 'e');
  assert.equal(saved.findGlobalRule([regex, plainQuestion], prompt, matchesGlobalPattern).id, 'q');
  assert.equal(saved.findGlobalRule([regex], prompt, matchesGlobalPattern).id, 'r');
  assert.equal(saved.findGlobalRule([], prompt, matchesGlobalPattern), undefined);
});

const savedEntry = () => ({ answer: '123456', scope: saved.authScope(normalized(pOld), endpointApp) });
const keyOf = () => saved.replyKey(normalized(pOld), endpointApp, prompt);
// Defaults describe a bookmark that has a saved reply for this prompt and the saved-reply grant.
function decide(stateExtra = {}, input = {}) {
  const config = normalized(pOld);
  const state = { authReplies: {}, globalAuthRules: [], useStoredAuthOnConnect: true, useSavedRepliesAutomatically: true, ...stateExtra };
  return saved.savedAuthDecision({ state, config, endpoint: endpointApp, scope: saved.authScope(config, endpointApp),
    prompt, canRemember: true, allowSaved: true, allowedRuleIds: [], matchesGlobalPattern, ...input });
}

test('a saved reply for this bookmark, endpoint and question is chosen', () => {
  const entry = savedEntry();
  const decision = decide({ authReplies: { [keyOf()]: entry } });
  assert.equal(decision.source, 'saved');
  assert.equal(decision.entry, entry);
  assert.equal(decision.used, keyOf());
  assert.equal(decision.reason, null);
});

test('the app key and the agent key choose the same saved reply', () => {
  const entry = savedEntry();
  const appDecision = saved.savedAuthDecision({ state: { authReplies: { [keyOf()]: entry }, globalAuthRules: [],
    useStoredAuthOnConnect: true, useSavedRepliesAutomatically: true }, config: p, endpoint: endpointApp,
  scope: saved.authScope(p, endpointApp), prompt, canRemember: true, allowSaved: true, allowedRuleIds: [], matchesGlobalPattern });
  assert.equal(appDecision.entry, decide({ authReplies: { [keyOf()]: entry } }).entry);
});

test('the setting that turns off automatic saved replies gives reason disabled', () => {
  assert.equal(decide({ authReplies: { [keyOf()]: savedEntry() }, useSavedRepliesAutomatically: false }).reason, 'disabled');
});

test('turning off stored authentication gives reason disabled even for a global rule', () => {
  const rule = { id: 'g', prompt, answer: 'x' };
  assert.equal(decide({ globalAuthRules: [rule], useStoredAuthOnConnect: false }, { allowedRuleIds: ['g'] }).reason, 'disabled');
});

test('a prompt that cannot be remembered gives reason not_rememberable', () => {
  assert.equal(decide({ authReplies: { [keyOf()]: savedEntry() } }, { canRemember: false }).reason, 'not_rememberable');
});

test('a saved reply saved for another scope gives reason scope_mismatch', () => {
  const entry = { answer: '123456', scope: 'another-scope' };
  assert.equal(decide({ authReplies: { [keyOf()]: entry } }).reason, 'scope_mismatch');
});

test('a mismatched connection target does not use a saved reply', () => {
  const decision = decide({ authReplies: { [keyOf()]: savedEntry() } }, { mismatch: true, scope: '' });
  assert.equal(decision.reason, 'scope_mismatch');
  assert.equal(decision.entry, undefined);
});

test('a question already answered on this connection gives reason already_used', () => {
  assert.equal(decide({ authReplies: { [keyOf()]: savedEntry() } }, { answered: new Set([question]) }).reason, 'already_used');
  assert.equal(decide({ authReplies: { [keyOf()]: savedEntry() } }, { answered: new Set([keyOf()]) }).reason, 'already_used');
});

test('an old string entry is not used automatically', () => {
  assert.equal(decide({ authReplies: { [keyOf()]: 'old-ciphertext' } }).reason, 'no_saved_reply');
});

test('no saved reply for the key gives reason no_saved_reply', () => {
  assert.equal(decide({}).reason, 'no_saved_reply');
});

test('an empty endpoint gives reason no_endpoint but a global rule can still answer', () => {
  assert.equal(decide({ authReplies: { [keyOf()]: savedEntry() } }, { endpoint: '' }).reason, 'no_endpoint');
  const rule = { id: 'g', prompt, answer: 'global' };
  const decision = decide({ globalAuthRules: [rule] }, { endpoint: '', allowedRuleIds: ['g'] });
  assert.equal(decision.source, 'global');
});

test('without the saved-auth grant the reason is not_granted', () => {
  assert.equal(decide({ authReplies: { [keyOf()]: savedEntry() } }, { allowSaved: false }).reason, 'not_granted');
});

test('a global rule outside the granted rules gives reason global_rule_not_granted', () => {
  const rule = { id: 'g', prompt, answer: 'global' };
  assert.equal(decide({ globalAuthRules: [rule] }, { allowSaved: false, allowedRuleIds: [] }).reason, 'global_rule_not_granted');
});

test('a granted global rule answers, and a rule already used gives already_used', () => {
  const rule = { id: 'g', prompt, answer: 'global' };
  const decision = decide({ globalAuthRules: [rule] }, { allowSaved: false, allowedRuleIds: ['g'] });
  assert.equal(decision.source, 'global');
  assert.equal(decision.used, 'g');
  assert.equal(decide({ globalAuthRules: [rule] }, { allowSaved: false, allowedRuleIds: ['g'], answered: new Set(['g']) }).reason, 'already_used');
});

test('with saved auth granted, every global rule the caller allows is used even when the PAM list is empty', () => {
  const rule = { id: 'g', prompt, answer: 'global' };
  const decision = decide({ globalAuthRules: [rule] }, { allowSaved: true, allowedRuleIds: ['g'] });
  assert.equal(decision.source, 'global');
});

test('every reason is one of the fixed codes and never contains a reply', () => {
  const entry = savedEntry();
  const cases = [
    decide({ authReplies: { [keyOf()]: entry } }, { mismatch: true, scope: '' }),
    decide({ authReplies: { [keyOf()]: { answer: '123456', scope: 'x' } } }),
    decide({}, { allowSaved: false }),
    decide({ useStoredAuthOnConnect: false }),
  ];
  for (const decision of cases) {
    assert.ok(saved.SAVED_AUTH_REASONS.includes(decision.reason), `unexpected reason ${decision.reason}`);
    assert.equal(JSON.stringify(decision).includes('123456'), false);
  }
});
