/**
 * 7.2: the ingest path never reads `transcript_path` for the current turn's
 * text. The transcript lags the turn, so reading it would render stale output.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, runCli, tempDir } from '../helpers.js';
import { Store } from '../../src/store/store.js';

const fixture = JSON.parse(await readFile(join(FIXTURES, 'stop-hook-payload.json'), 'utf8'));
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

test('the stored turn text is the payload message even when the transcript says otherwise', async (t) => {
  const dir = await tempDir(t);
  const transcript = join(dir, 'transcript.jsonl');
  await writeFile(
    transcript,
    [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'STALE TRANSCRIPT TEXT' }] } }),
    ].join('\n'),
    'utf8',
  );
  const stateDir = join(dir, 'state');
  const result = await runCli(['ingest'], {
    env: { SIDESCREEN_STATE_DIR: stateDir },
    input: JSON.stringify({ ...fixture, transcript_path: transcript, last_assistant_message: 'FRESH HOOK TEXT' }),
  });
  assert.equal(result.code, 0, result.stderr);
  const turn = (await new Store(stateDir).read()).turns[fixture.prompt_id];
  assert.equal(turn.message, 'FRESH HOOK TEXT');
  assert.doesNotMatch(turn.message, /STALE/);
  assert.equal(turn.transcriptPath, transcript, 'the path is kept for later evidence lookups, not read now');
});

test('ingest succeeds when the transcript path is unreadable, because it never opens it', async (t) => {
  const dir = await tempDir(t);
  const stateDir = join(dir, 'state');
  const asDirectory = join(dir, 'transcript-is-a-directory.jsonl');
  await mkdir(asDirectory);
  for (const transcriptPath of [join(dir, 'does-not-exist.jsonl'), asDirectory]) {
    const result = await runCli(['ingest'], {
      env: { SIDESCREEN_STATE_DIR: stateDir },
      input: JSON.stringify({ ...fixture, prompt_id: `p-${transcriptPath.length}`, transcript_path: transcriptPath, last_assistant_message: 'text' }),
    });
    assert.equal(result.code, 0, result.stderr);
  }
  assert.equal(Object.keys((await new Store(stateDir).read()).turns).length, 2);
});

test('the ingest modules have no filesystem access of their own, and the transcript path reaches only the label reader', async () => {
  for (const file of ['hooks/ingest.js', 'hooks/hook-payload.js', 'store/turns.js', 'store/sessions.js']) {
    const source = await readFile(join(SRC, file), 'utf8');
    assert.doesNotMatch(source, /['"]node:fs|['"]fs['"]|readFile|createReadStream|openSync|readline/, `${file} must not read files`);
    const handedTo = [...source.matchAll(/(\w+)\(\s*payload\.transcriptPath\s*\)/g)].map((match) => match[1]);
    assert.deepEqual(new Set(handedTo), new Set(file === 'hooks/ingest.js' ? ['readLabels'] : []), `${file} may hand the transcript path to the label reader and nothing else`);
    assert.doesNotMatch(source.replaceAll('readLabels(payload.transcriptPath)', ''), /transcriptPath\s*\)/, `${file} must not pass the transcript path to anything else`);
  }
  const titleReader = await readFile(join(SRC, 'hooks/session-title.js'), 'utf8');
  assert.doesNotMatch(titleReader, /lastAssistantMessage|last_assistant_message|\.message\b|"assistant"/, 'the title reader never looks at messages');
  const labelReader = await readFile(join(SRC, 'hooks/transcript-labels.js'), 'utf8');
  assert.doesNotMatch(labelReader, /lastAssistantMessage|last_assistant_message|\.content\b|\.text\b/, 'the label reader takes the model name from a record and never its text');
});
