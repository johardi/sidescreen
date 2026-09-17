import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BIN, runCli, tempDir } from './helpers.js';
import { SKILLS_DIR, listSkillFiles } from '../src/init.js';
import { hookCommand } from '../src/setup-hooks.js';
import { EMISSION_HEADER } from '../src/carry-back.js';

/** @param {string} path */
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

/** @param {string} path */
const exists = (path) => access(path).then(() => true, () => false);

test('init registers the Stop hook and installs the shipped skills under the invoking directory', async (t) => {
  const cwd = await tempDir(t);
  const result = await runCli(['init'], { cwd });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Stop: added/);
  assert.match(result.stdout, /skill sidescreen\/SKILL\.md: added/);

  const settings = await readJson(join(cwd, '.claude', 'settings.json'));
  const stopHooks = settings.hooks.Stop.flatMap((/** @type {{ hooks: { command: string }[] }} */ group) => group.hooks);
  assert.deepEqual(stopHooks, [{ type: 'command', command: hookCommand(BIN, 'ingest') }]);

  const shipped = await listSkillFiles();
  assert.ok(shipped.includes('sidescreen/SKILL.md'), 'sidescreen ships its own skill');
  for (const path of shipped) {
    const installed = await readFile(join(cwd, '.claude', 'skills', path));
    const source = await readFile(join(SKILLS_DIR, path));
    assert.ok(installed.equals(source), `${path} is installed byte-for-byte`);
  }
});

test('running init twice changes nothing the second time', async (t) => {
  const cwd = await tempDir(t);
  const first = await runCli(['init'], { cwd });
  assert.equal(first.code, 0, first.stderr);
  const second = await runCli(['init'], { cwd });
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /Stop: unchanged/);
  assert.match(second.stdout, /skill sidescreen\/SKILL\.md: unchanged/);
  assert.match(second.stdout, /is up to date/);
  const settings = await readJson(join(cwd, '.claude', 'settings.json'));
  assert.equal(settings.hooks.Stop.length, 1);
});

test('a locally edited copy of a shipped skill is restored and reported as updated', async (t) => {
  const cwd = await tempDir(t);
  const first = await runCli(['init'], { cwd });
  assert.equal(first.code, 0, first.stderr);
  const skillPath = join(cwd, '.claude', 'skills', 'sidescreen', 'SKILL.md');
  await writeFile(skillPath, '# edited locally\n', 'utf8');

  const second = await runCli(['init'], { cwd });
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /skill sidescreen\/SKILL\.md: updated/);
  assert.equal(await readFile(skillPath, 'utf8'), await readFile(join(SKILLS_DIR, 'sidescreen', 'SKILL.md'), 'utf8'));
});

test('skills that are not sidescreen\'s are left alone', async (t) => {
  const cwd = await tempDir(t);
  const otherSkill = join(cwd, '.claude', 'skills', 'someone-else', 'SKILL.md');
  await mkdir(join(cwd, '.claude', 'skills', 'someone-else'), { recursive: true });
  await writeFile(otherSkill, '---\nname: someone-else\n---\n', 'utf8');

  const result = await runCli(['init'], { cwd });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /someone-else/);
  assert.equal(await readFile(otherSkill, 'utf8'), '---\nname: someone-else\n---\n');
});

test('init --dry-run reports without creating anything', async (t) => {
  const cwd = await tempDir(t);
  const result = await runCli(['init', '--dry-run'], { cwd });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Stop: added \(dry run\)/);
  assert.match(result.stdout, /skill sidescreen\/SKILL\.md: added \(dry run\)/);
  assert.match(result.stdout, /Would write/);
  assert.equal(await exists(join(cwd, '.claude')), false);
});

test('init stops before installing skills when the project settings file cannot be parsed', async (t) => {
  const cwd = await tempDir(t);
  await mkdir(join(cwd, '.claude'), { recursive: true });
  const broken = '{ "hooks": ';
  await writeFile(join(cwd, '.claude', 'settings.json'), broken, 'utf8');

  const result = await runCli(['init'], { cwd });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /could not parse .*settings\.json/);
  assert.equal(await readFile(join(cwd, '.claude', 'settings.json'), 'utf8'), broken);
  assert.equal(await exists(join(cwd, '.claude', 'skills')), false);
});

test('init rejects unknown options', async (t) => {
  const cwd = await tempDir(t);
  const result = await runCli(['init', '--global'], { cwd });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown option "--global"/);
  assert.equal(await exists(join(cwd, '.claude')), false);
});

test('every shipped skill has frontmatter whose name matches its directory', async () => {
  const files = await listSkillFiles();
  const skillFiles = files.filter((path) => path.endsWith('/SKILL.md'));
  assert.ok(skillFiles.length > 0);
  for (const path of skillFiles) {
    const dir = path.slice(0, -'/SKILL.md'.length);
    const text = await readFile(join(SKILLS_DIR, path), 'utf8');
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, `${path} starts with frontmatter`);
    assert.match(frontmatter[1], new RegExp(`^name: ${dir}$`, 'm'), `${path} is named after its directory`);
    assert.match(frontmatter[1], /^description: \S/m, `${path} has a description`);
  }
});

test('the shipped skill quotes the carry-back header exactly as the CLI emits it', async () => {
  const skill = await readFile(join(SKILLS_DIR, 'sidescreen', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes(`"${EMISSION_HEADER}"`), 'SKILL.md must quote EMISSION_HEADER verbatim, in double quotes');
});
