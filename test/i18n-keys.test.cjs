// Checks the translation table in localization.js: every row has ko, ja and zh values, and every key the code
// looks up with t('…') or localized('…') has a row. Missing entries are printed with their language.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const languages = [['ko', 'ko'], ['ja', 'ja'], ['zh-Hans', 'zh']];

// Rows are "key|ko|ja|zh" between the backticks of the messages template literal.
const source = fs.readFileSync(path.join(root, 'localization.js'), 'utf8');
const table = source.slice(source.indexOf('`') + 1, source.indexOf('`', source.indexOf('`') + 1));
const rows = table.split('\n').map(line => line.trim()).filter(Boolean).map(line => line.split('|'));
const rowByKey = new Map(rows.map(fields => [fields[0], fields]));

function codeKeys() {
  const files = fs.readdirSync(root).filter(name => /\.(c?js)$/.test(name) && name !== 'localization.js');
  const keys = new Set();
  for (const name of files) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    for (const match of text.matchAll(/(?:\bt|\blocalized)\('((?:[^'\\\n]|\\.)+)'\)/g)) keys.add(match[1].replace(/\\'/g, "'"));
  }
  return [...keys].sort();
}

test('every translation row has a key and ko, ja, zh values', () => {
  const broken = rows.filter(fields => fields.length !== 4 || fields.some((field, index) => index > 0 && !field.trim()));
  assert.deepEqual(broken.map(fields => fields[0]), [], `rows without 4 filled fields: ${broken.map(f => f[0]).join(', ')}`);
});

test('every key used in code has ko, ja and zh translations', () => {
  const missing = [];
  for (const key of codeKeys()) {
    const fields = rowByKey.get(key);
    if (!fields) {
      for (const [language] of languages) missing.push(`${language}: ${key} (no row)`);
      continue;
    }
    for (const [language, column] of languages) {
      const index = { ko: 1, ja: 2, zh: 3 }[column];
      if (!fields[index]?.trim()) missing.push(`${language}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `missing translations:\n${missing.join('\n')}`);
});
