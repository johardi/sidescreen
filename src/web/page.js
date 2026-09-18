/**
 * HTML shells. The document itself is the rendered markdown, untouched;
 * everything here is the frame around it: the landing page that lists
 * projects, and the workspace that focuses on one.
 */

import { escapeHtml } from './render-markdown.js';
import { baseName, formatTime, shortId } from '../format.js';
import { projectPath } from '../store/projects.js';
import { VERSION } from '../version.js';

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
  comments: {
    viewBox: '0 0 640 512',
    path: 'M208 352c114.9 0 208-78.8 208-176S322.9 0 208 0S0 78.8 0 176c0 38.6 14.7 74.3 39.6 103.4c-3.5 9.4-8.7 17.7-14.2 24.7c-4.8 6.2-9.7 11-13.3 14.3c-1.8 1.6-3.3 2.9-4.3 3.7c-.5 .4-.9 .7-1.1 .8l-.2 .2s0 0 0 0s0 0 0 0C1 327.2-1.4 334.4 .8 340.9S9.1 352 16 352c21.8 0 43.8-5.6 62.1-12.5c9.2-3.5 17.8-7.4 25.2-11.4C134.1 343.3 169.8 352 208 352zM448 176c0 112.3-99.1 196.9-216.5 207C255.8 457.4 336.4 512 432 512c38.2 0 73.9-8.7 104.7-23.9c7.5 4 16 7.9 25.2 11.4c18.3 6.9 40.3 12.5 62.1 12.5c6.9 0 13.1-4.5 15.2-11.1c2.1-6.6-.2-13.8-5.8-17.9c0 0 0 0 0 0s0 0 0 0l-.2-.2c-.2-.2-.6-.4-1.1-.8c-1-.8-2.5-2-4.3-3.7c-3.6-3.3-8.5-8.1-13.3-14.3c-5.5-7-10.7-15.4-14.2-24.7c24.9-29 39.6-64.7 39.6-103.4c0-92.8-84.9-168.9-192.6-175.5c.4 5.1 .6 10.3 .6 15.5z',
  },
  'chevron-right': {
    viewBox: '0 0 320 512',
    path: 'M310.6 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L242.7 256 73.4 86.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l192 192z',
  },
  'chevron-down': {
    viewBox: '0 0 512 512',
    path: 'M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z',
  },
  'ellipsis-vertical': {
    viewBox: '0 0 128 512',
    path: 'M64 360a56 56 0 1 0 0 112 56 56 0 1 0 0-112zm0-160a56 56 0 1 0 0 112 56 56 0 1 0 0-112zM120 96A56 56 0 1 0 8 96a56 56 0 1 0 112 0z',
  },
  'circle-half-stroke': {
    viewBox: '0 0 512 512',
    path: 'M448 256c0-106-86-192-192-192l0 384c106 0 192-86 192-192zM0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256z',
  },
  sun: {
    viewBox: '0 0 512 512',
    path: 'M361.5 1.2c5 2.1 8.6 6.6 9.6 11.9L391 121l107.9 19.8c5.3 1 9.8 4.6 11.9 9.6s1.5 10.7-1.6 15.2L446.9 256l62.3 90.3c3.1 4.5 3.7 10.2 1.6 15.2s-6.6 8.6-11.9 9.6L391 391 371.1 498.9c-1 5.3-4.6 9.8-9.6 11.9s-10.7 1.5-15.2-1.6L256 446.9l-90.3 62.3c-4.5 3.1-10.2 3.7-15.2 1.6s-8.6-6.6-9.6-11.9L121 391 13.1 371.1c-5.3-1-9.8-4.6-11.9-9.6s-1.5-10.7 1.6-15.2L65.1 256 2.8 165.7c-3.1-4.5-3.7-10.2-1.6-15.2s6.6-8.6 11.9-9.6L121 121 140.9 13.1c1-5.3 4.6-9.8 9.6-11.9s10.7-1.5 15.2 1.6L256 65.1 346.3 2.8c4.5-3.1 10.2-3.7 15.2-1.6zM160 256a96 96 0 1 1 192 0 96 96 0 1 1 -192 0zm224 0a128 128 0 1 0 -256 0 128 128 0 1 0 256 0z',
  },
  moon: {
    viewBox: '0 0 384 512',
    path: 'M223.5 32C100 32 0 132.3 0 256S100 480 223.5 480c60.6 0 115.5-24.2 155.8-63.4c5-4.9 6.3-12.5 3.1-18.7s-10.1-9.7-17-8.5c-9.8 1.7-19.8 2.6-30.1 2.6c-96.9 0-175.5-78.8-175.5-176c0-65.8 36-123.1 89.3-153.3c6.1-3.5 9.2-10.5 7.7-17.3s-7.3-11.9-14.3-12.5c-6.3-.5-12.6-.8-19-.8z',
  },
  reply: {
    viewBox: '0 0 512 512',
    path: 'M205 34.8c11.5 5.1 19 16.6 19 29.2l0 64 112 0c97.2 0 176 78.8 176 176c0 113.3-81.5 163.9-100.2 174.1c-2.5 1.4-5.3 1.9-8.1 1.9c-10.9 0-19.7-8.9-19.7-19.7c0-7.5 4.3-14.4 9.8-19.5c9.4-8.8 22.2-26.4 22.2-56.7c0-53-43-96-96-96l-96 0 0 64c0 12.6-7.4 24.1-19 29.2s-25 3-34.4-5.4l-160-144C3.9 225.7 0 217.1 0 208s3.9-17.7 10.6-23.8l160-144c9.4-8.5 22.9-10.6 34.4-5.4z',
  },
  'code-branch': {
    viewBox: '0 0 448 512',
    path: 'M80 104a24 24 0 1 0 0-48 24 24 0 1 0 0 48zm80-24c0 32.8-19.7 61-48 73.3l0 87.8c18.8-10.9 40.7-17.1 64-17.1l96 0c35.3 0 64-28.7 64-64l0-6.7C307.7 141 288 112.8 288 80c0-44.2 35.8-80 80-80s80 35.8 80 80c0 32.8-19.7 61-48 73.3l0 6.7c0 70.7-57.3 128-128 128l-96 0c-35.3 0-64 28.7-64 64l0 6.7c28.3 12.3 48 40.5 48 73.3c0 44.2-35.8 80-80 80s-80-35.8-80-80c0-32.8 19.7-61 48-73.3l0-6.7 0-198.7C19.7 141 0 112.8 0 80C0 35.8 35.8 0 80 0s80 35.8 80 80zm232 0a24 24 0 1 0 -48 0 24 24 0 1 0 48 0zM80 456a24 24 0 1 0 0-48 24 24 0 1 0 0 48z',
  },
  minus: {
    viewBox: '0 0 448 512',
    path: 'M432 256c0 17.7-14.3 32-32 32L48 288c-17.7 0-32-14.3-32-32s14.3-32 32-32l352 0c17.7 0 32 14.3 32 32z',
  },
  xmark: {
    viewBox: '0 0 384 512',
    path: 'M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z',
  },
  maximize: {
    viewBox: '0 0 512 512',
    path: 'M344 0L488 0c13.3 0 24 10.7 24 24l0 144c0 9.7-5.8 18.5-14.8 22.2s-19.3 1.7-26.2-5.2l-39-39-87 87c-9.4 9.4-24.6 9.4-33.9 0l-32-32c-9.4-9.4-9.4-24.6 0-33.9l87-87L327 41c-6.9-6.9-8.9-17.2-5.2-26.2S334.3 0 344 0zM168 512L24 512c-13.3 0-24-10.7-24-24L0 344c0-9.7 5.8-18.5 14.8-22.2s19.3-1.7 26.2 5.2l39 39 87-87c9.4-9.4 24.6-9.4 33.9 0l32 32c9.4 9.4 9.4 24.6 0 33.9l-87 87 39 39c6.9 6.9 8.9 17.2 5.2 26.2s-12.5 14.8-22.2 14.8z',
  },
  restore: {
    viewBox: '0 0 512 512',
    path: 'M439 7c9.4-9.4 24.6-9.4 33.9 0l32 32c9.4 9.4 9.4 24.6 0 33.9l-87 87 39 39c6.9 6.9 8.9 17.2 5.2 26.2s-12.5 14.8-22.2 14.8l-144 0c-13.3 0-24-10.7-24-24l0-144c0-9.7 5.8-18.5 14.8-22.2s19.3-1.7 26.2 5.2l39 39L439 7zM72 272l144 0c13.3 0 24 10.7 24 24l0 144c0 9.7-5.8 18.5-14.8 22.2s-19.3 1.7-26.2-5.2l-39-39L73 505c-9.4 9.4-24.6 9.4-33.9 0L7 473c-9.4-9.4-9.4-24.6 0-33.9l87-87L55 313c-6.9-6.9-8.9-17.2-5.2-26.2s12.5-14.8 22.2-14.8z',
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
export function icon(name) {
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

  // The composer floats in the document pane's corner, in the manner of a mail client's compose window: a bar, or open, or maximized.
  const composer = turn
    ? `<aside class="composer" id="carry-back" aria-labelledby="carry-back-title">
      <header class="composer-bar" id="composer-bar" title="Open or minimize the carry-back list">
        <h2 class="carry-back-title" id="carry-back-title">Carry back</h2>
        <span class="carry-back-count" id="carry-back-count"></span>
        <span class="carry-back-sent-note" id="carry-back-sent"></span>
        <span class="composer-controls">
          <button type="button" class="icon-button composer-minimize" id="composer-minimize" aria-label="Minimize the carry-back list" title="Minimize">${icon('minus')}</button>
          <button type="button" class="icon-button composer-maximize" id="composer-maximize" aria-label="Maximize the carry-back list" title="Maximize">${icon('maximize')}${icon('restore')}</button>
        </span>
      </header>
      <div class="composer-body">
        <p class="carry-back-hint">Only these lines reach the terminal, as context on your next prompt in this session. Once sent, they leave this list. Select an entry to edit it.</p>
        <ul class="carry-back-list" id="carry-back-list"></ul>
        <form class="carry-back-form" id="carry-back-form">
          <label class="visually-hidden" for="carry-back-text">Conclusion to carry back. Enter adds it, Shift+Enter breaks a line</label>
          <textarea id="carry-back-text" class="carry-back-text" rows="2" placeholder="A conclusion in your own words… Enter adds it"></textarea>
        </form>
      </div>
    </aside>`
    : '';

  const reviewZones = turn
    ? `<div class="pane-handle" id="thread-handle" role="separator" aria-orientation="vertical" aria-label="Thread pane width" tabindex="0" data-pane="thread"></div>
  <aside class="thread-pane" id="thread-pane" aria-live="polite">
    <p class="thread-empty">Select text in the document to ask about it.</p>
  </aside>`
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
    <div class="sidebar-scroll" id="sidebar-scroll">
${renderSidebar({ sidebar, scope, activePromptId: turn?.promptId ?? null })}
    </div>
    <footer class="sidebar-footer">
      <button type="button" class="sidebar-toggle icon-button" id="sidebar-toggle" aria-pressed="false" aria-label="Hide sidebar" title="Hide sidebar">${icon('table-columns')}</button>
      <button type="button" class="theme-switch icon-button" id="theme-switch" aria-label="Colour scheme: system. Switch to light" title="Colour scheme: system. Switch to light">
        <span class="theme-icon" data-theme-icon="system">${icon('circle-half-stroke')}</span>
        <span class="theme-icon" data-theme-icon="light">${icon('sun')}</span>
        <span class="theme-icon" data-theme-icon="dark">${icon('moon')}</span>
      </button>
      <span class="sidebar-version" title="sidescreen ${escapeHtml(VERSION)}">v${escapeHtml(VERSION)}</span>
    </footer>
  </nav>
  <div class="pane-handle" id="sidebar-handle" role="separator" aria-orientation="vertical" aria-label="Sidebar width" tabindex="0" data-pane="sidebar"></div>
  <section class="document-cell">
    <div class="document-pane" id="document-pane">
      <div class="follow-notice" id="follow-notice" role="status" hidden></div>
      ${documentPane}
      ${popover}
    </div>
    ${composer}
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
          const time = formatTime(turn.receivedAt);
          return `<li class="turn-row" data-prompt-id="${escapeHtml(turn.promptId)}" data-thread-count="${turn.threadCount}"${active ? ' data-active=""' : ''}>
        <a class="turn-link" href="${turn.href}" title="${escapeHtml(time)}"${active ? ' aria-current="page"' : ''}>
          <span class="turn-bullet" aria-hidden="true"></span>
          <span class="turn-preview">${escapeHtml(turn.preview)}</span>
          <time class="turn-time visually-hidden" datetime="${escapeHtml(turn.receivedAt)}">${escapeHtml(time)}</time>
          ${turn.threadCount > 0 ? `<span class="turn-threads" title="${turn.threadCount} ${turn.threadCount === 1 ? 'thread' : 'threads'}">${turn.threadCount}</span>` : ''}
        </a>
        ${turn.removable ? '<button type="button" class="turn-remove" aria-label="Remove this turn">×</button>' : ''}
      </li>`;
        })
        .join('\n');
      const followed = scope?.kind === 'session' && scope.sessionId === session.sessionId;
      // Two sessions with one title stay apart by their start times; a session labelled by its start time already shows it.
      const started =
        session.title && session.sharedLabel
          ? `<time class="session-started" datetime="${escapeHtml(session.startedAt)}">${escapeHtml(formatTime(session.startedAt))}</time>`
          : '';
      return `<li class="session" data-session-id="${escapeHtml(session.sessionId)}" data-session-href="${session.href}"${followed ? ' data-followed=""' : ''}>
    <details class="session-details" open>
      <summary class="session-summary">
        <span class="session-marker" aria-hidden="true">${icon('comments')}${icon('chevron-right')}${icon('chevron-down')}</span>
        <span class="session-title"${session.title ? '' : ' data-untitled=""'}>${escapeHtml(session.label)}</span>
        ${started}
        <span class="session-count">${count}</span>
      </summary>
      <ul class="turn-list">
${turns}
      </ul>
    </details>
    <button type="button" class="session-menu-button icon-button" aria-label="Session menu" aria-haspopup="menu" aria-expanded="false" title="Session menu">${icon('ellipsis-vertical')}</button>
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
