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
 * The session id it reports encodes lineage, like the real CLI's does not:
 * a fresh `exec` gets STUB_CODEX_THREAD_ID or `stub-thread-<pid>`, and a
 * `fork` or `resume` of session S gets `fork-of-<S>-<pid>`, so tests can see
 * which session a question continued.
 *
 * STUB_CODEX_ARGS_TO and STUB_CODEX_PROMPT_TO name files that receive the
 * argv and the prompt of the latest run. STUB_CODEX_LOG_TO names a file that
 * gets one JSON line per run appended, with the working directory and the
 * sub-agent marker the run saw, for tests with several dispatches.
 * STUB_CODEX_DELAY_MS holds the answer back, to make runs overlap.
 *
 * Like the real CLI, it waits for end of input on stdin. Unlike the real CLI it
 * gives up after a second and exits 3, so a dispatcher that leaves stdin open
 * fails a test instead of hanging it.
 */

import { appendFileSync, writeFileSync } from 'node:fs';

const mode = process.env.STUB_CODEX_MODE ?? 'answer';
const args = process.argv.slice(2);
const prompt = args[args.length - 1] ?? '';
const subcommand = args[1] === 'fork' || args[1] === 'resume' ? args[1] : 'new';
const continuedSession = subcommand === 'new' ? null : args[args.length - 2];

if (process.env.STUB_CODEX_ARGS_TO) writeFileSync(process.env.STUB_CODEX_ARGS_TO, JSON.stringify(args));
if (process.env.STUB_CODEX_PROMPT_TO) writeFileSync(process.env.STUB_CODEX_PROMPT_TO, prompt);
if (process.env.STUB_CODEX_LOG_TO) {
  appendFileSync(process.env.STUB_CODEX_LOG_TO, JSON.stringify({ args, prompt, subcommand, continuedSession, cwd: process.cwd(), subagentMarker: process.env.SIDESCREEN_SUBAGENT ?? null }) + '\n');
}

const stdinTimer = setTimeout(() => {
  process.stderr.write('stub-codex: stdin is still open after 1s; a real codex would hang here\n');
  process.exit(3);
}, 1_000);

process.stdin.resume();
process.stdin.on('end', () => {
  clearTimeout(stdinTimer);
  const delay = Number(process.env.STUB_CODEX_DELAY_MS ?? 0);
  if (delay > 0) setTimeout(run, delay);
  else run();
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
  const threadId =
    continuedSession !== null ? `fork-of-${continuedSession}-${process.pid}` : process.env.STUB_CODEX_THREAD_ID ?? `stub-thread-${process.pid}`;
  const answer = process.env.STUB_CODEX_ANSWER_JSON ?? JSON.stringify({ answer: 'No documented intent found.', source: 'none', sourceDetail: '' });
  const events = [
    { type: 'thread.started', thread_id: threadId },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: answer } },
    { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
  ];
  process.stdout.write(events.map((event) => JSON.stringify(event)).join('\n') + '\n');
}
