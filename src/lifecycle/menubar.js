/**
 * The macOS menu bar item that accompanies a background server.
 *
 * `start` launches it after every successful report. The item is a
 * JavaScript for Automation script under menubar/, run by macOS's own
 * interpreter, so no compiled code of ours is involved; a program named by
 * SIDESCREEN_MENUBAR_BIN is launched instead when set, with the same
 * arguments. The item deduplicates itself per store, so launching is
 * unconditional here.
 */

import { spawn } from 'node:child_process';
import { access, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MENUBAR_LOG_FILE_NAME = 'menubar.log';
export const OSASCRIPT = '/usr/bin/osascript';
export const DEFAULT_SCRIPT_PATH = fileURLToPath(new URL('../../menubar/sidescreen-menubar.js', import.meta.url));
const OFF_VALUES = new Set(['off', '0', 'false', 'no']);

/**
 * Whether the item is launched here, and if not, why.
 *
 * @param {{ platform: NodeJS.Platform, env: NodeJS.ProcessEnv }} options
 * @returns {{ launch: true } | { launch: false, reason: 'platform'|'disabled' }}
 */
export function menubarDecision({ platform, env }) {
  if (platform !== 'darwin') return { launch: false, reason: 'platform' };
  if (OFF_VALUES.has((env.SIDESCREEN_MENUBAR ?? '').trim().toLowerCase())) return { launch: false, reason: 'disabled' };
  return { launch: true };
}

/**
 * The program that plays the item and the arguments before the item's own:
 * the interpreter and the shipped script, or the program SIDESCREEN_MENUBAR_BIN names.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ file: string, args: string[], script: string|null }} `script` is the shipped script when it is what runs.
 */
export function menubarCommand(env) {
  if (env.SIDESCREEN_MENUBAR_BIN) return { file: env.SIDESCREEN_MENUBAR_BIN, args: [], script: null };
  return { file: OSASCRIPT, args: ['-l', 'JavaScript', DEFAULT_SCRIPT_PATH], script: DEFAULT_SCRIPT_PATH };
}

/**
 * Launch the item for the server on `port`, detached, with absolute paths as
 * arguments so it never looks anything up on PATH, and with this environment
 * so its Start and Stop act on the same store.
 *
 * @param {{ port: number, stateDir: string, env: NodeJS.ProcessEnv, stderr: NodeJS.WritableStream, binPath: string, execPath?: string, platform?: NodeJS.Platform }} options
 * @returns {Promise<boolean>} Whether a launch was attempted.
 */
export async function launchMenubar({ port, stateDir, env, stderr, binPath, execPath = process.execPath, platform = process.platform }) {
  if (!menubarDecision({ platform, env }).launch) return false;
  const command = menubarCommand(env);
  const required = command.script ?? command.file;
  try {
    await access(required);
  } catch {
    stderr.write(
      command.script !== null
        ? `sidescreen: the menu bar item is unavailable: ${required} is missing; reinstall sidescreen, or set SIDESCREEN_MENUBAR=off to silence this.\n`
        : `sidescreen: the menu bar item is unavailable: SIDESCREEN_MENUBAR_BIN names ${required}, which is missing; fix it, or set SIDESCREEN_MENUBAR=off to silence this.\n`,
    );
    return false;
  }
  await mkdir(stateDir, { recursive: true });
  // Appended, not truncated: every `start` launches an item, and the one that
  // finds another running must not wipe the log of the one that stays.
  const log = await open(join(stateDir, MENUBAR_LOG_FILE_NAME), 'a');
  try {
    const child = spawn(command.file, [...command.args, '--port', String(port), '--state-dir', stateDir, '--node', execPath, '--bin', binPath], {
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
      env,
      windowsHide: true,
    });
    child.once('error', (error) => stderr.write(`sidescreen: the menu bar item could not be launched: ${error.message}\n`));
    child.unref();
  } finally {
    await log.close();
  }
  return true;
}
