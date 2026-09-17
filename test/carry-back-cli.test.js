/**
 * Tasks 6.2 to 6.5: the carry-back return path through the real CLI.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES, runCli, tempDir } from './helpers.js';
import { Store } from '../src/store.js';
import { addEntry, EMISSION_HEADER } from '../src/carry-back.js';
import { hookCommand, isSidescreenHookCommand } from '../src/setup-hooks.js';
import { BIN } from './helpers.js';
import { startServer, waitForAnswer } from './server-helpers.js';

const stopPayload = JSON.parse(await readFile(join(FIXTURES, 'stop-hook-payload.json'), 'utf8'));

/** @param {string} sessionId */
const promptSubmitPayload = (sessionId) =>
  JSON.stringify({ session_id: sessionId, transcript_path: '/t.jsonl', cwd: '/p', hook_event_name: 'UserPromptSubmit', prompt: 'next thing' });

test('6.2 --emit prints only the pending entries for the payload session, as plain text', async (t) => {
  const stateDir = await tempDir(t);
  await new Store(stateDir).update((state) => {
    addEntry(state, { sessionId: 'sess-a', text: 'Keep the directory lock.' });
    addEntry(state, { sessionId: 'sess-a', text: 'Rename store.lock to store.lockdir.' });
    addEntry(state, { sessionId: 'sess-b', text: 'A conclusion from another session.' });
  });
  const result = await runCli(['carry-back', '--emit'], { env: { SIDESCREEN_STATE_DIR: stateDir }, input: promptSubmitPayload('sess-a') });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${EMISSION_HEADER}\n- Keep the directory lock.\n- Rename store.lock to store.lockdir.\n`);
});

test('6.2 --emit prints nothing and exits 0 when the list is empty or the store does not exist yet', async (t) => {
  const stateDir = await tempDir(t);
  const missing = await runCli(['carry-back', '--emit'], { env: { SIDESCREEN_STATE_DIR: join(stateDir, 'never-created') }, input: promptSubmitPayload('sess-a') });
  assert.deepEqual(missing, { code: 0, stdout: '', stderr: '' });

  await new Store(stateDir).update((state) => {
    addEntry(state, { sessionId: 'sess-b', text: 'someone else' });
  });
  const empty = await runCli(['carry-back', '--emit'], { env: { SIDESCREEN_STATE_DIR: stateDir }, input: promptSubmitPayload('sess-a') });
  assert.deepEqual(empty, { code: 0, stdout: '', stderr: '' });
});

test('--session names the session when there is no hook payload; bad invocations are reported', async (t) => {
  const stateDir = await tempDir(t);
  await new Store(stateDir).update((state) => {
    addEntry(state, { sessionId: 'sess-a', text: 'By flag.' });
  });
  const byFlag = await runCli(['carry-back', '--emit', '--session', 'sess-a'], { env: { SIDESCREEN_STATE_DIR: stateDir } });
  assert.equal(byFlag.stdout, `${EMISSION_HEADER}\n- By flag.\n`);

  const noEmit = await runCli(['carry-back'], { env: { SIDESCREEN_STATE_DIR: stateDir } });
  assert.equal(noEmit.code, 1);
  assert.match(noEmit.stderr, /expected --emit/);

  const noSession = await runCli(['carry-back', '--emit'], { env: { SIDESCREEN_STATE_DIR: stateDir }, input: '' });
  assert.equal(noSession.code, 1);
  assert.match(noSession.stderr, /no hook payload on stdin/);

  const badPayload = await runCli(['carry-back', '--emit'], { env: { SIDESCREEN_STATE_DIR: stateDir }, input: '{"prompt": "x"}' });
  assert.equal(badPayload.code, 1);
  assert.match(badPayload.stderr, /session_id/);
});

test('6.3 setup hooks registers the UserPromptSubmit hook, once per event, however often it runs', async (t) => {
  const settingsPath = join(await tempDir(t), 'settings.json');
  for (const expected of [/UserPromptSubmit: added/, /UserPromptSubmit: unchanged/, /UserPromptSubmit: unchanged/]) {
    const result = await runCli(['setup', 'hooks', '--settings', settingsPath]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, expected);
  }
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  for (const [event, subcommand] of [['Stop', 'ingest'], ['UserPromptSubmit', 'carry-back --emit']]) {
    const commands = settings.hooks[event].flatMap((/** @type {{ hooks: { command: string }[] }} */ group) => group.hooks.map((hook) => hook.command));
    assert.deepEqual(commands, [hookCommand(BIN, subcommand)], `${event} has exactly one entry`);
    assert.ok(isSidescreenHookCommand(commands[0], subcommand));
  }
});

test('6.4 emitted entries are not emitted again: the second emit prints nothing', async (t) => {
  const stateDir = await tempDir(t);
  await new Store(stateDir).update((state) => {
    addEntry(state, { sessionId: 'sess-a', text: 'Once only.' });
  });
  const env = { SIDESCREEN_STATE_DIR: stateDir };
  const first = await runCli(['carry-back', '--emit'], { env, input: promptSubmitPayload('sess-a') });
  assert.equal(first.stdout, `${EMISSION_HEADER}\n- Once only.\n`);
  const second = await runCli(['carry-back', '--emit'], { env, input: promptSubmitPayload('sess-a') });
  assert.deepEqual(second, { code: 0, stdout: '', stderr: '' });

  const state = await new Store(stateDir).read();
  assert.match(state.carryBack['sess-a'][0].emittedAt ?? '', /^\d{4}-/);
});

test('6.5 end to end: thread contents never appear in the emitted output, only carry-back entries', async (t) => {
  const stateDir = await tempDir(t);
  const env = { SIDESCREEN_STATE_DIR: stateDir };
  const QUESTION = 'QUESTION-MARKER why is the lock a directory?';
  const ANSWER = 'ANSWER-MARKER because mkdir is atomic.';
  const SOURCE_DETAIL = 'SOURCEDETAIL-MARKER src/store.js:1';
  const CONCLUSION = 'CONCLUSION-MARKER keep the directory lock.';

  // 1. A turn arrives through the real ingest command.
  const ingest = await runCli(['ingest'], { env, input: JSON.stringify({ ...stopPayload, last_assistant_message: 'The store uses a directory lock.' }) });
  assert.equal(ingest.code, 0, ingest.stderr);

  // 2. A question is asked and answered, and one conclusion is carried back.
  const store = new Store(stateDir);
  const { url } = await startServer(t, {
    stateDir,
    turns: [],
    dispatch: async () => ({ ok: true, answer: { text: ANSWER, source: 'code', sourceDetail: SOURCE_DETAIL }, subAgentSessionId: 'sub' }),
  });
  const created = await fetch(new URL(`/api/turns/${stopPayload.prompt_id}/threads`, url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anchor: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 3 }, text: 'The' }, selectedText: 'The', question: QUESTION }),
  });
  assert.equal(created.status, 201);
  const { thread } = await created.json();
  const answered = await waitForAnswer(url, thread.id);
  assert.equal(answered.exchanges[0].answer.text, ANSWER);
  const added = await fetch(new URL(`/api/sessions/${stopPayload.session_id}/carry-back`, url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: CONCLUSION, threadId: thread.id }),
  });
  assert.equal(added.status, 201);

  // 3. The next prompt's hook emits the conclusion and nothing from the thread.
  const emitted = await runCli(['carry-back', '--emit'], { env, input: promptSubmitPayload(stopPayload.session_id) });
  assert.equal(emitted.code, 0, emitted.stderr);
  assert.equal(emitted.stdout, `${EMISSION_HEADER}\n- ${CONCLUSION}\n`);
  assert.doesNotMatch(emitted.stdout, /QUESTION-MARKER|ANSWER-MARKER|SOURCEDETAIL-MARKER/, 'no question, answer, or source detail leaks');
  assert.doesNotMatch(emitted.stdout, new RegExp(thread.id), 'no thread id leaks');
  assert.doesNotMatch(emitted.stdout, /The store uses a directory lock/, 'the turn text does not leak');

  // The thread itself is intact, so the leak check tested real content.
  const stored = await store.read();
  assert.equal(stored.threads[thread.id].exchanges[0].question, QUESTION);
});
