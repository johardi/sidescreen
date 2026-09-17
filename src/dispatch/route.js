/**
 * Routing a question: which backend answers it, and what it starts from.
 *
 * One rule covers a thread's first question, a follow-up, and a branch. The
 * backend is the tag if there is one, else the backend of the last answer in
 * the lineage, else the configured default. The question forks the newest
 * answer in its lineage that the same backend produced, carrying the
 * exchanges since as text; with no such answer it starts a new session with
 * the whole lineage as text.
 */

import { parseBackendTag } from './backends.js';

/** @typedef {import('./backends.js').Backend} Backend */
/** @typedef {import('./adapter.js').DispatchTarget} DispatchTarget */
/** @typedef {import('../store/threads.js').Exchange} Exchange */

/**
 * @typedef {object} Route
 * @property {Backend} backend
 * @property {string} question The question with any leading tag removed.
 * @property {DispatchTarget} target
 * @property {Exchange[]} priorExchanges For a new session: the lineage's answered exchanges, oldest first.
 * @property {Exchange[]} gap For a fork: the lineage's answered exchanges after the forked one, oldest first.
 */

/**
 * @param {Exchange} exchange
 * @returns {exchange is Exchange & { subAgentSessionId: string }}
 */
export function isAnswered(exchange) {
  return exchange.status === 'answered' && typeof exchange.subAgentSessionId === 'string' && exchange.subAgentSessionId !== '';
}

/**
 * @param {{ question: string, lineage: Exchange[], defaultBackend: Backend }} input The lineage is what the question continues, oldest first; empty for a thread's first question.
 * @returns {Route}
 */
export function routeQuestion({ question, lineage, defaultBackend }) {
  const tag = parseBackendTag(question);
  const answered = lineage.filter(isAnswered);
  const backend = tag.backend ?? answered[answered.length - 1]?.backend ?? defaultBackend;

  let forkIndex = -1;
  for (let index = lineage.length - 1; index >= 0; index -= 1) {
    const exchange = lineage[index];
    if (isAnswered(exchange) && exchange.backend === backend) {
      forkIndex = index;
      break;
    }
  }
  if (forkIndex < 0) {
    return { backend, question: tag.question, target: { mode: 'new' }, priorExchanges: answered, gap: [] };
  }
  const forked = /** @type {Exchange & { subAgentSessionId: string }} */ (lineage[forkIndex]);
  return {
    backend,
    question: tag.question,
    target: { mode: 'fork', sessionId: forked.subAgentSessionId },
    priorExchanges: [],
    gap: lineage.slice(forkIndex + 1).filter(isAnswered),
  };
}
