/**
 * The persisted store: a single JSON file under a state directory.
 *
 * Every mutation is a read-modify-write under two locks. An in-process mutex
 * serializes callers inside one process, and a directory lock on disk
 * serializes across processes, because every Stop hook runs its own
 * `annotatr ingest` process and two turns can finish at the same instant.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Mutex } from './mutex.js';

/** @typedef {import('./types.js').State} State */

export const STORE_FILE_NAME = 'store.json';
const LOCK_DIR_NAME = 'store.lock';
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

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
 * `ANNOTATR_STATE_DIR` wins. Otherwise `$XDG_STATE_HOME/annotatr`, falling
 * back to `~/.local/state/annotatr`.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} [home]
 * @returns {string}
 */
export function defaultStateDir(env, home = homedir()) {
  if (env.ANNOTATR_STATE_DIR) return env.ANNOTATR_STATE_DIR;
  const xdgStateHome = env.XDG_STATE_HOME || join(home, '.local', 'state');
  return join(xdgStateHome, 'annotatr');
}

/** @returns {State} */
export function emptyState() {
  return { version: 1, turns: {}, threads: {}, carryBack: {} };
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
    /** @type {string} */
    let text;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return emptyState();
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
   * Apply `mutator` to the latest state and persist the result atomically.
   *
   * @param {(state: State) => void|Promise<void>} mutator
   * @returns {Promise<State>} The state as written.
   */
  async update(mutator) {
    return this.#mutex.runExclusive(async () => {
      await mkdir(this.stateDir, { recursive: true });
      return withDirectoryLock(this.lockPath, async () => {
        const state = await this.read();
        await mutator(state);
        await writeAtomically(this.path, JSON.stringify(state, null, 2) + '\n');
        return state;
      });
    });
  }
}

/**
 * @param {unknown} parsed
 * @param {string} path
 * @returns {State}
 */
function normalize(parsed, path) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StoreError(`Store file ${path} does not contain an object`);
  }
  const record = /** @type {Record<string, unknown>} */ (parsed);
  if (record.version !== 1) {
    throw new StoreError(`Store file ${path} has unsupported version ${String(record.version)}`);
  }
  const base = emptyState();
  return {
    version: 1,
    turns: asRecord(record.turns) ?? base.turns,
    threads: asRecord(record.threads) ?? base.threads,
    carryBack: asRecord(record.carryBack) ?? base.carryBack,
  };
}

/**
 * @template T
 * @param {unknown} value
 * @returns {Record<string, T>|null}
 */
function asRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return /** @type {Record<string, T>} */ (value);
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
