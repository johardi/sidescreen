/**
 * `sidescreen ingest`: read a Stop hook payload from stdin and store the turn.
 *
 * This module has no filesystem access of its own. The turn's text comes from
 * the payload's `last_assistant_message` and from nowhere else. The only
 * things read from the transcript are labels, the session's title and the
 * turn's model, through a reader that never sees a message and whose failure
 * changes nothing about the turn.
 *
 * A sub-agent that sidescreen itself started runs with `SIDESCREEN_SUBAGENT=1`
 * in its environment. Should the harness's hooks fire inside it anyway, this
 * command does nothing, so a side question is never ingested as a turn.
 */

import { HookPayloadError, parseStopHookPayload } from './hook-payload.js';
import { readTranscriptLabels } from './transcript-labels.js';
import { Store, defaultStateDir } from '../store/store.js';
import { recordTurn } from '../store/turns.js';

/** The environment marker sidescreen sets on every sub-agent it starts. */
export const SUBAGENT_MARKER = 'SIDESCREEN_SUBAGENT';

/**
 * Whether this process is running inside a sub-agent sidescreen started.
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function isInsideSubagent(env) {
  return env[SUBAGENT_MARKER] === '1';
}

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
 * @param {import('../cli.js').CliIo} io
 * @param {{ readLabels?: (transcriptPath: string|null) => Promise<import('./transcript-labels.js').TranscriptLabels> }} [options] Injectable for tests.
 * @returns {Promise<number>} Exit code. Non-zero is a non-blocking hook error.
 */
export async function ingest(io, { readLabels = readTranscriptLabels } = {}) {
  const text = await readAll(io.stdin);
  if (isInsideSubagent(io.env)) return 0;
  /** @type {import('./hook-payload.js').StopHookPayload} */
  let payload;
  try {
    payload = parseStopHookPayload(text);
  } catch (error) {
    if (error instanceof HookPayloadError) {
      io.stderr.write(`sidescreen ingest: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  const store = new Store(defaultStateDir(io.env));
  const { title, model } = await readLabels(payload.transcriptPath);
  await recordTurn(store, payload, { title, model });
  return 0;
}
