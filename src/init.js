/**
 * `annotatr init`: set up the project in the current directory in one step.
 *
 * Registers annotatr's hooks in ./.claude/settings.json and installs the
 * skills annotatr ships into ./.claude/skills/. Both steps are idempotent, and
 * both report what they changed rather than doing it silently.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSettingsPath, setupHooks } from './setup-hooks.js';

/** The skills annotatr ships, one directory per skill. */
export const SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url));

/**
 * Where a project's skills live.
 *
 * @param {string} cwd
 */
export function projectSkillsDir(cwd) {
  return join(cwd, '.claude', 'skills');
}

/**
 * @typedef {object} SkillFileReport
 * @property {string} path Path relative to the skills directory, with forward slashes.
 * @property {'added'|'updated'|'unchanged'} action
 */

/**
 * Every file under a skills directory, relative to it, sorted.
 *
 * @param {string} skillsDir
 * @returns {Promise<string[]>}
 */
export async function listSkillFiles(skillsDir = SKILLS_DIR) {
  const entries = await readdir(skillsDir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(skillsDir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

/**
 * Copy the shipped skills into a project's skills directory. Files already
 * identical are left alone; files that differ are overwritten, because the
 * shipped copy is the one annotatr maintains. Files that are not annotatr's
 * are never touched.
 *
 * @param {{ cwd: string, skillsDir?: string, dryRun?: boolean }} options
 * @returns {Promise<SkillFileReport[]>}
 */
export async function installSkills({ cwd, skillsDir = SKILLS_DIR, dryRun = false }) {
  const targetDir = projectSkillsDir(cwd);
  /** @type {SkillFileReport[]} */
  const report = [];
  for (const path of await listSkillFiles(skillsDir)) {
    const source = await readFile(join(skillsDir, ...path.split('/')));
    const target = join(targetDir, ...path.split('/'));
    /** @type {Buffer|null} */
    let existing = null;
    try {
      existing = await readFile(target);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
    }
    if (existing !== null && existing.equals(source)) {
      report.push({ path, action: 'unchanged' });
      continue;
    }
    if (!dryRun) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    report.push({ path, action: existing === null ? 'added' : 'updated' });
  }
  return report;
}

/**
 * Run `annotatr init`.
 *
 * @param {{ cwd: string, binPath: string, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, dryRun?: boolean, skillsDir?: string }} options
 * @returns {Promise<number>} Exit code.
 */
export async function init({ cwd, binPath, stdout, stderr, dryRun = false, skillsDir = SKILLS_DIR }) {
  const hooksExit = await setupHooks({ settingsPath: projectSettingsPath(cwd), binPath, stdout, stderr, dryRun });
  if (hooksExit !== 0) return hooksExit;

  const report = await installSkills({ cwd, skillsDir, dryRun });
  const suffix = dryRun ? ' (dry run)' : '';
  for (const { path, action } of report) {
    stdout.write(`skill ${path}: ${action}${suffix}\n`);
  }
  const written = report.some(({ action }) => action !== 'unchanged');
  const skillsDirForDisplay = projectSkillsDir(cwd);
  if (written) stdout.write(`${dryRun ? 'Would write' : 'Wrote'} ${skillsDirForDisplay}\n`);
  else stdout.write(`${skillsDirForDisplay} is up to date\n`);
  return 0;
}
