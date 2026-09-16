import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeProject, findProject, listProjects, projectId, projectPath, sessionPath, turnPath } from '../src/projects.js';
import { emptyState } from '../src/store.js';
import { upsertSession } from '../src/sessions.js';
import { sampleTurn } from './server-helpers.js';

test('a project id is a stable 12-character hash that carries no path segment', () => {
  const id = projectId('/Users/example/proj');
  assert.equal(id, projectId('/Users/example/proj'));
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.notEqual(id, projectId('/Users/example/proj2'));
  assert.notEqual(id, projectId('/Users/other/proj'), 'two directories that share a name are two projects');
  assert.doesNotMatch(id, /proj|example|Users/);
});

test('projects are derived from sessions and ordered by latest turn', () => {
  const state = emptyState();
  upsertSession(state, sampleTurn({ sessionId: 'a', cwd: '/w/alpha', receivedAt: '2026-01-01T00:00:00.000Z' }));
  upsertSession(state, sampleTurn({ sessionId: 'b', cwd: '/w/alpha', receivedAt: '2026-01-03T00:00:00.000Z' }));
  upsertSession(state, sampleTurn({ sessionId: 'c', cwd: '/w/beta', receivedAt: '2026-01-02T00:00:00.000Z' }));
  const projects = listProjects(state);
  assert.deepEqual(
    projects.map(({ name, cwd, sessionCount, lastTurnAt }) => ({ name, cwd, sessionCount, lastTurnAt })),
    [
      { name: 'alpha', cwd: '/w/alpha', sessionCount: 2, lastTurnAt: '2026-01-03T00:00:00.000Z' },
      { name: 'beta', cwd: '/w/beta', sessionCount: 1, lastTurnAt: '2026-01-02T00:00:00.000Z' },
    ],
  );
  assert.equal(projects[0].id, projectId('/w/alpha'));
});

test('an unknown id resolves against directories the caller knows, else to null', () => {
  const state = emptyState();
  upsertSession(state, sampleTurn({ cwd: '/w/alpha' }));
  assert.equal(findProject(state, projectId('/w/alpha'))?.cwd, '/w/alpha');
  assert.deepEqual(findProject(state, projectId('/w/own'), ['/w/own']), describeProject('/w/own'));
  assert.equal(findProject(state, projectId('/w/own'), ['/w/own'])?.sessionCount, 0);
  assert.equal(findProject(state, 'nope', ['/w/own']), null);
});

test('addresses nest project, session, and turn, with every segment encoded', () => {
  assert.equal(projectPath('abc'), '/projects/abc');
  assert.equal(sessionPath('abc', 's 1'), '/projects/abc/sessions/s%201');
  assert.equal(turnPath('abc', 's', 'p/q'), '/projects/abc/sessions/s/turns/p%2Fq');
});
