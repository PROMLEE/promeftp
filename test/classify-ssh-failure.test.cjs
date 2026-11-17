// Classifier tests. Inputs are real OpenSSH 10.2 stderr captured in test/fixtures/ssh-stderr/ (not hand-written strings).
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripVTControlCharacters } = require('node:util');
const { classifySshFailure, scrubLines } = require('../agent-transport.cjs');

// Same line handling as agent-transport.cjs onEvent('data').
function linesOf(name) {
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'ssh-stderr', `${name}.txt`), 'utf8');
  return stripVTControlCharacters(raw).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

const HANDSHAKE_HINT = 'The server closed the connection during the handshake. Check the port, access limits, and firewall, and ProxyJump if you use it.';

const scenarios = [
  { name: '인증 실패 (test sshd, ssh2)', file: 'auth-failed', code: 'AUTH_FAILED', stage: 'auth' },
  { name: '인증 실패 (OpenSSH sshd)', file: 'auth-failed-openssh', code: 'AUTH_FAILED', stage: 'auth' },
  { name: '인증 실패 · 시도 횟수 초과 (OpenSSH sshd)', file: 'too-many-auth', code: 'AUTH_FAILED', stage: 'auth' },
  { name: '호스트 키 불일치', file: 'hostkey-changed', code: 'HOST_KEY_CHANGED', stage: 'hostkey' },
  { name: '미신뢰 호스트 키', file: 'hostkey-unknown', code: 'HOST_KEY_UNKNOWN', stage: 'hostkey' },
  { name: '연결 거부', file: 'refused', code: 'CONNECTION_REFUSED', stage: 'connect' },
  { name: 'DNS 실패', file: 'dns', code: 'DNS_FAILED', stage: 'connect' },
  { name: '연결 끊김 (handshake 중 reset)', file: 'drop-handshake', code: 'CONNECTION_FAILED', stage: 'connect', hint: HANDSHAKE_HINT },
  // Real OpenSSH output for a ProxyCommand that exits silently. It has no ProxyCommand text, so it is a handshake reset.
  { name: 'ProxyCommand 실패 (조용히 종료)', file: 'proxy-command-silent', code: 'CONNECTION_FAILED', stage: 'connect', hint: HANDSHAKE_HINT },
  // The proxy program printed "ProxyCommand: ..." itself. That line is not an OpenSSH line, so it is not counted.
  { name: 'ProxyCommand 프로그램 stderr 출력', file: 'proxy-command', code: 'CONNECTION_FAILED', stage: 'connect', hint: HANDSHAKE_HINT },
  // The jump host refused the connection, so the refusal is what matters.
  { name: 'ProxyJump 점프 호스트 거부', file: 'proxy-jump-refused', code: 'CONNECTION_REFUSED', stage: 'connect' },
  { name: '배너 위조 방어 (배너에 Connection refused)', file: 'banner-plain', code: 'AUTH_FAILED', stage: 'auth', notCode: 'CONNECTION_REFUSED' },
  { name: '비밀번호 프롬프트 (오답 3회)', file: 'password-prompt', code: 'AUTH_FAILED', stage: 'auth' },
];

for (const s of scenarios) {
  test(`${s.name} → ${s.code}`, () => {
    const result = classifySshFailure(linesOf(s.file), { exit: 255, stage: 'connect' });
    assert.equal(result.code, s.code);
    assert.equal(result.stage, s.stage);
    if (s.notCode) assert.notEqual(result.code, s.notCode);
    if (s.hint) assert.equal(result.hint, s.hint);
  });
}

test('password prompt log keeps the prompt but never the typed answer', () => {
  const scrubbed = scrubLines(linesOf('password-prompt'));
  assert.ok(scrubbed.some(line => /password:/.test(line)), 'prompt line is kept');
  assert.ok(scrubbed.every(line => !line.includes('WRONG-SENTINEL-123')), 'typed answer never appears');
});
