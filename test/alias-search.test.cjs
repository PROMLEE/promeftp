// The alias search matches an OpenSSH alias by its name, HostName, User and Port. Pure function, no ssh.
const test = require('node:test');
const assert = require('node:assert/strict');
const { aliasMatchesSearch, aliasSearchFields } = require('../alias-search.js');

const web = { hostname: '10.0.1.23', user: 'deploy', port: '2222' };

test('a fragment of the HostName IP matches the alias', () => {
  assert.equal(aliasMatchesSearch('10.0.1', 'web-01', web), true);
  assert.equal(aliasMatchesSearch('0.1.2', 'web-01', web), true);
  assert.equal(aliasMatchesSearch('192.168', 'web-01', web), false);
});

test('a fragment of the HostName domain matches the alias', () => {
  const db = { hostname: 'db.internal.example.test', user: 'backup', port: '22' };
  assert.equal(aliasMatchesSearch('internal.example', 'db', db), true);
  assert.equal(aliasMatchesSearch('example.org', 'db', db), false);
});

test('the User and the Port match the alias', () => {
  assert.equal(aliasMatchesSearch('deploy', 'web-01', web), true);
  assert.equal(aliasMatchesSearch('2222', 'web-01', web), true);
  assert.equal(aliasMatchesSearch('2223', 'web-01', web), false);
});

test('the words of the query must all match, in any field (AND)', () => {
  assert.equal(aliasMatchesSearch('deploy 10.0.1', 'web-01', web), true);
  assert.equal(aliasMatchesSearch('10.0.1  web', 'web-01', web), true);
  assert.equal(aliasMatchesSearch('deploy 192', 'web-01', web), false);
  assert.equal(aliasMatchesSearch('web-01 backup', 'web-01', web), false);
});

test('matching ignores case in the query and in the values', () => {
  assert.equal(aliasMatchesSearch('WEB-01', 'web-01', web), true);
  assert.equal(aliasMatchesSearch('DEPLOY', 'web-01', web), true);
  assert.equal(aliasMatchesSearch('EXAMPLE.TEST', 'db', { hostname: 'db.internal.Example.Test' }), true);
});

test('without details the alias is matched by its name only', () => {
  assert.equal(aliasMatchesSearch('10.0.1', 'web-01'), false);
  assert.equal(aliasMatchesSearch('10.0.1', 'web-01', {}), false);
  assert.equal(aliasMatchesSearch('web', 'web-01'), true);
  assert.equal(aliasMatchesSearch('web', 'web-01', { hostname: '', user: '', port: '' }), true);
});

test('a partial set of details is used for the fields that are known', () => {
  assert.equal(aliasMatchesSearch('10.0.1', 'web-01', { hostname: '10.0.1.23' }), true);
  assert.equal(aliasMatchesSearch('deploy', 'web-01', { hostname: '10.0.1.23' }), false);
});

test('an empty or blank query matches every alias', () => {
  assert.equal(aliasMatchesSearch('', 'web-01'), true);
  assert.equal(aliasMatchesSearch('   ', 'web-01', web), true);
  assert.equal(aliasMatchesSearch(undefined, 'web-01'), true);
});

test('a numeric port in the details is searched as text', () => {
  assert.deepEqual(aliasSearchFields('web', { hostname: 'h', user: 'u', port: 2222 }), ['web', 'h', 'u', '2222']);
  assert.equal(aliasMatchesSearch('222', 'web', { port: 2222 }), true);
});
