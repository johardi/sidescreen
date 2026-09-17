/**
 * Labels read from the tail of a session transcript at ingest: the title the
 * harness gave the session, and the model that produced the turn.
 *
 * Both are labels in the sense the ingestion rule allows. Their absence
 * changes nothing about the turn, and a lagging label is harmless where a
 * lagging document is not. The tail is read once for both.
 */

import { lastTitleIn, readTranscriptTail } from './session-title.js';

const ASSISTANT_RECORD_TYPE = 'assistant';

/**
 * @typedef {object} TranscriptLabels
 * @property {string|null} title
 * @property {string|null} model
 */

/**
 * @param {string|null|undefined} transcriptPath
 * @param {{ tailBytes?: number }} [options]
 * @returns {Promise<TranscriptLabels>} Each label, or null for any reason at all.
 */
export async function readTranscriptLabels(transcriptPath, options = {}) {
  const tail = await readTranscriptTail(transcriptPath, options);
  if (tail === null) return { title: null, model: null };
  return { title: lastTitleIn(tail), model: lastModelIn(tail) };
}

/**
 * The model named by the last well-formed `assistant` record in a stretch of
 * transcript text, or null when none names one.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function lastModelIn(text) {
  /** @type {string|null} */
  let model = null;
  for (const line of text.split('\n')) {
    if (!line.includes(`"${ASSISTANT_RECORD_TYPE}"`)) continue;
    try {
      const record = JSON.parse(line);
      if (record && record.type === ASSISTANT_RECORD_TYPE) {
        const candidate = record.message?.model;
        if (typeof candidate === 'string' && candidate.trim() !== '') model = candidate.trim();
      }
    } catch {
      // Not a complete JSON line. Skip it.
    }
  }
  return model;
}
