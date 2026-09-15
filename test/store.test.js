import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES, runCli, tempDir } from './helpers.js';
import { Store, StoreError, defaultStateDir } from '../src/store.js';

const fixtureText = await readFile(join(FIXTURES, 'stop-hook-payload.json'), 'utf8');
const fixture = JSON.parse(fixtureText);

test('ANNOTATR_STATE_DIR overrides the state directory', () => {
  assert.equal(defaultStateDir({ ANNOTATR_STATE_DIR: '/tmp/custom' }, '/home/u'), '/tmp/custom');
});

test('the state directory falls back to XDG_STATE_HOME, then ~/.local/state', () => {
  assert.equal(defaultStateDir({ XDG_STATE_HOME: '/xdg/state' }, '/home/u'), '/xdg/state/annotatr');
  assert.equal(defaultStateDir({}, '/home/u'), '/home/u/.local/state/annotatr');
});

test('reading a missing store yields an empty state', async (t) => {
  const store = new Store(await tempDir(t));
  assert.deepEqual(await store.read(), { version: 1, turns: {}, threads: {}, carryBack: {} });
});

test('a corrupt store file is an error, not a silent reset', async (t) => {
  const stateDir = await tempDir(t);
  await writeFile(join(stateDir, 'store.json'), '{"version": 1, "turns": ', 'utf8');
  await assert.rejects(new Store(stateDir).read(), StoreError);
});

test('concurrent in-process updates are serialized and none is lost', async (t) => {
  const store = new Store(await tempDir(t));
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      store.update((state) => {
        state.turns[`turn-${index}`] = {
          promptId: `turn-${index}`,
          sessionId: 's',
          cwd: '/p',
          transcriptPath: null,
          message: `m${index}`,
          receivedAt: new Date().toISOString(),
        };
      }),
    ),
  );
  const state = await store.read();
  assert.equal(Object.keys(state.turns).length, 25);
});

test('two concurrent ingest processes both retain their turns', async (t) => {
  const stateDir = await tempDir(t);
  const env = { ANNOTATR_STATE_DIR: stateDir };
  const payloads = ['first', 'second', 'third', 'fourth'].map((word, index) =>
    JSON.stringify({ ...fixture, prompt_id: `prompt-${index}`, last_assistant_message: word }),
  );
  const results = await Promise.all(payloads.map((input) => runCli(['ingest'], { env, input })));
  for (const result of results) assert.equal(result.code, 0, result.stderr);

  const state = await new Store(stateDir).read();
  assert.deepEqual(
    Object.values(state.turns).map((turn) => turn.message).sort(),
    ['first', 'fourth', 'second', 'third'],
  );
});

test('the store file is written whole: no temporary files linger', async (t) => {
  const stateDir = await tempDir(t);
  const store = new Store(stateDir);
  await store.update(() => {});
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(stateDir), ['store.json']);
});
