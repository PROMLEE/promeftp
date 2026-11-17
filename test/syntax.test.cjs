// Runs `node --check` on every top-level script and every test script, so a syntax error fails npm test
// even in a file no test imports.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const topLevel = fs.readdirSync(root).filter(name => /\.c?js$/.test(name)).map(name => path.join(root, name));
const tests = fs.readdirSync(__dirname).filter(name => name.endsWith('.cjs')).map(name => path.join(__dirname, name));
const files = [...topLevel, ...tests];

test('the syntax check covers the top-level scripts and the test scripts', () => {
  assert.ok(topLevel.length >= 15, `only ${topLevel.length} top-level scripts found`);
  assert.ok(tests.length >= 7, `only ${tests.length} test scripts found`);
});

for (const file of files) {
  test(`node --check passes for ${path.relative(root, file)}`, () => {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  });
}
