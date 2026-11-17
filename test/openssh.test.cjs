// Characterization tests for the pure parsers in openssh.cjs. Functions that start ssh, ssh-keygen or a PTY are not called here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHostKeyPrompt, authEndpoint } = require('../openssh.cjs');

const question = "Are you sure you want to continue connecting (yes/no/[fingerprint])?";

test('a host key question with a fingerprint is accepted by fingerprint', () => {
  const prompt = `The authenticity of host 'example.invalid (203.0.113.5)' can't be established.\nED25519 key fingerprint is SHA256:abcDEF+/09=.\n${question}`;
  assert.deepEqual(parseHostKeyPrompt(prompt), { host: 'example.invalid', fingerprint: 'SHA256:abcDEF+/09=', accept: 'SHA256:abcDEF+/09=' });
});

test('the host name is lowercased and the address in parentheses is removed', () => {
  const prompt = "The authenticity of host 'Example.INVALID (203.0.113.5)' can't be established.";
  assert.equal(parseHostKeyPrompt(prompt).host, 'example.invalid');
});

test('without the fingerprint question the answer is yes', () => {
  const prompt = "The authenticity of host 'example.invalid' can't be established.\nECDSA key fingerprint is SHA256:xyz.";
  assert.deepEqual(parseHostKeyPrompt(prompt), { host: 'example.invalid', fingerprint: 'SHA256:xyz', accept: 'yes' });
});

test('an MD5 fingerprint is recognised', () => {
  const md5 = Array.from({ length: 16 }, () => 'ab').join(':');
  const prompt = `The authenticity of host 'example.invalid' can't be established.\nRSA key fingerprint is MD5:${md5}.\n${question}`;
  assert.equal(parseHostKeyPrompt(prompt).fingerprint, `MD5:${md5}`);
});

test('text that is not a host key question returns null', () => {
  assert.equal(parseHostKeyPrompt('user@example.invalid password:'), null);
  assert.equal(parseHostKeyPrompt(''), null);
});

test('authEndpoint keeps only the connection settings that are safe to show', () => {
  const stdout = [
    'hostname example.invalid',
    'user alice',
    'port 2222',
    'proxyjump bastion.invalid',
    'identityfile ~/.ssh/id_ed25519',
    'localforward 8080 localhost:80',
    'sendenv LANG',
    'remoteforward 9000 localhost:9000',
  ].join('\n');
  assert.equal(authEndpoint(stdout), [
    'hostname example.invalid',
    'user alice',
    'port 2222',
    'proxyjump bastion.invalid',
    'identityfile ~/.ssh/id_ed25519',
  ].join('\n'));
});

test('authEndpoint needs the key followed by a space, so similar keys are dropped', () => {
  assert.equal(authEndpoint('hostnames example.invalid\nuser\nport'), '');
  assert.equal(authEndpoint(''), '');
});
