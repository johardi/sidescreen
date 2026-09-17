/**
 * The sub-agent backends: which CLI answers a question.
 *
 * A backend is named by the CLI that runs it, `claude` or `codex`, and a
 * question chooses one with a leading tag, `@claude` or `@codex`. Everything
 * that differs between the two lives in their adapters; this module only
 * names them and reads the configuration that picks a default.
 */

/** @typedef {'claude'|'codex'} Backend */

/** @type {readonly Backend[]} */
export const BACKENDS = ['claude', 'codex'];

/**
 * The environment variable that locates each backend's CLI.
 *
 * @type {Record<Backend, string>}
 */
export const BIN_SETTINGS = { claude: 'SIDESCREEN_CLAUDE_BIN', codex: 'SIDESCREEN_CODEX_BIN' };

/**
 * The environment variable that pins each backend's model.
 *
 * @type {Record<Backend, string>}
 */
export const MODEL_SETTINGS = { claude: 'SIDESCREEN_CLAUDE_MODEL', codex: 'SIDESCREEN_CODEX_MODEL' };

/** @type {Record<Backend, string>} */
export const DEFAULT_BINS = { claude: 'claude', codex: 'codex' };

export const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * The backend that produced the reviewed turn. The hooks are Claude Code's,
 * so today the parent is always Claude; the indirection keeps the `parent`
 * setting meaningful should another harness ever deliver a turn.
 */
export const PARENT_BACKEND = /** @type {Backend} */ ('claude');

/**
 * @param {unknown} value
 * @returns {value is Backend}
 */
export function isBackend(value) {
  return typeof value === 'string' && BACKENDS.includes(/** @type {Backend} */ (value));
}

/**
 * A tag is `@` and a name standing as a word of its own: preceded by the
 * start of the text or whitespace, and followed by the end, whitespace, or a
 * punctuation mark that does not run on into more text. So `does @codex
 * agree?` and `@codex.` carry a tag, while `me@codex.com`, `@codex.com`, and
 * the escaped `\@codex` do not.
 */
const TAG_TOKEN = /(^|\s)@([a-z]+)(?=$|\s|[.,;:!?)](?:\s|$))/gi;

/**
 * Read a backend tag out of a question.
 *
 * The first `@claude` or `@codex` standing as a word of its own, in any
 * letter case and at any position, names the backend, and that token is
 * removed from the question. Anything else, including an address, a domain,
 * an escaped tag, or an unknown name, is ordinary question text and is
 * returned unchanged. A second tag stays in the text.
 *
 * @param {string} text
 * @returns {{ backend: Backend|null, question: string }} The backend named, and the question with the tag removed.
 */
export function parseBackendTag(text) {
  for (const match of text.matchAll(TAG_TOKEN)) {
    const name = match[2].toLowerCase();
    if (!isBackend(name)) continue;
    const start = match.index ?? 0;
    const before = text.slice(0, start);
    // A line break before the tag stays; a space before it goes with the token.
    const lineBreak = /[\r\n]/.test(match[1]) ? match[1] : '';
    const after = text.slice(start + match[0].length).replace(lineBreak === '' ? /^(?!)/ : /^[ \t]+/, '');
    const question = `${before}${lineBreak}${after}`.replace(/[ \t]{2,}/g, ' ');
    return { backend: name, question: question.trim() };
  }
  return { backend: null, question: text };
}

/**
 * @typedef {object} DispatchSettings
 * @property {'parent'|Backend} subagent The configured default, as given.
 * @property {Backend} defaultBackend The configured default, resolved.
 * @property {Record<Backend, string>} bins The command for each backend.
 * @property {Record<Backend, string|undefined>} models A pinned model for each backend, when configured.
 * @property {number} timeoutMs
 */

/**
 * Read the sub-agent configuration from the environment.
 *
 * `SIDESCREEN_SUBAGENT` names the default backend: `parent` (the default),
 * `claude`, or `codex`. Anything else is treated as `parent`.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {DispatchSettings}
 */
export function dispatchSettings(env) {
  const raw = (env.SIDESCREEN_SUBAGENT ?? '').trim().toLowerCase();
  /** @type {'parent'|Backend} */
  const subagent = isBackend(raw) ? raw : 'parent';
  const timeout = Number(env.SIDESCREEN_DISPATCH_TIMEOUT_MS);
  return {
    subagent,
    defaultBackend: subagent === 'parent' ? PARENT_BACKEND : subagent,
    bins: {
      claude: env[BIN_SETTINGS.claude] || DEFAULT_BINS.claude,
      codex: env[BIN_SETTINGS.codex] || DEFAULT_BINS.codex,
    },
    models: {
      claude: env[MODEL_SETTINGS.claude] || undefined,
      codex: env[MODEL_SETTINGS.codex] || undefined,
    },
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}
