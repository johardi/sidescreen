/**
 * HTML shells. The document itself is the rendered markdown, untouched;
 * everything here is the frame around it: the landing page that lists
 * projects, and the workspace that focuses on one.
 */

import { escapeHtml } from './render-markdown.js';
import { baseName, formatTime, shortId } from '../format.js';
import { projectPath } from '../store/projects.js';

export { preview } from '../format.js';

/** @typedef {import('../types.js').Turn} Turn */
/** @typedef {import('../store/threads.js').Thread} Thread */
/** @typedef {import('../store/projects.js').Project} Project */
/** @typedef {import('./sidebar.js').Sidebar} Sidebar */

/**
 * What a workspace page follows. The URL depth decides it.
 *
 * @typedef {{ kind: 'project' } | { kind: 'session', sessionId: string } | { kind: 'turn', sessionId: string, promptId: string }} Scope
 */

/**
 * The icons, vendored from Font Awesome Free as SVG paths so that no
 * third-party origin is ever loaded. The license comment travels with them.
 */
const FONT_AWESOME_LICENSE =
  '<!--! Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2024 Fonticons, Inc. -->';

const ICONS = /** @type {Record<string, { viewBox: string, path: string }>} */ ({
  'arrow-left': {
    viewBox: '0 0 448 512',
    path: 'M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.2 288 416 288c17.7 0 32-14.3 32-32s-14.3-32-32-32l-306.7 0L214.6 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z',
  },
  'table-columns': {
    viewBox: '0 0 512 512',
    path: 'M0 96C0 60.7 28.7 32 64 32l384 0c35.3 0 64 28.7 64 64l0 320c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96zm64 64l0 256 160 0 0-256L64 160zm384 0l-160 0 0 256 160 0 0-256z',
  },
});

/** The hidden sprite every icon on the page refers to. */
function iconSprite() {
  const symbols = Object.entries(ICONS)
    .map(([name, { viewBox, path }]) => `<symbol id="icon-${name}" viewBox="${viewBox}"><path d="${path}"/></symbol>`)
    .join('');
  return `<svg class="icon-sprite" aria-hidden="true" focusable="false">${FONT_AWESOME_LICENSE}${symbols}</svg>`;
}

/** @param {keyof typeof ICONS} name */
function icon(name) {
  return `<svg class="icon" aria-hidden="true" focusable="false"><use href="#icon-${name}"></use></svg>`;
}

const HEAD_LINKS = `<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="stylesheet" href="/assets/app.css">`;

/**
 * @param {{ projects: Project[] }} input
 * @returns {string}
 */
export function renderLandingPage({ projects }) {
  const items = projects
    .map(
      (project) => `<li class="project-item">
  <a class="project-link" href="${projectPath(project.id)}" data-project-id="${escapeHtml(project.id)}">
    <span class="project-name">${escapeHtml(project.name)}</span>
    <time datetime="${escapeHtml(project.lastTurnAt ?? '')}">${escapeHtml(project.lastTurnAt ? formatTime(project.lastTurnAt) : 'no turns yet')}</time>
    <span class="project-path">${escapeHtml(project.cwd)}</span>
    <span class="project-sessions">${project.sessionCount} ${project.sessionCount === 1 ? 'session' : 'sessions'}</span>
  </a>
</li>`,
    )
    .join('\n');
  const empty = `<p class="landing-empty">No project has delivered a turn yet. Run <code>sidescreen init</code> in a project, restart Claude Code there, and finish a turn: the project appears here on its own.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SideScreen</title>
${HEAD_LINKS}
</head>
<body class="landing">
<header class="topbar">
  <div class="topbar-start">
    <a class="brand" href="/">SideScreen</a>
  </div>
  <span class="topbar-meta">Choose a project</span>
</header>
<main class="landing-main">
  <h1 class="landing-title">Projects</h1>
  ${projects.length === 0 ? empty : `<ol class="project-list">${items}</ol>`}
</main>
<script type="module" src="/assets/landing.js"></script>
</body>
</html>
`;
}

/**
 * @param {{ project: Project, scope: Scope, turn: Turn|null, documentHtml: string, threads: Thread[], carryBack: import('../store/carry-back.js').CarryBackEntry[], sidebar: Sidebar, ingestionAvailable: boolean }} input
 * @returns {string}
 */
export function renderWorkspacePage({ project, scope, turn, documentHtml, threads, carryBack, sidebar, ingestionAvailable }) {
  const workspaceData = { project, scope, currentPromptId: turn?.promptId ?? null, sidebar };
  const turnData = turn ? { turn: { ...turn, message: undefined }, threads, carryBack } : null;
  const title = turn ? `${project.name}: ${shortId(turn.promptId)}` : project.name;
  const scopeLabel = scope.kind === 'project' ? 'following the project' : scope.kind === 'session' ? 'following this session' : 'pinned turn';
  // The tag names what the page follows. Away from the project address it is also the way back to following.
  const scopeTag =
    scope.kind === 'project'
      ? `<span class="topbar-scope" data-scope="project">${scopeLabel}</span>`
      : `<a class="topbar-scope" data-scope="${scope.kind}" href="${projectPath(project.id)}" title="Return to following the project's newest turn">${scopeLabel}</a>`;
  const warning = ingestionAvailable
    ? ''
    : `<div class="ingestion-warning" role="status">ingestion unavailable for ${escapeHtml(project.name)}: no Stop hook registered. Run <code>sidescreen init</code> there.</div>`;

  const documentPane = turn
    ? `<article id="document" class="document">
${documentHtml}
    </article>`
    : `<div class="workspace-empty">
      <p>No turns yet from <strong>${escapeHtml(project.name)}</strong>.</p>
      <p>Finish a turn in Claude Code in <code>${escapeHtml(project.cwd)}</code> and it appears here on its own.</p>
    </div>`;

  // The popover lives inside the document pane so that it scrolls with the passage it belongs to.
  const popover = turn
    ? `<form id="ask-popover" class="ask-popover" hidden>
      <blockquote class="ask-selection" id="ask-selection"></blockquote>
      <label class="visually-hidden" for="ask-question">Question</label>
      <textarea id="ask-question" class="ask-question" rows="2" placeholder="Ask about this… (@claude or @codex to pick who answers)" required></textarea>
      <div class="ask-actions">
        <button type="button" class="button-secondary" id="ask-cancel">Cancel</button>
        <button type="submit" class="button-primary" id="ask-submit">Ask</button>
      </div>
    </form>`
    : '';

  const reviewZones = turn
    ? `<div class="pane-handle" id="thread-handle" role="separator" aria-orientation="vertical" aria-label="Thread pane width" tabindex="0" data-pane="thread"></div>
  <aside class="thread-pane" id="thread-pane" aria-live="polite">
    <p class="thread-empty">Select text in the document to ask about it.</p>
  </aside>
  <section class="carry-back" id="carry-back" aria-labelledby="carry-back-title">
    <header class="carry-back-header">
      <h2 class="carry-back-title" id="carry-back-title">Carry back</h2>
      <span class="carry-back-count" id="carry-back-count"></span>
      <span class="carry-back-sent-note" id="carry-back-sent"></span>
      <span class="carry-back-hint">Only these lines reach the terminal, as context on your next prompt in this session. Once sent, they leave this list.</span>
    </header>
    <ul class="carry-back-list" id="carry-back-list"></ul>
    <form class="carry-back-form" id="carry-back-form">
      <label class="visually-hidden" for="carry-back-text">Conclusion to carry back</label>
      <textarea id="carry-back-text" class="carry-back-text" rows="2" placeholder="A conclusion to carry back, in your own words…"></textarea>
      <div class="form-actions">
        <button type="submit" class="button-primary" id="carry-back-add">Add to carry-back</button>
      </div>
    </form>
  </section>`
    : '';

  const turnScripts = turnData
    ? `<script id="turn-data" type="application/json">${jsonForScript(turnData)}</script>
<script type="module" src="/assets/app.js"></script>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SideScreen: ${escapeHtml(title)}</title>
<script src="/assets/layout-boot.js"></script>
${HEAD_LINKS}
</head>
<body class="workspace">
${iconSprite()}
<header class="topbar">
  <div class="topbar-start">
    <a class="topbar-back icon-button" href="/" aria-label="All projects" title="All projects">${icon('arrow-left')}</a>
    <a class="brand" href="/">SideScreen</a>
    <button type="button" class="sidebar-toggle icon-button" id="sidebar-toggle" aria-pressed="false" aria-label="Hide sidebar" title="Hide sidebar">${icon('table-columns')}</button>
  </div>
  <div class="topbar-center">
    <span class="topbar-project">${escapeHtml(project.name)}</span>
    ${scopeTag}
  </div>
  <span class="topbar-path" title="${escapeHtml(project.cwd)}">${escapeHtml(project.cwd)}</span>
</header>
${warning}
<main class="workspace-layout${turn ? '' : ' workspace-layout-empty'}">
  <nav class="sidebar" id="sidebar" aria-label="Sessions and turns">
${renderSidebar({ sidebar, scope, activePromptId: turn?.promptId ?? null })}
  </nav>
  <div class="pane-handle" id="sidebar-handle" role="separator" aria-orientation="vertical" aria-label="Sidebar width" tabindex="0" data-pane="sidebar"></div>
  <section class="document-pane" id="document-pane">
    <div class="follow-notice" id="follow-notice" role="status" hidden></div>
    ${documentPane}
    ${popover}
  </section>
  ${reviewZones}
</main>
<script id="workspace-data" type="application/json">${jsonForScript(workspaceData)}</script>
<script type="module" src="/assets/workspace.js"></script>
${turnScripts}
</body>
</html>
`;
}

/**
 * The sidebar's inner markup. Rendered on the server for first paint and
 * returned by the project endpoint for the client to swap in.
 *
 * @param {{ sidebar: Sidebar, scope: Scope|null, activePromptId: string|null }} input
 * @returns {string}
 */
export function renderSidebar({ sidebar, scope, activePromptId }) {
  if (sidebar.sessions.length === 0) {
    return `<p class="sidebar-empty">No turns yet from this project.</p>`;
  }
  const sessions = sidebar.sessions
    .map((session) => {
      const count = `${session.turns.length} ${session.turns.length === 1 ? 'turn' : 'turns'}`;
      const turns = session.turns
        .map((turn) => {
          const active = turn.promptId === activePromptId;
          return `<li class="turn-row" data-prompt-id="${escapeHtml(turn.promptId)}" data-thread-count="${turn.threadCount}"${active ? ' data-active=""' : ''}>
        <a class="turn-link" href="${turn.href}"${active ? ' aria-current="page"' : ''}>
          <time class="turn-time" datetime="${escapeHtml(turn.receivedAt)}">${escapeHtml(formatTime(turn.receivedAt))}</time>
          <span class="turn-preview">${escapeHtml(turn.preview)}</span>
          ${turn.threadCount > 0 ? `<span class="turn-threads" title="${turn.threadCount} ${turn.threadCount === 1 ? 'thread' : 'threads'}">${turn.threadCount}</span>` : ''}
        </a>
        ${turn.removable ? '<button type="button" class="turn-remove" aria-label="Remove this turn">×</button>' : ''}
      </li>`;
        })
        .join('\n');
      const sessionCurrent = scope?.kind === 'session' && scope.sessionId === session.sessionId ? ' aria-current="page"' : '';
      const started = session.title ? `<time datetime="${escapeHtml(session.startedAt)}">${escapeHtml(formatTime(session.startedAt))}</time> · ` : '';
      return `<li class="session" data-session-id="${escapeHtml(session.sessionId)}">
    <details class="session-details" open>
      <summary class="session-summary">
        <span class="session-title"${session.title ? '' : ' data-untitled=""'}>${escapeHtml(session.label)}</span>
        <span class="session-meta">${started}<span class="session-count">${count}</span><span class="session-follow-wrap"> · <a class="session-follow" href="${session.href}"${sessionCurrent} title="Show this session's newest turn as it arrives">Follow</a></span></span>
      </summary>
      <ul class="turn-list">
${turns}
      </ul>
    </details>
  </li>`;
    })
    .join('\n');
  return `<ul class="session-list">\n${sessions}\n</ul>`;
}

/**
 * @param {string} title
 * @param {string} message
 */
export function renderErrorPage(title, message) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
${HEAD_LINKS}</head>
<body><main class="landing-main"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">All projects</a></p></main></body></html>
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

export { baseName, formatTime };
