/**
 * Thread model. A thread is one line of questioning anchored to a range of a turn.
 *
 * Every answered exchange keeps the id of the sub-agent session whose last
 * message is that answer. Sessions are never resumed, so those ids stay valid
 * forever: a follow-up or a branch forks the session of the answer it
 * continues, and the new answer gets a new id of its own.
 */

import { randomUUID } from 'node:crypto';

export { familyOf, rootOf, rootThreads } from './public/thread-tree.js';

/** @typedef {import('./types.js').State} State */
/** @typedef {import('./types.js').Turn} Turn */
/** @typedef {import('./public/anchor.js').Anchor} Anchor */

/**
 * Where an answer's evidence came from. `undeclared` means the sub-agent
 * failed to say, which the surface shows as a warning rather than trusting.
 *
 * @typedef {'code'|'transcript'|'spec'|'none'|'undeclared'} AnswerSource
 */

/** @type {readonly AnswerSource[]} */
export const ANSWER_SOURCES = ['code', 'transcript', 'spec', 'none', 'undeclared'];

/**
 * @typedef {object} Answer
 * @property {string} text Markdown answer text.
 * @property {AnswerSource} source
 * @property {string} sourceDetail Where exactly: a file and line, a transcript turn, a spec heading.
 */

/**
 * @typedef {object} Exchange One question and its answer within a thread.
 * @property {string} id
 * @property {string} question
 * @property {'pending'|'answered'|'failed'} status
 * @property {Answer|null} answer
 * @property {string|null} error Why the exchange failed, when status is `failed`.
 * @property {string|null} subAgentSessionId The sub-agent session whose last message is this answer.
 * @property {string} askedAt ISO timestamp.
 * @property {string|null} answeredAt ISO timestamp.
 */

/**
 * @typedef {object} Thread
 * @property {string} id
 * @property {string} promptId Turn the thread is anchored in.
 * @property {string} sessionId Harness session the turn belongs to.
 * @property {string|null} parentThreadId Thread this one was branched from, if any.
 * @property {string|null} branchedFromExchangeId The parent's exchange this branch continues, if any.
 * @property {Anchor} anchor Where in the rendered turn the user pointed.
 * @property {string} selectedText The text the user selected, for display and as a fallback.
 * @property {Exchange[]} exchanges Oldest first.
 * @property {string|null} subAgentSessionId The session of the latest answered exchange, for convenience.
 * @property {string} createdAt ISO timestamp.
 */

/**
 * @param {{ turn: Turn, anchor: Anchor, selectedText: string, question: string, parentThreadId?: string|null, branchedFromExchangeId?: string|null, now?: Date }} input
 * @returns {Thread}
 */
export function createThread({ turn, anchor, selectedText, question, parentThreadId = null, branchedFromExchangeId = null, now = new Date() }) {
  return {
    id: randomUUID(),
    promptId: turn.promptId,
    sessionId: turn.sessionId,
    parentThreadId,
    branchedFromExchangeId,
    anchor,
    selectedText,
    exchanges: [createExchange(question, now)],
    subAgentSessionId: null,
    createdAt: now.toISOString(),
  };
}

/**
 * @param {string} question
 * @param {Date} [now]
 * @returns {Exchange}
 */
export function createExchange(question, now = new Date()) {
  return {
    id: randomUUID(),
    question,
    status: 'pending',
    answer: null,
    error: null,
    subAgentSessionId: null,
    askedAt: now.toISOString(),
    answeredAt: null,
  };
}

/**
 * The newest exchange whose session a new question can fork, or null when
 * the thread has no answered exchange yet.
 *
 * @param {Thread} thread
 * @returns {Exchange|null}
 */
export function latestForkable(thread) {
  for (let index = thread.exchanges.length - 1; index >= 0; index -= 1) {
    const exchange = thread.exchanges[index];
    if (exchange.status === 'answered' && exchange.subAgentSessionId) return exchange;
  }
  return null;
}

/**
 * Threads anchored in a turn, oldest first.
 *
 * @param {State} state
 * @param {string} promptId
 * @returns {Thread[]}
 */
export function listThreadsForTurn(state, promptId) {
  return Object.values(state.threads)
    .filter((thread) => thread.promptId === promptId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Validate a client-supplied anchor. Returns the anchor when well-formed.
 *
 * @param {unknown} value
 * @returns {Anchor|null}
 */
export function validateAnchor(value) {
  if (value === null || typeof value !== 'object') return null;
  const { start, end, text } = /** @type {Record<string, unknown>} */ (value);
  const startBoundary = validateBoundary(start);
  const endBoundary = validateBoundary(end);
  if (!startBoundary || !endBoundary || typeof text !== 'string') return null;
  return { start: startBoundary, end: endBoundary, text };
}

/**
 * @param {unknown} value
 * @returns {import('./public/anchor.js').Boundary|null}
 */
function validateBoundary(value) {
  if (value === null || typeof value !== 'object') return null;
  const { path, offset } = /** @type {Record<string, unknown>} */ (value);
  if (!Array.isArray(path) || !path.every((step) => Number.isInteger(step) && step >= 0)) return null;
  if (!Number.isInteger(offset) || /** @type {number} */ (offset) < 0) return null;
  return { path: /** @type {number[]} */ (path), offset: /** @type {number} */ (offset) };
}
