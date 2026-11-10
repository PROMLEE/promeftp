# PromeFTP

**A macOS workspace for SSH and SFTP.** Open terminals, move files, and save the layout of the connections you use together. PromeFTP follows PromePaste’s local desktop approach.

[Download 1.0.0](https://github.com/PROMLEE/promeftp/releases/tag/v1.0.0) · [Install guide](docs/INSTALL.md) · [User guide](docs/USAGE.md) · [Release notes](docs/releases/1.0.0.md) · [Documentation index for assistants](llm.txt) · [한국어](README.ko.md)

Requires macOS 13 or later on Apple Silicon.

| Area | What you can do |
| --- | --- |
| SSH | Open local or remote shells, split terminals horizontally or vertically, search output, and paste global or connection-specific snippets. |
| SFTP | Browse local and remote files side by side. Drag files between panels, or copy between remote panels in the same tab. |
| Connections | Connect directly, reuse OpenSSH aliases, or organize bookmarks in folders. Successful connections appear in History. |
| Workspaces | Save selected tabs with their groups, colors, split layout, and SFTP paths. Open the saved tabs alongside running sessions. |
| Authentication | Verify SSH host keys and respond to keyboard-interactive questions. Manage saved replies and global PAM rules locally. |
| Preferences | Choose appearance, an installed monospace font, font size, scrollback, Option as Meta, and update behavior. Open with ⌘,. |

Install the DMG by dragging PromeFTP to Applications. The app uses a persistent signing identity and signed Sparkle updates. If macOS blocks the first launch, follow the Open Anyway steps in the install guide. [Installation and updates](docs/INSTALL.md)

Bookmarks, workspaces, and authentication settings live on this Mac. PromeFTP uses system OpenSSH for SSH configuration, host trust, and private keys. Saved PAM replies are encrypted with a key protected by the macOS Keychain. [Authentication guide](docs/USAGE.md#host-keys-and-pam)
