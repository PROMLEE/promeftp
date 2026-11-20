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

// Messages picked from a table in the code, such as agentCodeMessages, are looked up by t(table[code]) rather than t('…'),
// so the scan above does not see them. Each value must still have a translation row.
test('T11: every message in the agent code-message table has ko, ja and zh translations', () => {
  const agent = fs.readFileSync(path.join(root, 'agent-preferences.js'), 'utf8');
  const block = agent.slice(agent.indexOf('const agentCodeMessages = {'), agent.indexOf('};', agent.indexOf('const agentCodeMessages = {')));
  const messages = [...block.matchAll(/^\s+[A-Z_]+: '((?:[^'\\\n]|\\.)+)',$/gm)].map(match => match[1]);
  assert.ok(messages.length >= 8, `only ${messages.length} agent messages found`);
  const missing = [];
  for (const key of messages) {
    const fields = rowByKey.get(key);
    if (!fields) { missing.push(`${key} (no row)`); continue; }
    for (const [language, column] of languages) {
      const index = { ko: 1, ja: 2, zh: 3 }[column];
      if (!fields[index]?.trim()) missing.push(`${language}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `missing translations:\n${missing.join('\n')}`);
});

// UI labels: the second argument of iconButton('…', label, …), the literal assigned to .title or set as aria-label in the
// renderer scripts, the title, aria-label and placeholder attributes in the HTML pages, and the data-tip texts and infoTip
// literals that show as info tips. Each one is shown to the user, so each needs a translation row, the same as a t('…') key.
// Example values that are not sentences (a path, a font, a command name) are listed in exampleValues.
const exampleValues = new Set(['/srv/releases', 'service-status', 'sftp.list', '~/.ssh/config', 'Menlo']);

// Returns the source text of an argument that starts at `rest`, up to the comma or closing bracket that ends it.
// Quoted strings are skipped, so commas inside them do not end the argument.
function argumentText(rest) {
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i];
    if (char === "'") {
      for (i++; i < rest.length && rest[i] !== "'"; i++) if (rest[i] === '\\') i++;
    } else if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) { if (depth === 0) return rest.slice(0, i); depth--; }
    else if (char === ',' && depth === 0) return rest.slice(0, i);
  }
  return rest.slice(0, 200);
}

function uiLabels() {
  const found = new Map();
  const add = (text, where) => { if (!found.has(text)) found.set(text, where); };
  const literal = /'((?:[^'\\\n]|\\.)+)'/g;
  for (const name of fs.readdirSync(root).filter(file => /\.js$/.test(file) && file !== 'localization.js')) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    for (const match of text.matchAll(/iconButton\(\s*'[a-zA-Z]+',\s*/g)) {
      for (const label of argumentText(text.slice(match.index + match[0].length)).matchAll(literal)) add(label[1].replace(/\\'/g, "'"), name);
    }
    for (const match of text.matchAll(/\.title = '((?:[^'\\\n]|\\.)+)'/g)) add(match[1], name);
    for (const match of text.matchAll(/setAttribute\('aria-label', '((?:[^'\\\n]|\\.)+)'\)/g)) add(match[1], name);
    for (const match of text.matchAll(/infoTip\('((?:[^'\\\n]|\\.)+)'\)/g)) add(match[1], name);
  }
  for (const name of fs.readdirSync(root).filter(file => /\.html$/.test(file))) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    for (const match of text.matchAll(/\s(?:title|aria-label|placeholder|data-tip)="([^"\n]+)"/g)) add(match[1], name);
  }
  return found;
}

test('every UI label, info tip and placeholder has ko, ja and zh translations', () => {
  const found = uiLabels();
  // The scan must find the labels it is meant to find; an empty scan would pass the check below without checking anything.
  assert.ok(found.size >= 100, `only ${found.size} UI labels found`);
  const exclusions = new Set(exampleValues);
  assert.deepEqual([...exclusions].filter(text => !found.has(text)), [], 'exclusion list has entries that no longer appear in the UI code');
  const missing = [];
  for (const [text, where] of found) {
    if (exclusions.has(text)) continue;
    const fields = rowByKey.get(text);
    if (!fields) { missing.push(`${text} (no row; ${where})`); continue; }
    for (const [language, column] of languages) {
      const index = { ko: 1, ja: 2, zh: 3 }[column];
      if (!fields[index]?.trim()) missing.push(`${language}: ${text} (${where})`);
    }
  }
  assert.deepEqual(missing, [], `missing translations:\n${missing.join('\n')}`);
});
