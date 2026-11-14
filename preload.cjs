const { contextBridge, ipcRenderer } = require('electron');
const methods = [
  'open-sponsors', 'open-project-license', 'open-license-notices', 'agent-info', 'agent-enable', 'agent-register', 'agent-revoke', 'agent-grant',
  'agent-answer', 'agent-history', 'agent-retention', 'agent-export', 'agent-skill',
  'read-clipboard', 'write-clipboard', 'open-link', 'local-directory', 'local-list', 'local-mkdir', 'local-action', 'config-aliases', 'effective-config', 'inspect-identity-file', 'choose-config', 'config-files', 'register-config', 'unregister-config', 'edit-config-file', 'save-config-file', 'connection-history', 'remove-history-item', 'snippets', 'application-info', 'check-for-updates', 'set-automatic-updates', 'appearance', 'open-preferences', 'close-preferences', 'show-about', 'update-status', 'open-config-from-preferences', 'preferences-data', 'save-preferences', 'keyboard-shortcuts', 'set-appearance', 'save-snippet', 'remove-snippet', 'terminal-triggers', 'save-terminal-trigger', 'set-terminal-trigger-enabled', 'remove-terminal-trigger', 'keychain-preferences', 'set-keychain-preferences', 'export-log', 'workspaces', 'rename-workspace', 'save-workspace', 'confirm-remove-workspace',
  'profiles', 'bookmark-folders', 'save-bookmark-folder', 'remove-bookmark-folder', 'move-bookmark', 'save-profile', 'remove-profile', 'choose-key', 'ssh-password-saved', 'forget-ssh-password', 'connect', 'auth-answer', 'saved-auth-replies', 'reveal-auth-answer', 'move-auth-reply-to-global', 'saved-auto-setting', 'set-saved-auto-setting', 'global-auth-rules', 'save-global-auth-rule', 'remove-global-auth-rule', 'update-auth-reply', 'remove-auth-reply', 'disconnect', 'input', 'resize', 'sftp', 'copy-remote', 'context-menu',
];
contextBridge.exposeInMainWorld('promeftp', {
  ...Object.fromEntries(methods.map(name => [name, (...args) => ipcRenderer.invoke(name, ...args)])),
  onPreferences: callback => ipcRenderer.on('preferences-changed', (_event, settings) => callback(settings)),
  onCommand: callback => ipcRenderer.on('command', (_event, command) => callback(command)),
  onSession: callback => ipcRenderer.on('session', (_event, payload) => callback(payload)),
});
