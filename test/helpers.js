import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN = fileURLToPath(new URL('../bin/sidescreen.js', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/**
 * Create a temporary directory that is removed when the test finishes.
 *
 * @param {import('node:test').TestContext} t
 * @param {string} [prefix]
 */
export async function tempDir(t, prefix = 'sidescreen-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Start `sidescreen serve` through the real CLI on an ephemeral port and wait
 * for its address. The server is stopped when the test ends.
 *
 * @param {import('node:test').TestContext} t
 * @param {NodeJS.ProcessEnv} env
 * @param {{ cwd?: string }} [options]
 */
export async function serveViaCli(t, env, { cwd } = {}) {
  const child = spawn(process.execPath, [BIN, 'serve', '--port', '0'], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('close', resolve));
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  /** @type {string} */
  const url = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
      const match = /sidescreen listening on (http:\/\/[^\s]+)/.exec(output);
      if (match) resolve(match[1]);
    });
    child.once('close', (code) => reject(new Error(`serve exited early with ${code}: ${stderr}`)));
  });
  return { url, child, stderr: () => stderr };
}

/**
 * Run the sidescreen CLI as a child process.
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
