import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES, runCli, tempDir } from '../helpers.js';
import { Store } from '../../src/store/store.js';

const fixtureText = await readFile(join(FIXTURES, 'stop-hook-payload.json'), 'utf8');
const fixture = JSON.parse(fixtureText);

test('piping the captured probe payload into ingest creates a retrievable turn', async (t) => {
  const stateDir = await tempDir(t);
  const result = await runCli(['ingest'], { env: { SIDESCREEN_STATE_DIR: stateDir }, input: fixtureText });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '', 'ingest stays silent so the hook adds nothing to the transcript');

  const state = await new Store(stateDir).read();
  const turn = state.turns[fixture.prompt_id];
  assert.ok(turn, 'turn is keyed by prompt_id');
  assert.equal(turn.message, 'banana');
  assert.equal(turn.sessionId, fixture.session_id);
  assert.equal(turn.cwd, fixture.cwd);
  assert.equal(turn.transcriptPath, fixture.transcript_path);
  assert.equal(turn.model, null, 'the fixture transcript does not exist, so no model');
  assert.match(turn.receivedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('a second Stop for the same prompt_id replaces the turn rather than duplicating it', async (t) => {
  const stateDir = await tempDir(t);
  const env = { SIDESCREEN_STATE_DIR: stateDir };
  await runCli(['ingest'], { env, input: fixtureText });
  await runCli(['ingest'], { env, input: JSON.stringify({ ...fixture, last_assistant_message: 'banana, revised' }) });

  const state = await new Store(stateDir).read();
  assert.equal(Object.keys(state.turns).length, 1);
  assert.equal(state.turns[fixture.prompt_id].message, 'banana, revised');
});

test('ingest records the session and reads its title from the transcript, keeping it when a later transcript has none', async (t) => {
  const dir = await tempDir(t);
  const stateDir = join(dir, 'state');
  const env = { SIDESCREEN_STATE_DIR: stateDir };
  const untitled = join(dir, 'untitled.jsonl');
  await writeFile(untitled, JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }) + '\n', 'utf8');
  const titled = join(dir, 'titled.jsonl');
  await writeFile(titled, JSON.stringify({ type: 'ai-title', aiTitle: 'Project level hook installation', sessionId: fixture.session_id }) + '\n', 'utf8');

  await runCli(['ingest'], { env, input: JSON.stringify({ ...fixture, prompt_id: 'first', transcript_path: untitled }) });
  let session = (await new Store(stateDir).read()).sessions[fixture.session_id];
  assert.ok(session, 'the session is recorded with its first turn');
  assert.equal(session.title, null, 'no title yet');
  assert.equal(session.cwd, fixture.cwd);

  await runCli(['ingest'], { env, input: JSON.stringify({ ...fixture, prompt_id: 'second', transcript_path: titled }) });
  session = (await new Store(stateDir).read()).sessions[fixture.session_id];
  assert.equal(session.title, 'Project level hook installation');

  await runCli(['ingest'], { env, input: JSON.stringify({ ...fixture, prompt_id: 'third', transcript_path: untitled }) });
  session = (await new Store(stateDir).read()).sessions[fixture.session_id];
  assert.equal(session.title, 'Project level hook installation', 'a title once seen is kept');
  assert.ok(session.lastTurnAt >= session.startedAt);
});

test('ingest records the model the transcript names for the turn, and null when the transcript lags', async (t) => {
  const dir = await tempDir(t);
  const stateDir = join(dir, 'state');
  const env = { SIDESCREEN_STATE_DIR: stateDir };
  const named = join(dir, 'named.jsonl');
  await writeFile(named, JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'text', text: 'banana' }] } }) + '\n', 'utf8');

  await runCli(['ingest'], { env, input: JSON.stringify({ ...fixture, prompt_id: 'named', transcript_path: named }) });
  await runCli(['ingest'], { env, input: JSON.stringify({ ...fixture, prompt_id: 'lagging', transcript_path: join(dir, 'not-yet-written.jsonl') }) });
  const state = await new Store(stateDir).read();
  assert.equal(state.turns.named.model, 'claude-fable-5-1');
  assert.equal(state.turns.lagging.model, null);
  assert.equal(state.turns.lagging.message, 'banana', 'the turn is otherwise exactly as it would be with a model');
  assert.equal(state.turns.lagging.sessionId, fixture.session_id);
});

test('inside a sub-agent sidescreen started, ingest stores nothing and exits 0', async (t) => {
  const stateDir = await tempDir(t);
  const result = await runCli(['ingest'], { env: { SIDESCREEN_STATE_DIR: stateDir, SIDESCREEN_SUBAGENT: '1' }, input: fixtureText });
  assert.deepEqual(result, { code: 0, stdout: '', stderr: '' });
  await assert.rejects(access(join(stateDir, 'store.json')), 'no store file is created');
});

test('a malformed payload exits 1 with a message and writes nothing', async (t) => {
  const stateDir = await tempDir(t);
  const result = await runCli(['ingest'], { env: { SIDESCREEN_STATE_DIR: stateDir }, input: '{"session_id": "x"}' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /missing required field "last_assistant_message"/);
  await assert.rejects(access(join(stateDir, 'store.json')), 'no store file should be created');
});
