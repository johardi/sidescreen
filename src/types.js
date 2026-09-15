/**
 * Shared JSDoc type definitions. This module exports no runtime values.
 *
 * @typedef {object} Turn One completed agent turn, as received from the Stop hook.
 * @property {string} promptId Stable identifier of the turn, from the hook payload.
 * @property {string} sessionId Harness session the turn belongs to.
 * @property {string} cwd Project directory the turn ran in.
 * @property {string|null} transcriptPath Path to the harness transcript, if the hook supplied one.
 * @property {string} message The turn's final assistant message, verbatim.
 * @property {string} receivedAt ISO timestamp of ingestion.
 */

/**
 * @typedef {object} State The whole persisted store.
 * @property {1} version Schema version.
 * @property {Record<string, Turn>} turns Turns keyed by promptId.
 * @property {Record<string, import('./threads.js').Thread>} threads Threads keyed by thread id.
 * @property {Record<string, import('./carry-back.js').CarryBackEntry[]>} carryBack Carry-back entries keyed by sessionId.
 */

export {};
