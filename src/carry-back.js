/**
 * Carry-back list: the only thing that returns to the main session.
 *
 * The user adds conclusions while reviewing. On the next prompt, the
 * UserPromptSubmit hook runs `annotatr carry-back --emit`, which prints the
 * pending entries and nothing else: no questions, no answers, no thread text.
 * Claude Code injects that stdout as context, and the entries are then marked
 * emitted so they are not injected again.
 */

import { randomUUID } from 'node:crypto';
import { HookPayloadError, parseUserPromptSubmitPayload } from './hook-payload.js';
import { readAll } from './ingest.js';
import { Store, defaultStateDir } from './store.js';

/** @typedef {import('./types.js').State} State */

/**
 * @typedef {object} CarryBackEntry
 * @property {string} id
 * @property {string} text The conclusion, in the user's words.
 * @property {string|null} threadId The thread it came out of, for display only. Never emitted.
 * @property {string} addedAt ISO timestamp.
 * @property {string|null} emittedAt ISO timestamp of the emit that returned it, or null while pending.
 */

export const EMISSION_HEADER = 'Conclusions the user carried back from their annotatr review of earlier output:';

/**
 * @param {State} state
 * @param {string} sessionId
 * @returns {CarryBackEntry[]} Oldest first. The live array, for mutation inside a store update.
 */
export function entriesFor(state, sessionId) {
  state.carryBack[sessionId] ??= [];
  return state.carryBack[sessionId];
}

/**
 * @param {State} state
 * @param {string} sessionId
 * @returns {CarryBackEntry[]}
 */
export function pendingEntries(state, sessionId) {
  return (state.carryBack[sessionId] ?? []).filter((entry) => entry.emittedAt === null);
}

/**
 * @param {State} state
 * @param {{ sessionId: string, text: string, threadId?: string|null, now?: Date }} input
 * @returns {CarryBackEntry}
 */
export function addEntry(state, { sessionId, text, threadId = null, now = new Date() }) {
  const entry = { id: randomUUID(), text: text.trim(), threadId, addedAt: now.toISOString(), emittedAt: null };
  entriesFor(state, sessionId).push(entry);
  return entry;
}

/**
 * @param {State} state
 * @param {string} sessionId
 * @param {string} entryId
 * @returns {boolean} Whether an entry was removed.
 */
export function removeEntry(state, sessionId, entryId) {
  const entries = state.carryBack[sessionId];
  if (!entries) return false;
  const index = entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return false;
  entries.splice(index, 1);
  return true;
}

/**
 * The plain text injected into the next prompt. Empty when nothing is pending.
 *
 * @param {CarryBackEntry[]} entries
 * @returns {string}
 */
export function formatEmission(entries) {
  if (entries.length === 0) return '';
  return `${EMISSION_HEADER}\n${entries.map((entry) => `- ${entry.text.replace(/\s*\n\s*/g, ' ')}`).join('\n')}\n`;
}

/**
 * Print the pending entries for a session, then mark exactly those emitted.
 *
 * @param {{ store: Store, sessionId: string, stdout: NodeJS.WritableStream, now?: Date }} input
 * @returns {Promise<number>} How many entries were emitted.
 */
export async function emitCarryBack({ store, sessionId, stdout, now = new Date() }) {
  const pending = pendingEntries(await store.read(), sessionId);
  if (pending.length === 0) return 0;
  stdout.write(formatEmission(pending));
  const emittedIds = new Set(pending.map((entry) => entry.id));
  await store.update((state) => {
    for (const entry of entriesFor(state, sessionId)) {
      if (emittedIds.has(entry.id)) entry.emittedAt = now.toISOString();
    }
  });
  return pending.length;
}

/**
 * `annotatr carry-back --emit [--session <id>]`.
 *
 * Run by the UserPromptSubmit hook with the hook payload on stdin. Prints only
 * pending entries for that session, or nothing. Exit 0 either way, because a
 * failing hook would get in the user's way at exactly the wrong moment.
 *
 * @param {string[]} argv
 * @param {import('./cli.js').CliIo} io
 * @returns {Promise<number>}
 */
export async function carryBackCommand(argv, io) {
  /** @type {string|null} */
  let sessionId = null;
  let emit = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--emit') emit = true;
    else if (arg === '--session' && argv[index + 1] !== undefined) {
      sessionId = argv[index + 1];
      index += 1;
    } else {
      io.stderr.write(`annotatr carry-back: unknown option "${arg}"\n`);
      return 1;
    }
  }
  if (!emit) {
    io.stderr.write('annotatr carry-back: expected --emit\n');
    return 1;
  }
  if (sessionId === null) {
    const text = await readAll(io.stdin);
    if (text.trim() === '') {
      io.stderr.write('annotatr carry-back: no hook payload on stdin and no --session given\n');
      return 1;
    }
    try {
      sessionId = parseUserPromptSubmitPayload(text).sessionId;
    } catch (error) {
      if (!(error instanceof HookPayloadError)) throw error;
      io.stderr.write(`annotatr carry-back: ${error.message}\n`);
      return 1;
    }
  }
  const store = new Store(defaultStateDir(io.env));
  await emitCarryBack({ store, sessionId, stdout: io.stdout });
  return 0;
}
