/**
 * The prompt a sub-agent receives for a side question. Built in one place so
 * that every dispatch, on either backend, carries the same rules and the same
 * forwarded conventions. Nothing here knows which CLI will read it.
 */

import { parseBackendTag } from './backends.js';

export const CONVENTIONS_HEADING = '## Conventions forwarded from the user';
export const EARLIER_HEADING = '## Earlier in this thread';
export const SINCE_HEADING = '## Since your last answer';
const MAX_DOCUMENT_CHARS = 40_000;
const WINDOW_CHARS = 15_000;

/** @typedef {import('../store/threads.js').Exchange} Exchange */

/**
 * @typedef {object} PromptInput
 * @property {string} question The question, with any leading backend tag removed.
 * @property {string} selectedText
 * @property {string} message The agent's turn output being reviewed.
 * @property {string} cwd
 * @property {string|null} transcriptPath
 * @property {string|null} [turnSlicePath] The reviewed turn's own slice of the transcript, when it could be located.
 * @property {string} conventions Forwarded conventions text, possibly empty.
 * @property {string} promptId
 * @property {Exchange[]} [priorExchanges] Earlier answered exchanges in this thread, oldest first, for a new session that continues a thread.
 */

/**
 * @param {PromptInput} input
 * @returns {string}
 */
export function buildPrompt(input) {
  const prior = input.priorExchanges ?? [];
  return [
    'You are answering a side question about a coding agent\'s output, on behalf of the user who is reading that output.',
    'You run read-only. You may inspect files and the transcript. You must not modify anything.',
    'You are not the agent that produced the output and you do not know its reasoning unless a record of it exists.',
    '',
    '## Where evidence may come from',
    '',
    transcriptSource(input.transcriptPath, input.turnSlicePath ?? null),
    `2. \`code\`: the project at \`${input.cwd}\`. Authoritative for what happens, silent on why.`,
    `3. \`spec\`: project specification documents, such as \`openspec/\` under the project, README files, and design notes. Authored intent, which may be stale.`,
    '',
    'Declare exactly one source for your answer, the one that carries the evidence. If several apply, name the strongest and mention the rest in the answer.',
    'If nothing documents the answer, say so: answer "No documented intent found." with source `none`, and add what you did check. Do not invent a plausible reason. An honest "nothing found" is a complete answer.',
    '',
    CONVENTIONS_HEADING,
    '',
    'Follow these when writing your answer. They come from the user\'s own agent instructions, which you would not otherwise see.',
    '',
    input.conventions.trim() === '' ? '(none found)' : input.conventions.trim(),
    '',
    `## The agent's output being reviewed (turn ${input.promptId})`,
    '',
    windowDocument(input.message, input.selectedText),
    '',
    '## The range the user selected',
    '',
    quote(input.selectedText),
    '',
    ...(prior.length > 0
      ? [
          EARLIER_HEADING,
          '',
          'The user already asked about this range. The exchanges so far, as question and answer text only; you did not see how the answers were found.',
          '',
          describeExchanges(prior),
          '',
        ]
      : []),
    '## The question',
    '',
    input.question.trim(),
    '',
    '## Response format',
    '',
    'Respond as JSON matching the schema you were given: `answer` (markdown), `source` (one of code, transcript, spec, none), `sourceDetail` (a file and line, a transcript turn, or a spec heading; empty for none).',
    'Treat the selected range as what the user is pointing at, not as the limit of what you may read.',
  ].join('\n');
}

/**
 * The transcript as an evidence source: where it is, how to read it, and
 * where the reviewed turn's own slice is, or how to find the turn without one.
 *
 * @param {string|null} transcriptPath
 * @param {string|null} turnSlicePath
 */
function transcriptSource(transcriptPath, turnSlicePath) {
  if (transcriptPath === null) return '1. `transcript`: not available for this turn.';
  const where = `1. \`transcript\`: the main session's transcript at \`${transcriptPath}\`. It is JSONL; each line is a JSON object whose \`type\` is \`user\` or \`assistant\` with the message under \`message\`. This is the decision as it was made, and the best evidence for "why".`;
  if (turnSlicePath !== null) {
    return `${where} The reviewed turn's own slice of it is at \`${turnSlicePath}\`, as Markdown: the user prompt that started the turn, the agent's reasoning where recorded, its tool calls with their results, and its final message. Start there; the full transcript holds the earlier turns.`;
  }
  return `${where} The reviewed turn could not be located in it when this question was asked; the transcript may lag. To find it, search the file for the opening words of the final message quoted below, then follow each record's \`parentUuid\` back to the \`user\` record that started the turn.`;
}

/**
 * Earlier exchanges as text: question, then answer with its declared source.
 * A question is shown without the tag that routed it, which is a note to
 * sidescreen and not part of what was asked.
 *
 * @param {Exchange[]} exchanges Oldest first.
 * @returns {string}
 */
export function describeExchanges(exchanges) {
  return exchanges
    .map((exchange, index) => {
      const answer = exchange.answer;
      const source = answer === null ? 'no answer' : answer.sourceDetail ? `source \`${answer.source}\`, ${answer.sourceDetail}` : `source \`${answer.source}\``;
      return [
        `### Exchange ${index + 1}, answered by ${exchange.backend}`,
        '',
        `Question: ${parseBackendTag(exchange.question.trim()).question.trim()}`,
        '',
        `Answer (${source}):`,
        '',
        answer === null ? '(none)' : answer.text.trim(),
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * The whole document when it fits, otherwise a window around the selection.
 *
 * @param {string} message
 * @param {string} selectedText
 * @returns {string}
 */
function windowDocument(message, selectedText) {
  if (message.length <= MAX_DOCUMENT_CHARS) return fence(message);
  const index = selectedText === '' ? -1 : message.indexOf(selectedText);
  const center = index >= 0 ? index + Math.floor(selectedText.length / 2) : Math.floor(message.length / 2);
  const start = Math.max(0, center - WINDOW_CHARS);
  const end = Math.min(message.length, center + WINDOW_CHARS);
  const before = start > 0 ? `[… ${start} characters omitted …]\n` : '';
  const after = end < message.length ? `\n[… ${message.length - end} characters omitted …]` : '';
  return fence(`${before}${message.slice(start, end)}${after}`);
}

/** @param {string} text */
function fence(text) {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}markdown\n${text}\n${ticks}`;
}

/** @param {string} text */
function quote(text) {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * The prompt for a question that continues an answered exchange.
 *
 * The forked session already holds the agent's output, the selected range,
 * and the earlier answers, so only the rules, the conventions, the new
 * question, and whatever other sub-agents answered since travel.
 *
 * @param {{ question: string, selectedText: string, conventions: string, sinceLastAnswer?: Exchange[] }} input
 * @returns {string}
 */
export function buildFollowUpPrompt(input) {
  const since = input.sinceLastAnswer ?? [];
  return [
    "A follow-up question in the same review. You already have the agent's output, the range the user selected, and your earlier answers in this conversation.",
    'You still run read-only, and you still declare exactly one source from code, transcript, spec, or none. "No documented intent found." with source `none` remains a complete answer.',
    '',
    CONVENTIONS_HEADING,
    '',
    input.conventions.trim() === '' ? '(none found)' : input.conventions.trim(),
    '',
    '## The range the user selected',
    '',
    quote(input.selectedText),
    '',
    ...(since.length > 0
      ? [
          SINCE_HEADING,
          '',
          `The thread continued after your last answer with ${since.length === 1 ? 'an exchange' : 'exchanges'} answered by ${describeBackends(since)}. ${since.length === 1 ? 'It is' : 'They are'} given as question and answer text only; you did not see how ${since.length === 1 ? 'that answer' : 'those answers'} ${since.length === 1 ? 'was' : 'were'} found.`,
          '',
          describeExchanges(since),
          '',
        ]
      : []),
    '## The question',
    '',
    input.question.trim(),
    '',
    '## Response format',
    '',
    'Respond as JSON matching the schema you were given: `answer` (markdown), `source` (one of code, transcript, spec, none), `sourceDetail` (a file and line, a transcript turn, or a spec heading; empty for none).',
  ].join('\n');
}

/** @param {Exchange[]} exchanges */
function describeBackends(exchanges) {
  const names = [...new Set(exchanges.map((exchange) => exchange.backend))];
  return names.length === 1 ? `another sub-agent (${names[0]})` : `other sub-agents (${names.join(' and ')})`;
}
