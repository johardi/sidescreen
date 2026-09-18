/**
 * `sidescreen stop`: ask the server on an address to shut down and wait until
 * the address is free.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { probe, serverUrl } from './probe.js';
import { assess, problemLine } from './report.js';

export const STOP_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 100;

/**
 * @param {{ port: number, stateDir: string, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, timeoutMs?: number }} options
 * @returns {Promise<number>} Exit code: 0 when no sidescreen server on this store answers afterwards.
 */
export async function stopCommand({ port, stateDir, stdout, stderr, timeoutMs = STOP_TIMEOUT_MS }) {
  const result = await probe(port);
  const assessment = await assess(result, stateDir);
  if (assessment === 'none') {
    stdout.write(`no sidescreen server is running at 127.0.0.1:${port}\n`);
    return 0;
  }
  if (assessment !== 'running' || result.kind !== 'sidescreen') {
    stderr.write(`${problemLine({ command: 'stop', assessment: /** @type {Exclude<typeof assessment, 'none'|'running'>} */ (assessment), result, port, stateDir })}\n`);
    return 1;
  }

  try {
    process.kill(result.pid, 'SIGTERM');
  } catch (error) {
    // Already gone: the address will refuse connections in a moment.
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') throw error;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const now = await probe(port, { timeoutMs: 1_000 });
    if (now.kind === 'none') {
      stdout.write(`sidescreen stopped (pid ${result.pid} at ${serverUrl(port)})\n`);
      return 0;
    }
  }
  stderr.write(
    `sidescreen stop: the server (pid ${result.pid}) is still answering at 127.0.0.1:${port} after ${timeoutMs / 1000}s. It was asked to stop and was not killed; check on it, or run sidescreen stop again.\n`,
  );
  return 1;
}
