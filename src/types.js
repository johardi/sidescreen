/**
 * Shared JSDoc type definitions. This module exports no runtime values.
 *
 * @typedef {object} Turn One completed agent turn, as received from the Stop hook.
 * @property {string} promptId Stable identifier of the turn, from the hook payload.
 * @property {string} sessionId Harness session the turn belongs to.
 * @property {string} cwd Project directory the turn ran in.
 * @property {string|null} transcriptPath Path to the harness transcript, if the hook supplied one.
 * @property {string} message The turn's final assistant message, verbatim.
 * @property {string|null} model The model that produced the turn, as the transcript names it, or null when the transcript had not named it at ingest.
 * @property {string} receivedAt ISO timestamp of ingestion.
 */

/**
 * One harness session, which is one conversation: `/clear` starts a new one
 * inside the same process, and `--resume` continues an old one in a new process.
 *
 * @typedef {object} Session
 * @property {string} sessionId
 * @property {string} cwd Project directory the session runs in. Fixed for the session's lifetime.
 * @property {string|null} transcriptPath Transcript path from the latest turn that supplied one.
 * @property {string|null} title The title the harness gave the session, or null until one has been seen.
 * @property {string} startedAt ISO timestamp of the session's earliest ingested turn.
 * @property {string} lastTurnAt ISO timestamp of the session's latest ingested turn.
 */

/**
 * @typedef {object} State The whole persisted store.
 * @property {3} version Schema version.
 * @property {Record<string, Turn>} turns Turns keyed by promptId.
 * @property {Record<string, Session>} sessions Sessions keyed by sessionId.
 * @property {Record<string, import('./store/threads.js').Thread>} threads Threads keyed by thread id.
 * @property {Record<string, import('./store/carry-back.js').CarryBackEntry[]>} carryBack Carry-back entries keyed by sessionId.
 */

export {};
