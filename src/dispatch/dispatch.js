/**
 * Dispatching a side question to a read-only sub-agent.
 *
 * The read-only guarantee is structural: `buildCommand` has no parameter for
 * the sandbox policy, so no caller can widen it. Standard input is always
 * `/dev/null`, because a sub-agent CLI handed an open pipe waits on it forever.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildFollowUpPrompt, buildPrompt } from './dispatch-prompt.js';
import { loadConventions } from './conventions.js';

/** @typedef {import('../store/threads.js').Answer} Answer */
/** @typedef {import('../web/server.js').DispatchInput} DispatchInput */
/** @typedef {import('../web/server.js').DispatchResult} DispatchResult */

/** The only sandbox policy a side question may run under. */
export const SANDBOX_POLICY = 'read-only';
/** The same policy as a config override, for subcommands without `-s`. */
export const READ_ONLY_CONFIG = `sandbox_mode="${SANDBOX_POLICY}"`;
/** Node's spawn value that attaches /dev/null to a stdio slot. */
export const STDIN_CLOSED = 'ignore';
export const DEFAULT_TIMEOUT_MS = 300_000;
export const DEFAULT_CODEX_BIN = 'codex';
export const ANSWER_SCHEMA_PATH = fileURLToPath(new URL('./answer-schema.json', import.meta.url));
const KILL_GRACE_MS = 2_000;

/**
 * Where a dispatch starts from.
 *
 * @typedef {{ mode: 'new', cwd: string } | { mode: 'resume', sessionId: string } | { mode: 'fork', sessionId: string }} DispatchTarget
 */

/**
 * Build the sub-agent command line. There is deliberately no way to pass a
 * sandbox policy: every command this returns is read-only.
 *
 * @param {{ target: DispatchTarget, prompt: string, schemaPath?: string, codexBin?: string, model?: string }} options
 * @returns {{ command: string, args: string[] }}
 */
export function buildCommand({ target, prompt, schemaPath = ANSWER_SCHEMA_PATH, codexBin = DEFAULT_CODEX_BIN, model }) {
  const output = ['--json', '--output-schema', schemaPath];
  const modelArgs = model ? ['-m', model] : [];
  /** @type {string[]} */
  let args;
  switch (target.mode) {
    case 'new':
      args = ['exec', '-s', SANDBOX_POLICY, '-c', READ_ONLY_CONFIG, '-C', target.cwd, '--skip-git-repo-check', ...output, ...modelArgs, prompt];
      break;
    case 'resume':
      args = ['exec', 'resume', '-c', READ_ONLY_CONFIG, '--skip-git-repo-check', ...output, ...modelArgs, target.sessionId, prompt];
      break;
    case 'fork':
      args = ['exec', 'fork', '-c', READ_ONLY_CONFIG, '--skip-git-repo-check', ...output, ...modelArgs, target.sessionId, prompt];
      break;
  }
  return { command: codexBin, args };
}

/**
 * @typedef {object} RunResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {number|null} exitCode
 * @property {NodeJS.Signals|null} signal
 * @property {boolean} timedOut
 * @property {number} durationMs
 */

/**
 * Run a command with stdin closed and a hard time bound.
 *
 * @param {{ command: string, args: string[], cwd?: string, timeoutMs: number, spawn?: typeof nodeSpawn, env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<RunResult>} Rejects only when the process cannot be started.
 */
export function runCommand({ command, args, cwd, timeoutMs, spawn = nodeSpawn, env = process.env }) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: [STDIN_CLOSED, 'pipe', 'pipe'] });
    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, KILL_GRACE_MS).unref();
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}

/**
 * @typedef {object} CodexEvents
 * @property {string|null} threadId The sub-agent session id, from `thread.started`.
 * @property {string|null} finalText The last agent message.
 * @property {string[]} errors Error messages the sub-agent reported.
 */

/**
 * Pull what matters out of `codex exec --json` output.
 *
 * @param {string} stdout
 * @returns {CodexEvents}
 */
export function parseCodexEvents(stdout) {
  /** @type {CodexEvents} */
  const result = { threadId: null, finalText: null, errors: [] };
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    /** @type {Record<string, unknown>} */
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    switch (event.type) {
      case 'thread.started':
        if (typeof event.thread_id === 'string') result.threadId = event.thread_id;
        break;
      case 'item.completed': {
        const item = /** @type {{ type?: string, text?: string }|undefined} */ (event.item);
        if (item?.type === 'agent_message' && typeof item.text === 'string') result.finalText = item.text;
        break;
      }
      case 'error':
      case 'turn.failed': {
        const message = event.message ?? /** @type {{ message?: string }|undefined} */ (event.error)?.message;
        if (typeof message === 'string') result.errors.push(message);
        break;
      }
      default:
        break;
    }
  }
  return result;
}

const SOURCES = new Set(['code', 'transcript', 'spec', 'none']);
const TRAILING_SOURCE_LINE = /^\s*source\s*:\s*(code|transcript|spec|none)\b\s*(?:[-:,]\s*(.*))?$/i;

/**
 * Interpret the sub-agent's final message as a sourced answer.
 *
 * Structured output is expected. A plain-text answer ending in a
 * `Source: <value>` line is accepted. Anything else is kept as the answer
 * text with the source marked `undeclared`, which the surface flags.
 *
 * @param {string|null} finalText
 * @returns {Answer|null} Null when there is no answer text at all.
 */
export function parseAnswer(finalText) {
  if (finalText === null || finalText.trim() === '') return null;
  const trimmed = finalText.trim();

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && typeof parsed.answer === 'string' && SOURCES.has(parsed.source)) {
        return {
          text: parsed.answer,
          source: parsed.source,
          sourceDetail: typeof parsed.sourceDetail === 'string' ? parsed.sourceDetail : '',
        };
      }
    } catch {
      // Fall through to the plain-text forms.
    }
  }

  const lines = trimmed.split('\n');
  const lastLine = lines[lines.length - 1];
  const match = TRAILING_SOURCE_LINE.exec(lastLine);
  if (match && lines.length > 1) {
    return {
      text: lines.slice(0, -1).join('\n').trim(),
      source: /** @type {Answer['source']} */ (match[1].toLowerCase()),
      sourceDetail: (match[2] ?? '').trim(),
    };
  }

  return { text: trimmed, source: 'undeclared', sourceDetail: '' };
}

/**
 * @typedef {object} DispatchOptions
 * @property {DispatchTarget} [target] Overrides the target the server chose; defaults to a new session in the turn's cwd.
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [codexBin]
 * @property {number} [timeoutMs]
 * @property {string} [model]
 * @property {string} [conventions] Pre-loaded conventions text; loaded from disk when omitted.
 * @property {typeof nodeSpawn} [spawn]
 * @property {string} [schemaPath]
 */

/**
 * Answer one exchange by running the sub-agent once.
 *
 * @param {Omit<DispatchInput, 'target'> & DispatchOptions} input
 * @returns {Promise<DispatchResult>}
 */
export async function dispatchQuestion(input) {
  const env = input.env ?? process.env;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const conventions = input.conventions ?? (await loadConventions({ cwd: input.turn.cwd, env })).text;
  const target = input.target ?? { mode: 'new', cwd: input.turn.cwd };
  const prompt =
    target.mode === 'new'
      ? buildPrompt({
          question: input.exchange.question,
          selectedText: input.thread.selectedText,
          message: input.turn.message,
          cwd: input.turn.cwd,
          transcriptPath: input.turn.transcriptPath,
          conventions,
          promptId: input.turn.promptId,
        })
      : buildFollowUpPrompt({ question: input.exchange.question, selectedText: input.thread.selectedText, conventions });
  const { command, args } = buildCommand({ target, prompt, schemaPath: input.schemaPath, codexBin: input.codexBin, model: input.model });

  /** @type {RunResult} */
  let run;
  try {
    run = await runCommand({ command, args, cwd: input.turn.cwd, timeoutMs, spawn: input.spawn, env });
  } catch (error) {
    return { ok: false, error: `Could not start ${command}: ${/** @type {Error} */ (error).message}` };
  }

  if (run.timedOut) {
    return { ok: false, error: `The sub-agent did not answer within ${Math.round(timeoutMs / 1000)}s and was stopped.` };
  }

  const events = parseCodexEvents(run.stdout);
  const answer = parseAnswer(events.finalText);
  if (answer === null) {
    const detail = events.errors.length > 0 ? events.errors.join('; ') : lastNonEmptyLine(run.stderr);
    const exit = run.exitCode === null ? `signal ${run.signal}` : `exit code ${run.exitCode}`;
    return { ok: false, error: `The sub-agent produced no answer (${exit})${detail ? `: ${detail}` : '.'}` };
  }
  return { ok: true, answer, subAgentSessionId: events.threadId };
}

/**
 * The server-facing dispatcher, configured from the environment.
 *
 * @param {{ env: NodeJS.ProcessEnv, spawn?: typeof nodeSpawn }} options
 * @returns {import('../web/server.js').Dispatch}
 */
export function createCodexDispatch({ env, spawn }) {
  const settings = dispatchSettings(env);
  return (input) => dispatchQuestion({ ...input, env, spawn, ...settings });
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ codexBin: string, timeoutMs: number, model: string|undefined }}
 */
export function dispatchSettings(env) {
  const timeout = Number(env.SIDESCREEN_DISPATCH_TIMEOUT_MS);
  return {
    codexBin: env.SIDESCREEN_CODEX_BIN || DEFAULT_CODEX_BIN,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    model: env.SIDESCREEN_MODEL || undefined,
  };
}

/** @param {string} text */
function lastNonEmptyLine(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  return lines[lines.length - 1] ?? '';
}
