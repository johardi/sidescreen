/**
 * `sidescreen start`: run the server as a process of its own.
 *
 * The command probes the address, launches `serve` detached when nothing is
 * there, and returns once the server answers, so the address it prints is
 * true by the time anyone reads it.
 */

import { spawn } from 'node:child_process';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DEFAULT_PORT } from '../web/server.js';
import { probe } from './probe.js';
import { assess, problemLine, runningLines } from './report.js';
import { openInBrowser } from './browser.js';
import { projectUrl } from './report.js';
import { serverUrl } from './probe.js';

export const LOG_FILE_NAME = 'server.log';
export const START_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 100;
const LOG_TAIL_LINES = 5;

/**
 * @typedef {object} StartOptions
 * @property {number} port
 * @property {boolean} open Open this directory's project page when a server is running.
 * @property {string} cwd
 * @property {NodeJS.ProcessEnv} env Passed to the server, which keeps it for its lifetime.
 * @property {string} stateDir The store this command uses; the log file lives beside it.
 * @property {string} binPath Absolute path to bin/sidescreen.js.
 * @property {NodeJS.WritableStream} stdout
 * @property {NodeJS.WritableStream} stderr
 * @property {string} [execPath] The node binary to run the server on.
 * @property {number} [timeoutMs] How long to wait for the server to answer.
 */

/**
 * @param {StartOptions} options
 * @returns {Promise<number>} Exit code: 0 when a sidescreen server on this store answers afterwards.
 */
export async function startCommand({ port, open: openPage, cwd, env, stateDir, binPath, stdout, stderr, execPath = process.execPath, timeoutMs = START_TIMEOUT_MS }) {
  if (port === 0) {
    stderr.write(
      `sidescreen start: a detached server needs a fixed port, and port 0 asks the system for a random one that no later command could find. Use --port <n> or leave the default ${DEFAULT_PORT}.\n`,
    );
    return 1;
  }

  /**
   * Report a server on this store.
   *
   * @param {import('./probe.js').ProbeResult} result
   * @param {boolean} found
   */
  const succeed = (result, found) => report({ command: 'start', result, found, port, cwd, stateDir, openPage, stdout, stderr });

  const before = await probe(port);
  if (before.kind !== 'none') return succeed(before, true);

  await mkdir(stateDir, { recursive: true });
  const logPath = join(stateDir, LOG_FILE_NAME);
  const log = await open(logPath, 'w');
  /** @type {import('node:child_process').ChildProcess} */
  let child;
  try {
    child = spawn(execPath, [binPath, 'serve', '--port', String(port)], {
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
      env,
      cwd,
      windowsHide: true,
    });
  } finally {
    await log.close();
  }
  child.unref();
  /** @type {{ code: number|null, signal: NodeJS.Signals|null }|{ error: Error }|null} */
  let ended = null;
  child.once('exit', (code, signal) => {
    ended = { code, signal };
  });
  child.once('error', (error) => {
    ended = { error };
  });

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe(port, { timeoutMs: 1_000 });
    if (result.kind !== 'none') {
      const code = await succeed(result, false);
      if (code === 0) stdout.write(`log: ${logPath}\n`);
      return code;
    }
    if (ended !== null) {
      // The server is gone. Once more, in case it lost the port to another
      // start whose server is the one now answering.
      const again = await probe(port);
      if (again.kind !== 'none') return succeed(again, false);
      return failed(ended, logPath, stderr);
    }
    if (Date.now() >= deadline) {
      stderr.write(
        `sidescreen start: the server has not answered at 127.0.0.1:${port} after ${timeoutMs / 1000}s. It was left running in case it is still coming up; its output is in ${logPath}.\n`,
      );
      return 1;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Report a probe result that is not `none` and exit accordingly.
 *
 * @param {{ command: string, result: import('./probe.js').ProbeResult, found: boolean, port: number, cwd: string, stateDir: string, openPage: boolean, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream }} options
 * @returns {Promise<number>}
 */
export async function report({ command, result, found, port, cwd, stateDir, openPage, stdout, stderr }) {
  const assessment = await assess(result, stateDir);
  if (assessment === 'running' && result.kind === 'sidescreen') {
    for (const line of runningLines({ result, port, cwd, found })) stdout.write(`${line}\n`);
    if (openPage) openInBrowser(projectUrl(serverUrl(port), cwd));
    return 0;
  }
  if (assessment === 'none' || assessment === 'running') return 1; // unreachable: callers pass a result that is not `none`
  stderr.write(`${problemLine({ command, assessment, result, port, stateDir })}\n`);
  return 1;
}

/**
 * @param {{ code: number|null, signal: NodeJS.Signals|null }|{ error: Error }} ended
 * @param {string} logPath
 * @param {NodeJS.WritableStream} stderr
 * @returns {Promise<number>}
 */
async function failed(ended, logPath, stderr) {
  const how =
    'error' in ended
      ? `could not be started (${ended.error.message})`
      : ended.signal !== null
        ? `exited on ${ended.signal}`
        : `exited with code ${String(ended.code)}`;
  const tail = await logTail(logPath);
  stderr.write(`sidescreen start: the server ${how} before answering. Its output is in ${logPath}${tail.length > 0 ? ':' : '.'}\n`);
  for (const line of tail) stderr.write(`  ${line}\n`);
  return 1;
}

/**
 * @param {string} logPath
 * @returns {Promise<string[]>}
 */
async function logTail(logPath) {
  try {
    const text = await readFile(logPath, 'utf8');
    return text.trimEnd().split('\n').filter((line) => line.trim() !== '').slice(-LOG_TAIL_LINES);
  } catch {
    return [];
  }
}
