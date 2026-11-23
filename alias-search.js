// Matching for the OpenSSH alias search. An alias matches when every word of the query appears, case-insensitively,
// in its name, HostName or User. Details are optional: an alias whose details are unknown is matched by name only.
// Loaded as a browser script and, in tests, as a module.

// The searchable values of an alias, lower-cased. Empty values (unknown details) are left out.
function aliasSearchFields(name, details = {}) {
  return [name, details?.hostname, details?.user]
    .map(value => String(value ?? '').toLowerCase())
    .filter(Boolean);
}

// True when the query is empty, or each whitespace-separated word of it is a part of some field of the alias.
function aliasMatchesSearch(query, name, details) {
  const words = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const fields = aliasSearchFields(name, details);
  return words.every(word => fields.some(field => field.includes(word)));
}

if (typeof module !== 'undefined') module.exports = { aliasSearchFields, aliasMatchesSearch };
