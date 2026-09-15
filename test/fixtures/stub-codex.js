#!/usr/bin/env node
/**
 * A stand-in for `codex exec` that speaks the same JSONL event protocol.
 *
 * Behavior is chosen with STUB_CODEX_MODE:
 *   answer  (default) emit STUB_CODEX_ANSWER_JSON, or a "no documented intent" answer
 *   hang    never exit
 *   fail    exit 1 with a message on stderr
 *   garbage emit text that is not JSONL
 *
 * STUB_CODEX_ARGS_TO and STUB_CODEX_PROMPT_TO name files to record the argv and
 * the prompt, so tests can assert on what the real dispatch path constructed.
 *
 * Like the real CLI, it waits for end of input on stdin. Unlike the real CLI it
 * gives up after a second and exits 3, so a dispatcher that leaves stdin open
 * fails a test instead of hanging it.
 */

import { writeFileSync } from 'node:fs';

const mode = process.env.STUB_CODEX_MODE ?? 'answer';
const args = process.argv.slice(2);
const prompt = args[args.length - 1] ?? '';

if (process.env.STUB_CODEX_ARGS_TO) writeFileSync(process.env.STUB_CODEX_ARGS_TO, JSON.stringify(args));
if (process.env.STUB_CODEX_PROMPT_TO) writeFileSync(process.env.STUB_CODEX_PROMPT_TO, prompt);

const stdinTimer = setTimeout(() => {
  process.stderr.write('stub-codex: stdin is still open after 1s; a real codex would hang here\n');
  process.exit(3);
}, 1_000);

process.stdin.resume();
process.stdin.on('end', () => {
  clearTimeout(stdinTimer);
  run();
});

function run() {
  if (mode === 'hang') {
    setInterval(() => {}, 1_000);
    return;
  }
  if (mode === 'fail') {
    process.stderr.write('stub-codex: simulated failure\n');
    process.exit(1);
  }
  if (mode === 'garbage') {
    process.stdout.write('this is not json\n');
    process.exit(0);
  }
  const threadId = process.env.STUB_CODEX_THREAD_ID ?? `stub-thread-${process.pid}`;
  const answer = process.env.STUB_CODEX_ANSWER_JSON ?? JSON.stringify({ answer: 'No documented intent found.', source: 'none', sourceDetail: '' });
  const events = [
    { type: 'thread.started', thread_id: threadId },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: answer } },
    { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
  ];
  process.stdout.write(events.map((event) => JSON.stringify(event)).join('\n') + '\n');
}
