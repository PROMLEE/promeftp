// Every relative link in the public Markdown and text docs must point at a file that exists.
// Links are read the way CommonMark reads them: code spans and fenced code are skipped, and a destination
// with a space in it is not a link at all (so "[label](some text)" is plain text).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : markdownFiles(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

const docs = [
  ...fs.readdirSync(root).filter(name => /^(README.*\.md|CONTRIBUTING\.md|TODO\.md|llms.*\.txt)$/.test(name)).map(name => path.join(root, name)),
  ...markdownFiles(path.join(root, 'docs')),
];

function stripCode(text) {
  return text
    .replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '')
    .replace(/`[^`\n]*`/g, '');
}

// [label](destination) or [label](destination "title") or ![alt](destination). The destination has no spaces.
const linkPattern = /\]\(([^()\s<>]+)(?:\s+"[^"]*")?\)/g;

function relativeLinks(text) {
  return [...stripCode(text).matchAll(linkPattern)].map(match => match[1])
    .filter(target => !/^[a-z][a-z0-9+.-]*:/i.test(target))
    .filter(target => !target.startsWith('#'))
    .map(target => decodeURI(target.split('#')[0]))
    .filter(Boolean);
}

test('the doc set includes the README, contributor and docs files', () => {
  const names = docs.map(file => path.relative(root, file));
  assert.ok(names.includes('README.md'));
  assert.ok(names.includes('docs/USAGE.md'));
  assert.ok(names.includes('TODO.md'));
  assert.ok(names.includes('llms.txt'));
});

// llms-full.txt joins several documents. Each "--- path ---" line starts a section, and the links in a section are
// relative to that section's source file. Text before the first marker is relative to the repository root.
function sectionsOf(file, text) {
  if (path.basename(file) !== 'llms-full.txt') return [{ base: path.dirname(file), text }];
  const parts = text.split(/^--- (\S+) ---$/m);
  const sections = [{ base: root, text: parts[0] }];
  for (let i = 1; i < parts.length; i += 2) sections.push({ base: path.join(root, path.dirname(parts[i])), text: parts[i + 1] });
  return sections;
}

test('every relative link in the docs points at an existing file', () => {
  const broken = [];
  for (const file of docs) {
    for (const { base, text } of sectionsOf(file, fs.readFileSync(file, 'utf8'))) {
      for (const target of relativeLinks(text)) {
        if (!fs.existsSync(path.resolve(base, target))) broken.push(`${path.relative(root, file)} -> ${target}`);
      }
    }
  }
  assert.deepEqual(broken, [], `broken relative links:\n${broken.join('\n')}`);
});

test('llms-full.txt sections resolve links against their own source folder', () => {
  const sections = sectionsOf('llms-full.txt', '[a](x.md)\n--- docs/USAGE.md ---\n[b](INSTALL.md)\n');
  assert.deepEqual(sections.map(section => path.relative(root, section.base) || '.'), ['.', 'docs']);
});

test('the link reader ignores code, spaced destinations and absolute URLs', () => {
  const sample = [
    'See [a](docs/A.md) and ![pic](docs/assets/x.png "title").',
    'Inline `[b](docs/B.md)` is code.',
    '```',
    '[c](docs/C.md)',
    '```',
    '[d](문장 공백이 있다) is text, [e](https://example.invalid/x) is external, [f](#top) is an anchor.',
    '[g](docs/G.md#section)',
  ].join('\n');
  assert.deepEqual(relativeLinks(sample), ['docs/A.md', 'docs/assets/x.png', 'docs/G.md']);
});
