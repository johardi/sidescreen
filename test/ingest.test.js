import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES, runCli, tempDir } from './helpers.js';
import { Store } from '../src/store.js';

const fixtureText = await readFile(join(FIXTURES, 'stop-hook-payload.json'), 'utf8');
const fixture = JSON.parse(fixtureText);

test('piping the captured probe payload into ingest creates a retrievable turn', async (t) => {
  const stateDir = await tempDir(t);
  const result = await runCli(['ingest'], { env: { ANNOTATR_STATE_DIR: stateDir }, input: fixtureText });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '', 'ingest stays silent so the hook adds nothing to the transcript');

  const state = await new Store(stateDir).read();
  const turn = state.turns[fixture.prompt_id];
  assert.ok(turn, 'turn is keyed by prompt_id');
  assert.equal(turn.message, 'banana');
  assert.equal(turn.sessionId, fixture.session_id);
  assert.equal(turn.cwd, fixture.cwd);
  assert.equal(turn.transcriptPath, fixture.transcript_path);
  assert.match(turn.receivedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('a second Stop for the same prompt_id replaces the turn rather than duplicating it', async (t) => {
  const stateDir = await tempDir(t);
  const env = { ANNOTATR_STATE_DIR: stateDir };
  await runCli(['ingest'], { env, input: fixtureText });
  await runCli(['ingest'], { env, input: JSON.stringify({ ...fixture, last_assistant_message: 'banana, revised' }) });

  const state = await new Store(stateDir).read();
  assert.equal(Object.keys(state.turns).length, 1);
  assert.equal(state.turns[fixture.prompt_id].message, 'banana, revised');
});

test('a malformed payload exits 1 with a message and writes nothing', async (t) => {
  const stateDir = await tempDir(t);
  const result = await runCli(['ingest'], { env: { ANNOTATR_STATE_DIR: stateDir }, input: '{"session_id": "x"}' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /missing required field "last_assistant_message"/);
  await assert.rejects(access(join(stateDir, 'store.json')), 'no store file should be created');
});
