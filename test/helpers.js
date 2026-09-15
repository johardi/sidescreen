import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN = fileURLToPath(new URL('../bin/annotatr.js', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/**
 * Create a temporary directory that is removed when the test finishes.
 *
 * @param {import('node:test').TestContext} t
 * @param {string} [prefix]
 */
export async function tempDir(t, prefix = 'annotatr-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Run the annotatr CLI as a child process.
 *
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, input?: string, cwd?: string }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runCli(args, { env = {}, input, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [BIN, ...args],
      { env: { ...process.env, ...env }, cwd },
      (error, stdout, stderr) => {
        if (error && typeof (/** @type {NodeJS.ErrnoException} */ (error)).code !== 'number' && !('code' in error)) {
          reject(error);
          return;
        }
        const code = error ? Number(/** @type {{ code?: number }} */ (error).code ?? 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    if (child.stdin) {
      if (input !== undefined) child.stdin.end(input);
      else child.stdin.end();
    }
  });
}
