# ssh stderr fixtures

Raw stderr from the OpenSSH client (`OpenSSH_10.2p1, LibreSSL 3.3.6`, macOS). Each file is the output of one failed `ssh` run, with the `EXIT=` line removed. The tests read these files as-is.

| File | How it was produced |
| --- | --- |
| `auth-failed-openssh` | Throwaway local `sshd` on 127.0.0.1 (non-root, no password login), wrong key, `PreferredAuthentications=publickey` |
| `too-many-auth` | Same `sshd` with `MaxAuthTries 1`, three identities, `IdentitiesOnly=yes` |
| `auth-failed` | Test sshd built on ssh2 (`server.cjs`), wrong key, `BatchMode=yes` |
| `hostkey-changed` | Known-hosts entry for `[127.0.0.1]:2222` holding another key, `BatchMode=yes` |
| `hostkey-unknown` | Empty known-hosts file, `StrictHostKeyChecking=yes`, `BatchMode=yes` |
| `refused` | Port 2223 with nothing listening |
| `dns` | `tester@nonexistent.invalid` |
| `drop-handshake` | A TCP server on 127.0.0.1:2224 that closes each connection at once |
| `password-prompt` | Run under `script` (a PTY), three wrong passwords sent on stdin. The sentinel value is never echoed by ssh, so it is absent from the output. |
| `proxy-command-silent` | `ssh -o ProxyCommand="sh -c 'exit 1'"` to the test sshd |
| `proxy-command` | A ProxyCommand that prints `ProxyCommand: ...` on stderr and exits 1. This line is the proxy program's own output. |
| `proxy-jump-refused` | `ssh -J 127.0.0.1:2223` (nothing listening on the jump port) |
| `banner-plain` | ssh2 test sshd with `banner: "Connection refused"`, wrong key |
| `banner-forged-form` | ssh2 test sshd with a banner in OpenSSH's line form. Kept for reference; the test does not assert on it. |

Every run used `-F /dev/null -o GlobalKnownHostsFile=/dev/null -o IdentityAgent=none` and a known-hosts file outside the user's `~/.ssh`. The user's `~/.ssh/known_hosts` was not used or changed.
