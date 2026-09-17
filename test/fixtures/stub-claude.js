#!/usr/bin/env node
/**
 * A stand-in for `claude -p --output-format json` that prints the same one
 * JSON result object the real CLI does.
 *
 * Behavior is chosen with STUB_CLAUDE_MODE:
 *   answer  (default) emit STUB_CLAUDE_ANSWER_JSON as structured output, or a "no documented intent" answer
 *   hang    never exit
 *   fail    exit 1 with an is_error result, like a CLI that is not logged in
 *   denied  exit 0 with no answer and a permission denial recorded
 *   garbage emit text that is not JSON
 *
 * The session id it reports encodes lineage, like the real CLI's does not:
 * a fresh run gets STUB_CLAUDE_SESSION_ID or `stub-session-<pid>`, and a run
 * with `--resume S --fork-session` gets `fork-of-<S>-<pid>`, so tests can see
 * which session a question continued.
 *
 * STUB_CLAUDE_ARGS_TO and STUB_CLAUDE_PROMPT_TO name files that receive the
 * argv and the prompt of the latest run. STUB_CLAUDE_LOG_TO names a file that
 * gets one JSON line per run appended, with the working directory and the
 * sub-agent marker the run saw. STUB_CLAUDE_DELAY_MS holds the answer back.
 *
 * Like the real CLI, it waits for end of input on stdin. Unlike the real CLI it
 * gives up after a second and exits 3, so a dispatcher that leaves stdin open
 * fails a test instead of hanging it.
 */

import { appendFileSync, writeFileSync } from 'node:fs';

const mode = process.env.STUB_CLAUDE_MODE ?? 'answer';
const args = process.argv.slice(2);
const prompt = args[args.length - 1] ?? '';
const resumeIndex = args.indexOf('--resume');
const continuedSession = resumeIndex >= 0 ? args[resumeIndex + 1] : null;
const subcommand = continuedSession === null ? 'new' : 'fork';
const modelIndex = args.indexOf('--model');
const model = modelIndex >= 0 ? args[modelIndex + 1] : null;

if (process.env.STUB_CLAUDE_ARGS_TO) writeFileSync(process.env.STUB_CLAUDE_ARGS_TO, JSON.stringify(args));
if (process.env.STUB_CLAUDE_PROMPT_TO) writeFileSync(process.env.STUB_CLAUDE_PROMPT_TO, prompt);
if (process.env.STUB_CLAUDE_LOG_TO) {
  appendFileSync(
    process.env.STUB_CLAUDE_LOG_TO,
    JSON.stringify({ args, prompt, subcommand, continuedSession, model, cwd: process.cwd(), subagentMarker: process.env.SIDESCREEN_SUBAGENT ?? null }) + '\n',
  );
}

const stdinTimer = setTimeout(() => {
  process.stderr.write('stub-claude: stdin is still open after 1s; a real claude would wait here\n');
  process.exit(3);
}, 1_000);

process.stdin.resume();
process.stdin.on('end', () => {
  clearTimeout(stdinTimer);
  const delay = Number(process.env.STUB_CLAUDE_DELAY_MS ?? 0);
  if (delay > 0) setTimeout(run, delay);
  else run();
});

function run() {
  const sessionId = continuedSession !== null ? `fork-of-${continuedSession}-${process.pid}` : process.env.STUB_CLAUDE_SESSION_ID ?? `stub-session-${process.pid}`;
  const modelUsage = model === null ? {} : { [model]: { inputTokens: 1, outputTokens: 1 } };
  if (mode === 'hang') {
    setInterval(() => {}, 1_000);
    return;
  }
  if (mode === 'fail') {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, session_id: sessionId, result: 'Not logged in · Please run /login', modelUsage: {} }) + '\n');
    process.exit(1);
  }
  if (mode === 'denied') {
    process.stdout.write(
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: '', modelUsage, permission_denials: [{ tool_name: 'Write', tool_use_id: 'x' }] }) + '\n',
    );
    process.exit(0);
  }
  if (mode === 'garbage') {
    process.stdout.write('this is not json\n');
    process.exit(0);
  }
  const answer = process.env.STUB_CLAUDE_ANSWER_JSON ?? JSON.stringify({ answer: 'No documented intent found.', source: 'none', sourceDetail: '' });
  /** @type {unknown} */
  let structured;
  try {
    structured = JSON.parse(answer);
  } catch {
    structured = null;
  }
  process.stdout.write(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: sessionId,
      result: answer,
      ...(structured === null ? {} : { structured_output: structured }),
      modelUsage,
      permission_denials: [],
      num_turns: 1,
    }) + '\n',
  );
}
