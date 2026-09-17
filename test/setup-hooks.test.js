import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BIN, runCli, tempDir } from './helpers.js';
import { hookCommand, isSidescreenHookCommand, registerHooks } from '../src/setup-hooks.js';

/** @param {string} path */
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('running setup hooks twice produces exactly one Stop hook entry', async (t) => {
  const settingsPath = join(await tempDir(t), 'settings.json');
  const first = await runCli(['setup', 'hooks', '--settings', settingsPath]);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /Stop: added/);

  const afterFirst = await stat(settingsPath);
  const second = await runCli(['setup', 'hooks', '--settings', settingsPath]);
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /Stop: unchanged/);
  assert.match(second.stdout, /is up to date/);
  assert.equal((await stat(settingsPath)).mtimeMs, afterFirst.mtimeMs, 'an unchanged settings file is not rewritten');

  const settings = await readJson(settingsPath);
  const stopHooks = settings.hooks.Stop.flatMap((/** @type {{ hooks: { command: string }[] }} */ group) => group.hooks);
  assert.equal(stopHooks.length, 1);
  assert.equal(stopHooks[0].type, 'command');
  assert.equal(stopHooks[0].command, hookCommand(BIN, 'ingest'));
});

test('unrelated settings and unrelated hooks are left untouched', async (t) => {
  const settingsPath = join(await tempDir(t), 'settings.json');
  const original = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    model: 'claude-fable-5-1',
    env: { FOO: 'bar' },
    hooks: {
      SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
    },
    permissions: { allow: ['Bash(ls:*)'] },
  };
  await writeFile(settingsPath, JSON.stringify(original), 'utf8');

  const result = await runCli(['setup', 'hooks', '--settings', settingsPath]);
  assert.equal(result.code, 0, result.stderr);

  const settings = await readJson(settingsPath);
  const { hooks, ...restOfSettings } = settings;
  const { hooks: _originalHooks, ...restOfOriginal } = original;
  assert.deepEqual(restOfSettings, restOfOriginal);
  assert.deepEqual(hooks.SessionStart, original.hooks.SessionStart);
  assert.deepEqual(hooks.Stop[0], original.hooks.Stop[0], 'the pre-existing Stop hook keeps its place');
  assert.equal(hooks.Stop.length, 2);
  assert.equal(hooks.Stop[1].hooks[0].command, hookCommand(BIN, 'ingest'));
});

test('an existing sidescreen hook with a stale path is updated in place, not duplicated', async (t) => {
  const settingsPath = join(await tempDir(t), 'settings.json');
  await writeFile(
    settingsPath,
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node /old/place/bin/sidescreen.js ingest' }] }] } }),
    'utf8',
  );
  const result = await runCli(['setup', 'hooks', '--settings', settingsPath]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Stop: updated/);
  const settings = await readJson(settingsPath);
  assert.equal(settings.hooks.Stop.length, 1);
  assert.equal(settings.hooks.Stop[0].hooks[0].command, hookCommand(BIN, 'ingest'));
});

test('a settings file that cannot be parsed is reported and left untouched', async (t) => {
  const settingsPath = join(await tempDir(t), 'settings.json');
  const broken = '{ "model": "x", "hooks": { ';
  await writeFile(settingsPath, broken, 'utf8');

  const result = await runCli(['setup', 'hooks', '--settings', settingsPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /could not parse .*settings\.json/);
  assert.match(result.stderr, /leaving it untouched/);
  assert.equal(await readFile(settingsPath, 'utf8'), broken);
});

test('a hooks key of the wrong shape is reported rather than clobbered', async (t) => {
  const settingsPath = join(await tempDir(t), 'settings.json');
  const original = JSON.stringify({ hooks: { Stop: { oops: true } } });
  await writeFile(settingsPath, original, 'utf8');
  const result = await runCli(['setup', 'hooks', '--settings', settingsPath]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /hooks\.Stop.*not an array/);
  assert.equal(await readFile(settingsPath, 'utf8'), original);
});

test('--dry-run reports without writing', async (t) => {
  const settingsPath = join(await tempDir(t), 'settings.json');
  const result = await runCli(['setup', 'hooks', '--settings', settingsPath, '--dry-run']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Stop: added \(dry run\)/);
  await assert.rejects(readFile(settingsPath));
});

test('isSidescreenHookCommand recognizes the ways sidescreen can be invoked', () => {
  assert.ok(isSidescreenHookCommand('sidescreen ingest', 'ingest'));
  assert.ok(isSidescreenHookCommand('node /x/bin/sidescreen.js ingest', 'ingest'));
  assert.ok(isSidescreenHookCommand('node "/x y/bin/sidescreen.js" ingest', 'ingest'));
  assert.ok(isSidescreenHookCommand('npx sidescreen ingest', 'ingest'));
  assert.ok(!isSidescreenHookCommand('sidescreen serve', 'ingest'));
  assert.ok(!isSidescreenHookCommand('my-sidescreen-wrapper ingest', 'ingest'));
  assert.ok(!isSidescreenHookCommand('echo sidescreen ingestion', 'ingest'));
});

test('registerHooks is pure and does not mutate its input', () => {
  const input = { hooks: { Stop: [] } };
  const snapshot = JSON.stringify(input);
  registerHooks(input, { binPath: '/bin/sidescreen.js' });
  assert.equal(JSON.stringify(input), snapshot);
});
