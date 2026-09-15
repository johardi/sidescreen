/**
 * `annotatr setup hooks`: register annotatr's hooks in a Claude Code settings file.
 *
 * Registration is idempotent. An existing annotatr entry for an event is
 * updated in place rather than duplicated, and every unrelated setting is
 * preserved byte-for-byte in meaning.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * @typedef {object} HookRegistration
 * @property {string} event Claude Code hook event name.
 * @property {string} subcommand The annotatr subcommand the hook runs.
 */

/** Hooks annotatr needs. */
export const HOOK_REGISTRATIONS = /** @type {readonly HookRegistration[]} */ ([
  { event: 'Stop', subcommand: 'ingest' },
]);

/**
 * @typedef {object} HookCommand
 * @property {'command'} type
 * @property {string} command
 * @property {number} [timeout]
 */

/**
 * @typedef {object} HookGroup
 * @property {string} [matcher]
 * @property {HookCommand[]} hooks
 */

/**
 * @typedef {object} RegistrationReport
 * @property {string} event
 * @property {'added'|'updated'|'unchanged'} action
 * @property {string} command
 */

/**
 * Default user-scope settings file.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} [home]
 */
export function defaultSettingsPath(env, home = homedir()) {
  return join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json');
}

/**
 * The shell command a hook runs for a subcommand.
 *
 * @param {string} binPath Absolute path to bin/annotatr.js.
 * @param {string} subcommand
 */
export function hookCommand(binPath, subcommand) {
  return `node ${shellQuote(binPath)} ${subcommand}`;
}

/**
 * Whether a hook command is annotatr running `subcommand`, however it is invoked.
 *
 * @param {string} command
 * @param {string} subcommand
 */
export function isAnnotatrHookCommand(command, subcommand) {
  const pattern = new RegExp(
    String.raw`(?:^|[\s"'/\\])annotatr(?:\.js)?["']?\s+${escapeRegExp(subcommand)}(?:\s|$)`,
  );
  return pattern.test(command);
}

/**
 * Register annotatr's hooks in a settings object. Pure: returns a new object.
 *
 * @param {Record<string, unknown>} settings Parsed settings file contents.
 * @param {{ binPath: string, registrations?: readonly HookRegistration[] }} options
 * @returns {{ settings: Record<string, unknown>, report: RegistrationReport[] }}
 */
export function registerHooks(settings, { binPath, registrations = HOOK_REGISTRATIONS }) {
  const existingHooks = settings.hooks;
  if (existingHooks !== undefined && (existingHooks === null || typeof existingHooks !== 'object' || Array.isArray(existingHooks))) {
    throw new SetupHooksError('Settings key "hooks" exists but is not an object');
  }
  /** @type {Record<string, unknown>} */
  const hooks = { .../** @type {Record<string, unknown>|undefined} */ (existingHooks) };
  /** @type {RegistrationReport[]} */
  const report = [];

  for (const { event, subcommand } of registrations) {
    const command = hookCommand(binPath, subcommand);
    const current = hooks[event];
    if (current !== undefined && !Array.isArray(current)) {
      throw new SetupHooksError(`Settings key "hooks.${event}" exists but is not an array`);
    }
    /** @type {HookGroup[]} */
    const groups = (/** @type {HookGroup[]|undefined} */ (current) ?? []).map((group) => ({
      ...group,
      hooks: Array.isArray(group.hooks) ? group.hooks.map((hook) => ({ ...hook })) : [],
    }));

    const match = findAnnotatrHook(groups, subcommand);
    if (match === null) {
      groups.push({ hooks: [{ type: 'command', command }] });
      report.push({ event, action: 'added', command });
    } else if (match.command !== command) {
      match.command = command;
      report.push({ event, action: 'updated', command });
    } else {
      report.push({ event, action: 'unchanged', command });
    }
    hooks[event] = groups;
  }

  return { settings: { ...settings, hooks }, report };
}

/**
 * @param {HookGroup[]} groups
 * @param {string} subcommand
 * @returns {HookCommand|null}
 */
function findAnnotatrHook(groups, subcommand) {
  for (const group of groups) {
    for (const hook of group.hooks) {
      if (hook && typeof hook.command === 'string' && isAnnotatrHookCommand(hook.command, subcommand)) {
        return hook;
      }
    }
  }
  return null;
}

export class SetupHooksError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SetupHooksError';
  }
}

/**
 * Read, update, and write a settings file.
 *
 * @param {{ settingsPath: string, binPath: string, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, dryRun?: boolean }} options
 * @returns {Promise<number>} Exit code.
 */
export async function setupHooks({ settingsPath, binPath, stdout, stderr, dryRun = false }) {
  /** @type {Record<string, unknown>} */
  let settings = {};
  /** @type {string|null} */
  let existingText = null;
  try {
    existingText = await readFile(settingsPath, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  }
  if (existingText !== null) {
    try {
      const parsed = JSON.parse(existingText);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        stderr.write(`annotatr setup hooks: ${settingsPath} does not contain a JSON object; leaving it untouched\n`);
        return 1;
      }
      settings = parsed;
    } catch (error) {
      stderr.write(
        `annotatr setup hooks: could not parse ${settingsPath} (${/** @type {Error} */ (error).message}); leaving it untouched\n`,
      );
      return 1;
    }
  }

  /** @type {ReturnType<typeof registerHooks>} */
  let result;
  try {
    result = registerHooks(settings, { binPath });
  } catch (error) {
    if (error instanceof SetupHooksError) {
      stderr.write(`annotatr setup hooks: ${error.message} in ${settingsPath}; leaving it untouched\n`);
      return 1;
    }
    throw error;
  }

  if (!dryRun) {
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, JSON.stringify(result.settings, null, 2) + '\n', 'utf8');
  }

  for (const { event, action, command } of result.report) {
    stdout.write(`${event}: ${action}${dryRun ? ' (dry run)' : ''}\n  ${command}\n`);
  }
  stdout.write(`${dryRun ? 'Would write' : 'Wrote'} ${settingsPath}\n`);
  return 0;
}

/** @param {string} value */
function shellQuote(value) {
  return /^[A-Za-z0-9_./-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether any settings file Claude Code would load from here registers the
 * ingest hook. Used by the surface to say when ingestion is unavailable.
 *
 * @param {{ env: NodeJS.ProcessEnv, cwd: string }} options
 * @returns {Promise<boolean>}
 */
export async function isIngestHookRegistered({ env, cwd }) {
  const candidates = [
    defaultSettingsPath(env),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ];
  for (const path of candidates) {
    /** @type {string} */
    let text;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const hooks = /** @type {{ hooks?: { Stop?: HookGroup[] } }} */ (parsed)?.hooks;
    const groups = hooks?.Stop;
    if (Array.isArray(groups) && findAnnotatrHook(groups, 'ingest') !== null) return true;
  }
  return false;
}
