/**
 * The Claude Code CLI as a sub-agent backend.
 *
 * The read-only guarantee rests on four flags together, and on nothing a
 * caller can reach: `--restricted` removes the shell and code-running tools
 * and ignores user and project settings, so sidescreen's own hooks never
 * fire inside the sub-agent; `--tools` allows only the three reading tools;
 * `--strict-mcp-config` loads no MCP server, since `--tools` governs the
 * built-in set only and a user's MCP servers can write elsewhere; and
 * `--permission-prompts none` denies anything that would have asked.
 * `buildClaudeCommand` has no parameter for any of them.
 */

/** @typedef {import('./adapter.js').BackendAdapter} BackendAdapter */
/** @typedef {import('./adapter.js').CommandInput} CommandInput */
/** @typedef {import('./adapter.js').ParsedOutput} ParsedOutput */

/** The only tools a side question may use. */
export const READ_ONLY_TOOLS = 'Read,Grep,Glob';
/** The fixed arguments that make every run read-only. */
export const RESTRICTED_ARGS = Object.freeze(['--restricted', '--tools', READ_ONLY_TOOLS, '--strict-mcp-config', '--permission-prompts', 'none']);

/**
 * Build the Claude Code command line. Every command this returns is
 * read-only; there is no parameter through which that can change.
 *
 * @param {CommandInput} input
 * @returns {{ command: string, args: string[] }}
 */
export function buildClaudeCommand({ bin, target, prompt, schemaText, model, readDirs, sessionName }) {
  const args = ['-p', ...RESTRICTED_ARGS, '--output-format', 'json', '--json-schema', schemaText];
  for (const dir of readDirs) args.push('--add-dir', dir);
  if (model) args.push('--model', model);
  if (sessionName) args.push('--name', sessionName);
  if (target.mode === 'fork') args.push('--resume', target.sessionId, '--fork-session');
  args.push(prompt);
  return { command: bin, args };
}

/**
 * Read the one JSON object `claude -p --output-format json` prints.
 *
 * `structured_output` is the answer when the schema was honoured, `result`
 * otherwise. `is_error` makes `result` the error message. A denied tool is
 * the likeliest reason for an empty answer, so denials are reported too.
 *
 * @param {string} stdout
 * @returns {ParsedOutput}
 */
export function parseClaudeResult(stdout) {
  /** @type {ParsedOutput} */
  const parsed = { sessionId: null, finalText: null, errors: [], model: null };
  /** @type {Record<string, unknown>|null} */
  let result = null;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const candidate = JSON.parse(trimmed);
      if (candidate && typeof candidate === 'object' && candidate.type === 'result') result = candidate;
    } catch {
      continue;
    }
  }
  if (result === null) return parsed;
  if (typeof result.session_id === 'string') parsed.sessionId = result.session_id;
  const usage = result.modelUsage;
  if (usage && typeof usage === 'object') {
    const [model] = Object.keys(usage);
    if (model) parsed.model = model;
  }
  if (result.is_error === true) {
    parsed.errors.push(typeof result.result === 'string' && result.result !== '' ? result.result : 'the CLI reported an error');
    return parsed;
  }
  if (result.structured_output && typeof result.structured_output === 'object') {
    parsed.finalText = JSON.stringify(result.structured_output);
  } else if (typeof result.result === 'string' && result.result.trim() !== '') {
    parsed.finalText = result.result;
  }
  const denials = Array.isArray(result.permission_denials) ? result.permission_denials : [];
  if (parsed.finalText === null && denials.length > 0) {
    const tools = denials.map((denial) => (denial && typeof denial === 'object' && typeof denial.tool_name === 'string' ? denial.tool_name : 'a tool')).join(', ');
    parsed.errors.push(`permission denied for ${tools}`);
  }
  return parsed;
}

/** @type {BackendAdapter} */
export const claudeAdapter = {
  name: 'claude',
  command: buildClaudeCommand,
  parseOutput: parseClaudeResult,
};
