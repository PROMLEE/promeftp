// Characterization tests for the pure parsers in openssh.cjs. Functions that start ssh, ssh-keygen or a PTY are not called here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHostKeyPrompt, authEndpoint, parseKeygenFingerprints, parseKeygenEntries, knownHostFingerprints, agentRestrictedOptions } = require('../openssh.cjs');

const question = "Are you sure you want to continue connecting (yes/no/[fingerprint])?";

test('a host key question with a fingerprint is accepted by fingerprint', () => {
  const prompt = `The authenticity of host 'example.invalid (203.0.113.5)' can't be established.\nED25519 key fingerprint is SHA256:abcDEF+/09=.\n${question}`;
  assert.deepEqual(parseHostKeyPrompt(prompt), { host: 'example.invalid', fingerprint: 'SHA256:abcDEF+/09=', accept: 'SHA256:abcDEF+/09=', keyType: 'ED25519' });
});

test('the host name is lowercased and the address in parentheses is removed', () => {
  const prompt = "The authenticity of host 'Example.INVALID (203.0.113.5)' can't be established.";
  assert.equal(parseHostKeyPrompt(prompt).host, 'example.invalid');
});

test('without the fingerprint question the answer is yes', () => {
  const prompt = "The authenticity of host 'example.invalid' can't be established.\nECDSA key fingerprint is SHA256:xyz.";
  assert.deepEqual(parseHostKeyPrompt(prompt), { host: 'example.invalid', fingerprint: 'SHA256:xyz', accept: 'yes', keyType: 'ECDSA' });
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

// Output of `ssh-keygen -l -F host -f file` as OpenSSH 10 prints it for a plain and a hashed entry.
test('parseKeygenFingerprints reads the SHA256 fingerprint from a real ssh-keygen answer', () => {
  const plain = '# Host example.invalid found: line 1 \nexample.invalid ED25519 SHA256:2x4rVmPgLrZC3BCyj4QvzB6Q+6EznY3lUyA/oa5tnZg\n';
  assert.deepEqual(parseKeygenFingerprints(plain), ['SHA256:2x4rVmPgLrZC3BCyj4QvzB6Q+6EznY3lUyA/oa5tnZg']);
});

test('parseKeygenFingerprints skips comment lines and keeps each fingerprint once', () => {
  const output = '# Host example.invalid found: line 3\n256 SHA256:abc example.invalid (ED25519)\n256 SHA256:abc example.invalid (ED25519)\n';
  assert.deepEqual(parseKeygenFingerprints(output), ['SHA256:abc']);
});

test('parseKeygenFingerprints reads a hashed host line too', () => {
  assert.deepEqual(parseKeygenFingerprints('256 SHA256:hashed1 |1|abc=|def= (ED25519)\n'), ['SHA256:hashed1']);
});

test('parseKeygenFingerprints gives an empty list for empty output or a comment only', () => {
  assert.deepEqual(parseKeygenFingerprints(''), []);
  assert.deepEqual(parseKeygenFingerprints('# Host example.invalid found: line 3\n'), []);
});

test('knownHostFingerprints returns an empty list for a file that does not exist', async () => {
  assert.deepEqual(await knownHostFingerprints('/var/empty-promeftp-test/known_hosts', 'example.invalid'), []);
});

test('agentRestrictedOptions names only the agent known_hosts file, never ~/.ssh/known_hosts', () => {
  const args = agentRestrictedOptions({ configPath: '', knownHosts: '/x/k' });
  assert.ok(args.includes('UserKnownHostsFile="/x/k"'));
  assert.equal(args.join(' ').includes('~/.ssh/known_hosts'), false);
  assert.ok(args.includes('IdentityAgent=none'));
  assert.ok(args.includes('IdentitiesOnly=yes'));
  assert.equal(args.includes('-F'), false);
});

test('agentRestrictedOptions adds the config file first and escapes quotes in the path', () => {
  const args = agentRestrictedOptions({ configPath: '/dev/null', knownHosts: '/x/"k' });
  assert.deepEqual(args.slice(0, 2), ['-F', '/dev/null']);
  assert.ok(args.includes('UserKnownHostsFile="/x/\\"k"'));
});

test('agentRestrictedOptions refuses to run without the agent known_hosts file', () => {
  assert.throws(() => agentRestrictedOptions({ configPath: '' }), /own known_hosts file/);
});

test('parseHostKeyPrompt gives the key type in upper case, or an empty string when the question names none', () => {
  const rsa = `The authenticity of host 'example.invalid' can't be established.\nrsa key fingerprint is SHA256:r1.\n${question}`;
  assert.equal(parseHostKeyPrompt(rsa).keyType, 'RSA');
  const ecdsa = `The authenticity of host 'example.invalid' can't be established.\nECDSA key fingerprint is SHA256:e1.\n${question}`;
  assert.equal(parseHostKeyPrompt(ecdsa).keyType, 'ECDSA');
  const none = "The authenticity of host 'example.invalid' can't be established.";
  assert.equal(parseHostKeyPrompt(none).keyType, '');
});

test('parseKeygenEntries reads type and fingerprint from the parenthesized layout', () => {
  assert.deepEqual(parseKeygenEntries('256 SHA256:abc example.invalid (ED25519)\n# Host x found: line 3'),
    [{ fingerprint: 'SHA256:abc', type: 'ED25519' }]);
  assert.deepEqual(parseKeygenEntries(''), []);
});

test('parseKeygenEntries reads the type from the layout ssh-keygen -F prints on this Mac', () => {
  const output = '# Host example.invalid found: line 1 \nexample.invalid ED25519 SHA256:2x4rVmPgLrZC3BCyj4QvzB6Q+6EznY3lUyA/oa5tnZg\n';
  assert.deepEqual(parseKeygenEntries(output),
    [{ fingerprint: 'SHA256:2x4rVmPgLrZC3BCyj4QvzB6Q+6EznY3lUyA/oa5tnZg', type: 'ED25519' }]);
});

test('the agent options also turn off the system-wide known_hosts file', () => {
  const args = agentRestrictedOptions({ configPath: '', knownHosts: '/x/k' });
  assert.ok(args.includes('GlobalKnownHostsFile=/dev/null'));
  assert.equal(args.join(' ').includes('.ssh'), false);
});

test('knownHostKeyEntries: a missing file has no entries, but a directory is a read failure', async () => {
  const { knownHostKeyEntries } = require('../openssh.cjs');
  assert.deepEqual(await knownHostKeyEntries('/var/empty-promeftp-test/known_hosts', 'example.invalid'), []);
  const dir = await require('node:fs/promises').mkdtemp(require('node:path').join(require('node:os').tmpdir(), 'promeftp-kh-'));
  try {
    await assert.rejects(knownHostKeyEntries(dir, 'example.invalid'), /not a regular file/);
  } finally {
    await require('node:fs/promises').rm(dir, { recursive: true, force: true });
  }
});

// shell() starts a PTY on the agent ControlMaster socket, so it is checked from the source text instead of running ssh.
const sshSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'openssh.cjs'), 'utf8');
const shellBlock = sshSource.slice(sshSource.indexOf('shell(shellSize, onData, onExit)'), sshSource.indexOf('input(data) { if (!stopped) terminal.write(data); }'));

test('shell is exposed only on agent exec connections', () => {
  assert.match(sshSource, /\(\(agent && mode === 'exec'\) && \{ shell\(shellSize, onData, onExit\)/);
  assert.equal((sshSource.match(/shell\(shellSize, onData, onExit\)/g) || []).length, 1);
});

test('shell reuses the existing socket as an interactive session without authentication', () => {
  assert.ok(shellBlock.length > 100);
  for (const option of ["'-tt'", "'BatchMode=yes'", "'ProxyCommand=/usr/bin/false'", "'-S', socket"]) assert.ok(shellBlock.includes(option), option);
  assert.match(shellBlock, /stopped \|\| !isReady\) throw Error\('SSH session is unavailable\.'\)/);
  // No askpass environment, so a password or OTP prompt can never be answered from here.
  assert.equal(/auth\??\.env|SSH_ASKPASS|askpass/i.test(shellBlock), false);
});

test('closing the master kills every open user shell', () => {
  const closeBlock = sshSource.slice(sshSource.indexOf('function close() {'), sshSource.indexOf('function ready() {'));
  assert.match(closeBlock, /for \(const shell of shells\)[\s\S]*shell\.kill\(\)/);
});
