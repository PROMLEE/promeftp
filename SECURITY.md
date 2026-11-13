# Privacy and security

## Local data

PromeFTP stores bookmarks, connection history, workspace layouts, snippets, preferences, and saved authentication settings on your Mac. SSH private keys and standard known-hosts handling are managed by system OpenSSH. Workspace snapshots contain connection and layout details, including SFTP paths. Terminal output is held in memory during the session and is written to a file when you explicitly export a log.

Saved SSH passwords, PAM answers, and global rule values are stored as plain text in the local profiles file, protected only by the current user's macOS file permissions. Anyone with access to that user account or a copy of the file can read them. PromeFTP does not use Keychain to protect these saved values. Existing encrypted values from older builds are decrypted when first used and converted locally. Successful authentication is required before an answer saved from an authentication prompt is retained. A global rule may send its value to any matching connection, so reserve global rules for replies intended for those hosts.

## Network and files

The app connects to the hosts you choose and requests the signed update feed when you check for updates or opt into automatic updates. There is no cloud account, team vault, or sync service. A copy between remote SFTP panels stages the file contents in a temporary directory on your Mac. The OS may ask to access protected local folders when you browse them.

## Reporting

For an ordinary bug, use [GitHub Issues](https://github.com/PROMLEE/promeftp/issues) with sample data. For a suspected vulnerability, use [GitHub’s private reporting form](https://github.com/PROMLEE/promeftp/security/advisories/new) if enabled. If private reporting is unavailable, ask for a private contact method without including sensitive details in the issue.
