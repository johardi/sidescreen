/**
 * `annotatr ingest`: read a Stop hook payload from stdin and store the turn.
 *
 * This module has no filesystem access of its own. The turn's text comes from
 * the payload's `last_assistant_message` and from nowhere else. The one thing
 * read from the transcript is the session's title, through a reader that
 * returns a label and never sees a message, and whose failure changes nothing
 * about the turn.
 */

import { HookPayloadError, parseStopHookPayload } from './hook-payload.js';
import { readSessionTitle } from './session-title.js';
import { Store, defaultStateDir } from './store.js';
import { recordTurn } from './turns.js';

/**
 * Read a stream to completion.
 *
 * @param {NodeJS.ReadableStream} stream
 * @returns {Promise<string>}
 */
export async function readAll(stream) {
  /** @type {string[]} */
  const chunks = [];
  stream.setEncoding('utf8');
  for await (const chunk of stream) chunks.push(String(chunk));
  return chunks.join('');
}

/**
 * @param {import('./cli.js').CliIo} io
 * @param {{ readTitle?: (transcriptPath: string|null) => Promise<string|null> }} [options] Injectable for tests.
 * @returns {Promise<number>} Exit code. Non-zero is a non-blocking hook error.
 */
export async function ingest(io, { readTitle = readSessionTitle } = {}) {
  const text = await readAll(io.stdin);
  /** @type {import('./hook-payload.js').StopHookPayload} */
  let payload;
  try {
    payload = parseStopHookPayload(text);
  } catch (error) {
    if (error instanceof HookPayloadError) {
      io.stderr.write(`annotatr ingest: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  const store = new Store(defaultStateDir(io.env));
  const title = await readTitle(payload.transcriptPath);
  await recordTurn(store, payload, { title });
  return 0;
}
