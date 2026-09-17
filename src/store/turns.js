import { refreshSessionTimes, upsertSession } from './sessions.js';

/** @typedef {import('../types.js').Turn} Turn */
/** @typedef {import('../types.js').State} State */
/** @typedef {import('../hooks/hook-payload.js').StopHookPayload} StopHookPayload */

/**
 * Build a turn document from a parsed Stop hook payload.
 *
 * @param {StopHookPayload} payload
 * @param {{ model?: string|null, now?: Date }} [options] The model the transcript named for the turn, when known.
 * @returns {Turn}
 */
export function turnFromPayload(payload, { model = null, now = new Date() } = {}) {
  return {
    promptId: payload.promptId,
    sessionId: payload.sessionId,
    cwd: payload.cwd,
    transcriptPath: payload.transcriptPath,
    message: payload.lastAssistantMessage,
    model,
    receivedAt: now.toISOString(),
  };
}

/**
 * Store a turn, replacing any earlier turn with the same promptId, and record
 * it against its session.
 *
 * The hook's working directory follows the agent's shell, so a turn of a
 * session already known takes the session's directory: that is the project,
 * and it is what every consumer of the directory wants. A session's first
 * turn sets it.
 *
 * @param {import('./store.js').Store} store
 * @param {StopHookPayload} payload
 * @param {{ title?: string|null, model?: string|null, now?: Date }} [options] The labels the caller read from the transcript, when found.
 * @returns {Promise<Turn>}
 */
export async function recordTurn(store, payload, { title = null, model = null, now = new Date() } = {}) {
  const turn = turnFromPayload(payload, { model, now });
  await store.update((state) => {
    const session = state.sessions[turn.sessionId];
    if (session) turn.cwd = session.cwd;
    state.turns[turn.promptId] = turn;
    upsertSession(state, turn, title);
  });
  return turn;
}

/**
 * Turns newest first.
 *
 * @param {State} state
 * @returns {Turn[]}
 */
export function listTurns(state) {
  return Object.values(state.turns).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

/**
 * One session's turns, newest first.
 *
 * @param {State} state
 * @param {string} sessionId
 * @returns {Turn[]}
 */
export function turnsForSession(state, sessionId) {
  return listTurns(state).filter((turn) => turn.sessionId === sessionId);
}

/**
 * Whether a turn is its session's newest, and so not removable.
 *
 * @param {State} state
 * @param {Turn} turn
 */
export function isNewestInSession(state, turn) {
  return turnsForSession(state, turn.sessionId)[0]?.promptId === turn.promptId;
}

/**
 * @typedef {object} RemovedTurn
 * @property {Turn} turn
 * @property {number} removedThreads How many threads went with it.
 * @property {boolean} sessionRemoved Whether it was the session's last turn.
 */

/**
 * Remove a turn and every thread anchored in it. Carry-back entries are the
 * user's conclusions and stay. A session with no turn left is removed too.
 *
 * @param {State} state
 * @param {string} promptId
 * @returns {RemovedTurn|null} Null when there is no such turn.
 */
export function removeTurn(state, promptId) {
  const turn = state.turns[promptId];
  if (!turn) return null;
  delete state.turns[promptId];
  let removedThreads = 0;
  for (const [threadId, thread] of Object.entries(state.threads)) {
    if (thread.promptId !== promptId) continue;
    delete state.threads[threadId];
    removedThreads += 1;
  }
  const sessionRemoved = !refreshSessionTimes(state, turn.sessionId);
  if (sessionRemoved) delete state.sessions[turn.sessionId];
  return { turn, removedThreads, sessionRemoved };
}
