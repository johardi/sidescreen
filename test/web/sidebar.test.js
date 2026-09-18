import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../../src/store/store.js';
import { upsertSession } from '../../src/store/sessions.js';
import { listProjects } from '../../src/store/projects.js';
import { presentSidebar } from '../../src/web/sidebar.js';
import { sampleTurn } from '../server-helpers.js';

test('a session whose label another session of the project shares is flagged, so its start time can be shown beside it', () => {
  const state = emptyState();
  const turns = [
    sampleTurn({ promptId: 'a1', sessionId: 'sess-a', receivedAt: '2026-01-01T00:00:00.000Z' }),
    sampleTurn({ promptId: 'b1', sessionId: 'sess-b', receivedAt: '2026-01-01T01:00:00.000Z' }),
    sampleTurn({ promptId: 'c1', sessionId: 'sess-c', receivedAt: '2026-01-01T02:00:00.000Z' }),
  ];
  for (const turn of turns) {
    state.turns[turn.promptId] = turn;
    upsertSession(state, turn, turn.sessionId === 'sess-c' ? 'Unique title' : 'Shared title');
  }
  const sidebar = presentSidebar(state, listProjects(state)[0]);
  assert.deepEqual(
    sidebar.sessions.map((session) => [session.sessionId, session.sharedLabel]),
    [['sess-c', false], ['sess-b', true], ['sess-a', true]],
  );
});
