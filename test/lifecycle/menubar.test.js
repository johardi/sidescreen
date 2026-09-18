import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { DEFAULT_SCRIPT_PATH, OSASCRIPT, launchMenubar, menubarCommand, menubarDecision } from '../../src/lifecycle/menubar.js';
import { BIN, runCli, tempDir } from '../helpers.js';
import { freePort, stopServerAfter, waitUntil } from './lifecycle-helpers.js';

const darwinOnly = { skip: process.platform !== 'darwin' && 'the item is launched on macOS only' };

/**
 * A stand-in for the helper that records what it was launched with, one file
 * pair per launch, named by its pid.
 *
 * @param {import('node:test').TestContext} t
 */
async function fakeHelper(t) {
  const dir = await tempDir(t, 'sidescreen-menubar-fake-');
  const path = join(dir, 'sidescreen-menubar');
  // The environment goes first and the arguments last, each through a rename,
  // so a reader that sees an .args file sees two complete files.
  await writeFile(
    path,
    `#!/bin/sh\nenv > "${dir}/launch.$$.env.tmp" && mv "${dir}/launch.$$.env.tmp" "${dir}/launch.$$.env"\nprintf '%s\\n' "$@" > "${dir}/launch.$$.args.tmp" && mv "${dir}/launch.$$.args.tmp" "${dir}/launch.$$.args"\n`,
  );
  await chmod(path, 0o755);
  /** How many launches have been recorded so far. */
  const launches = async () => (await readdir(dir)).filter((name) => name.endsWith('.args')).length;
  /** The arguments and environment of the only launch. */
  const onlyLaunch = async () => {
    const names = (await readdir(dir)).filter((name) => name.endsWith('.args'));
    assert.equal(names.length, 1, 'exactly one launch');
    const stem = names[0].replace(/\.args$/, '');
    return {
      args: (await readFile(join(dir, names[0]), 'utf8')).trimEnd().split('\n'),
      env: (await readFile(join(dir, `${stem}.env`), 'utf8')).split('\n'),
    };
  };
  return { path, launches, onlyLaunch };
}

/** A writable that keeps what was written. */
function sink() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += String(chunk);
      callback();
    },
  });
  return { stream, text: () => text };
}

test('2.1 the item is launched on darwin unless disabled, and never elsewhere', () => {
  assert.deepEqual(menubarDecision({ platform: 'darwin', env: {} }), { launch: true });
  assert.deepEqual(menubarDecision({ platform: 'darwin', env: { SIDESCREEN_MENUBAR: 'on' } }), { launch: true });
  for (const value of ['off', 'OFF', ' off ', '0', 'false', 'no']) {
    assert.deepEqual(menubarDecision({ platform: 'darwin', env: { SIDESCREEN_MENUBAR: value } }), { launch: false, reason: 'disabled' }, value);
  }
  assert.deepEqual(menubarDecision({ platform: 'linux', env: {} }), { launch: false, reason: 'platform' });
  assert.deepEqual(menubarDecision({ platform: 'win32', env: {} }), { launch: false, reason: 'platform' });
});

test('2.1 the item is the shipped script through osascript unless SIDESCREEN_MENUBAR_BIN names a program', () => {
  assert.deepEqual(menubarCommand({}), { file: OSASCRIPT, args: ['-l', 'JavaScript', DEFAULT_SCRIPT_PATH], script: DEFAULT_SCRIPT_PATH });
  assert.equal(OSASCRIPT, '/usr/bin/osascript');
  assert.match(DEFAULT_SCRIPT_PATH, /menubar\/sidescreen-menubar\.js$/);
  assert.deepEqual(menubarCommand({ SIDESCREEN_MENUBAR_BIN: '/opt/menubar' }), { file: '/opt/menubar', args: [], script: null });
});

test('2.1 launching passes the port, the state directory, node, and the bin as arguments, and the environment as is', darwinOnly, async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-menubar-state-');
  const fake = await fakeHelper(t);
  const stderr = sink();
  const env = { ...process.env, SIDESCREEN_MENUBAR_BIN: fake.path, SIDESCREEN_STATE_DIR: stateDir, SIDESCREEN_PROBE_MARK: 'carried' };
  const launched = await launchMenubar({ port: 7599, stateDir, env, stderr: stderr.stream, binPath: BIN, execPath: '/usr/local/bin/node-for-test', platform: 'darwin' });
  assert.equal(launched, true);
  await waitUntil(async () => (await fake.launches()) === 1, 'the fake helper to record its launch');
  const { args, env: recorded } = await fake.onlyLaunch();
  assert.deepEqual(args, ['--port', '7599', '--state-dir', stateDir, '--node', '/usr/local/bin/node-for-test', '--bin', BIN]);
  assert.ok(recorded.includes(`SIDESCREEN_STATE_DIR=${stateDir}`), 'the store travels as the environment');
  assert.ok(recorded.includes('SIDESCREEN_PROBE_MARK=carried'), 'the whole environment travels');
  assert.equal(stderr.text(), '');
  await waitUntil(() => readFile(join(stateDir, 'menubar.log')).then(() => true, () => false), 'the menubar log to exist');
});

test('2.1 a missing helper is one line on stderr and no launch; off and other platforms are silent', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-menubar-state-');
  const missing = sink();
  const launched = await launchMenubar({ port: 7599, stateDir, env: { SIDESCREEN_MENUBAR_BIN: join(stateDir, 'nope') }, stderr: missing.stream, binPath: BIN, platform: 'darwin' });
  assert.equal(launched, false);
  assert.equal(missing.text(), `sidescreen: the menu bar item is unavailable: SIDESCREEN_MENUBAR_BIN names ${join(stateDir, 'nope')}, which is missing; fix it, or set SIDESCREEN_MENUBAR=off to silence this.\n`);

  const off = sink();
  assert.equal(await launchMenubar({ port: 7599, stateDir, env: { SIDESCREEN_MENUBAR: 'off', SIDESCREEN_MENUBAR_BIN: join(stateDir, 'nope') }, stderr: off.stream, binPath: BIN, platform: 'darwin' }), false);
  assert.equal(off.text(), '');

  const linux = sink();
  assert.equal(await launchMenubar({ port: 7599, stateDir, env: { SIDESCREEN_MENUBAR_BIN: join(stateDir, 'nope') }, stderr: linux.stream, binPath: BIN, platform: 'linux' }), false);
  assert.equal(linux.text(), '');
});

test('2.2 start launches the item when it starts a server and again when it finds one; off launches nothing', darwinOnly, async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-menubar-state-');
  const fake = await fakeHelper(t);
  const port = await freePort();
  const env = { SIDESCREEN_STATE_DIR: stateDir, SIDESCREEN_MENUBAR_BIN: fake.path };
  stopServerAfter(t, port, { ...env, SIDESCREEN_MENUBAR: 'off' });

  const started = await runCli(['start', '--port', String(port)], { env });
  assert.equal(started.code, 0, started.stderr);
  assert.equal(started.stderr, '');
  await waitUntil(async () => (await fake.launches()) === 1, 'the launch after starting');
  const { args, env: recorded } = await fake.onlyLaunch();
  assert.deepEqual(args, ['--port', String(port), '--state-dir', stateDir, '--node', process.execPath, '--bin', BIN]);
  assert.ok(recorded.includes(`SIDESCREEN_STATE_DIR=${stateDir}`));

  const found = await runCli(['start', '--port', String(port)], { env });
  assert.equal(found.code, 0, found.stderr);
  assert.match(found.stdout, /is already running/);
  await waitUntil(async () => (await fake.launches()) === 2, 'the launch after finding; the helper deduplicates, not the CLI');

  const off = await runCli(['start', '--port', String(port)], { env: { ...env, SIDESCREEN_MENUBAR: 'off' } });
  assert.equal(off.code, 0, off.stderr);
  assert.equal(off.stderr, '');
  assert.doesNotMatch(off.stdout, /menu bar/);
  assert.equal(await fake.launches(), 2, 'no third launch');
});

test('2.2 start with a nonexistent SIDESCREEN_MENUBAR_BIN says so in one stderr line and still exits 0', darwinOnly, async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-menubar-state-');
  const port = await freePort();
  const env = { SIDESCREEN_STATE_DIR: stateDir, SIDESCREEN_MENUBAR_BIN: join(stateDir, 'no-such-helper') };
  stopServerAfter(t, port, { ...env, SIDESCREEN_MENUBAR: 'off' });
  const result = await runCli(['start', '--port', String(port)], { env });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^sidescreen running at/m);
  assert.equal(result.stderr.trim().split('\n').length, 1);
  assert.match(result.stderr, /^sidescreen: the menu bar item is unavailable: SIDESCREEN_MENUBAR_BIN names .*no-such-helper, which is missing;/);
});
