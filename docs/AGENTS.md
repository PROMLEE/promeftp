# Use PromeFTP from an AI agent

Open **Settings → Agents**, enable local agent access, and register a client.
Copy the token into your agent runtime’s protected environment as
`PROMEFTP_AGENT_TOKEN`. The token is copied once. Revoke and register again to
replace it. The app must be running for the CLI to connect.

Select the client and a saved bookmark. First use a direct bookmark with an
explicit username. SSH aliases, custom SSH configuration files, and proxy or
jump-host configurations are outside this release's agent connection support.
The host key must already be trusted by OpenSSH for the destination. Configure
and verify it through a regular desktop connection first.

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
promeftp ssh run --session SESSION_ID --task service-status --json
promeftp ssh command --session SESSION_ID --command 'uptime' --json
promeftp events list --session SESSION_ID --after 0 --json
promeftp session close --session SESSION_ID --json
```

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
