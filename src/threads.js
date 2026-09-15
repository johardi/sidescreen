/**
 * Thread model. A thread is one line of questioning anchored to a range of a turn.
 */

import { randomUUID } from 'node:crypto';

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
 * @property {string} askedAt ISO timestamp.
 * @property {string|null} answeredAt ISO timestamp.
 */

/**
 * @typedef {object} Thread
 * @property {string} id
 * @property {string} promptId Turn the thread is anchored in.
 * @property {string} sessionId Harness session the turn belongs to.
 * @property {string|null} parentThreadId Thread this one was branched from, if any.
 * @property {Anchor} anchor Where in the rendered turn the user pointed.
 * @property {string} selectedText The text the user selected, for display and as a fallback.
 * @property {Exchange[]} exchanges Oldest first.
 * @property {string|null} subAgentSessionId The sub-agent session that answers this thread.
 * @property {string} createdAt ISO timestamp.
 */

/**
 * @param {{ turn: Turn, anchor: Anchor, selectedText: string, question: string, parentThreadId?: string|null, now?: Date }} input
 * @returns {Thread}
 */
export function createThread({ turn, anchor, selectedText, question, parentThreadId = null, now = new Date() }) {
  const timestamp = now.toISOString();
  return {
    id: randomUUID(),
    promptId: turn.promptId,
    sessionId: turn.sessionId,
    parentThreadId,
    anchor,
    selectedText,
    exchanges: [createExchange(question, now)],
    subAgentSessionId: null,
    createdAt: timestamp,
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
    askedAt: now.toISOString(),
    answeredAt: null,
  };
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
