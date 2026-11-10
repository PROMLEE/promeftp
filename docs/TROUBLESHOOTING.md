# Troubleshooting PromeFTP

## An SSH alias is missing or points to a different host

Open **OpenSSH Config**, select the expected file, and search again. The picker lists concrete aliases. If your config relies on a wildcard, enter the alias manually. Compare the resolved destination with system OpenSSH:

```sh
ssh -G example-host | awk '/^(hostname|user|port) / { print }'
```

For an alternate config, add `-F /path/to/config` before the alias. Clear any explicit hostname, user, or port overrides in PromeFTP to use the resolved values again. Redact internal addresses and usernames before sharing output.

## Authentication asks me to reply again

In **Preferences → General → PAM Authentication**, check **Send saved answers automatically**. A stored reply can only be reused after matching the connection and prompt, and automatic replies are limited to one attempt for a matching question per connection. If the server repeats the prompt, answer manually and check **Authentication Activity**. A jump-host prompt requires a manual answer. If a Global rule does not match, compare the full prompt and use a fixed answer for testing. Use `\n` for a line break within a single prompt.

## I see a host-key warning

Confirm the current fingerprint with the server administrator. PromeFTP remembers approval by address, port, and fingerprint. A changed fingerprint requires fresh verification. See [Host keys and PAM](USAGE.md#host-keys-and-pam).

## SFTP connects but a file will not transfer

Confirm the target pane is on the intended directory. For uploads, check that your remote account can create files there. Replacement also requires server support for the operation. If the target is a folder or a download destination already exists, select a different name or folder. For remote-to-remote copies, check available space on your Mac as well as on the destination.

## The prompt displays boxes or broken glyphs

Install the font required by your shell theme on the Mac running PromeFTP. In **Preferences → Terminal**, select or type its exact family name, preview it, and save. Restart the app if you installed the font while it was running. For SSH, the prompt itself still comes from the remote shell.

## macOS blocks launch, or the update does not appear

Check the architecture, verify the official DMG, and follow the [first-launch instructions](INSTALL.md#first-launch-on-macos). For updates, close all sessions and retry from **Preferences → General**. If the signed update cannot download, use the official DMG. [Update guide](UPDATES.md)

## Report a bug

Include your PromeFTP version and build from **Preferences → About**, macOS version, and reproducible steps using sample data. For SSH or SFTP issues, mention whether the connection uses an alias, a jump host, or keyboard-interactive authentication. Remove private hostnames, usernames, fingerprints, passwords, OTPs, keys, terminal output, and config details before posting. [GitHub Issues](https://github.com/PROMLEE/promeftp/issues)
