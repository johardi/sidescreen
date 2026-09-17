/**
 * The Codex CLI as a sub-agent backend.
 *
 * The read-only guarantee is structural: `buildCodexCommand` has no parameter
 * for the sandbox policy, so no caller can widen it. A new session runs
 * `codex exec` with `-s read-only`; a continuation runs `codex exec fork`,
 * which takes no `-s`, with the same policy as a config override.
 */

/** @typedef {import('./adapter.js').BackendAdapter} BackendAdapter */
/** @typedef {import('./adapter.js').CommandInput} CommandInput */
/** @typedef {import('./adapter.js').ParsedOutput} ParsedOutput */

/** The only sandbox policy a side question may run under. */
export const SANDBOX_POLICY = 'read-only';
/** The same policy as a config override, for subcommands without `-s`. */
export const READ_ONLY_CONFIG = `sandbox_mode="${SANDBOX_POLICY}"`;

/**
 * Build the Codex command line. There is deliberately no way to pass a
 * sandbox policy: every command this returns is read-only.
 *
 * @param {CommandInput} input
 * @returns {{ command: string, args: string[] }}
 */
export function buildCodexCommand({ bin, target, prompt, schemaPath, model, cwd }) {
  const output = ['--json', '--output-schema', schemaPath];
  const modelArgs = model ? ['-m', model] : [];
  /** @type {string[]} */
  let args;
  switch (target.mode) {
    case 'new':
      args = ['exec', '-s', SANDBOX_POLICY, '-c', READ_ONLY_CONFIG, '-C', cwd, '--skip-git-repo-check', ...output, ...modelArgs, prompt];
      break;
    case 'fork':
      args = ['exec', 'fork', '-c', READ_ONLY_CONFIG, '--skip-git-repo-check', ...output, ...modelArgs, target.sessionId, prompt];
      break;
  }
  return { command: bin, args };
}

/**
 * Pull what matters out of `codex exec --json` output: the thread id from
 * `thread.started`, the last agent message, and any reported errors.
 *
 * @param {string} stdout
 * @returns {ParsedOutput}
 */
export function parseCodexEvents(stdout) {
  /** @type {ParsedOutput} */
  const result = { sessionId: null, finalText: null, errors: [], model: null };
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
        if (typeof event.thread_id === 'string') result.sessionId = event.thread_id;
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

/** @type {BackendAdapter} */
export const codexAdapter = {
  name: 'codex',
  command: buildCodexCommand,
  parseOutput: parseCodexEvents,
};
