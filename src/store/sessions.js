/**
 * Sessions: one record per harness session id, materialized because the
 * sidebar orders by latest turn and the title needs a home.
 *
 * Projects are not stored. They are derived from the sessions' directories,
 * see projects.js.
 */

import { formatTime } from '../format.js';

/** @typedef {import('../types.js').State} State */
/** @typedef {import('../types.js').Turn} Turn */
/** @typedef {import('../types.js').Session} Session */

/**
 * A session record as it stands after one turn.
 *
 * @param {Turn} turn
 * @param {string|null} [title]
 * @returns {Session}
 */
export function sessionFromTurn(turn, title = null) {
  return {
    sessionId: turn.sessionId,
    cwd: turn.cwd,
    transcriptPath: turn.transcriptPath,
    title,
    startedAt: turn.receivedAt,
    lastTurnAt: turn.receivedAt,
  };
}

/**
 * Record a turn against its session, creating the session on its first turn.
 * A title replaces the stored one; no title leaves the stored one alone, since
 * a title once seen is still right.
 *
 * @param {State} state
 * @param {Turn} turn
 * @param {string|null} [title]
 * @returns {Session}
 */
export function upsertSession(state, turn, title = null) {
  const existing = state.sessions[turn.sessionId];
  if (!existing) {
    const created = sessionFromTurn(turn, title);
    state.sessions[turn.sessionId] = created;
    return created;
  }
  if (turn.receivedAt < existing.startedAt) existing.startedAt = turn.receivedAt;
  if (turn.receivedAt > existing.lastTurnAt) existing.lastTurnAt = turn.receivedAt;
  if (turn.transcriptPath !== null) existing.transcriptPath = turn.transcriptPath;
  if (title !== null) existing.title = title;
  return existing;
}

/**
 * Sessions rebuilt from turns alone, for a store written before sessions existed.
 *
 * @param {Record<string, Turn>} turns
 * @returns {Record<string, Session>}
 */
export function deriveSessions(turns) {
  /** @type {State} */
  const scratch = { version: 3, turns: {}, sessions: {}, threads: {}, carryBack: {} };
  for (const turn of Object.values(turns)) upsertSession(scratch, turn);
  return scratch.sessions;
}

/**
 * Recompute a session's times from the turns that remain. Returns false when
 * none remain, in which case the caller drops the session.
 *
 * @param {State} state
 * @param {string} sessionId
 * @returns {boolean}
 */
export function refreshSessionTimes(state, sessionId) {
  const session = state.sessions[sessionId];
  const remaining = Object.values(state.turns).filter((turn) => turn.sessionId === sessionId);
  if (!session || remaining.length === 0) return false;
  const times = remaining.map((turn) => turn.receivedAt).sort();
  session.startedAt = times[0];
  session.lastTurnAt = times[times.length - 1];
  return true;
}

/**
 * The sessions of one project directory, latest turn first.
 *
 * @param {State} state
 * @param {string} cwd
 * @returns {Session[]}
 */
export function sessionsIn(state, cwd) {
  return Object.values(state.sessions)
    .filter((session) => session.cwd === cwd)
    .sort((a, b) => b.lastTurnAt.localeCompare(a.lastTurnAt));
}

/**
 * What the sidebar calls a session: its title, or its start time until the
 * harness has titled it.
 *
 * @param {Pick<Session, 'title'|'startedAt'>} session
 */
export function sessionLabel(session) {
  return session.title ?? formatTime(session.startedAt);
}
