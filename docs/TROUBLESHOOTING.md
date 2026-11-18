# Troubleshooting PromeFTP

## An SSH alias is missing or points to a different host

Open **OpenSSH Config**, select the expected file, and search again. The picker lists concrete aliases. If your config relies on a wildcard, enter the alias manually. Compare the resolved destination with system OpenSSH:

```sh
ssh -G example-host | awk '/^(hostname|user|port) / { print }'
```

For an alternate config, add `-F /path/to/config` before the alias. Clear any explicit hostname, user, or port overrides in PromeFTP to use the resolved values again. Redact internal addresses and usernames before sharing output.

## No matching key exchange method

When a server offers only legacy SHA-1 KEX, choose **Configure SSH** in the session status. In the matching `Host` section, add the offered KEX and save. PromeFTP appends it to the host's configured/default algorithms so a stronger shared method remains preferred. SHA-1 KEX is weak; use it only for that server and ask its administrator to upgrade the SSH service.

## SSH reports that `id_rsa` is not accessible

Check that the configured `IdentityFile` exists on this Mac. PromeFTP only fills the **Key** field with a local identity file it can find; when that field is empty, OpenSSH can still use the identities and agent configured for the alias. If the config points to an old path, update `IdentityFile` in the config file.

## Authentication asks me to reply again

In **Preferences → Authentication**, check **Send saved answers automatically**. A stored reply can only be reused after matching the connection and prompt, and automatic replies are limited to one attempt for a matching question per connection. If the server repeats the prompt, answer manually and check **Authentication Activity**. A jump-host prompt requires a manual answer. If a Global rule does not match, compare the full prompt and use a fixed answer for testing. Use `\n` for a line break within a single prompt.

## macOS asks for a Keychain password when I connect

New PromeFTP-saved passwords and PAM answers no longer use **PromeFTP Safe Storage**. If this is the first time you use a value saved by an older version, macOS may ask once while PromeFTP migrates it to the local profile format. OpenSSH identities, agents, or jump-host configurations may still request Keychain access independently.

For an account password, enter it in the connection form. Select **Remember password** to store it in PromeFTP's local profile file after successful authentication. The value is plain text protected only by macOS user file permissions. Leave the field empty to use the saved password, or choose **Forget saved** to remove it.
When OpenSSH repeats the same password prompt during one connection, PromeFTP reuses the supplied password up to three times. Different PAM or OTP questions remain separate prompts.

## I see a host-key warning

Confirm the current fingerprint with the server administrator. PromeFTP remembers approval by address, port, and fingerprint. A changed fingerprint requires fresh verification. See [Host keys and PAM](USAGE.md#host-keys-and-pam).

## SFTP connects but a file will not transfer

Confirm the target pane is on the intended directory. For uploads, check that your remote account can create files there. Replacement also requires server support for the operation. If the target is a folder or a download destination already exists, select a different name or folder. For remote-to-remote copies, check available space on your Mac as well as on the destination.

## The prompt displays boxes or broken glyphs

Install the font required by your shell theme on the Mac running PromeFTP. In **Preferences → Terminal**, select or type its exact family name, preview it, and save. Restart the app if you installed the font while it was running. For SSH, the prompt itself still comes from the remote shell.

## macOS blocks launch, or the update does not appear

Check the architecture, verify the official DMG, and follow the [first-launch instructions](INSTALL.md#first-launch-on-macos). For updates, close all sessions and retry from **Preferences → About**. If the signed update cannot download, use the official DMG. [Update guide](UPDATES.md)

## Shortcuts that do not work

Another app can take a key before PromeFTP sees it. Common causes are a global shortcut in another app, and key remapping tools such as Karabiner-Elements.

1. Open **Preferences → Shortcuts** and turn on **Key diagnostics**.
2. Press the shortcut, then choose **View log**.
3. If the key is listed, PromeFTP receives it and the conflict is elsewhere. Check the other apps. If the key is missing, another app or a remapping tool took it.

Change the shortcut in **Preferences → Shortcuts** if the key is taken, or turn off the other app's global shortcut.

## Agent connection failures

Run `session status` for the session. Its `error.code` names the cause, such as `HOST_KEY_UNKNOWN`, `HOST_KEY_CHANGED`, `HOST_KEY_UNCONFIRMED`, `DNS_FAILED`, `CONNECTION_REFUSED`, or `AUTH_FAILED`. Open the activity history in **Preferences → Agents** and choose **Show log** for the raw OpenSSH output.

`error.next` lists the steps the agent may take. A step with `ask_user` means you must act in PromeFTP, and the agent should not retry it. The agent no longer stops before PromeFTP decides about a host key. A key that differs from the one you trusted opens a dialog with both fingerprints, and the agent connects only after you choose **Trust and Connect**, unless the bookmark's host key trust is set to **New and changed keys**. In that case the key is trusted automatically and recorded as `hostkey.autotrusted`. `HOST_KEY_CHANGED` appears only when no dialog can be shown. `HOST_KEY_UNCONFIRMED` means the dialog was declined or not answered within 60 seconds. PromeFTP never changes your `~/.ssh/known_hosts`.

To check automatic trust, open **Preferences → Agents** and look for **Host key trusted automatically** in the activity history. Those rows are shown in red and list the host and the previous and new fingerprints.

When an agent reaches an authentication prompt that PromeFTP did not answer, the `auth.prompt` event records a `savedAuth` reason. The reason never includes the question's answer or any password.

| `savedAuth` | Meaning |
|---|---|
| `not_granted` | The bookmark's grant does not allow saved authentication, and no granted global rule matches. |
| `disabled` | Stored authentication or automatic saved replies is turned off in Preferences. |
| `not_rememberable` | The prompt did not come from the connection itself, so PromeFTP does not answer it. |
| `no_endpoint` | PromeFTP could not read the bookmark's effective SSH settings. |
| `no_saved_reply` | No reply is saved for this exact question on this bookmark. Save one in PromeFTP. |
| `scope_mismatch` | The saved reply belongs to other SSH settings, or the agent's connection reaches a different server than the app. |
| `global_rule_not_granted` | A global rule matches, but the grant does not include it. |
| `already_used` | The same question was already answered on this connection. The saved answer may be wrong. |
| `read_failed` | The saved answer could not be read or checked. |

## Report a bug

Include your PromeFTP version and build from **Preferences → About**, macOS version, and reproducible steps using sample data. For SSH or SFTP issues, mention whether the connection uses an alias, a jump host, or keyboard-interactive authentication. Remove private hostnames, usernames, fingerprints, passwords, OTPs, keys, terminal output, and config details before posting. [GitHub Issues](https://github.com/PROMLEE/promeftp/issues)
