import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lastModelIn, readTranscriptLabels } from '../../src/hooks/transcript-labels.js';
import { tempDir } from '../helpers.js';

const assistant = (/** @type {string|undefined} */ model, text = 'hello') =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', ...(model === undefined ? {} : { model }), content: [{ type: 'text', text }] } });
const user = JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } });
const title = JSON.stringify({ type: 'ai-title', aiTitle: 'Model pinning', sessionId: 's' });

test('the last well-formed assistant record names the model, and malformed or modelless lines are skipped', () => {
  assert.equal(lastModelIn([user, assistant('claude-opus-5'), user, assistant('claude-fable-5-1')].join('\n')), 'claude-fable-5-1');
  assert.equal(lastModelIn([assistant('claude-opus-5'), '{"type":"assistant","message":{"model":"cut', 'garbage "assistant" here'].join('\n')), 'claude-opus-5');
  assert.equal(lastModelIn([user, user].join('\n')), null, 'no assistant record');
  assert.equal(lastModelIn(assistant(undefined)), null, 'an assistant record without a model');
  assert.equal(lastModelIn(JSON.stringify({ type: 'assistant', message: { model: '   ' } })), null, 'a blank model is no model');
  assert.equal(lastModelIn(JSON.stringify({ type: 'user', message: { model: 'claude-x' } })), null, 'only assistant records count');
  assert.equal(lastModelIn(''), null);
});

test('both labels are read from one tail, each null on its own when absent', async (t) => {
  const dir = await tempDir(t);
  const both = join(dir, 'both.jsonl');
  await writeFile(both, [user, assistant('claude-fable-5-1'), title].join('\n') + '\n', 'utf8');
  assert.deepEqual(await readTranscriptLabels(both), { title: 'Model pinning', model: 'claude-fable-5-1' });

  const modelOnly = join(dir, 'model-only.jsonl');
  await writeFile(modelOnly, [user, assistant('claude-fable-5-1')].join('\n') + '\n', 'utf8');
  assert.deepEqual(await readTranscriptLabels(modelOnly), { title: null, model: 'claude-fable-5-1' });

  const titleOnly = join(dir, 'title-only.jsonl');
  await writeFile(titleOnly, [user, title].join('\n') + '\n', 'utf8');
  assert.deepEqual(await readTranscriptLabels(titleOnly), { title: 'Model pinning', model: null });
});

test('a missing path, an unreadable path, an empty file, or no path at all yields no labels, never an error', async (t) => {
  const dir = await tempDir(t);
  const asDirectory = join(dir, 'transcript-is-a-directory.jsonl');
  await mkdir(asDirectory);
  const empty = join(dir, 'empty.jsonl');
  await writeFile(empty, '', 'utf8');
  for (const path of [join(dir, 'does-not-exist.jsonl'), asDirectory, empty, null, '']) {
    assert.deepEqual(await readTranscriptLabels(path), { title: null, model: null }, String(path));
  }
});

test('only the tail is read, so an early model outside the window is not seen', async (t) => {
  const dir = await tempDir(t);
  const path = join(dir, 'long.jsonl');
  const filler = Array.from({ length: 50 }, () => user).join('\n');
  await writeFile(path, [assistant('claude-early'), filler].join('\n') + '\n', 'utf8');
  assert.equal((await readTranscriptLabels(path, { tailBytes: 200 })).model, null);
  assert.equal((await readTranscriptLabels(path)).model, 'claude-early', 'the default window covers the whole file');
});
