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

/**
 * @typedef {object} RemovedSession
 * @property {import('../types.js').Session} session
 * @property {number} removedTurns
 * @property {number} removedThreads
 */

/**
 * Remove a session with all of its turns and every thread anchored in them.
 * Carry-back entries stay: the terminal session may still be running and is
 * still owed them. The session's next ingested turn recreates it.
 *
 * @param {State} state
 * @param {string} sessionId
 * @returns {RemovedSession|null} Null when there is no such session.
 */
export function removeSession(state, sessionId) {
  const session = state.sessions[sessionId];
  if (!session) return null;
  /** @type {Set<string>} */
  const promptIds = new Set();
  for (const [promptId, turn] of Object.entries(state.turns)) {
    if (turn.sessionId !== sessionId) continue;
    delete state.turns[promptId];
    promptIds.add(promptId);
  }
  let removedThreads = 0;
  for (const [threadId, thread] of Object.entries(state.threads)) {
    if (!promptIds.has(thread.promptId)) continue;
    delete state.threads[threadId];
    removedThreads += 1;
  }
  delete state.sessions[sessionId];
  return { session, removedTurns: promptIds.size, removedThreads };
}
