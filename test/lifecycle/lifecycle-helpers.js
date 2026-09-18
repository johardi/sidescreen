import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { probe } from '../../src/lifecycle/probe.js';
import { FIXTURES, runCli } from '../helpers.js';

/**
 * A port nothing listens on right now. The small window before a test binds
 * it is accepted; callers that see a foreign occupant retry once.
 *
 * @returns {Promise<number>}
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address !== null && typeof address === 'object' ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Stop the sidescreen server on `port` when the test ends, and kill it if it
 * is still answering afterwards, so a failed assertion never leaves one behind.
 *
 * @param {import('node:test').TestContext} t
 * @param {number} port
 * @param {NodeJS.ProcessEnv} env
 */
export function stopServerAfter(t, port, env) {
  t.after(async () => {
    await runCli(['stop', '--port', String(port)], { env });
    const left = await probe(port, { timeoutMs: 500 });
    if (left.kind === 'sidescreen') {
      try {
        process.kill(left.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  });
}

/**
 * An HTTP server on a free port, closed when the test ends.
 *
 * @param {import('node:test').TestContext} t
 * @param {http.RequestListener} handler
 * @returns {Promise<{ port: number, server: http.Server }>}
 */
export async function httpServerAfter(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve(undefined));
      }),
  );
  const address = server.address();
  const port = address !== null && typeof address === 'object' ? address.port : 0;
  return { port, server };
}

/**
 * Something on a port that is not sidescreen: it answers every request with
 * other JSON.
 *
 * @param {import('node:test').TestContext} t
 */
export function foreignServerAfter(t) {
  return httpServerAfter(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hello: 'world' }));
  });
}

/**
 * A server shaped like sidescreen's health answer, in this process, so a
 * test can vary the version or the state directory it claims. Never point
 * `stop` at it: the pid it reports is the test runner's.
 *
 * @param {import('node:test').TestContext} t
 * @param {{ version?: string, stateDir: string }} options
 */
export function fakeSidescreenAfter(t, { version = '0.0.1', stateDir }) {
  return httpServerAfter(t, (req, res) => {
    if (req.url !== '/api/health') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'sidescreen', version, pid: process.pid, stateDir }));
  });
}

/**
 * A sidescreen-shaped server in its own process that ignores SIGTERM, for
 * exercising the bounded wait in `stop`. Killed with SIGKILL when the test ends.
 *
 * @param {import('node:test').TestContext} t
 * @param {{ port: number, stateDir: string }} options
 * @returns {Promise<{ pid: number }>}
 */
export async function stubbornServerAfter(t, { port, stateDir }) {
  const child = spawn(process.execPath, [join(FIXTURES, 'stubborn-server.js'), String(port), stateDir], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('close', resolve));
  });
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
      if (/listening/.test(output)) resolve(undefined);
    });
    child.once('close', (code) => reject(new Error(`stubborn server exited early with ${code}`)));
  });
  if (child.pid === undefined) throw new Error('stubborn server has no pid');
  return { pid: child.pid };
}

/**
 * Poll until `check` returns true, or fail after `timeoutMs`.
 *
 * @param {() => Promise<boolean>|boolean} check
 * @param {string} what
 * @param {number} [timeoutMs]
 */
export async function waitUntil(check, what, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** @param {string} value */
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
