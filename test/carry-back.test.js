import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { emptyState, Store } from '../src/store.js';
import { EMISSION_HEADER, addEntry, emitCarryBack, formatEmission, pendingEntries, removeEntry } from '../src/carry-back.js';
import { HookPayloadError, parseUserPromptSubmitPayload } from '../src/hook-payload.js';
import { tempDir } from './helpers.js';
import { rawRequest, sampleTurn, startServer, turnHref } from './server-helpers.js';

/** A writable that collects what is written to it. */
function sink() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += String(chunk);
      callback();
    },
  });
  return { stream, read: () => text };
}

test('entries are kept per session, pending until emitted', () => {
  const state = emptyState();
  const first = addEntry(state, { sessionId: 's1', text: '  Use a directory lock.  ' });
  addEntry(state, { sessionId: 's2', text: 'Other session' });
  assert.equal(first.text, 'Use a directory lock.');
  assert.equal(first.emittedAt, null);
  assert.deepEqual(pendingEntries(state, 's1').map((entry) => entry.text), ['Use a directory lock.']);
  assert.deepEqual(pendingEntries(state, 'unknown'), []);
  assert.equal(removeEntry(state, 's1', first.id), true);
  assert.equal(removeEntry(state, 's1', first.id), false);
  assert.deepEqual(pendingEntries(state, 's1'), []);
});

test('the emission is plain text: a header and one line per entry, or nothing at all', () => {
  assert.equal(formatEmission([]), '');
  const state = emptyState();
  addEntry(state, { sessionId: 's', text: 'First conclusion.' });
  addEntry(state, { sessionId: 's', text: 'Second, with\na line break.' });
  assert.equal(formatEmission(pendingEntries(state, 's')), `${EMISSION_HEADER}\n- First conclusion.\n- Second, with a line break.\n`);
});

test('emitting prints the pending entries once and marks exactly those emitted', async (t) => {
  const store = new Store(await tempDir(t));
  await store.update((state) => {
    addEntry(state, { sessionId: 's', text: 'Alpha' });
    addEntry(state, { sessionId: 's', text: 'Beta' });
    addEntry(state, { sessionId: 'other', text: 'Not this session' });
  });

  const first = sink();
  assert.equal(await emitCarryBack({ store, sessionId: 's', stdout: first.stream }), 2);
  assert.equal(first.read(), `${EMISSION_HEADER}\n- Alpha\n- Beta\n`);

  const second = sink();
  assert.equal(await emitCarryBack({ store, sessionId: 's', stdout: second.stream }), 0);
  assert.equal(second.read(), '', 'a second emit prints nothing');

  await store.update((state) => {
    addEntry(state, { sessionId: 's', text: 'Gamma, added later' });
  });
  const third = sink();
  assert.equal(await emitCarryBack({ store, sessionId: 's', stdout: third.stream }), 1);
  assert.equal(third.read(), `${EMISSION_HEADER}\n- Gamma, added later\n`);

  const state = await store.read();
  assert.deepEqual(
    state.carryBack.s.map((entry) => [entry.text, entry.emittedAt !== null]),
    [['Alpha', true], ['Beta', true], ['Gamma, added later', true]],
  );
  assert.equal(state.carryBack.other[0].emittedAt, null, 'other sessions are untouched');
});

test('the UserPromptSubmit payload parser needs only the session id', () => {
  const payload = parseUserPromptSubmitPayload({ session_id: 'abc', transcript_path: '/t', cwd: '/p', hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
  assert.deepEqual(payload, { sessionId: 'abc', cwd: '/p', prompt: 'hi' });
  assert.deepEqual(parseUserPromptSubmitPayload({ session_id: 'abc' }), { sessionId: 'abc', cwd: null, prompt: '' });
  assert.throws(() => parseUserPromptSubmitPayload({ prompt: 'no session' }), HookPayloadError);
  assert.throws(() => parseUserPromptSubmitPayload('nope'), HookPayloadError);
});

test('the API adds, lists, and removes entries for a session, and the turn page carries them', async (t) => {
  const { url, port } = await startServer(t);
  const base = new URL('/api/sessions/session-1/carry-back', url);
  const added = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Keep the directory lock.' }) });
  assert.equal(added.status, 201);
  const { entry, entries } = await added.json();
  assert.equal(entry.text, 'Keep the directory lock.');
  assert.equal(entries.length, 1);

  assert.equal((await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '   ' }) })).status, 400);

  const listed = await (await fetch(base)).json();
  assert.deepEqual(listed.entries.map((/** @type {{ text: string }} */ e) => e.text), ['Keep the directory lock.']);

  const page = await (await fetch(new URL(turnHref(sampleTurn()), url))).text();
  assert.match(page, /"carryBack":\[\{"id":/);
  assert.match(page, /<section class="carry-back" id="carry-back"/);

  const otherSession = await (await fetch(new URL('/api/sessions/session-2/carry-back', url))).json();
  assert.deepEqual(otherSession.entries, []);

  const crossSite = await rawRequest({ port, path: `/api/sessions/session-1/carry-back/${entry.id}`, method: 'DELETE', headers: { Origin: 'https://evil.example' } });
  assert.equal(crossSite.status, 403);
  const removed = await fetch(new URL(`/api/sessions/session-1/carry-back/${entry.id}`, url), { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.deepEqual((await removed.json()).entries, []);
  assert.equal((await fetch(new URL(`/api/sessions/session-1/carry-back/${entry.id}`, url), { method: 'DELETE' })).status, 404);
});

test('turns from different sessions see different carry-back lists', async (t) => {
  const { url } = await startServer(t, { turns: [sampleTurn(), sampleTurn({ promptId: 'prompt-2', sessionId: 'session-2' })] });
  await fetch(new URL('/api/sessions/session-2/carry-back', url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Only in session two' }) });
  const one = await (await fetch(new URL('/api/turns/prompt-1', url))).json();
  const two = await (await fetch(new URL('/api/turns/prompt-2', url))).json();
  assert.deepEqual(one.carryBack, []);
  assert.equal(two.carryBack[0].text, 'Only in session two');
});
