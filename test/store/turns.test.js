import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, emptyState } from '../../src/store/store.js';
import { isNewestInSession, recordTurn, removeSession, removeTurn, turnsForSession } from '../../src/store/turns.js';
import { createThread } from '../../src/store/threads.js';
import { addEntry } from '../../src/store/carry-back.js';
import { sessionLabel, upsertSession } from '../../src/store/sessions.js';
import { tempDir } from '../helpers.js';
import { sampleTurn } from '../server-helpers.js';

/**
 * @param {string} promptId
 * @param {Partial<import('../../src/hooks/hook-payload.js').StopHookPayload>} [overrides]
 * @returns {import('../../src/hooks/hook-payload.js').StopHookPayload}
 */
function payload(promptId, overrides = {}) {
  return {
    lastAssistantMessage: `message ${promptId}`,
    sessionId: 'session-1',
    promptId,
    cwd: '/Users/example/proj',
    transcriptPath: '/Users/example/.claude/projects/x/session-1.jsonl',
    stopHookActive: false,
    ...overrides,
  };
}

test('the first turn of a session creates it, labelled by its start time until a title arrives', async (t) => {
  const store = new Store(await tempDir(t));
  const first = await recordTurn(store, payload('p1'), { now: new Date('2026-03-01T10:00:00.000Z') });
  let session = (await store.read()).sessions['session-1'];
  assert.deepEqual(session, {
    sessionId: 'session-1',
    cwd: '/Users/example/proj',
    transcriptPath: '/Users/example/.claude/projects/x/session-1.jsonl',
    title: null,
    startedAt: first.receivedAt,
    lastTurnAt: first.receivedAt,
  });
  assert.equal(sessionLabel(session), new Date(first.receivedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
  assert.equal(first.model, null, 'no model until the caller supplies one');

  const second = await recordTurn(store, payload('p2'), { title: 'Hook installation', now: new Date('2026-03-01T10:05:00.000Z') });
  session = (await store.read()).sessions['session-1'];
  assert.equal(session.title, 'Hook installation');
  assert.equal(sessionLabel(session), 'Hook installation');
  assert.equal(session.startedAt, first.receivedAt);
  assert.equal(session.lastTurnAt, second.receivedAt);

  await recordTurn(store, payload('p3'), { title: null, now: new Date('2026-03-01T10:10:00.000Z') });
  session = (await store.read()).sessions['session-1'];
  assert.equal(session.title, 'Hook installation', 'a turn without a title keeps the one already seen');
  assert.equal(Object.keys((await store.read()).sessions).length, 1);
  assert.deepEqual(
    turnsForSession(await store.read(), 'session-1').map((turn) => turn.promptId),
    ['p3', 'p2', 'p1'],
    'newest first',
  );
});

test('a later turn of a known session takes the session\'s directory, and records the model the caller read', async (t) => {
  const store = new Store(await tempDir(t));
  await recordTurn(store, payload('p1'), { now: new Date('2026-03-01T10:00:00.000Z') });
  const moved = await recordTurn(store, payload('p2', { cwd: '/Users/example/proj/openspec/changes/x' }), {
    model: 'claude-fable-5-1',
    now: new Date('2026-03-01T10:05:00.000Z'),
  });
  assert.equal(moved.cwd, '/Users/example/proj', 'the hook\'s directory followed the shell; the turn takes the session\'s');
  assert.equal(moved.model, 'claude-fable-5-1');
  const state = await store.read();
  assert.equal(state.turns.p2.cwd, '/Users/example/proj');
  assert.equal(state.turns.p2.model, 'claude-fable-5-1');
  assert.equal(state.sessions['session-1'].cwd, '/Users/example/proj', 'the session is unchanged');
  assert.equal(Object.keys(state.sessions).length, 1, 'no second session for the subdirectory');
  assert.equal(isNewestInSession(state, state.turns.p2), true);
  assert.equal(isNewestInSession(state, state.turns.p1), false);

  const fresh = await recordTurn(store, payload('q1', { sessionId: 'session-2', cwd: '/Users/example/proj/sub' }), { now: new Date('2026-03-01T11:00:00.000Z') });
  assert.equal(fresh.cwd, '/Users/example/proj/sub', 'a session\'s first turn sets its directory');
});

test('removing a turn takes its threads, keeps carry-back, and drops the session with its last turn', () => {
  const state = emptyState();
  const t1 = sampleTurn({ promptId: 't1', receivedAt: '2026-01-01T00:00:00.000Z' });
  const t2 = sampleTurn({ promptId: 't2', receivedAt: '2026-01-02T00:00:00.000Z' });
  const t3 = sampleTurn({ promptId: 't3', receivedAt: '2026-01-03T00:00:00.000Z' });
  const otherSession = sampleTurn({ promptId: 'o1', sessionId: 'session-2', receivedAt: '2026-01-04T00:00:00.000Z' });
  for (const turn of [t1, t2, t3, otherSession]) state.turns[turn.promptId] = turn;
  for (const turn of [t1, t2, t3, otherSession]) upsertSession(state, turn);
  const anchor = { start: { path: [0], offset: 0 }, end: { path: [0], offset: 3 }, text: 'The' };
  for (const question of ['a', 'b', 'c']) {
    const thread = createThread({ turn: t3, anchor, selectedText: 'The', question, backend: 'claude' });
    state.threads[thread.id] = thread;
  }
  const kept = createThread({ turn: t2, anchor, selectedText: 'The', question: 'kept', backend: 'claude' });
  state.threads[kept.id] = kept;
  addEntry(state, { sessionId: 'session-1', text: 'A conclusion.' });

  const removed = removeTurn(state, 't3');
  assert.ok(removed);
  assert.equal(removed.removedThreads, 3);
  assert.equal(removed.sessionRemoved, false);
  assert.equal(state.turns.t3, undefined);
  assert.deepEqual(Object.keys(state.threads), [kept.id], 'threads of other turns survive');
  assert.equal(state.sessions['session-1'].lastTurnAt, '2026-01-02T00:00:00.000Z', 'the latest time is recomputed');
  assert.equal(state.carryBack['session-1'].length, 1);

  assert.equal(removeTurn(state, 't3'), null, 'removing again is a no-op');
  assert.equal(removeTurn(state, 't2')?.removedThreads, 1);
  const last = removeTurn(state, 't1');
  assert.equal(last?.sessionRemoved, true);
  assert.equal(state.sessions['session-1'], undefined);
  assert.equal(state.carryBack['session-1'].length, 1, 'carry-back is still owed to the terminal');
  assert.ok(state.sessions['session-2'], 'the other session is untouched');
});

test('removing a session takes every turn and thread of it, keeps carry-back, and leaves other sessions alone', () => {
  const state = emptyState();
  const t1 = sampleTurn({ promptId: 't1', receivedAt: '2026-01-01T00:00:00.000Z' });
  const t2 = sampleTurn({ promptId: 't2', receivedAt: '2026-01-02T00:00:00.000Z' });
  const t3 = sampleTurn({ promptId: 't3', receivedAt: '2026-01-03T00:00:00.000Z' });
  const otherSession = sampleTurn({ promptId: 'o1', sessionId: 'session-2', receivedAt: '2026-01-04T00:00:00.000Z' });
  for (const turn of [t1, t2, t3, otherSession]) state.turns[turn.promptId] = turn;
  for (const turn of [t1, t2, t3, otherSession]) upsertSession(state, turn);
  const anchor = { start: { path: [0], offset: 0 }, end: { path: [0], offset: 3 }, text: 'The' };
  for (const [turn, question] of /** @type {const} */ ([[t3, 'a'], [t3, 'b'], [t2, 'c'], [otherSession, 'other']])) {
    const thread = createThread({ turn, anchor, selectedText: 'The', question, backend: 'claude' });
    state.threads[thread.id] = thread;
  }
  addEntry(state, { sessionId: 'session-1', text: 'A conclusion.' });

  const removed = removeSession(state, 'session-1');
  assert.ok(removed);
  assert.equal(removed.session.sessionId, 'session-1');
  assert.equal(removed.removedTurns, 3);
  assert.equal(removed.removedThreads, 3);
  assert.equal(state.sessions['session-1'], undefined);
  assert.deepEqual(Object.keys(state.turns), ['o1'], 'only the other session\'s turn remains');
  assert.equal(Object.values(state.threads).length, 1, 'only the other session\'s thread remains');
  assert.equal(state.carryBack['session-1'].length, 1, 'carry-back is still owed to the terminal');
  assert.ok(state.sessions['session-2'], 'the other session is untouched');
  assert.equal(removeSession(state, 'session-1'), null, 'removing again is a no-op');
});
