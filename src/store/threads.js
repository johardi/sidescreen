/**
 * Thread model. A thread is one line of questioning anchored to a range of a turn.
 *
 * Every answered exchange keeps the id of the sub-agent session whose last
 * message is that answer, together with the backend that minted it, since a
 * session can only be forked by the CLI that created it. Sessions are never
 * resumed, so those ids stay valid forever: a question that continues an
 * answer forks the newest session of its own backend in the lineage, and the
 * new answer gets a new id of its own.
 */

import { randomUUID } from 'node:crypto';

export { familyOf, rootOf, rootThreads } from '../web/public/thread-tree.js';

/** @typedef {import('../types.js').State} State */
/** @typedef {import('../types.js').Turn} Turn */
/** @typedef {import('../web/public/anchor.js').Anchor} Anchor */
/** @typedef {import('../dispatch/backends.js').Backend} Backend */

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
 * @property {string} question As the user typed it, tag included.
 * @property {Backend} backend The backend that answers, decided when the question was routed.
 * @property {string|null} model The model the answer ran on, when known.
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
 * @property {string} createdAt ISO timestamp.
 */

/**
 * @param {{ turn: Turn, anchor: Anchor, selectedText: string, question: string, backend: Backend, parentThreadId?: string|null, branchedFromExchangeId?: string|null, now?: Date }} input
 * @returns {Thread}
 */
export function createThread({ turn, anchor, selectedText, question, backend, parentThreadId = null, branchedFromExchangeId = null, now = new Date() }) {
  return {
    id: randomUUID(),
    promptId: turn.promptId,
    sessionId: turn.sessionId,
    parentThreadId,
    branchedFromExchangeId,
    anchor,
    selectedText,
    exchanges: [createExchange(question, backend, now)],
    createdAt: now.toISOString(),
  };
}

/**
 * @param {string} question
 * @param {Backend} backend
 * @param {Date} [now]
 * @returns {Exchange}
 */
export function createExchange(question, backend, now = new Date()) {
  return {
    id: randomUUID(),
    question,
    backend,
    model: null,
    status: 'pending',
    answer: null,
    error: null,
    subAgentSessionId: null,
    askedAt: now.toISOString(),
    answeredAt: null,
  };
}

/**
 * The exchanges a question continues, oldest first.
 *
 * For a follow-up, the thread's own exchanges. For a branch, the parent's
 * lineage cut at the branched-from exchange, so a branch never sees what its
 * parent asked after the branch point. A branch of a branch composes.
 *
 * @param {Record<string, Thread>} threads Every thread, by id.
 * @param {Thread} thread The thread being continued, or the parent being branched from.
 * @param {string|null} [cutAtExchangeId] Include exchanges up to and including this one only.
 * @returns {Exchange[]}
 */
export function lineageOf(threads, thread, cutAtExchangeId = null) {
  /** @type {Exchange[]} */
  let own = thread.exchanges;
  if (cutAtExchangeId !== null) {
    const index = thread.exchanges.findIndex((exchange) => exchange.id === cutAtExchangeId);
    own = index < 0 ? [] : thread.exchanges.slice(0, index + 1);
  }
  const parent = thread.parentThreadId === null ? undefined : threads[thread.parentThreadId];
  if (!parent || thread.branchedFromExchangeId === null || parent.id === thread.id) return own;
  return [...lineageOf(threads, parent, thread.branchedFromExchangeId), ...own];
}

/**
 * The latest answered exchange of a thread, or null.
 *
 * @param {Thread} thread
 * @returns {Exchange|null}
 */
export function latestAnswered(thread) {
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
 * @returns {import('../web/public/anchor.js').Boundary|null}
 */
function validateBoundary(value) {
  if (value === null || typeof value !== 'object') return null;
  const { path, offset } = /** @type {Record<string, unknown>} */ (value);
  if (!Array.isArray(path) || !path.every((step) => Number.isInteger(step) && step >= 0)) return null;
  if (!Number.isInteger(offset) || /** @type {number} */ (offset) < 0) return null;
  return { path: /** @type {number[]} */ (path), offset: /** @type {number} */ (offset) };
}
