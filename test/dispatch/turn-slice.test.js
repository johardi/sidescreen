/**
 * 4.1 to 4.3: locating the reviewed turn in the transcript, rendering its
 * slice, and handing the slice to a cold-started sub-agent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES, tempDir } from '../helpers.js';
import { sampleTurn } from '../server-helpers.js';
import { MAX_TOOL_RESULT_CHARS, TURN_SLICES_DIR, locateTurn, parseTranscript, renderTurnSlice, writeTurnSlice } from '../../src/dispatch/turn-slice.js';
import { dispatchQuestion } from '../../src/dispatch/dispatch.js';
import { createThread } from '../../src/store/threads.js';

const FINAL = 'The lock is a directory because `mkdir` is atomic.\n\nRun `npm test` to confirm.';

/**
 * @param {Record<string, unknown>} fields
 */
const record = (fields) => JSON.stringify({ sessionId: 's', timestamp: '2026-01-01T00:00:00.000Z', ...fields });

/** A transcript with an earlier turn, then the reviewed turn: prompt, thinking, a tool call with a long result, the final message. */
function transcript({ resultChars = 5_000, duplicateFinal = false } = {}) {
  const lines = [
    record({ type: 'user', uuid: 'u0', parentUuid: null, message: { role: 'user', content: 'Earlier question' } }),
    record({ type: 'assistant', uuid: 'a0', parentUuid: 'u0', message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'text', text: duplicateFinal ? FINAL : 'Earlier answer' }] } }),
    record({ type: 'ai-title', aiTitle: 'Locks', sessionId: 's' }),
    record({ type: 'user', uuid: 'u1', parentUuid: 'a0', message: { role: 'user', content: 'Why is the lock a directory?' } }),
    record({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'thinking', thinking: 'Let me look at the store module.' }] } }),
    record({ type: 'assistant', uuid: 'a2', parentUuid: 'a1', message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/store.js' } }] } }),
    record({ type: 'user', uuid: 'u2', parentUuid: 'a2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(resultChars) }] }, toolUseResult: {} }),
    record({ type: 'user', uuid: 'u2m', parentUuid: 'u2', isMeta: true, message: { role: 'user', content: 'a harness note' } }),
    record({ type: 'assistant', uuid: 'a3', parentUuid: 'u2m', message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'text', text: 'Found it.' }] } }),
    record({ type: 'assistant', uuid: 'a4', parentUuid: 'a3', message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'text', text: FINAL }] } }),
    '{"type":"assistant","uuid":"cut',
  ];
  return lines.join('\n') + '\n';
}

test('4.1 the turn is found from its final message and walked back to the user prompt that started it', () => {
  const records = parseTranscript(transcript());
  const turn = locateTurn(records, FINAL);
  assert.ok(turn);
  assert.deepEqual(turn.map((entry) => entry.uuid), ['u1', 'a1', 'a2', 'u2', 'u2m', 'a3', 'a4']);
  assert.ok(locateTurn(records, `  The lock is a directory   because \`mkdir\` is atomic.\nRun \`npm test\` to confirm.  `), 'whitespace differences do not matter');
});

test('4.1 when the final message appears twice the later turn is taken', () => {
  const records = parseTranscript(transcript({ duplicateFinal: true }));
  const turn = locateTurn(records, FINAL);
  assert.ok(turn);
  assert.equal(turn[0].uuid, 'u1', 'the later occurrence, which is the one the hook delivered');
  assert.equal(turn[turn.length - 1].uuid, 'a4');
});

test('4.1 a transcript without the turn, an empty message, or a missing file yields null', async (t) => {
  const records = parseTranscript(transcript());
  assert.equal(locateTurn(records, 'Something never said.'), null);
  assert.equal(locateTurn(records, '   '), null);
  assert.equal(locateTurn([], FINAL), null);
  const dir = await tempDir(t);
  const turn = sampleTurn({ message: FINAL, transcriptPath: join(dir, 'missing.jsonl') });
  assert.equal(await writeTurnSlice({ stateDir: join(dir, 'state'), turn }), null);
  assert.equal(await writeTurnSlice({ stateDir: join(dir, 'state'), turn: sampleTurn({ message: FINAL, transcriptPath: null }) }), null);
});

test('4.2 the slice renders the prompt, reasoning, each tool call with its result cut at 4,000 characters, and the final message', () => {
  const records = locateTurn(parseTranscript(transcript()), FINAL);
  assert.ok(records);
  const turn = sampleTurn({ message: FINAL, promptId: 'p-slice' });
  const markdown = renderTurnSlice(records, { turn });
  assert.equal(MAX_TOOL_RESULT_CHARS, 4_000);
  assert.match(markdown, /^# Turn p-slice/);
  assert.ok(markdown.includes('## User prompt\n\nWhy is the lock a directory?'));
  assert.ok(markdown.includes('### Reasoning\n\nLet me look at the store module.'));
  assert.ok(markdown.includes('### Tool call: Read'));
  assert.ok(markdown.includes('"file_path": "src/store.js"'));
  assert.ok(markdown.includes('Result (first 4,000 of 5,000 characters; 1,000 omitted):'));
  assert.ok(markdown.includes('x'.repeat(4_000)) && !markdown.includes('x'.repeat(4_001)), 'cut at exactly 4,000');
  assert.ok(markdown.includes('### Message\n\nFound it.'));
  assert.ok(markdown.includes(`## Final message\n\n${FINAL}`));
  assert.ok(!markdown.includes('a harness note'), 'meta records are not the prompt');

  const short = renderTurnSlice(/** @type {NonNullable<typeof records>} */ (locateTurn(parseTranscript(transcript({ resultChars: 12 })), FINAL)), { turn });
  assert.ok(short.includes('Result (12 characters):'));
  assert.ok(!short.includes('omitted):'), 'a short result is not cut');
});

test('4.2 the slice is written under the state directory and rewritten on each call', async (t) => {
  const dir = await tempDir(t);
  const transcriptPath = join(dir, 't.jsonl');
  await writeFile(transcriptPath, transcript({ resultChars: 10 }), 'utf8');
  const stateDir = join(dir, 'state');
  const turn = sampleTurn({ message: FINAL, promptId: 'p/1', transcriptPath });
  const first = await writeTurnSlice({ stateDir, turn });
  assert.equal(first, join(stateDir, TURN_SLICES_DIR, `${encodeURIComponent('p/1')}.md`));
  assert.ok((await stat(first ?? '')).isFile());
  assert.ok((await readFile(first ?? '', 'utf8')).includes('Result (10 characters):'));

  await writeFile(transcriptPath, transcript({ resultChars: 20 }), 'utf8');
  const second = await writeTurnSlice({ stateDir, turn });
  assert.equal(second, first);
  assert.ok((await readFile(second ?? '', 'utf8')).includes('Result (20 characters):'), 'the file reflects the transcript as it is now');
});

test('4.3 a cold start names the slice file in the prompt when the turn is found, and says how to find it when not', async (t) => {
  const dir = await tempDir(t);
  const transcriptPath = join(dir, 't.jsonl');
  await writeFile(transcriptPath, transcript(), 'utf8');
  const promptFile = join(dir, 'prompt.txt');
  const env = { ...process.env, SIDESCREEN_CODEX_BIN: join(FIXTURES, 'stub-codex.js'), SIDESCREEN_STATE_DIR: join(dir, 'state'), STUB_CODEX_PROMPT_TO: promptFile };
  const ask = async (/** @type {import('../../src/types.js').Turn} */ turn) => {
    const thread = createThread({ turn, anchor: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 3 }, text: 'The' }, selectedText: 'The', question: 'Why?', backend: 'codex' });
    const result = await dispatchQuestion({ turn, thread, exchange: thread.exchanges[0], question: 'Why?', target: { mode: 'new' }, priorExchanges: [], gap: [], env, stateDir: join(dir, 'state'), conventions: '', timeoutMs: 10_000 });
    assert.ok(result.ok, JSON.stringify(result));
    return readFile(promptFile, 'utf8');
  };

  const found = await ask(sampleTurn({ cwd: dir, message: FINAL, promptId: 'p-found', transcriptPath }));
  const slicePath = join(dir, 'state', TURN_SLICES_DIR, 'p-found.md');
  assert.ok(found.includes(`\`${slicePath}\``), 'the slice path is named under the transcript source');
  assert.ok(found.includes('Start there'));
  assert.ok(found.includes(transcriptPath), 'the full transcript is still offered');
  assert.ok((await readFile(slicePath, 'utf8')).includes('## Final message'));

  const lagging = await ask(sampleTurn({ cwd: dir, message: 'A message the transcript does not hold yet.', promptId: 'p-lag', transcriptPath }));
  assert.ok(lagging.includes('could not be located'));
  assert.ok(lagging.includes('parentUuid'));
  assert.ok(!lagging.includes(TURN_SLICES_DIR));
});
