// What PromeFTP does with a host key that OpenSSH asks about, from the keys the user trusted in the app.
//
// trustedHostKeys maps 'host:<host>' (OpenSSH's own name for the server, such as '[1.2.3.4]:2222') to the last
// fingerprint the user trusted. hostKeyAutoAccept marks the servers for which the user chose "Don't ask again for this
// server": their key is accepted without a dialog even when it differs from the saved one.
//
// Returns null when the user must be asked. Otherwise { kind, save }:
//   kind 'verified': the key is the one the user trusted.
//   kind 'changed':  the key differs, but the user chose not to be asked again for this server.
//   save: the fingerprint to store under scope (a legacy match or a changed key), or '' when nothing changes.
function savedHostKeyDecision({ trustedHostKeys = {}, hostKeyAutoAccept = {}, scope, legacyScope, fingerprint }) {
  if (!scope || !fingerprint) return null;
  const saved = trustedHostKeys[scope];
  if (saved === fingerprint) return { kind: 'verified', save: '' };
  if (!saved && legacyScope && trustedHostKeys[legacyScope] === fingerprint) return { kind: 'verified', save: fingerprint };
  if (hostKeyAutoAccept[scope] === true) return { kind: 'changed', save: fingerprint };
  return null;
}

// Records the user's choice in the dialog. The fingerprint is always saved, so the agent and the host list see the key
// the user trusted. alwaysAccept turns on "Don't ask again for this server".
function rememberHostKey(state, scope, fingerprint, alwaysAccept) {
  (state.trustedHostKeys ??= {})[scope] = fingerprint;
  if (alwaysAccept) (state.hostKeyAutoAccept ??= {})[scope] = true;
}

module.exports = { savedHostKeyDecision, rememberHostKey };
