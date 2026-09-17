/**
 * Dispatching a side question to a read-only sub-agent.
 *
 * The dispatcher knows a backend only by name. It composes one prompt, the
 * same for either CLI, hands it to that backend's adapter for the command
 * line, runs the command with stdin closed and a time bound, and reads the
 * answer the adapter extracts. Standard input is always `/dev/null`, because
 * a sub-agent CLI handed an open pipe waits on it forever.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFollowUpPrompt, buildPrompt } from './dispatch-prompt.js';
import { loadConventions } from './conventions.js';
import { BIN_SETTINGS, dispatchSettings } from './backends.js';
import { claudeAdapter } from './claude-adapter.js';
import { codexAdapter } from './codex-adapter.js';
import { writeTurnSlice } from './turn-slice.js';
import { normalizeWhitespace } from './turn-slice.js';
import { defaultStateDir } from '../store/store.js';
import { SUBAGENT_MARKER } from '../hooks/ingest.js';

/** @typedef {import('../store/threads.js').Answer} Answer */
/** @typedef {import('../store/threads.js').Exchange} Exchange */
/** @typedef {import('./backends.js').Backend} Backend */
/** @typedef {import('./backends.js').DispatchSettings} DispatchSettings */
/** @typedef {import('./adapter.js').DispatchTarget} DispatchTarget */
/** @typedef {import('./adapter.js').BackendAdapter} BackendAdapter */
/** @typedef {import('../web/server.js').DispatchInput} DispatchInput */
/** @typedef {import('../web/server.js').DispatchResult} DispatchResult */

export { DEFAULT_TIMEOUT_MS } from './backends.js';

/** Node's spawn value that attaches /dev/null to a stdio slot. */
export const STDIN_CLOSED = 'ignore';
export const ANSWER_SCHEMA_PATH = fileURLToPath(new URL('./answer-schema.json', import.meta.url));
const KILL_GRACE_MS = 2_000;
const SESSION_NAME_CHARS = 60;

/** @type {Record<Backend, BackendAdapter>} */
export const ADAPTERS = { claude: claudeAdapter, codex: codexAdapter };

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
 * A recognizable name for a sub-agent session, for CLIs that keep one.
 *
 * @param {string} question
 */
export function sessionNameFor(question) {
  const short = normalizeWhitespace(question);
  return `sidescreen: ${short.length > SESSION_NAME_CHARS ? `${short.slice(0, SESSION_NAME_CHARS - 1)}…` : short}`;
}

/**
 * @typedef {object} DispatchOptions
 * @property {NodeJS.ProcessEnv} [env]
 * @property {DispatchSettings} [settings] Read from `env` when omitted.
 * @property {string} [stateDir] Where the turn slice is written; read from `env` when omitted.
 * @property {number} [timeoutMs]
 * @property {string} [conventions] Pre-loaded conventions text; loaded from disk when omitted.
 * @property {typeof nodeSpawn} [spawn]
 * @property {string} [schemaPath]
 */

/**
 * Answer one exchange by running its backend once.
 *
 * @param {DispatchInput & DispatchOptions} input
 * @returns {Promise<DispatchResult>}
 */
export async function dispatchQuestion(input) {
  const env = input.env ?? process.env;
  const settings = input.settings ?? dispatchSettings(env);
  const backend = input.exchange.backend;
  const adapter = ADAPTERS[backend];
  const bin = settings.bins[backend];
  const timeoutMs = input.timeoutMs ?? settings.timeoutMs;
  const schemaPath = input.schemaPath ?? ANSWER_SCHEMA_PATH;
  const conventions = input.conventions ?? (await loadConventions({ cwd: input.turn.cwd, env })).text;
  const { turn, thread, target } = input;

  /** @type {string} */
  let prompt;
  /** @type {string[]} */
  const readDirs = [];
  if (turn.transcriptPath !== null) readDirs.push(dirname(turn.transcriptPath));
  if (target.mode === 'new') {
    const slicePath = await writeTurnSlice({ stateDir: input.stateDir ?? defaultStateDir(env), turn });
    if (slicePath !== null) readDirs.push(dirname(slicePath));
    prompt = buildPrompt({
      question: input.question,
      selectedText: thread.selectedText,
      message: turn.message,
      cwd: turn.cwd,
      transcriptPath: turn.transcriptPath,
      turnSlicePath: slicePath,
      conventions,
      promptId: turn.promptId,
      priorExchanges: input.priorExchanges,
    });
  } else {
    prompt = buildFollowUpPrompt({ question: input.question, selectedText: thread.selectedText, conventions, sinceLastAnswer: input.gap });
  }

  const model = backend === 'claude' ? settings.models.claude ?? turn.model ?? undefined : settings.models.codex;
  const { command, args } = adapter.command({
    bin,
    target,
    prompt,
    cwd: turn.cwd,
    schemaPath,
    schemaText: await readFile(schemaPath, 'utf8'),
    model,
    readDirs: await existingDirectories(readDirs),
    sessionName: sessionNameFor(input.question),
  });

  /** @type {RunResult} */
  let run;
  try {
    run = await runCommand({ command, args, cwd: turn.cwd, timeoutMs, spawn: input.spawn, env: { ...env, [SUBAGENT_MARKER]: '1' } });
  } catch (error) {
    return {
      ok: false,
      error: `Could not start the ${backend} CLI (${command}): ${/** @type {Error} */ (error).message}. Set ${BIN_SETTINGS[backend]} to where it is installed.`,
    };
  }

  if (run.timedOut) {
    return { ok: false, error: `The ${backend} sub-agent did not answer within ${Math.round(timeoutMs / 1000)}s and was stopped.` };
  }

  const output = adapter.parseOutput(run.stdout);
  const answer = parseAnswer(output.finalText);
  if (answer === null) {
    const detail = output.errors.length > 0 ? output.errors.join('; ') : lastNonEmptyLine(run.stderr);
    const exit = run.exitCode === null ? `signal ${run.signal}` : `exit code ${run.exitCode}`;
    return { ok: false, error: `The ${backend} sub-agent produced no answer (${exit})${detail ? `: ${detail}` : '.'}` };
  }
  return { ok: true, answer, subAgentSessionId: output.sessionId, model: output.model ?? model ?? null };
}

/**
 * The server-facing dispatcher, configured from the environment.
 *
 * @param {{ env: NodeJS.ProcessEnv, spawn?: typeof nodeSpawn, stateDir?: string }} options
 * @returns {import('../web/server.js').Dispatch}
 */
export function createDispatch({ env, spawn, stateDir }) {
  const settings = dispatchSettings(env);
  return (input) => dispatchQuestion({ ...input, env, spawn, settings, stateDir });
}

/**
 * @param {string[]} candidates
 * @returns {Promise<string[]>} The candidates that exist as directories, deduplicated, in order.
 */
async function existingDirectories(candidates) {
  /** @type {string[]} */
  const dirs = [];
  for (const candidate of candidates) {
    if (dirs.includes(candidate)) continue;
    try {
      if ((await stat(candidate)).isDirectory()) dirs.push(candidate);
    } catch {
      // Not there; nothing to grant.
    }
  }
  return dirs;
}

/** @param {string} text */
function lastNonEmptyLine(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  return lines[lines.length - 1] ?? '';
}
