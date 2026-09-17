import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES, runCli, tempDir } from '../helpers.js';
import { Store, StoreError, defaultStateDir } from '../../src/store/store.js';

const fixtureText = await readFile(join(FIXTURES, 'stop-hook-payload.json'), 'utf8');
const fixture = JSON.parse(fixtureText);

test('SIDESCREEN_STATE_DIR overrides the state directory', () => {
  assert.equal(defaultStateDir({ SIDESCREEN_STATE_DIR: '/tmp/custom' }, '/home/u'), '/tmp/custom');
});

test('the state directory falls back to XDG_STATE_HOME, then ~/.local/state', () => {
  assert.equal(defaultStateDir({ XDG_STATE_HOME: '/xdg/state' }, '/home/u'), '/xdg/state/sidescreen');
  assert.equal(defaultStateDir({}, '/home/u'), '/home/u/.local/state/sidescreen');
});

test('reading a missing store yields an empty state', async (t) => {
  const store = new Store(await tempDir(t));
  assert.deepEqual(await store.read(), { version: 2, turns: {}, sessions: {}, threads: {}, carryBack: {} });
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
  const env = { SIDESCREEN_STATE_DIR: stateDir };
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
  assert.deepEqual(await readdir(stateDir), ['store.json']);
});

test('a version 1 store opens with sessions derived from its turns, and is backed up once on the first write', async (t) => {
  const stateDir = await tempDir(t);
  const turn = (/** @type {string} */ promptId, /** @type {string} */ sessionId, /** @type {string} */ receivedAt) => ({
    promptId,
    sessionId,
    cwd: '/Users/example/proj',
    transcriptPath: `/t/${sessionId}.jsonl`,
    message: `m ${promptId}`,
    receivedAt,
  });
  const v1 = {
    version: 1,
    turns: {
      a1: turn('a1', 'sess-a', '2026-01-02T00:00:00.000Z'),
      a2: turn('a2', 'sess-a', '2026-01-01T00:00:00.000Z'),
      b1: turn('b1', 'sess-b', '2026-01-03T00:00:00.000Z'),
    },
    threads: { th: { id: 'th', promptId: 'a1', sessionId: 'sess-a', exchanges: [] } },
    carryBack: { 'sess-a': [{ id: 'cb', text: 'keep me', threadId: null, addedAt: '2026-01-02T00:00:00.000Z', emittedAt: null }] },
  };
  const original = JSON.stringify(v1, null, 2);
  await writeFile(join(stateDir, 'store.json'), original, 'utf8');

  const store = new Store(stateDir);
  const state = await store.read();
  assert.equal(state.version, 2);
  assert.deepEqual(state.sessions, {
    'sess-a': { sessionId: 'sess-a', cwd: '/Users/example/proj', transcriptPath: '/t/sess-a.jsonl', title: null, startedAt: '2026-01-01T00:00:00.000Z', lastTurnAt: '2026-01-02T00:00:00.000Z' },
    'sess-b': { sessionId: 'sess-b', cwd: '/Users/example/proj', transcriptPath: '/t/sess-b.jsonl', title: null, startedAt: '2026-01-03T00:00:00.000Z', lastTurnAt: '2026-01-03T00:00:00.000Z' },
  });
  assert.deepEqual(state.threads, v1.threads);
  assert.deepEqual(state.carryBack, v1.carryBack);
  assert.deepEqual(await readdir(stateDir), ['store.json'], 'reading alone writes nothing');

  await store.update(() => {});
  assert.deepEqual((await readdir(stateDir)).sort(), ['store.json', 'store.v1.bak']);
  assert.equal(await readFile(join(stateDir, 'store.v1.bak'), 'utf8'), original, 'the backup is the version 1 file byte for byte');
  assert.equal(JSON.parse(await readFile(join(stateDir, 'store.json'), 'utf8')).version, 2);

  await store.update((latest) => {
    latest.turns.c1 = turn('c1', 'sess-c', '2026-01-04T00:00:00.000Z');
  });
  assert.equal(await readFile(join(stateDir, 'store.v1.bak'), 'utf8'), original, 'a later write leaves the backup alone');
  assert.equal(Object.keys((await new Store(stateDir).read()).turns).length, 4);
});

test('a store with an unknown version is refused', async (t) => {
  const stateDir = await tempDir(t);
  await writeFile(join(stateDir, 'store.json'), '{"version": 3, "turns": {}}', 'utf8');
  await assert.rejects(new Store(stateDir).read(), /unsupported version 3/);
});
