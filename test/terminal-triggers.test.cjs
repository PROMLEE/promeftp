// Characterization tests for terminal-triggers.cjs: pattern validation and matching across PTY chunks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { compileTrigger, scanTriggers } = require('../terminal-triggers.cjs');

const rule = (pattern, id = pattern) => ({ id, regex: compileTrigger(pattern) });

test('compileTrigger accepts patterns of 1 to 512 characters', () => {
  assert.ok(compileTrigger('a'));
  assert.ok(compileTrigger('a'.repeat(512)));
});

test('compileTrigger rejects empty, blank, non-string and over-long patterns with the existing message', () => {
  const message = 'Enter a regular expression of 1–512 characters.';
  for (const bad of ['', '   ', undefined, 7, 'a'.repeat(513)]) {
    assert.throws(() => compileTrigger(bad), { message }, String(bad).slice(0, 20));
  }
});

test('compileTrigger rejects a pattern that is not a valid regular expression', () => {
  assert.throws(() => compileTrigger('(unclosed'));
});

test('a match is reported once per rule', () => {
  const trigger = rule('password:');
  assert.deepEqual(scanTriggers('', 'user@host password: ', [trigger]).matches, [trigger]);
  assert.deepEqual(scanTriggers('', 'nothing here', [trigger]).matches, []);
});

test('ANSI escape sequences are removed before matching', () => {
  const trigger = rule('Password:');
  assert.deepEqual(scanTriggers('', '\x1b[1m\x1b[31mPassword:\x1b[0m', [trigger]).matches, [trigger]);
});

test('carriage returns are removed before matching', () => {
  const trigger = rule('Are you sure');
  assert.deepEqual(scanTriggers('', 'Are\r you sure', [trigger]).matches, [trigger]);
  assert.deepEqual(scanTriggers('', 'Are you sure\r\n', [trigger]).matches, [trigger]);
});

test('a prompt split across two chunks still matches', () => {
  const trigger = rule('password:');
  const first = scanTriggers('', 'pass', [trigger]);
  assert.deepEqual(first.matches, []);
  const second = scanTriggers(first.tail, 'word: ', [trigger]);
  assert.deepEqual(second.matches, [trigger]);
});

test('a split escape sequence does not hide the text around it', () => {
  const trigger = rule('password:');
  const first = scanTriggers('', 'pass\x1b[', [trigger]);
  const second = scanTriggers(first.tail, '0mword:', [trigger]);
  assert.deepEqual(second.matches, [trigger]);
});

test('text already reported in an earlier chunk is not reported again', () => {
  const trigger = rule('password:');
  const first = scanTriggers('', 'password: ', [trigger]);
  assert.deepEqual(first.matches, [trigger]);
  const second = scanTriggers(first.tail, 'more output', [trigger]);
  assert.deepEqual(second.matches, []);
});

test('the kept tail is at most 8192 characters', () => {
  const { tail } = scanTriggers('', 'x'.repeat(20000), [rule('nomatch')]);
  assert.equal(tail.length, 8192);
});

test('a match that appears only after a chunk longer than 8192 characters is found', () => {
  const trigger = rule('needle');
  const chunk = 'a'.repeat(10000) + 'needle';
  assert.deepEqual(scanTriggers('', chunk, [trigger]).matches, [trigger]);
});

test('zero-length matches never trigger a rule and do not loop forever', () => {
  assert.deepEqual(scanTriggers('', 'abc', [rule('x*')]).matches, []);
});

test('several rules are checked in one pass and each matching rule is returned once', () => {
  const first = rule('alpha');
  const second = rule('beta');
  const third = rule('gamma');
  const result = scanTriggers('', 'alpha beta alpha', [first, second, third]);
  assert.deepEqual(result.matches, [first, second]);
});

test('an empty rule list matches nothing and keeps the tail', () => {
  const result = scanTriggers('previous', 'text', []);
  assert.deepEqual(result.matches, []);
  assert.equal(result.tail, 'previoustext');
});
