# Privacy and security

## Local data

PromeFTP stores bookmarks, connection history, workspace layouts, snippets, preferences, and saved authentication settings on your Mac. SSH private keys and standard known-hosts handling are managed by system OpenSSH. Workspace snapshots contain connection and layout details, including SFTP paths. Terminal output is held in memory during the session and is written to a file when you explicitly export a log.

Saved PAM answers and global rule values are encrypted locally. macOS Keychain protects the wrapping key through Electron Safe Storage. Successful authentication is required before an answer saved from an authentication prompt is retained. An answer stored in a global rule may be sent to any matching trusted connection, so reserve global rules for replies intended for those hosts.

## Network and files

The app connects to the hosts you choose and requests the signed update feed when you check for updates or opt into automatic updates. There is no cloud account, team vault, or sync service. A copy between remote SFTP panels stages the file contents in a temporary directory on your Mac. The OS may ask to access protected local folders when you browse them.

## Reporting

For an ordinary bug, use [GitHub Issues](https://github.com/PROMLEE/promeftp/issues) with sample data. For a suspected vulnerability, use [GitHub’s private reporting form](https://github.com/PROMLEE/promeftp/security/advisories/new) if enabled. If private reporting is unavailable, ask for a private contact method without including sensitive details in the issue.
