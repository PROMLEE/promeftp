const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, verify, randomUUID } = require('node:crypto');
const { protocol, problem } = require('./agent-service.cjs');

const agentTargets = {
  codex: ['Codex', '.agents/skills', '.agents/skills'],
  claude: ['Claude Code', '.claude/skills', '.claude/skills'],
  cursor: ['Cursor', '.cursor/skills', '.cursor/skills'],
  gemini: ['Gemini CLI', '.gemini/skills', '.gemini/skills'],
  copilot: ['GitHub Copilot CLI', '.copilot/skills', '.github/skills'],
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bundled = path.join(__dirname, 'agent-skills/promeftp/SKILL.md');
const manifestURL = 'https://raw.githubusercontent.com/PROMLEE/promeftp/main/updates/agent-skills.json';

async function detectAgents(home) {
  const commands = { codex: 'codex', claude: 'claude', cursor: 'cursor', gemini: 'gemini', copilot: 'copilot' };
  const appNames = { codex: 'Codex', claude: 'Claude', cursor: 'Cursor' };
  const binDirs = [...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local/bin')].filter(path.isAbsolute);
  const exists = file => fs.access(file).then(() => true, () => false);
  return Promise.all(Object.entries(agentTargets).map(async ([id, [name, userDirectory]]) => {
    const agentHome = id === 'codex' ? '.codex' : userDirectory.split('/')[0];
    const possible = [path.join(home, agentHome), ...binDirs.map(dir => path.join(dir, commands[id]))];
    if (appNames[id]) possible.push('/Applications/' + appNames[id] + '.app', path.join(home, 'Applications', appNames[id] + '.app'));
    return { id, name, detected: (await Promise.all(possible.map(exists))).some(Boolean) };
  }));
}

async function fetchLimited(url, limit) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (response.status === 404) return null;
  if (!response.ok || !response.body) throw problem('SKILL_DOWNLOAD_FAILED');
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw problem('SKILL_DOWNLOAD_FAILED');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function packageFor(target, appVersion, publicKey) {
  let envelope;
  try { envelope = await fetchLimited(manifestURL, 65536); }
  catch (error) { if (error.agentCode) throw error; }
  if (!envelope) return { bytes: await fs.readFile(bundled), version: appVersion };
  try {
    const { manifest, signature } = JSON.parse(envelope.toString());
    const payload = Buffer.from(manifest, 'base64');
    const key = Buffer.concat([Buffer.from('302a300506032b6570032100','hex'), Buffer.from(publicKey,'base64')]);
    if (!verify(null, payload, { key, format: 'der', type: 'spki' }, Buffer.from(signature,'base64'))) throw Error();
    const entry = JSON.parse(payload.toString()).packages.find(p => p.protocol === protocol && p.targets.includes(target) &&
      p.appVersion === appVersion && /^\d+\.\d+\.\d+$/.test(p.version) && /^[a-f0-9]{64}$/.test(p.sha256));
    if (!entry) return { bytes: await fs.readFile(bundled), version: appVersion };
    const root = 'https://raw.githubusercontent.com/PROMLEE/promeftp/v' + entry.release + '/';
    if (!/^\d+\.\d+\.\d+$/.test(entry.release) || entry.url !== root + 'skills/promeftp/SKILL.md') throw Error();
    const bytes = await fetchLimited(entry.url, 65536);
    if (!bytes || sha(bytes) !== entry.sha256) throw Error();
    return { bytes, version: entry.version };
  } catch { throw problem('SKILL_SIGNATURE_OR_INTEGRITY'); }
}

async function safeDirectory(base, relative, create) {
  let directory = base;
  for (const segment of relative.split('/')) {
    directory = path.join(directory, segment);
    let info = await fs.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!info) {
      if (!create) return null;
      await fs.mkdir(directory, { mode: 0o700 });
      info = await fs.lstat(directory);
    }
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o022)) throw problem('UNSAFE_SKILL_PATH');
  }
  return directory;
}

async function manageSkill({ target, action, base, project = false, appVersion, publicKey, receipt }) {
  if (!Object.hasOwn(agentTargets, target) || !['install','remove'].includes(action)) throw problem('INVALID_REQUEST');
  const root = await fs.realpath(base);
  const relative = agentTargets[target][project ? 2 : 1] + '/promeftp';
  const directory = await safeDirectory(root, relative, action === 'install');
  const file = directory && path.join(directory, 'SKILL.md');
  if (!file) return { removed: true };
  const stat = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (stat && (!stat.isFile() || stat.uid !== process.getuid() || stat.size > 65536)) throw problem('UNMANAGED_SKILL');
  if (stat && (!receipt || sha(await fs.readFile(file)) !== receipt.sha256)) throw problem('UNMANAGED_SKILL');
  if (action === 'remove') {
    if (stat) await fs.unlink(file);
    return { removed: true };
  }
  const { bytes, version } = await packageFor(target, appVersion, publicKey);
  const hash = sha(bytes);
  if (receipt && version.localeCompare(receipt.version, 'en', { numeric: true }) < 0) {
    if (stat) return receipt;
    throw problem('SKILL_VERSION_MISMATCH');
  }
  await safeDirectory(root, relative, false);
  const temporary = path.join(directory, '.promeftp-' + randomUUID());
  await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  try {
    if (stat) {
      const current = await fs.lstat(file);
      if (!current.isFile() || current.ino !== stat.ino || sha(await fs.readFile(file)) !== receipt.sha256) throw problem('UNMANAGED_SKILL');
      await fs.rename(temporary, file);
    } else await fs.link(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
  return { version, sha256: hash, path: file };
}
module.exports = { manageSkill, agentTargets, detectAgents };
