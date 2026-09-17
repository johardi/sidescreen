/**
 * The title the harness gave a session, read from its transcript.
 *
 * Claude Code writes `{"type":"ai-title","aiTitle":"...","sessionId":"..."}`
 * records into the transcript, repeatedly, once it has titled the session.
 * Only the tail of the file is read: transcripts grow to many megabytes, the
 * records recur, and a title already stored is kept when none is found here.
 *
 * This module returns a label and nothing else. It never looks at messages,
 * so the turn's text still comes from the hook payload alone.
 */

import { open } from 'node:fs/promises';

export const TITLE_TAIL_BYTES = 1_048_576;
const TITLE_RECORD_TYPE = 'ai-title';

/**
 * The last `tailBytes` of a transcript as text, or null for any reason at all:
 * no path, a missing or unreadable file, or an empty one.
 *
 * @param {string|null|undefined} transcriptPath
 * @param {{ tailBytes?: number }} [options]
 * @returns {Promise<string|null>}
 */
export async function readTranscriptTail(transcriptPath, { tailBytes = TITLE_TAIL_BYTES } = {}) {
  if (typeof transcriptPath !== 'string' || transcriptPath === '') return null;
  /** @type {import('node:fs/promises').FileHandle|undefined} */
  let handle;
  try {
    handle = await open(transcriptPath, 'r');
    const { size } = await handle.stat();
    const start = Math.max(0, size - tailBytes);
    const length = size - start;
    if (length === 0) return null;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * @param {string|null|undefined} transcriptPath
 * @param {{ tailBytes?: number }} [options]
 * @returns {Promise<string|null>} The latest title in the tail, or null for any reason at all.
 */
export async function readSessionTitle(transcriptPath, options = {}) {
  const tail = await readTranscriptTail(transcriptPath, options);
  return tail === null ? null : lastTitleIn(tail);
}

/**
 * The last well-formed title record in a stretch of transcript text. A
 * stretch that starts mid-line is fine: the partial first line fails to
 * parse and is skipped like any other malformed line.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function lastTitleIn(text) {
  /** @type {string|null} */
  let title = null;
  for (const line of text.split('\n')) {
    if (!line.includes(`"${TITLE_RECORD_TYPE}"`)) continue;
    try {
      const record = JSON.parse(line);
      if (record && record.type === TITLE_RECORD_TYPE && typeof record.aiTitle === 'string' && record.aiTitle.trim() !== '') {
        title = record.aiTitle.trim();
      }
    } catch {
      // Not a complete JSON line. Skip it.
    }
  }
  return title;
}
