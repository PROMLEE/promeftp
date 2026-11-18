// Saved-answer decisions shared by the app and agent connections. Pure functions, no Electron dependency.
// Both sides must pick the same saved reply for the same bookmark, endpoint and question, so the digests and the
// decision order live here only.
const { createHash } = require('node:crypto');
const { normalizedAuthQuestion, matchesGlobalPattern: defaultMatchesGlobalPattern } = require('./auth-rules.cjs');

// Reasons an automatic reply was not used. They never contain a reply, a password or a prompt value.
const SAVED_AUTH_REASONS = ['not_granted', 'disabled', 'not_rememberable', 'no_endpoint', 'no_saved_reply',
  'scope_mismatch', 'global_rule_not_granted', 'already_used', 'read_failed'];

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Missing optional fields are stored as '' so that an old profile and a normalized profile give the same digest.
function authIdentity(config) {
  return { host: config.host || '', configPath: config.configPath || '', keyPath: config.keyPath || '' };
}
function authScope(config, endpoint) {
  const { host, configPath, keyPath } = authIdentity(config);
  return digest([host, configPath, keyPath, endpoint]);
}
function replyKey(config, endpoint, prompt) {
  const { host, configPath, keyPath } = authIdentity(config);
  return digest([host, configPath, keyPath, endpoint, prompt]);
}
// A saved reply is used automatically only when it has an answer and was saved with a scope.
function autoSavedReply(state, entry) {
  return state.useSavedRepliesAutomatically !== false && Boolean((entry?.answer || entry?.ciphertext) && entry.scope);
}
// Exact prompt first, then the question without its "(user@host) " prefix, then regular expressions.
function findGlobalRule(rules, prompt, matches = defaultMatchesGlobalPattern) {
  const question = normalizedAuthQuestion(prompt);
  return rules.find(rule => rule.match !== 'regex' && rule.prompt === prompt)
    || rules.find(rule => rule.match !== 'regex' && rule.prompt === question)
    || rules.find(rule => rule.match === 'regex' && matches(rule, question));
}

// Decides which saved reply, if any, answers a prompt. The caller reads the answer and checks it again.
// Returns { entry, source: 'saved' | 'global', used, key, reason: null } when a reply is chosen, otherwise { reason }.
//   allowSaved: the grant allows saved replies for this bookmark (agent) or the app's own setting is on.
//   allowedRuleIds: ids of the global rules the connection may use.
//   scope: the bookmark's authScope. Pass '' when the connection's target does not match the app's (mismatch).
//   endpoint: the app-equivalent endpoint text. The reply key is computed from it.
//   answered: questions and ids already answered on this connection.
function savedAuthDecision({ state, config, endpoint = '', scope = '', mismatch = false, prompt, canRemember,
  answered = new Set(), allowSaved, allowedRuleIds = [], matchesGlobalPattern = defaultMatchesGlobalPattern }) {
  if (state.useStoredAuthOnConnect === false) return { reason: 'disabled' };
  if (!canRemember) return { reason: 'not_rememberable' };
  const question = normalizedAuthQuestion(prompt);
  let reason = null;
  let key;
  if (allowSaved) {
    if (state.useSavedRepliesAutomatically === false) reason = 'disabled';
    else if (mismatch) reason = 'scope_mismatch';
    else if (!endpoint) reason = 'no_endpoint';
    else {
      key = replyKey(config, endpoint, prompt);
      const saved = state.authReplies?.[key];
      if (typeof saved !== 'object' || !saved || !(saved.answer || saved.ciphertext)) reason = 'no_saved_reply';
      else if (saved.scope !== scope) reason = 'scope_mismatch';
      else if (answered.has(question) || answered.has(key)) reason = 'already_used';
      else return { entry: saved, source: 'saved', used: key, key, reason: null };
    }
  }
  const rules = state.globalAuthRules || [];
  const global = findGlobalRule(rules.filter(rule => allowedRuleIds.includes(rule.id)), prompt, matchesGlobalPattern);
  if (global) {
    if (!answered.has(question) && !answered.has(global.id)) {
      return { entry: global, source: 'global', used: global.id, key, reason: null };
    }
    reason = 'already_used';
  }
  if (!reason) {
    reason = findGlobalRule(rules, prompt, matchesGlobalPattern) ? 'global_rule_not_granted' : 'not_granted';
  }
  return { reason };
}

module.exports = { SAVED_AUTH_REASONS, authIdentity, authScope, replyKey, autoSavedReply, findGlobalRule, savedAuthDecision };
