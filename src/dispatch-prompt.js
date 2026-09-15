/**
 * The prompt a sub-agent receives for a side question. Built in one place so
 * that every dispatch carries the same rules and the same forwarded conventions.
 */

export const CONVENTIONS_HEADING = '## Conventions forwarded from the user';
const MAX_DOCUMENT_CHARS = 40_000;
const WINDOW_CHARS = 15_000;

/**
 * @typedef {object} PromptInput
 * @property {string} question
 * @property {string} selectedText
 * @property {string} message The agent's turn output being reviewed.
 * @property {string} cwd
 * @property {string|null} transcriptPath
 * @property {string} conventions Forwarded conventions text, possibly empty.
 * @property {string} promptId
 * @property {string[]} [priorExchanges] Earlier question/answer pairs in this thread, for cold starts only.
 */

/**
 * @param {PromptInput} input
 * @returns {string}
 */
export function buildPrompt(input) {
  const transcriptLine =
    input.transcriptPath === null
      ? '1. `transcript`: not available for this turn.'
      : `1. \`transcript\`: the main session's transcript at \`${input.transcriptPath}\`. It is JSONL; each line is a JSON object whose \`type\` is \`user\` or \`assistant\` with the message under \`message\`. This is the decision as it was made, and the best evidence for "why".`;

  return [
    'You are answering a side question about a coding agent\'s output, on behalf of the user who is reading that output.',
    'You run read-only. You may inspect files and the transcript. You must not modify anything.',
    'You are not the agent that produced the output and you do not know its reasoning unless a record of it exists.',
    '',
    '## Where evidence may come from',
    '',
    transcriptLine,
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
    ...(input.priorExchanges && input.priorExchanges.length > 0 ? ['## Earlier in this thread', '', ...input.priorExchanges, ''] : []),
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
