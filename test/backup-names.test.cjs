// The type column for backup copies (review item 5): a copy shows the type of its original name.
const test = require('node:test');
const assert = require('node:assert/strict');
const { nameTypeOf } = require('../backup-names.js');

test('a backup copy shows the extension of its original name', () => {
  assert.deepEqual(nameTypeOf('app.conf.20261118-170909'), { extension: 'CONF', backup: true });
  assert.deepEqual(nameTypeOf('archive.tar.gz.20261118-170909-2'), { extension: 'GZ', backup: true });
});

test('a backup copy of a name without an extension is a backup, not a timestamp', () => {
  assert.deepEqual(nameTypeOf('Makefile.20261118-170909'), { extension: '', backup: true });
  assert.deepEqual(nameTypeOf('.env.20261118-170909'), { extension: '', backup: true });
});

test('an ordinary name keeps its own extension, and a name without one has none', () => {
  assert.deepEqual(nameTypeOf('notes.txt'), { extension: 'TXT', backup: false });
  assert.deepEqual(nameTypeOf('Makefile'), { extension: '', backup: false });
  assert.deepEqual(nameTypeOf('v1.2026'), { extension: '2026', backup: false });
});
