const { stripVTControlCharacters } = require('node:util');
const { RE2 } = require('re2-wasm');

const tailLimit = 8192;

function compileTrigger(pattern) {
  if (typeof pattern !== 'string' || !pattern.trim() || pattern.length > 512) {
    throw Error('Enter a regular expression of 1–512 characters.');
  }
  return new RE2(pattern, 'gu');
}

function visibleOutput(value) {
  return stripVTControlCharacters(value).replaceAll('\r', '');
}

function scanTriggers(previous, chunk, rules) {
  const prefix = visibleOutput(previous);
  const matches = [];
  // Keep boundaries across PTY chunks, including split escape sequences.
  for (let offset = 0; offset < chunk.length; offset += tailLimit) {
    const part = chunk.slice(offset, offset + tailLimit);
    const before = offset ? visibleOutput(previous) : prefix;
    const combined = previous + part;
    const after = visibleOutput(combined);
    previous = combined.slice(-tailLimit);
    let boundary = before.length;
    if (!after.startsWith(before)) {
      boundary = 0;
      while (boundary < before.length && before[boundary] === after[boundary]) boundary++;
    }
    if (after.length <= boundary) continue;
    for (const rule of rules) {
      if (matches.includes(rule)) continue;
      const { regex } = rule;
      regex.lastIndex = 0;
      for (let match; (match = regex.exec(after));) {
        if (match[0].length && match.index + match[0].length > boundary) {
          matches.push(rule);
          break;
        }
        if (!match[0].length) {
          if (regex.lastIndex >= after.length) break;
          regex.lastIndex += after.codePointAt(regex.lastIndex) > 0xffff ? 2 : 1;
        }
      }
    }
  }
  return { tail: previous, matches };
}

module.exports = { compileTrigger, scanTriggers };
