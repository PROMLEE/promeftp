# Install and update PromeFTP

PromeFTP 1.0.0 requires macOS 13 or later on an Apple Silicon Mac. [GitHub release](https://github.com/PROMLEE/promeftp/releases/tag/v1.0.0)

## Install

1. Download `PromeFTP-1.0.0-macos-arm64.dmg` from Assets. The matching `.sha256` file is available on the same release.
2. Open the DMG and drag **PromeFTP** into **Applications**. Eject the disk image.
3. Launch PromeFTP from Applications.

To verify the download, put the DMG and its checksum file in the same folder and run the following from that folder.

```sh
shasum -a 256 -c PromeFTP-1.0.0-macos-arm64.dmg.sha256
```

## First launch on macOS

The release is signed with the persistent PromeFTP certificate. It has no Apple notarization. If macOS says it cannot verify the developer or check the app for malicious software, confirm you downloaded the official build before continuing.

1. Dismiss the alert, then open **System Settings → Privacy & Security**.
2. Under **Security**, click **Open Anyway** next to the PromeFTP message.
3. Confirm the app name and approve the launch. macOS may ask for your login password or Touch ID.

If the button is missing, launch PromeFTP from Applications again and return to Settings. If macOS reports the app as damaged or harmful, stop and check the download. Managed Macs may restrict this action. [Apple’s macOS instructions](https://support.apple.com/en-us/102445)

## Permissions and updates

SFTP can trigger normal macOS prompts when you browse protected local folders. If you save PAM answers, macOS may ask for access to **PromeFTP Safe Storage**. On a verified official build, **Always Allow** lets future requests from the trusted app use that entry. SSH private keys remain under OpenSSH management.

Open **PromeFTP → Check for Updates…** or **Preferences → General** to check manually. Automatic updates are optional and off by default on a fresh install. Close active SSH, SFTP, and local shell sessions before a manual update. Automatic installation waits for active sessions and pending writes. Sparkle verifies both the feed and the update archive before installing.

Version 0.0.9 can upgrade to 1.0.0 through its existing feed. Version 1.0.0 reads the stable feed. You can also quit the old app and replace it in Applications with the official DMG. The app continues using the same local settings and signing identity.
