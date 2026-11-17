// Bundled skill lookup in agent-skills.cjs. The app bundle has agent-skills/promeftp/SKILL.md; the source tree
// only has the published copy at skills/promeftp/SKILL.md. Both must be found when running with electron .
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { bundledSkillPaths, readFirstSkill } = require('../agent-skills.cjs');

const root = path.join(__dirname, '..');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'promeftp-skill-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('agent-skills.cjs does not load Electron', async () => {
  const source = await fs.readFile(path.join(root, 'agent-skills.cjs'), 'utf8');
  assert.doesNotMatch(source, /require\(['"]electron['"]\)/);
});

test('the bundled paths are the app-bundle location first, then the source copy', () => {
  assert.equal(bundledSkillPaths.length, 2);
  assert.equal(bundledSkillPaths[0], path.join(root, 'agent-skills/promeftp/SKILL.md'));
  assert.equal(bundledSkillPaths[1], path.join(root, 'skills/promeftp/SKILL.md'));
});

test('the source-tree fallback reads the published skill', async () => {
  const expected = await fs.readFile(path.join(root, 'skills/promeftp/SKILL.md'));
  assert.deepEqual(await readFirstSkill(bundledSkillPaths.slice(1)), expected);
});

test('the first existing path wins when both exist', async t => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, 'a'));
  await fs.mkdir(path.join(dir, 'b'));
  await fs.writeFile(path.join(dir, 'a', 'SKILL.md'), 'first');
  await fs.writeFile(path.join(dir, 'b', 'SKILL.md'), 'second');
  assert.equal((await readFirstSkill([path.join(dir, 'a', 'SKILL.md'), path.join(dir, 'b', 'SKILL.md')])).toString(), 'first');
});

test('a missing first path falls back to the second', async t => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, 'b'));
  await fs.writeFile(path.join(dir, 'b', 'SKILL.md'), 'second');
  assert.equal((await readFirstSkill([path.join(dir, 'missing', 'SKILL.md'), path.join(dir, 'b', 'SKILL.md')])).toString(), 'second');
});

test('when no candidate exists the error is ENOENT', async t => {
  const dir = await fixture(t);
  await assert.rejects(readFirstSkill([path.join(dir, 'x'), path.join(dir, 'y')]), { code: 'ENOENT' });
});

test('errors other than ENOENT are not hidden by the fallback', async t => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, 'is-a-directory'));
  await fs.mkdir(path.join(dir, 'b'));
  await fs.writeFile(path.join(dir, 'b', 'SKILL.md'), 'second');
  await assert.rejects(readFirstSkill([path.join(dir, 'is-a-directory'), path.join(dir, 'b', 'SKILL.md')]), error => error.code !== 'ENOENT');
});
