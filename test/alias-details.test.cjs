// The HostName, User and Port of each alias come from ssh -G with a temporary config file (never ~/.ssh or /etc/ssh).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { aliasDetails, parseAliasDetails } = require('../openssh.cjs');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'promeftp-alias-details-'));
const configPath = path.join(sandbox, 'config');
fs.writeFileSync(configPath, [
  'Host web-01',
  '  HostName 10.0.1.23',
  '  User deploy',
  '  Port 2222',
  '',
  'Host db.example.test',
  '  HostName db.internal.example.test',
  '  User backup',
  '',
  'Host bare',
  '',
  'Host *.lab',
  '  User nobody',
  '',
].join('\n'));
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('parseAliasDetails reads the lines of ssh -G output and keeps the first value of each key', () => {
  const stdout = 'host web-01\nhostname 10.0.1.23\nuser deploy\nport 2222\nport 22\r\nidentityfile ~/.ssh/id_ed25519\n';
  assert.deepEqual(parseAliasDetails(stdout), { hostname: '10.0.1.23', user: 'deploy', port: '2222' });
});

test('parseAliasDetails gives empty strings for keys that are missing', () => {
  assert.deepEqual(parseAliasDetails(''), { hostname: '', user: '', port: '' });
  assert.deepEqual(parseAliasDetails('hostname example.test\n'), { hostname: 'example.test', user: '', port: '' });
});

test('aliasDetails resolves HostName, User and Port with ssh -G for the aliases in the config file', async () => {
  const results = await aliasDetails(configPath, ['web-01', 'db.example.test', 'bare']);
  const byName = new Map(results.map(item => [item.name, item]));
  assert.deepEqual(byName.get('web-01'), { name: 'web-01', hostname: '10.0.1.23', user: 'deploy', port: '2222' });
  assert.equal(byName.get('db.example.test').hostname, 'db.internal.example.test');
  assert.equal(byName.get('db.example.test').user, 'backup');
  assert.equal(byName.get('db.example.test').port, '22');
  assert.equal(byName.get('bare').hostname, 'bare');
  assert.equal(results.length, 3);
});

test('wildcard, negated, dashed and spaced names are not run, so they get no details', async () => {
  const results = await aliasDetails(configPath, ['*.lab', '-oProxyCommand=touch x', 'two words', '', 'web-01']);
  assert.deepEqual(results.map(item => item.name), ['web-01']);
});

test('an alias that fails to resolve keeps its name with empty details', async () => {
  // A config file that does not exist makes ssh -G fail for every alias, so each one falls back to its name.
  const results = await aliasDetails(path.join(sandbox, 'missing-config'), ['web-01', 'bare']);
  assert.deepEqual(results, [
    { name: 'web-01', hostname: '', user: '', port: '' },
    { name: 'bare', hostname: '', user: '', port: '' },
  ]);
});

test('aliasDetails resolves more names than the concurrency limit', async () => {
  const many = Array.from({ length: 20 }, (_, index) => `host-${index}`);
  const extra = fs.readFileSync(configPath, 'utf8') + many.map(name => `\nHost ${name}\n  HostName ${name}.example.test\n`).join('');
  const file = path.join(sandbox, 'many-config');
  fs.writeFileSync(file, extra);
  const results = await aliasDetails(file, many);
  assert.equal(results.length, 20);
  assert.ok(results.every(item => item.hostname === `${item.name}.example.test`));
});
