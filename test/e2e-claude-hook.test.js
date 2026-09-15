/**
 * End-to-end: a real `claude -p` run, with a generated settings file that
 * registers the real ingest command as its Stop hook, lands the turn in the store.
 *
 * This spends API credit and needs a logged-in `claude`, so it only runs when
 * ANNOTATR_E2E_CLAUDE=1 is set. Otherwise it is skipped with a reason.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BIN, tempDir } from './helpers.js';
import { registerHooks } from '../src/setup-hooks.js';
import { Store } from '../src/store.js';

const execFileAsync = promisify(execFile);

const optedIn = process.env.ANNOTATR_E2E_CLAUDE === '1';
const claudeAvailable = await execFileAsync('claude', ['--version']).then(() => true, () => false);

/**
 * Environment for a nested claude run: drop the markers of the session this
 * test may itself be running inside, so the child starts fresh.
 *
 * @param {Record<string, string>} extra
 * @returns {NodeJS.ProcessEnv}
 */
function childEnv(extra) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_') || key === 'CLAUDE_PID' || key === 'CLAUDE_EFFORT') continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

/** @param {string} path */
async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

test(
  'a claude -p turn reaches the store through the Stop hook',
  { skip: !optedIn ? 'set ANNOTATR_E2E_CLAUDE=1 to run against a real claude' : !claudeAvailable ? 'claude is not on PATH' : false },
  async (t) => {
    const workDir = await tempDir(t, 'annotatr-e2e-');
    const stateDir = join(workDir, 'state');
    const settingsPath = join(workDir, 'settings.json');
    const userSettingsPath = join(homedir(), '.claude', 'settings.json');
    const userSettingsBefore = await readIfExists(userSettingsPath);

    const { settings } = registerHooks({}, { binPath: BIN });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

    const { stdout } = await execFileAsync(
      'claude',
      ['-p', '--model', 'haiku', '--no-session-persistence', '--settings', settingsPath, 'Reply with exactly one word: banana'],
      { cwd: workDir, env: childEnv({ ANNOTATR_STATE_DIR: stateDir }), timeout: 120_000 },
    );
    assert.match(stdout, /banana/i, 'claude answered');

    const state = await new Store(stateDir).read();
    const turns = Object.values(state.turns);
    assert.equal(turns.length, 1, 'exactly one turn was ingested');
    const [turn] = turns;
    assert.match(turn.message, /banana/i, "the turn's text came through last_assistant_message");
    assert.equal(await import('node:fs/promises').then((fs) => fs.realpath(turn.cwd)), await import('node:fs/promises').then((fs) => fs.realpath(workDir)));
    assert.ok(turn.sessionId.length > 0);
    assert.ok(turn.promptId.length > 0);

    assert.equal(await readIfExists(userSettingsPath), userSettingsBefore, 'user settings were not modified');
  },
);
