/**
 * The reviewed turn's own slice of the transcript, as a readable file.
 *
 * The transcript has no turn marker. The turn is found from its end: the
 * latest `assistant` record whose text is the turn's final message, then the
 * chain of `parentUuid` links back to the `user` record that started it. The
 * records in between are rendered as Markdown, tool results cut to a bounded
 * size, so a sub-agent reads one small file instead of searching megabytes
 * of JSONL. This happens at question time, when the transcript is complete;
 * the rule that the rendered document never comes from the transcript is
 * untouched, since the slice is evidence for the sub-agent, not the document.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** @typedef {import('../types.js').Turn} Turn */

export const TURN_SLICES_DIR = 'turn-slices';
export const MAX_TOOL_RESULT_CHARS = 4_000;

/**
 * @typedef {object} TranscriptRecord One `user` or `assistant` line of the transcript, as far as the slice needs it.
 * @property {'user'|'assistant'} type
 * @property {string} uuid
 * @property {string|null} parentUuid
 * @property {boolean} isMeta
 * @property {ContentBlock[]} content
 */

/**
 * @typedef {{ type: 'text', text: string } | { type: 'thinking', thinking: string } | { type: 'tool_use', id: string, name: string, input: unknown } | { type: 'tool_result', toolUseId: string, text: string } | { type: 'other', kind: string }} ContentBlock
 */

/**
 * The `user` and `assistant` records of a transcript, in file order.
 * Malformed lines and other record types are skipped.
 *
 * @param {string} text
 * @returns {TranscriptRecord[]}
 */
export function parseTranscript(text) {
  /** @type {TranscriptRecord[]} */
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"user"') && !line.includes('"assistant"')) continue;
    /** @type {Record<string, unknown>} */
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (!raw || (raw.type !== 'user' && raw.type !== 'assistant') || typeof raw.uuid !== 'string') continue;
    const message = /** @type {{ content?: unknown }|undefined} */ (raw.message);
    records.push({
      type: raw.type,
      uuid: raw.uuid,
      parentUuid: typeof raw.parentUuid === 'string' ? raw.parentUuid : null,
      isMeta: raw.isMeta === true,
      content: parseContent(message?.content),
    });
  }
  return records;
}

/**
 * @param {unknown} content
 * @returns {ContentBlock[]}
 */
function parseContent(content) {
  if (typeof content === 'string') return content === '' ? [] : [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  /** @type {ContentBlock[]} */
  const blocks = [];
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue;
    const block = /** @type {Record<string, unknown>} */ (raw);
    switch (block.type) {
      case 'text':
        if (typeof block.text === 'string') blocks.push({ type: 'text', text: block.text });
        break;
      case 'thinking':
        if (typeof block.thinking === 'string') blocks.push({ type: 'thinking', thinking: block.thinking });
        break;
      case 'tool_use':
        blocks.push({ type: 'tool_use', id: String(block.id ?? ''), name: typeof block.name === 'string' ? block.name : 'tool', input: block.input });
        break;
      case 'tool_result':
        blocks.push({ type: 'tool_result', toolUseId: String(block.tool_use_id ?? ''), text: toolResultText(block.content) });
        break;
      default:
        blocks.push({ type: 'other', kind: String(block.type ?? 'unknown') });
    }
  }
  return blocks;
}

/**
 * @param {unknown} content
 * @returns {string}
 */
function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part === 'object' && typeof (/** @type {{ text?: unknown }} */ (part)).text === 'string' ? /** @type {{ text: string }} */ (part).text : ''))
    .join('\n');
}

/**
 * A record's visible text: its text blocks joined.
 *
 * @param {TranscriptRecord} record
 */
export function textOf(record) {
  return record.content
    .filter((block) => block.type === 'text')
    .map((block) => /** @type {{ text: string }} */ (block).text)
    .join('\n');
}

/** @param {string} text */
export function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A user record that is the person's own prompt, not a tool result or a
 * harness note.
 *
 * @param {TranscriptRecord} record
 */
export function isUserPrompt(record) {
  if (record.type !== 'user' || record.isMeta) return false;
  if (record.content.some((block) => block.type === 'tool_result')) return false;
  return record.content.some((block) => block.type === 'text' && block.text.trim() !== '');
}

/**
 * The records of the turn whose final message is `message`, oldest first, or
 * null when no assistant record carries that text. The chain runs from the
 * final message back along `parentUuid` and stops at the user prompt that
 * started the turn, or at the first record with no known parent.
 *
 * @param {TranscriptRecord[]} records
 * @param {string} message
 * @returns {TranscriptRecord[]|null}
 */
export function locateTurn(records, message) {
  const wanted = normalizeWhitespace(message);
  if (wanted === '') return null;
  /** @type {TranscriptRecord|null} */
  let final = null;
  for (const record of records) {
    if (record.type === 'assistant' && normalizeWhitespace(textOf(record)) === wanted) final = record;
  }
  if (final === null) return null;
  const byUuid = new Map(records.map((record) => [record.uuid, record]));
  /** @type {TranscriptRecord[]} */
  const chain = [final];
  const seen = new Set([final.uuid]);
  let current = final;
  while (current.parentUuid !== null && !seen.has(current.parentUuid)) {
    const parent = byUuid.get(current.parentUuid);
    if (parent === undefined) break;
    chain.unshift(parent);
    seen.add(parent.uuid);
    if (isUserPrompt(parent)) break;
    current = parent;
  }
  return chain;
}

/**
 * The turn's records as Markdown a sub-agent can read in one pass.
 *
 * @param {TranscriptRecord[]} records Oldest first, as `locateTurn` returns them.
 * @param {{ turn: Turn, maxToolResultChars?: number }} options
 * @returns {string}
 */
export function renderTurnSlice(records, { turn, maxToolResultChars = MAX_TOOL_RESULT_CHARS }) {
  /** @type {Map<string, string>} */
  const results = new Map();
  for (const record of records) {
    for (const block of record.content) if (block.type === 'tool_result') results.set(block.toolUseId, block.text);
  }
  const last = records[records.length - 1];
  const opening = records[0] !== undefined && isUserPrompt(records[0]) ? records[0] : null;

  /** @type {string[]} */
  const lines = [
    `# Turn ${turn.promptId}: the reviewed turn's slice of the transcript`,
    '',
    `Session \`${turn.sessionId}\`${turn.transcriptPath ? `, transcript \`${turn.transcriptPath}\`` : ''}. Records in the order they happened; tool results are cut to ${maxToolResultChars.toLocaleString('en-US')} characters, with the omitted length noted.`,
    '',
    '## User prompt',
    '',
    opening === null ? '(not found in the transcript: the chain of records ends before a user prompt)' : textOf(opening).trim(),
    '',
    '## What the agent did',
    '',
  ];
  let steps = 0;
  for (const record of records) {
    if (record === opening || record === last || record.type !== 'assistant') continue;
    for (const block of record.content) {
      switch (block.type) {
        case 'thinking':
          steps += 1;
          lines.push('### Reasoning', '', block.thinking.trim(), '');
          break;
        case 'text':
          if (block.text.trim() === '') break;
          steps += 1;
          lines.push('### Message', '', block.text.trim(), '');
          break;
        case 'tool_use': {
          steps += 1;
          const result = results.get(block.id);
          lines.push(`### Tool call: ${block.name}`, '', 'Input:', '', fence(JSON.stringify(block.input ?? null, null, 2), 'json'), '');
          if (result === undefined) lines.push('Result: (none recorded)', '');
          else lines.push(...describeResult(result, maxToolResultChars), '');
          break;
        }
        default:
          break;
      }
    }
  }
  if (steps === 0) lines.push('(no reasoning or tool calls recorded before the final message)', '');
  lines.push('## Final message', '', last === undefined ? '' : textOf(last).trim(), '');
  return lines.join('\n');
}

/**
 * @param {string} result
 * @param {number} max
 * @returns {string[]}
 */
function describeResult(result, max) {
  if (result.length <= max) return [`Result (${result.length.toLocaleString('en-US')} characters):`, '', fence(result, '')];
  const omitted = result.length - max;
  return [
    `Result (first ${max.toLocaleString('en-US')} of ${result.length.toLocaleString('en-US')} characters; ${omitted.toLocaleString('en-US')} omitted):`,
    '',
    fence(result.slice(0, max), ''),
  ];
}

/**
 * @param {string} text
 * @param {string} language
 */
function fence(text, language) {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${language}\n${text}\n${ticks}`;
}

/**
 * Locate the turn in its transcript and write its slice under the state
 * directory. Returns the file's path, or null when the transcript is missing,
 * unreadable, or does not hold the turn yet. The file is rewritten on every
 * call, since a cold start is rare and the transcript may have grown.
 *
 * @param {{ stateDir: string, turn: Turn, maxToolResultChars?: number }} options
 * @returns {Promise<string|null>}
 */
export async function writeTurnSlice({ stateDir, turn, maxToolResultChars }) {
  if (turn.transcriptPath === null) return null;
  /** @type {string} */
  let text;
  try {
    text = await readFile(turn.transcriptPath, 'utf8');
  } catch {
    return null;
  }
  const records = locateTurn(parseTranscript(text), turn.message);
  if (records === null) return null;
  const dir = join(stateDir, TURN_SLICES_DIR);
  const path = join(dir, `${encodeURIComponent(turn.promptId)}.md`);
  await mkdir(dir, { recursive: true });
  await writeFile(path, renderTurnSlice(records, { turn, maxToolResultChars }), 'utf8');
  return path;
}
