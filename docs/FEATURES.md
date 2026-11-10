# Features and limits

| Area | Supported in 1.0.2 | Practical limits |
| --- | --- | --- |
| Platform | macOS 13 and later on Apple Silicon | Distribution is arm64. Preferences and major interface controls support English, Korean, Japanese, and Simplified Chinese. |
| SSH and local shell | System OpenSSH, interactive terminal, search, resize, split panes, prompt navigation, and output export | Port forwarding is disabled. Prompt navigation needs OSC 133 markers. iTerm2 profile import and tmux integration mode are outside scope. |
| OpenSSH config | Concrete aliases from `Host` and `Include`, effective settings, alternate config files, hostname/user/port overrides | Enter wildcard-matched aliases manually. PromeFTP opens files in the system editor and does not write config directives. |
| SFTP | Shared local browser with one or more remote panes in a tab, folder trees, recent paths, drag and drop, and selection with Shift and ⌘ | SFTP must be enabled on the server. Transfer permissions depend on both the local filesystem and the remote account. |
| Remote-to-remote | Copy between remote panes in the same tab | The copy stages on your Mac, uses local disk space, and keeps the source. A failure can leave completed items at the destination. |
| Conflicts | Skip or replace an existing remote file on upload | Existing download targets and same-name folders are protected. Folder copies skip symlinks. Remote folder deletion requires an empty directory. |
| Layouts | Tab names, colors, groups, splits, and selected-tab workspace snapshots | Restoring a layout appends tabs and opens fresh connections. It does not resume remote processes or restore terminal output. To change a saved snapshot, delete and recreate it. |
| Authentication | Interactive prompts, saved replies, exact or RE2 global rules, and authentication activity | New connections can prompt again. RE2 rules match a prompt and send a fixed single-line answer. Jump-host prompts are answered manually. |
| Scrollback | Finite setting or optional unlimited mode in session memory | Long output uses memory. The terminal library has a buffer ceiling. Session log export uses a separate, bounded capture. |
| Updates | Signed arm64 archive and feed, manual checks, and opt-in automatic installation | First launch can require approval because the release is not Apple notarized. |

[User guide](USAGE.md) · [Troubleshooting](TROUBLESHOOTING.md)
