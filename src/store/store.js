/**
 * The persisted store: a single JSON file under a state directory.
 *
 * Every mutation is a read-modify-write under two locks. An in-process mutex
 * serializes callers inside one process, and a directory lock on disk
 * serializes across processes, because every Stop hook runs its own
 * `sidescreen ingest` process and two turns can finish at the same instant.
 *
 * Schema history:
 * - Version 2 added the `sessions` record.
 * - Version 3 added `model` to turns and `backend` and `model` to exchanges,
 *   made a turn's directory its session's, and dropped the thread-level copy
 *   of the sub-agent session id.
 *
 * An older file is read as is and upgraded in memory, and is copied to a
 * backup once before the first write at the current version, so rolling back
 * the code is restoring one file.
 */

import { constants, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Mutex } from './mutex.js';
import { deriveSessions } from './sessions.js';

/** @typedef {import('../types.js').State} State */

export const STORE_FILE_NAME = 'store.json';
export const STORE_VERSION = 3;
const SUPPORTED_VERSIONS = new Set([1, 2, STORE_VERSION]);
const LOCK_DIR_NAME = 'store.lock';
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

/** The backend that minted every sub-agent session before exchanges recorded one. */
const LEGACY_BACKEND = /** @type {import('../dispatch/backends.js').Backend} */ ('codex');

export class StoreError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'StoreError';
  }
}

/**
 * Resolve the state directory from the environment.
 *
 * `SIDESCREEN_STATE_DIR` wins. Otherwise `$XDG_STATE_HOME/sidescreen`, falling
 * back to `~/.local/state/sidescreen`.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} [home]
 * @returns {string}
 */
export function defaultStateDir(env, home = homedir()) {
  if (env.SIDESCREEN_STATE_DIR) return env.SIDESCREEN_STATE_DIR;
  const xdgStateHome = env.XDG_STATE_HOME || join(home, '.local', 'state');
  return join(xdgStateHome, 'sidescreen');
}

/**
 * The file an older store is copied to before the first write upgrades it.
 *
 * @param {number} version The version found on disk.
 */
export function backupFileName(version) {
  return `store.v${version}.bak`;
}

/** @returns {State} */
export function emptyState() {
  return { version: STORE_VERSION, turns: {}, sessions: {}, threads: {}, carryBack: {} };
}

export class Store {
  #mutex = new Mutex();

  /** @param {string} stateDir */
  constructor(stateDir) {
    this.stateDir = stateDir;
    this.path = join(stateDir, STORE_FILE_NAME);
    this.lockPath = join(stateDir, LOCK_DIR_NAME);
  }

  /**
   * Read the current state from disk. A missing file is an empty store.
   * A file that exists but cannot be parsed is an error, never silently reset.
   *
   * @returns {Promise<State>}
   */
  async read() {
    return (await this.#readWithVersion()).state;
  }

  /**
   * Apply `mutator` to the latest state and persist the result atomically.
   *
   * @param {(state: State) => void|Promise<void>} mutator
   * @returns {Promise<State>} The state as written.
   */
  async update(mutator) {
    return this.#mutex.runExclusive(async () => {
      await mkdir(this.stateDir, { recursive: true });
      return withDirectoryLock(this.lockPath, async () => {
        const { state, diskVersion } = await this.#readWithVersion();
        if (diskVersion !== null && diskVersion < STORE_VERSION) await this.#backUp(diskVersion);
        await mutator(state);
        await writeAtomically(this.path, JSON.stringify(state, null, 2) + '\n');
        return state;
      });
    });
  }

  /**
   * @returns {Promise<{ state: State, diskVersion: number|null }>} The version found on disk, or null with no file.
   */
  async #readWithVersion() {
    /** @type {string} */
    let text;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return { state: emptyState(), diskVersion: null };
      throw error;
    }
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new StoreError(`Store file ${this.path} is not valid JSON: ${/** @type {Error} */ (error).message}`);
    }
    return normalize(parsed, this.path);
  }

  /**
   * Copy an older file aside, once. An existing backup is never overwritten.
   *
   * @param {number} diskVersion
   */
  async #backUp(diskVersion) {
    try {
      await copyFile(this.path, join(this.stateDir, backupFileName(diskVersion)), constants.COPYFILE_EXCL);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
    }
  }
}

/**
 * @param {unknown} parsed
 * @param {string} path
 * @returns {{ state: State, diskVersion: number }}
 */
function normalize(parsed, path) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StoreError(`Store file ${path} does not contain an object`);
  }
  const record = /** @type {Record<string, unknown>} */ (parsed);
  const version = record.version;
  if (typeof version !== 'number' || !SUPPORTED_VERSIONS.has(version)) {
    throw new StoreError(`Store file ${path} has unsupported version ${String(version)}`);
  }
  const base = emptyState();
  const turns = /** @type {Record<string, import('../types.js').Turn>|null} */ (asRecord(record.turns)) ?? base.turns;
  const threads = /** @type {State['threads']|null} */ (asRecord(record.threads)) ?? base.threads;
  const carryBack = /** @type {State['carryBack']|null} */ (asRecord(record.carryBack)) ?? base.carryBack;
  const sessions = version === 1 ? deriveSessions(turns) : (/** @type {State['sessions']|null} */ (asRecord(record.sessions)) ?? deriveSessions(turns));
  return { state: upgrade({ version: STORE_VERSION, turns, sessions, threads, carryBack }), diskVersion: version };
}

/**
 * Bring records written by an older version up to what the current one
 * guarantees. Idempotent, so it runs on every read.
 *
 * @param {State} state
 * @returns {State}
 */
function upgrade(state) {
  for (const turn of Object.values(state.turns)) {
    if (turn.model === undefined) turn.model = null;
    const session = state.sessions[turn.sessionId];
    if (session && turn.cwd !== session.cwd) turn.cwd = session.cwd;
  }
  for (const thread of Object.values(state.threads)) {
    delete (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (thread))).subAgentSessionId;
    for (const exchange of thread.exchanges ?? []) {
      if (exchange.backend === undefined) exchange.backend = LEGACY_BACKEND;
      if (exchange.model === undefined) exchange.model = null;
    }
  }
  return state;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>|null}
 */
function asRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * Write via a temporary file and rename, so readers never observe a partial file.
 *
 * @param {string} path
 * @param {string} contents
 */
async function writeAtomically(path, contents) {
  const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(temporary, contents, 'utf8');
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Hold a cross-process lock while `fn` runs. `mkdir` is atomic on every
 * platform Node supports, which is what makes the directory a usable lock.
 *
 * @template T
 * @param {string} lockPath
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withDirectoryLock(lockPath, fn) {
  const started = Date.now();
  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
      if (await isStale(lockPath)) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        throw new StoreError(`Timed out waiting for store lock ${lockPath}`);
      }
      await sleep(5 + Math.random() * 20);
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

/**
 * @param {string} lockPath
 * @returns {Promise<boolean>}
 */
async function isStale(lockPath) {
  try {
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}
