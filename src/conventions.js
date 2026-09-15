/**
 * The user's conventions, gathered for forwarding to sub-agents.
 *
 * A sub-agent does not read the user's global agent instructions, so anything
 * it should honor has to travel inside the prompt. This is the one place that
 * decides what travels.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const MAX_CHARS_PER_FILE = 12_000;

/**
 * Files consulted when ANNOTATR_CONVENTIONS_FILES is not set.
 *
 * @param {string} home
 * @param {string} cwd
 * @returns {string[]}
 */
export function defaultConventionFiles(home, cwd) {
  return [join(home, '.claude', 'CLAUDE.md'), join(cwd, 'CLAUDE.md'), join(cwd, 'AGENTS.md')];
}

/**
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, home?: string }} options
 * @returns {Promise<{ text: string, sources: string[] }>}
 */
export async function loadConventions({ cwd, env, home = homedir() }) {
  const configured = env.ANNOTATR_CONVENTIONS_FILES;
  const paths = configured !== undefined ? configured.split(delimiter).filter((path) => path !== '') : defaultConventionFiles(home, cwd);

  /** @type {string[]} */
  const sections = [];
  /** @type {string[]} */
  const sources = [];
  for (const path of paths) {
    /** @type {string} */
    let text;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    const trimmed = text.trim();
    if (trimmed === '') continue;
    const body = trimmed.length > MAX_CHARS_PER_FILE ? `${trimmed.slice(0, MAX_CHARS_PER_FILE)}\n\n[truncated]` : trimmed;
    sections.push(`### From ${path}\n\n${body}`);
    sources.push(path);
  }
  return { text: sections.join('\n\n'), sources };
}
