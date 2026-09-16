import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lastTitleIn, readSessionTitle } from '../src/session-title.js';
import { tempDir } from './helpers.js';

const title = (/** @type {string} */ text) => JSON.stringify({ type: 'ai-title', aiTitle: text, sessionId: 's' });
const other = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'not a title' }] } });

test('the last well-formed title record wins, and malformed lines are skipped', () => {
  assert.equal(lastTitleIn([other, title('First title'), other, title('Second title'), other].join('\n')), 'Second title');
  assert.equal(lastTitleIn(['{"type":"ai-title","aiTitle":"cut off', title('Whole'), 'garbage "ai-title" here'].join('\n')), 'Whole');
  assert.equal(lastTitleIn([other, other].join('\n')), null);
  assert.equal(lastTitleIn(''), null);
  assert.equal(lastTitleIn(JSON.stringify({ type: 'ai-title', aiTitle: '   ' })), null, 'a blank title is no title');
  assert.equal(lastTitleIn(JSON.stringify({ type: 'ai-title', aiTitle: 42 })), null);
});

test('a transcript with a title yields it, one without yields null', async (t) => {
  const dir = await tempDir(t);
  const titled = join(dir, 'titled.jsonl');
  await writeFile(titled, [other, title('Carry-back feature testing'), other].join('\n') + '\n', 'utf8');
  assert.equal(await readSessionTitle(titled), 'Carry-back feature testing');

  const untitled = join(dir, 'untitled.jsonl');
  await writeFile(untitled, [other, other].join('\n') + '\n', 'utf8');
  assert.equal(await readSessionTitle(untitled), null);

  const empty = join(dir, 'empty.jsonl');
  await writeFile(empty, '', 'utf8');
  assert.equal(await readSessionTitle(empty), null);
});

test('a missing path, an unreadable path, or no path at all is null, never an error', async (t) => {
  const dir = await tempDir(t);
  const asDirectory = join(dir, 'transcript-is-a-directory.jsonl');
  await mkdir(asDirectory);
  assert.equal(await readSessionTitle(join(dir, 'does-not-exist.jsonl')), null);
  assert.equal(await readSessionTitle(asDirectory), null);
  assert.equal(await readSessionTitle(null), null);
  assert.equal(await readSessionTitle(''), null);
});

test('only the tail of the transcript is read', async (t) => {
  const dir = await tempDir(t);
  const path = join(dir, 'long.jsonl');
  const early = title('Early title');
  const filler = Array.from({ length: 50 }, () => other).join('\n');
  await writeFile(path, [early, filler, title('Late title')].join('\n') + '\n', 'utf8');
  assert.equal(await readSessionTitle(path, { tailBytes: 200 }), 'Late title', 'the late title sits inside the window');

  await writeFile(path, [early, filler].join('\n') + '\n', 'utf8');
  assert.equal(await readSessionTitle(path, { tailBytes: 200 }), null, 'the early title sits outside the window');
  assert.equal(await readSessionTitle(path), 'Early title', 'the default window covers the whole file');
});
