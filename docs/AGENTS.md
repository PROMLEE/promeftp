# Use PromeFTP from an AI agent

Open **Settings → Agents**, enable local agent access, and register a client.
In the one-time token window, choose **Save for installed skills** to store it
as plain text in a `0600` file under PromeFTP's app data. The bundled CLI reads
that token automatically. **Forget saved token** removes it; revoking that
client also removes it. The token is never written into skill files. Or choose
**Copy Token** and provide it through `PROMEFTP_AGENT_TOKEN` in your agent
runtime. Closing the window clears the displayed value; PromeFTP cannot show it
again. The clipboard is not cleared on a timer. The app must be running for the
CLI to connect.

Select the client and a saved bookmark. Agent connections follow that bookmark's
OpenSSH configuration, including aliases, configured SSH files, `Include`,
`ProxyJump`, and `ProxyCommand`. `ProxyCommand` can start a local process when
the agent opens a connection. Confirm aliases and proxy routes resolve to the
intended server.

Host keys are checked against the keys PromeFTP trusts. Trust comes from, in order: a key you trusted in PromeFTP, a key that an agent grant trusted automatically, and a matching key in your `~/.ssh/known_hosts` or `/etc/ssh/ssh_known_hosts`. PromeFTP only reads those two system files and never writes to them. Each agent connection starts with an empty known-hosts file of its own, so an old stored key cannot stop it before PromeFTP decides. ProxyJump routes are not verified in this release.

By default a new or changed key is never accepted on the agent's word. PromeFTP shows a confirmation dialog with the new fingerprint and, when there is one, the previous fingerprint and where it came from. The agent connects only if you choose **Trust and Connect**. If you decline, or do not answer within 60 seconds, the session fails with `HOST_KEY_UNCONFIRMED`.

The bookmark's grant has a **Trust host keys automatically** setting that can skip that dialog. **Off (ask me)** is the default. **New keys only** accepts a key PromeFTP has never seen for that host, and asks about any other key. **New and changed keys** also accepts a key that differs from the trusted one. Both automatic settings can let a man-in-the-middle attack pass on the first connection, and saved passwords and answers can then be sent to the attacker. Automatic trust is kept in the agent's own trust list and never changes the keys PromeFTP trusts for your own connections. Each automatic trust is recorded as a `hostkey.autotrusted` event, visible in `promeftp events list` and in **Preferences → Agents**. An agent cannot change this setting.

Each failure response includes `error.next`, a list of steps the agent may take. A step with `action` set to `ask_user` means the user must act in PromeFTP, and the agent should not retry it on its own.

## Grant a bookmark

- Turn on **Allow SFTP browsing** and enter an absolute remote directory for
  listing and stat operations. Enable downloads separately. Downloads go to the
  app's private staging folder (16 MiB per file, up to 64 staged files). Old
  staging folders are cleared on subsequent downloads.
- Set a task name and a fixed SSH command to expose a reusable operation.
  Enable **Allow SSH commands with approval** to let the agent request a
  different command. The app shows the client, server, and exact command before
  sending it. The approval lasts for that request only, within its timeout.
  An SSH command can change or delete files with the remote account's rights.
  Use an account with appropriate server-side restrictions.
- Select PAM rules and notification triggers individually. **Use saved
  authentication** authorizes existing host-scoped credentials where the
  effective endpoint matches. Unexpected prompts appear in the Agents tab.
  Trigger matches are reported as events. A trigger cannot send a reply or
  run another command on an agent's session.

## CLI

Use the CLI path shown in Settings. In the standard installation it is
`/Applications/PromeFTP.app/Contents/MacOS/promeftp`.

```sh
promeftp profiles list --json
promeftp session open --profile PROFILE_ID --mode ssh --json
promeftp session status --session SESSION_ID --json
promeftp session wait --session SESSION_ID --json
promeftp ssh run --session SESSION_ID --task service-status --json
promeftp ssh command --session SESSION_ID --command 'uptime' --json
promeftp events list --session SESSION_ID --after 0 --json
promeftp session close --session SESSION_ID --json
```

A session can stay in `connecting` or `waiting_for_user` for a while when the
user must enter an OTP in PromeFTP. Keep it open and keep polling. `session wait`
returns within 25 seconds, or as soon as the status changes. A question from
PromeFTP extends the authentication deadline by three minutes, and never past
ten minutes after the session opened. `expires` in the status is a Unix time in
milliseconds: keep waiting until the status changes, or until the current time is
past `expires`. Do not close or reopen the session while it waits, because
reopening asks the user for a new OTP.

Open a session with `--mode sftp` for `sftp list`, `sftp stat`, and
`sftp download`. Each takes `--session` and `--path`. The SFTP API does
not accept file modification requests. Commands are single executions
with stdout, stderr, exit code, and truncation status. An arbitrary command
request has a 30-second budget including approval.

The response contains `version`, `request`, and either `data` or an error
code. Local CLI errors can occur before a request ID is assigned.
Exit codes are 0 for success, 1 for API or transport errors, 2 for invalid
CLI arguments, 3 for missing credentials, 4 for app offline, and 5 for a
remote command failure or truncated output.

## Skills and activity

Install the skill from Settings for Codex, Claude Code, Cursor, Gemini CLI, or
GitHub Copilot CLI. Choose user or project scope and optionally enable automatic
updates. Outside the app, refresh the agent's skills or start a new session.
The app loads a signed compatible skill from the official feed when available,
or uses the bundled copy when offline or when the feed has no compatible entry.
Installation grants no bookmark access.

Activity history retains request IDs, authorization decisions, session events,
PAM and trigger rule IDs, and outcomes. Filter and export it from Settings.
The default retention is 30 days and can be set to 1–90 days. Credentials,
terminal output, and arbitrary SSH command text are excluded. An interrupted
operation may be recorded as an unknown result.

## Ship the CLI and skill

Build the app with `build-macos.sh`; the CLI is part of the app bundle.
The bundle must include the project `LICENSE` and `THIRD-PARTY-NOTICES.md`.
Publish those two files in the public source repository with the README so
the app and release page show the same license terms.
The production signing script also generates `skills/promeftp/SKILL.md` and
`agent-skills.json`. Copy the versioned skill to the public source and
documentation commit **before** tagging it. Publish the signed manifest as
`updates/agent-skills.json` after the release tag is accessible. Keep older
entries only if they are included in a newly signed manifest. A missing manifest
does not prevent the app from installing the bundled skill.
