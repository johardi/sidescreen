/**
 * HTML shells. The document itself is the rendered markdown, untouched;
 * everything here is the frame around it.
 */

import { escapeHtml } from './render-markdown.js';

/** @typedef {import('./types.js').Turn} Turn */
/** @typedef {import('./threads.js').Thread} Thread */

/**
 * @param {{ turn: Turn, documentHtml: string, threads: Thread[], ingestionAvailable: boolean }} input
 * @returns {string}
 */
export function renderTurnPage({ turn, documentHtml, threads, ingestionAvailable }) {
  const data = { turn: { ...turn, message: undefined }, threads };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>annotatr: ${escapeHtml(shortId(turn.promptId))}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">annotatr</a>
  <span class="topbar-meta" title="${escapeHtml(turn.cwd)}">${escapeHtml(baseName(turn.cwd))}</span>
  <time class="topbar-meta" datetime="${escapeHtml(turn.receivedAt)}">${escapeHtml(formatTime(turn.receivedAt))}</time>
  ${ingestionAvailable ? '' : '<span class="topbar-warning">ingestion unavailable: no Stop hook registered</span>'}
</header>
<main class="layout">
  <section class="document-pane">
    <article id="document" class="document">
${documentHtml}
    </article>
  </section>
  <aside class="thread-pane" id="thread-pane" aria-live="polite">
    <p class="thread-empty">Select text in the document to ask about it.</p>
  </aside>
</main>
<form id="ask-popover" class="ask-popover" hidden>
  <blockquote class="ask-selection" id="ask-selection"></blockquote>
  <label class="visually-hidden" for="ask-question">Question</label>
  <textarea id="ask-question" class="ask-question" rows="2" placeholder="Ask about this…" required></textarea>
  <div class="ask-actions">
    <button type="button" class="button-secondary" id="ask-cancel">Cancel</button>
    <button type="submit" class="button-primary" id="ask-submit">Ask</button>
  </div>
</form>
<script id="turn-data" type="application/json">${jsonForScript(data)}</script>
<script type="module" src="/assets/app.js"></script>
</body>
</html>
`;
}

/**
 * @param {{ turns: Turn[], ingestionAvailable: boolean }} input
 * @returns {string}
 */
export function renderIndexPage({ turns, ingestionAvailable }) {
  const items = turns
    .map(
      (turn) => `<li class="turn-item">
  <a class="turn-link" href="/turns/${encodeURIComponent(turn.promptId)}">
    <span class="turn-project">${escapeHtml(baseName(turn.cwd))}</span>
    <time datetime="${escapeHtml(turn.receivedAt)}">${escapeHtml(formatTime(turn.receivedAt))}</time>
    <span class="turn-preview">${escapeHtml(preview(turn.message))}</span>
  </a>
</li>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>annotatr</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body class="index">
<header class="topbar">
  <a class="brand" href="/">annotatr</a>
  ${ingestionAvailable ? '' : '<span class="topbar-warning">ingestion unavailable: no Stop hook registered. Run <code>annotatr setup hooks</code>.</span>'}
</header>
<main class="index-main">
  ${turns.length === 0 ? '<p class="thread-empty">No turns yet. Finish a turn in Claude Code and it will appear here.</p>' : `<ol class="turn-list">${items}</ol>`}
</main>
<script type="module" src="/assets/index.js"></script>
</body>
</html>
`;
}

/**
 * @param {string} title
 * @param {string} message
 */
export function renderErrorPage(title, message) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/assets/app.css"></head>
<body><main class="index-main"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">All turns</a></p></main></body></html>
`;
}

/**
 * JSON that is safe inside a script element: no closing-tag sequences.
 *
 * @param {unknown} value
 */
export function jsonForScript(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

/** @param {string} id */
function shortId(id) {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** @param {string} path */
function baseName(path) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** @param {string} iso */
function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The first line of a message as plain text, for the turn list.
 *
 * @param {string} markdown
 */
export function preview(markdown) {
  let line = '';
  let inFence = false;
  for (const raw of markdown.split('\n')) {
    const candidate = raw.trim();
    if (/^(```|~~~)/.test(candidate)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || candidate === '' || /^(---|\|)/.test(candidate)) continue;
    line = candidate;
    break;
  }
  const plain = line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1');
  return plain.length > 140 ? `${plain.slice(0, 137)}…` : plain;
}
