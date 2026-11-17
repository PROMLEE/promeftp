// Question normalization and global regex rules for SSH and SFTP authentication prompts. No Electron dependency.
const { RE2 } = require('re2-wasm');

const globalPatternCache = new WeakMap();
function globalPattern(prompt) {
  return new RE2(prompt, 'u');
}
function matchesGlobalPattern(rule, question) {
  if (!globalPatternCache.has(rule)) {
    try { globalPatternCache.set(rule, globalPattern(rule.prompt)); }
    catch { globalPatternCache.set(rule, null); }
  }
  return globalPatternCache.get(rule)?.test(question) === true;
}

function normalizedAuthQuestion(question) {
  return question.replace(/^\([^\r\n)]{1,512}\) /, '');
}

module.exports = { normalizedAuthQuestion, globalPattern, matchesGlobalPattern };
