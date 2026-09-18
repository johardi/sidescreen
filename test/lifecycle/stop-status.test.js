import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { probe, serverUrl } from '../../src/lifecycle/probe.js';
import { VERSION } from '../../src/version.js';
import { runCli, tempDir } from '../helpers.js';
import { startServer } from '../server-helpers.js';
import { fakeSidescreenAfter, foreignServerAfter, freePort, stopServerAfter, stubbornServerAfter } from './lifecycle-helpers.js';

/** @param {string} stateDir */
const envFor = (stateDir) => ({ SIDESCREEN_STATE_DIR: stateDir, SIDESCREEN_MENUBAR: 'off' });

test('4.1 stop shuts down the running server and frees the address', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-stop-');
  const port = await freePort();
  const env = envFor(stateDir);
  stopServerAfter(t, port, env);
  const started = await runCli(['start', '--port', String(port)], { env });
  assert.equal(started.code, 0, started.stderr);
  const running = await probe(port);
  assert.equal(running.kind, 'sidescreen');

  const result = await runCli(['stop', '--port', String(port)], { env });
  assert.equal(result.code, 0, result.stderr);
  if (running.kind === 'sidescreen') assert.equal(result.stdout, `sidescreen stopped (pid ${running.pid} at ${serverUrl(port)})\n`);
  assert.deepEqual(await probe(port), { kind: 'none' });
});

test('4.1 stop when nothing runs says so and exits 0', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-stop-');
  const port = await freePort();
  const result = await runCli(['stop', '--port', String(port)], { env: envFor(stateDir) });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `no sidescreen server is running at 127.0.0.1:${port}\n`);
});

test('4.1 stop leaves another program alone and exits 1', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-stop-');
  const { port } = await foreignServerAfter(t);
  const result = await runCli(['stop', '--port', String(port)], { env: envFor(stateDir) });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, `sidescreen stop: 127.0.0.1:${port} is in use by something other than sidescreen. Choose another port with --port.\n`);
  const response = await fetch(`${serverUrl(port)}anything`);
  assert.equal(response.status, 200, 'the other program still answers');
});

test('4.1 stop reports the pid and exits 1 when the server will not leave, and does not kill it', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-stop-');
  const port = await freePort();
  const { pid } = await stubbornServerAfter(t, { port, stateDir: resolve(stateDir) });
  const startedAt = Date.now();
  const result = await runCli(['stop', '--port', String(port)], { env: envFor(stateDir) });
  assert.equal(result.code, 1);
  assert.ok(Date.now() - startedAt >= 4_500, 'stop waited out its bound');
  assert.equal(
    result.stderr,
    `sidescreen stop: the server (pid ${pid}) is still answering at 127.0.0.1:${port} after 5s. It was asked to stop and was not killed; check on it, or run sidescreen stop again.\n`,
  );
  const still = await probe(port);
  assert.equal(still.kind === 'sidescreen' && still.pid, pid, 'the server was not force-killed');
});

test('4.2 status of a running server is one line with address, version, and pid, exit 0', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-status-');
  const { port } = await startServer(t, { stateDir });
  const result = await runCli(['status', '--port', String(port)], { env: envFor(stateDir) });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `sidescreen ${VERSION} is running at ${serverUrl(port)} (pid ${process.pid})\n`);
  assert.equal(result.stderr, '');
});

test('4.2 status with no server is one line, exit 1', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-status-');
  const port = await freePort();
  const result = await runCli(['status', '--port', String(port)], { env: envFor(stateDir) });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, `no sidescreen server is running at 127.0.0.1:${port}\n`);
  assert.equal(result.stderr, '');
});

test('4.2 status on a port held by another program reports it and exits 1', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-status-');
  const { port } = await foreignServerAfter(t);
  const result = await runCli(['status', '--port', String(port)], { env: envFor(stateDir) });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, `sidescreen status: 127.0.0.1:${port} is in use by something other than sidescreen. Choose another port with --port.\n`);
});

test('4.2 status names both versions when the running server is from another install', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-status-');
  const { port } = await fakeSidescreenAfter(t, { version: '0.0.1', stateDir: resolve(stateDir) });
  const result = await runCli(['status', '--port', String(port)], { env: envFor(stateDir) });
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], `sidescreen 0.0.1 is running at ${serverUrl(port)} (pid ${process.pid})`);
  assert.equal(lines[1], `The running server is sidescreen 0.0.1; this command is ${VERSION}. Run \`sidescreen stop\` then \`sidescreen start\` to switch to the installed version.`);
});

test('4.3 stop and status refuse a server reading another store, and the server is untouched', async (t) => {
  const theirs = await tempDir(t, 'sidescreen-theirs-');
  const mine = await tempDir(t, 'sidescreen-mine-');
  const { port } = await startServer(t, { stateDir: theirs });

  const stopped = await runCli(['stop', '--port', String(port)], { env: envFor(mine) });
  assert.equal(stopped.code, 1);
  assert.equal(
    stopped.stderr,
    `sidescreen stop: the sidescreen server at 127.0.0.1:${port} reads ${resolve(theirs)}, not ${mine}. Set SIDESCREEN_STATE_DIR to match it before acting on that server.\n`,
  );
  const still = await probe(port);
  assert.equal(still.kind === 'sidescreen' && still.pid, process.pid, 'the server still answers');

  const status = await runCli(['status', '--port', String(port)], { env: envFor(mine) });
  assert.equal(status.code, 1);
  assert.equal(
    status.stderr,
    `sidescreen status: the sidescreen server at 127.0.0.1:${port} reads ${resolve(theirs)}, not ${mine}. Set SIDESCREEN_STATE_DIR to match it before acting on that server.\n`,
  );
});
