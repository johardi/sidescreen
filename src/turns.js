/** @typedef {import('./types.js').Turn} Turn */
/** @typedef {import('./types.js').State} State */
/** @typedef {import('./hook-payload.js').StopHookPayload} StopHookPayload */

/**
 * Build a turn document from a parsed Stop hook payload.
 *
 * @param {StopHookPayload} payload
 * @param {Date} [now]
 * @returns {Turn}
 */
export function turnFromPayload(payload, now = new Date()) {
  return {
    promptId: payload.promptId,
    sessionId: payload.sessionId,
    cwd: payload.cwd,
    transcriptPath: payload.transcriptPath,
    message: payload.lastAssistantMessage,
    receivedAt: now.toISOString(),
  };
}

/**
 * Store a turn, replacing any earlier turn with the same promptId.
 *
 * @param {import('./store.js').Store} store
 * @param {StopHookPayload} payload
 * @returns {Promise<Turn>}
 */
export async function recordTurn(store, payload) {
  const turn = turnFromPayload(payload);
  await store.update((state) => {
    state.turns[turn.promptId] = turn;
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
