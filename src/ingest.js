/**
 * `annotatr ingest`: read a Stop hook payload from stdin and store the turn.
 *
 * This module deliberately has no filesystem access of its own. The turn's
 * text comes from the payload's `last_assistant_message` and from nowhere else.
 */

import { HookPayloadError, parseStopHookPayload } from './hook-payload.js';
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
 * @returns {Promise<number>} Exit code. Non-zero is a non-blocking hook error.
 */
export async function ingest(io) {
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
  await recordTurn(store, payload);
  return 0;
}
