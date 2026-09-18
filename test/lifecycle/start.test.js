import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmod, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { probe, serverUrl } from '../../src/lifecycle/probe.js';
import { projectUrl } from '../../src/lifecycle/report.js';
import { LOG_FILE_NAME } from '../../src/lifecycle/start.js';
import { VERSION } from '../../src/version.js';
import { BIN, runCli, tempDir } from '../helpers.js';
import { startServer } from '../server-helpers.js';
import { escapeRegExp, fakeSidescreenAfter, foreignServerAfter, freePort, stopServerAfter, waitUntil } from './lifecycle-helpers.js';

const execFileAsync = promisify(execFile);

/** @param {string} stateDir */
const envFor = (stateDir) => ({ SIDESCREEN_STATE_DIR: stateDir, SIDESCREEN_MENUBAR: 'off' });

/**
 * A fresh store, a project directory, and a free port with cleanup registered.
 *
 * @param {import('node:test').TestContext} t
 */
async function arena(t) {
  const stateDir = await tempDir(t, 'sidescreen-start-state-');
  const project = await realpath(await tempDir(t, 'sidescreen-start-project-'));
  const port = await freePort();
  const env = envFor(stateDir);
  stopServerAfter(t, port, env);
  return { stateDir, project, port, env };
}

test('3.1 start launches a detached server, prints both addresses and the log, and the server answers after the command has exited', async (t) => {
  const { stateDir, project, port, env } = await arena(t);
  const result = await runCli(['start', '--port', String(port)], { cwd: project, env });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^sidescreen running at ${escapeRegExp(serverUrl(port))} \\(pid \\d+\\)$`, 'm'));
  assert.ok(result.stdout.includes(`this project: ${projectUrl(serverUrl(port), project)} (${project})`), result.stdout);
  assert.match(result.stdout, new RegExp(`^log: ${escapeRegExp(join(stateDir, LOG_FILE_NAME))}$`, 'm'));
  assert.equal(result.stderr, '');

  const running = await probe(port);
  assert.equal(running.kind, 'sidescreen');
  if (running.kind === 'sidescreen') {
    assert.equal(running.stateDir, resolve(stateDir));
    assert.equal(running.version, VERSION);
    assert.notEqual(running.pid, process.pid);
  }
  assert.match(await readFile(join(stateDir, LOG_FILE_NAME), 'utf8'), /sidescreen listening on/);
});

test('3.1 start refuses port 0 with an explanation', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-start-state-');
  const result = await runCli(['start', '--port', '0'], { env: envFor(stateDir) });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^sidescreen start: a detached server needs a fixed port/);
  assert.equal(result.stdout, '');
});

test('3.1 when the server exits before answering, start names the log file with its last lines and exits 1', async (t) => {
  const { stateDir, project, port, env } = await arena(t);
  await writeFile(join(stateDir, 'store.json'), 'not json\n');
  const result = await runCli(['start', '--port', String(port)], { cwd: project, env });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^sidescreen start: the server exited with code 1 before answering\. Its output is in /);
  assert.ok(result.stderr.includes(join(stateDir, LOG_FILE_NAME)), result.stderr);
  assert.match(result.stderr, /not valid JSON/, 'the log tail carries the reason');
  assert.deepEqual(await probe(port), { kind: 'none' });
});

test('one server per address: a second start reports the running server, with its pid, and exits 0 without starting another', async (t) => {
  const { project, port, env } = await arena(t);
  const first = await runCli(['start', '--port', String(port)], { cwd: project, env });
  assert.equal(first.code, 0, first.stderr);
  const before = await probe(port);
  assert.equal(before.kind, 'sidescreen');

  const second = await runCli(['start', '--port', String(port)], { cwd: project, env });
  assert.equal(second.code, 0, second.stderr);
  assert.equal(second.stderr, '');
  if (before.kind === 'sidescreen') {
    assert.match(second.stdout, new RegExp(`^sidescreen is already running at ${escapeRegExp(serverUrl(port))} \\(pid ${before.pid}\\)$`, 'm'));
  }
  assert.ok(second.stdout.includes(`this project: ${projectUrl(serverUrl(port), project)} (${project})`), second.stdout);
  assert.doesNotMatch(second.stdout, /^log:/m, 'nothing was started, so there is no new log to name');
  const after = await probe(port);
  assert.deepEqual(after, before, 'the same server answers');
  assert.equal(await serveProcessCount(port), 1);
});

test('2.2 a running server from another version is named, with how to switch, and the exit stays 0', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-start-state-');
  const { port } = await fakeSidescreenAfter(t, { version: '0.0.1', stateDir: resolve(stateDir) });
  const result = await runCli(['start', '--port', String(port)], { env: envFor(stateDir) });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /is already running at/);
  assert.match(result.stdout, new RegExp(`^The running server is sidescreen 0\\.0\\.1; this command is ${escapeRegExp(VERSION)}\\. Run \`sidescreen stop\` then \`sidescreen start\` to switch to the installed version\\.$`, 'm'));
});

test('start on a port held by another program says so, suggests --port, and exits 1', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-start-state-');
  const { port } = await foreignServerAfter(t);
  const result = await runCli(['start', '--port', String(port)], { env: envFor(stateDir) });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, `sidescreen start: 127.0.0.1:${port} is in use by something other than sidescreen. Choose another port with --port.\n`);
  assert.equal(result.stdout, '');
});

test('start on a port held by a sidescreen server reading another store names both directories and exits 1', async (t) => {
  const theirs = await tempDir(t, 'sidescreen-theirs-');
  const mine = await tempDir(t, 'sidescreen-mine-');
  const { port } = await startServer(t, { stateDir: theirs });
  const result = await runCli(['start', '--port', String(port)], { env: envFor(mine) });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^sidescreen start: the sidescreen server at 127\.0\.0\.1:\d+ reads /);
  assert.ok(result.stderr.includes(resolve(theirs)), result.stderr);
  assert.ok(result.stderr.includes(mine), result.stderr);
  assert.match(result.stderr, /Turns stored here would not appear there/);
  assert.equal(result.stderr.trim().split('\n').length, 1);
  const still = await probe(port);
  assert.equal(still.kind === 'sidescreen' && still.pid, process.pid, 'the other server is untouched and no new one was started');
});

test('3.3 the server survives the process group that ran start', { skip: process.platform === 'win32' && 'needs sh and process groups' }, async (t) => {
  const { project, port, env } = await arena(t);
  const wrapper = spawn('sh', ['-c', `"${process.execPath}" "${BIN}" start --port ${port}`], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    cwd: project,
  });
  let stderr = '';
  wrapper.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise((resolve) => wrapper.once('close', resolve));
  assert.equal(code, 0, stderr);
  assert.ok(wrapper.pid);

  // The wrapper led its own process group. If the server had been in it, this
  // signal would reach the server; the group being empty is the proof.
  /** @type {NodeJS.ErrnoException|null} */
  let groupError = null;
  try {
    process.kill(-wrapper.pid, 'SIGTERM');
  } catch (error) {
    groupError = /** @type {NodeJS.ErrnoException} */ (error);
  }
  assert.equal(groupError?.code, 'ESRCH', 'the group that ran start has no members left');
  await sleep(200);
  const running = await probe(port);
  assert.equal(running.kind, 'sidescreen', 'the server still answers');
});

test('3.4 two concurrent starts leave exactly one server and both report it', { skip: process.platform === 'win32' && 'counts processes with pgrep' }, async (t) => {
  const { project, port, env } = await arena(t);
  const [a, b] = await Promise.all([
    runCli(['start', '--port', String(port)], { cwd: project, env }),
    runCli(['start', '--port', String(port)], { cwd: project, env }),
  ]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  assert.ok(a.stdout.includes(serverUrl(port)), a.stdout);
  assert.ok(b.stdout.includes(serverUrl(port)), b.stdout);
  const running = await probe(port);
  assert.equal(running.kind, 'sidescreen');
  assert.equal(await serveProcessCount(port), 1, 'one serve process for the port');
});

test("3.5 start --open opens this directory's project when a server is already running", { skip: process.platform === 'win32' && 'fakes the opener on PATH' }, async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-start-state-');
  const { port } = await startServer(t, { stateDir });
  const project = await realpath(await tempDir(t, 'sidescreen-open-project-'));
  const binDir = await tempDir(t, 'sidescreen-opener-');
  const record = join(binDir, 'opened.txt');
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  await writeFile(join(binDir, opener), `#!/bin/sh\nprintf '%s\\n' "$1" >> "${record}"\n`);
  await chmod(join(binDir, opener), 0o755);

  const result = await runCli(['start', '--port', String(port), '--open'], {
    cwd: project,
    env: { ...envFor(stateDir), PATH: `${binDir}:${process.env.PATH ?? ''}` },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /is already running/);
  await waitUntil(() => readFile(record, 'utf8').then(() => true, () => false), 'the opener to be called');
  assert.equal(await readFile(record, 'utf8'), `${projectUrl(serverUrl(port), project)}\n`);
});

/**
 * How many `serve` processes are bound to `port`, by command line.
 *
 * @param {number} port
 */
async function serveProcessCount(port) {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-f', `sidescreen\\.js serve --port ${port}$`]);
    return stdout.trim().split('\n').filter((line) => line !== '').length;
  } catch (error) {
    // pgrep exits 1 when nothing matches.
    if (/** @type {{ code?: number }} */ (error).code === 1) return 0;
    throw error;
  }
}
