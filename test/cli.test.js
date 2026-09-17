import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { projectUrl } from '../src/cli.js';
import { projectId } from '../src/projects.js';
import { startServer } from './server-helpers.js';
import { runCli, tempDir } from './helpers.js';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/sidescreen.js', import.meta.url));
const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));

test('--version prints the package.json version', async () => {
  const { version } = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const { stdout } = await execFileAsync(process.execPath, [bin, '--version']);
  assert.equal(stdout.trim(), version);
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
  assert.ok(output.includes(`this project: ${projectUrl(base, project)} (${project})`), output);
  const page = await fetch(projectUrl(base, project));
  assert.equal(page.status, 200, 'the project address works before the directory has delivered a turn');
  assert.match(await page.text(), /No turns yet from/);
});

test('a second serve on a port already in use says so in one line and exits 1', async (t) => {
  const { port } = await startServer(t);
  const result = await runCli(['serve', '--port', String(port)]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, new RegExp(`^sidescreen serve: 127\\.0\\.0\\.1:${port} is already in use\\.`));
  assert.match(result.stderr, /--port/);
  assert.doesNotMatch(result.stderr, /at .*\.js:\d+/, 'no stack trace');
  assert.equal(result.stderr.trim().split('\n').length, 1);
});
