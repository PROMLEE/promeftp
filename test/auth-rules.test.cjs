// Characterization tests for auth-rules.cjs: question normalization and global regex rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizedAuthQuestion, globalPattern, matchesGlobalPattern } = require('../auth-rules.cjs');

test('the "(user@host) " prefix is removed from a question', () => {
  assert.equal(normalizedAuthQuestion('(alice@example.invalid) Password: '), 'Password: ');
});

test('a prefix of up to 512 characters is removed and a longer one is kept', () => {
  assert.equal(normalizedAuthQuestion(`(${'a'.repeat(512)}) Question`), 'Question');
  const longer = `(${'a'.repeat(513)}) Question`;
  assert.equal(normalizedAuthQuestion(longer), longer);
});

test('only one prefix is removed, and only at the start', () => {
  assert.equal(normalizedAuthQuestion('(a) (b) Question'), '(b) Question');
  assert.equal(normalizedAuthQuestion('Question (a) '), 'Question (a) ');
});

test('an empty bracket, a bracket without a following space, and a line break inside the bracket are not prefixes', () => {
  assert.equal(normalizedAuthQuestion('() Question'), '() Question');
  assert.equal(normalizedAuthQuestion('(a)Question'), '(a)Question');
  assert.equal(normalizedAuthQuestion('(a\nb) Question'), '(a\nb) Question');
});

test('a question without a prefix is returned unchanged', () => {
  assert.equal(normalizedAuthQuestion('Verification code: '), 'Verification code: ');
  assert.equal(normalizedAuthQuestion(''), '');
});

test('globalPattern compiles a valid expression and throws for an invalid one', () => {
  assert.ok(globalPattern('^Password:$'));
  assert.throws(() => globalPattern('(unclosed'));
});

test('a regex rule matches the question as a whole when the pattern anchors it', () => {
  const rule = { prompt: '^Password:$' };
  assert.equal(matchesGlobalPattern(rule, 'Password:'), true);
  assert.equal(matchesGlobalPattern(rule, 'Password: '), false);
  assert.equal(matchesGlobalPattern(rule, 'Enter Password:'), false);
});

test('\\n in a pattern matches a line break inside the question', () => {
  assert.equal(matchesGlobalPattern({ prompt: 'first\\nsecond' }, 'first\nsecond'), true);
  assert.equal(matchesGlobalPattern({ prompt: 'first\\nsecond' }, 'first second'), false);
});

test('an invalid pattern never matches and never throws', () => {
  assert.equal(matchesGlobalPattern({ prompt: '(unclosed' }, '(unclosed'), false);
});

test('the compiled pattern is cached on the rule object', () => {
  const rule = { prompt: '^a$' };
  assert.equal(matchesGlobalPattern(rule, 'a'), true);
  rule.prompt = '^b$';
  assert.equal(matchesGlobalPattern(rule, 'a'), true, 'the first compiled pattern is still used');
  assert.equal(matchesGlobalPattern({ prompt: '^b$' }, 'a'), false, 'a new rule object compiles its own pattern');
});
