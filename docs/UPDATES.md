# PromeFTP updates

| Starting point | Update path |
| --- | --- |
| 0.0.9 beta | Use **PromeFTP → Check for Updates…**. Its beta feed offers 1.0.5. |
| 1.0.0 or later (stable) | Use **PromeFTP → Check for Updates…** or **Preferences → About**. Stable feed offers 1.0.5. |
| Fresh or manual install | Download the Apple Silicon DMG, verify its checksum, and replace PromeFTP in Applications after quitting. |

## Manual and automatic updates

Close active SSH, SFTP, and local shell sessions before checking manually. Enable **Install updates automatically** in Preferences if you want Sparkle to check and download on your behalf. It is off by default on a fresh install. Installation is deferred when sessions or pending writes would be interrupted. A ready update can install when the app quits.

## How the release is verified

Sparkle validates the signed appcast and the ZIP archive with the PromeFTP update key. The bundle uses a separate, persistent macOS signing certificate. The public SHA-256 files let you verify manual downloads. Signing and Apple notarization are separate, so macOS can still require explicit first-launch approval. [Install guide](INSTALL.md) · [1.0.5 release notes](releases/1.0.5.md)
