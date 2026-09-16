/**
 * Projects: one per distinct working directory that has delivered a turn.
 *
 * Nothing is stored about a project. It is derived from the sessions, and its
 * id is a short hash of the directory so the path never appears in a URL.
 */

import { createHash } from 'node:crypto';
import { baseName } from './format.js';

/** @typedef {import('./types.js').State} State */

/**
 * @typedef {object} Project
 * @property {string} id Stable, path-free identifier.
 * @property {string} cwd The exact directory as the hook reported it.
 * @property {string} name The directory's last segment.
 * @property {number} sessionCount
 * @property {string|null} lastTurnAt ISO timestamp of the project's latest turn, or null with no turns.
 */

export const PROJECT_ID_LENGTH = 12;

/**
 * @param {string} cwd
 * @returns {string}
 */
export function projectId(cwd) {
  return createHash('sha256').update(cwd).digest('hex').slice(0, PROJECT_ID_LENGTH);
}

/**
 * A project with no sessions yet, for a directory the server knows by other means.
 *
 * @param {string} cwd
 * @returns {Project}
 */
export function describeProject(cwd) {
  return { id: projectId(cwd), cwd, name: baseName(cwd), sessionCount: 0, lastTurnAt: null };
}

/**
 * Every project with at least one session, latest turn first.
 *
 * @param {State} state
 * @returns {Project[]}
 */
export function listProjects(state) {
  /** @type {Map<string, Project>} */
  const byCwd = new Map();
  for (const session of Object.values(state.sessions)) {
    const project = byCwd.get(session.cwd) ?? describeProject(session.cwd);
    project.sessionCount += 1;
    if (project.lastTurnAt === null || session.lastTurnAt > project.lastTurnAt) project.lastTurnAt = session.lastTurnAt;
    byCwd.set(session.cwd, project);
  }
  return [...byCwd.values()].sort((a, b) => (b.lastTurnAt ?? '').localeCompare(a.lastTurnAt ?? ''));
}

/**
 * Resolve a project id, against the sessions first and then against
 * directories the caller knows of, such as the server's own.
 *
 * @param {State} state
 * @param {string} id
 * @param {string[]} [knownCwds]
 * @returns {Project|null}
 */
export function findProject(state, id, knownCwds = []) {
  const fromSessions = listProjects(state).find((project) => project.id === id);
  if (fromSessions) return fromSessions;
  const cwd = knownCwds.find((candidate) => projectId(candidate) === id);
  return cwd === undefined ? null : describeProject(cwd);
}

/** @param {string} id */
export function projectPath(id) {
  return `/projects/${encodeURIComponent(id)}`;
}

/**
 * @param {string} id
 * @param {string} sessionId
 */
export function sessionPath(id, sessionId) {
  return `${projectPath(id)}/sessions/${encodeURIComponent(sessionId)}`;
}

/**
 * @param {string} id
 * @param {string} sessionId
 * @param {string} promptId
 */
export function turnPath(id, sessionId, promptId) {
  return `${sessionPath(id, sessionId)}/turns/${encodeURIComponent(promptId)}`;
}
