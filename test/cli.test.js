import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { describeSubagents } from '../src/cli.js';
import { projectUrl } from '../src/lifecycle/report.js';
import { dispatchSettings } from '../src/dispatch/backends.js';
import { projectId } from '../src/store/projects.js';
import { startServer } from './server-helpers.js';
import { runCli, tempDir } from './helpers.js';
import { foreignServerAfter } from './lifecycle/lifecycle-helpers.js';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/sidescreen.js', import.meta.url));
const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));

test('--version prints the package.json version', async () => {
  const { version } = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const { stdout } = await execFileAsync(process.execPath, [bin, '--version']);
  assert.equal(stdout.trim(), version);
});

test('7.1 the help lists the per-backend settings and no longer the single model setting', async () => {
  const { stdout } = await execFileAsync(process.execPath, [bin, '--help']);
  for (const name of ['SIDESCREEN_SUBAGENT', 'SIDESCREEN_CLAUDE_BIN', 'SIDESCREEN_CODEX_BIN', 'SIDESCREEN_CLAUDE_MODEL', 'SIDESCREEN_CODEX_MODEL', 'SIDESCREEN_DISPATCH_TIMEOUT_MS', 'SIDESCREEN_CONVENTIONS_FILES', 'SIDESCREEN_STATE_DIR']) {
    assert.match(stdout, new RegExp(`^  ${name} `, 'm'), `help lists ${name}`);
  }
  assert.doesNotMatch(stdout, /SIDESCREEN_MODEL\b/);
  assert.match(stdout, /@claude or @codex/);
});

test('7.1 the serve start-up line names the default backend, both CLIs, and the bounds', () => {
  assert.equal(describeSubagents(dispatchSettings({})), "default claude (the parent's harness, on the reviewed turn's model); claude: claude; codex: codex; read-only, 300s timeout");
  assert.equal(
    describeSubagents(dispatchSettings({ SIDESCREEN_SUBAGENT: 'codex', SIDESCREEN_CODEX_BIN: '/opt/codex', SIDESCREEN_CODEX_MODEL: 'gpt-5', SIDESCREEN_CLAUDE_MODEL: 'opus', SIDESCREEN_DISPATCH_TIMEOUT_MS: '60000' })),
    'default codex (configured); claude: claude (model opus); codex: /opt/codex (model gpt-5); read-only, 60s timeout',
  );
});

test('an unknown command exits non-zero with usage on stderr', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [bin, 'frobnicate']),
    /** @param {{ code: number, stderr: string }} error */
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /unknown command "frobnicate"/);
      assert.match(error.stderr, /Usage:/);
      return true;
    },
  );
});

test('serve --open targets the current directory\'s project, and serve reports that address', async (t) => {
  assert.equal(projectUrl('http://127.0.0.1:7486/', '/w/proj'), `http://127.0.0.1:7486/projects/${projectId('/w/proj')}`);

  const stateDir = await tempDir(t, 'sidescreen-serve-');
  // The child's process.cwd() is the physical path, so resolve the temp directory's symlinks first.
  const project = await realpath(await tempDir(t, 'sidescreen-cwd-'));
  const child = spawn(process.execPath, [bin, 'serve', '--port', '0'], {
    cwd: project,
    env: { ...process.env, SIDESCREEN_STATE_DIR: stateDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('close', resolve));
  });
  const output = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', (chunk) => {
      text += String(chunk);
      if (/sub-agent:/.test(text)) resolve(text);
    });
    child.once('close', (code) => reject(new Error(`serve exited early with ${code}`)));
  });
  const base = /sidescreen listening on (http:\/\/[^\s]+)/.exec(output)?.[1];
  assert.ok(base);
  assert.match(output, /^sub-agent: default claude \(the parent's harness, on the reviewed turn's model\); claude: claude; codex: codex; read-only, 300s timeout$/m);
  assert.ok(output.includes(`this project: ${projectUrl(base, project)} (${project})`), output);
  const page = await fetch(projectUrl(base, project));
  assert.equal(page.status, 200, 'the project address works before the directory has delivered a turn');
  assert.match(await page.text(), /No turns yet from/);
});

test('2.1 serve on a port held by a sidescreen server on the same store reports it as running and exits 0', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-serve-');
  const { port } = await startServer(t, { stateDir });
  const project = await realpath(await tempDir(t, 'sidescreen-cwd-'));
  const result = await runCli(['serve', '--port', String(port)], { cwd: project, env: { SIDESCREEN_STATE_DIR: stateDir } });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^sidescreen is already running at http://127\\.0\\.0\\.1:${port}/ \\(pid ${process.pid}\\)$`, 'm'));
  assert.ok(result.stdout.includes(`this project: ${projectUrl(`http://127.0.0.1:${port}/`, project)} (${project})`), result.stdout);
  assert.equal(result.stderr, '');
});

test('2.1 serve on a port held by a sidescreen server on another store names both directories and exits 1', async (t) => {
  const theirs = await tempDir(t, 'sidescreen-theirs-');
  const mine = await tempDir(t, 'sidescreen-mine-');
  const { port } = await startServer(t, { stateDir: theirs });
  const result = await runCli(['serve', '--port', String(port)], { env: { SIDESCREEN_STATE_DIR: mine } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, new RegExp(`^sidescreen serve: the sidescreen server at 127\\.0\\.0\\.1:${port} reads `));
  assert.ok(result.stderr.includes(resolve(theirs)), result.stderr);
  assert.ok(result.stderr.includes(mine), result.stderr);
  assert.match(result.stderr, /--port/);
  assert.doesNotMatch(result.stderr, /at .*\.js:\d+/, 'no stack trace');
  assert.equal(result.stderr.trim().split('\n').length, 1);
});

test('2.1 serve on a port held by another program says so in one line and exits 1', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-serve-');
  const { port } = await foreignServerAfter(t);
  const result = await runCli(['serve', '--port', String(port)], { env: { SIDESCREEN_STATE_DIR: stateDir } });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, `sidescreen serve: 127.0.0.1:${port} is in use by something other than sidescreen. Choose another port with --port.\n`);
  assert.equal(result.stdout, '');
});

test('5.2 the help lists start, stop, and status, and labels serve as the foreground command', async () => {
  const { stdout } = await execFileAsync(process.execPath, [bin, '--help']);
  for (const command of ['start', 'stop', 'status', 'serve']) {
    assert.match(stdout, new RegExp(`^ {2}sidescreen ${command} \\[options\\]`, 'm'), `help lists ${command}`);
  }
  assert.match(stdout, /^ {2}sidescreen serve \[options\] .*foreground/m);
  assert.match(stdout, /^ {2}sidescreen start \[options\] .*background/m);
  assert.match(stdout, /server\.log/);
});
