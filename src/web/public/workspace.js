/**
 * The workspace frame: the sidebar of sessions and turns, following the
 * newest turn, and removing turns. The document, threads, and carry-back
 * live in app.js and are only present when the page shows a turn.
 */

import { events } from './events.js';
import './layout.js';

/** @typedef {import('../sidebar.js').Sidebar} Sidebar */
/** @typedef {import('../sidebar.js').SidebarTurn} SidebarTurn */
/** @typedef {import('../page.js').Scope} Scope */

const dataElement = /** @type {HTMLScriptElement} */ (document.getElementById('workspace-data'));
const initial = /** @type {{ project: import('../../store/projects.js').Project, scope: Scope, currentPromptId: string|null, sidebar: Sidebar }} */ (
  JSON.parse(dataElement.textContent ?? '{}')
);
const sidebar = /** @type {HTMLElement} */ (document.getElementById('sidebar'));
const notice = /** @type {HTMLElement} */ (document.getElementById('follow-notice'));

const { project, scope, currentPromptId } = initial;
const projectHref = `/projects/${encodeURIComponent(project.id)}`;
const collapsedKey = `sidescreen:collapsed:${project.id}`;
/** Every turn the sidebar has shown so far, to tell arrivals from what was already there. */
const knownPromptIds = new Set(turnsOf(initial.sidebar).map((turn) => turn.promptId));
/** @type {string|null} The turn whose remove control is waiting for its second click. */
let armedPromptId = null;
/** Set once this page has decided to go elsewhere, so a later event cannot start a second navigation. */
let leaving = false;

/** @param {string} href */
function leaveTo(href) {
  if (leaving) return;
  leaving = true;
  window.location.assign(href);
}

function reloadInPlace() {
  if (leaving) return;
  leaving = true;
  window.location.reload();
}

/** @param {Sidebar} data */
function turnsOf(data) {
  return data.sessions.flatMap((session) => session.turns);
}

// ---- Collapse state, per browser tab -----------------------------------------

/** @returns {Set<string>} */
function readCollapsed() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(collapsedKey) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((value) => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

/** @param {Set<string>} collapsed */
function writeCollapsed(collapsed) {
  try {
    sessionStorage.setItem(collapsedKey, JSON.stringify([...collapsed]));
  } catch {
    // Storage unavailable. The sidebar still works, it just forgets.
  }
}

sidebar.addEventListener(
  'toggle',
  (event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement)) return;
    const sessionId = details.closest('.session')?.getAttribute('data-session-id');
    if (!sessionId) return;
    const collapsed = readCollapsed();
    if (details.open) collapsed.delete(sessionId);
    else collapsed.add(sessionId);
    writeCollapsed(collapsed);
  },
  true,
);

// ---- Marking the sidebar -------------------------------------------------------

/**
 * Apply what the server-rendered markup does not know: which turn is on
 * screen, which sessions this tab collapsed, and where to scroll.
 *
 * @param {{ scrollIntoView: boolean }} options
 */
function decorateSidebar({ scrollIntoView }) {
  for (const link of sidebar.querySelectorAll('.turn-link[aria-current]')) link.removeAttribute('aria-current');
  for (const row of sidebar.querySelectorAll('.turn-row[data-active]')) row.removeAttribute('data-active');
  const activeRow = currentPromptId ? rowFor(currentPromptId) : null;
  if (activeRow) {
    activeRow.setAttribute('data-active', '');
    activeRow.querySelector('.turn-link')?.setAttribute('aria-current', 'page');
  }
  for (const follow of sidebar.querySelectorAll('.session-follow')) {
    const sessionId = follow.closest('.session')?.getAttribute('data-session-id');
    if (scope.kind === 'session' && sessionId === scope.sessionId) follow.setAttribute('aria-current', 'page');
    else follow.removeAttribute('aria-current');
  }

  const collapsed = readCollapsed();
  const activeSessionId = activeRow?.closest('.session')?.getAttribute('data-session-id') ?? (scope.kind === 'project' ? null : scope.sessionId);
  if (activeSessionId && collapsed.has(activeSessionId)) {
    collapsed.delete(activeSessionId);
    writeCollapsed(collapsed);
  }
  for (const details of sidebar.querySelectorAll('details.session-details')) {
    const sessionId = details.closest('.session')?.getAttribute('data-session-id');
    /** @type {HTMLDetailsElement} */ (details).open = !(sessionId && collapsed.has(sessionId));
  }
  if (scrollIntoView && activeRow) activeRow.scrollIntoView({ block: 'nearest' });
}

/** @param {string} promptId */
function rowFor(promptId) {
  for (const row of sidebar.querySelectorAll('.turn-row')) {
    if (row.getAttribute('data-prompt-id') === promptId) return /** @type {HTMLElement} */ (row);
  }
  return null;
}

// ---- Live updates and following ----------------------------------------------

async function refreshSidebar() {
  if (leaving) return;
  /** @type {Response} */
  let response;
  try {
    response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`);
  } catch {
    return;
  }
  if (response.status === 404) {
    // The project has no turn left anywhere. Nothing to show here any more.
    if (currentPromptId !== null) leaveTo('/');
    return;
  }
  if (!response.ok || leaving) return;
  const data = /** @type {Sidebar & { sidebarHtml: string }} */ (await response.json());
  const arrivals = turnsOf(data).filter((turn) => !knownPromptIds.has(turn.promptId));
  for (const turn of turnsOf(data)) knownPromptIds.add(turn.promptId);
  // A refresh must not cancel a confirmation in progress: re-arm the same row in the new markup.
  const armedBefore = armedPromptId;
  armedPromptId = null;
  sidebar.innerHTML = data.sidebarHtml;
  decorateSidebar({ scrollIntoView: false });
  const armedRow = armedBefore === null ? null : rowFor(armedBefore);
  if (armedRow) arm(armedRow);
  follow(data, arrivals);
}

/**
 * Decide what a change means for this page: show the newest turn in scope
 * when the page is clean, otherwise offer it.
 *
 * @param {Sidebar} data
 * @param {SidebarTurn[]} arrivals Turns not seen by this page before.
 */
function follow(data, arrivals) {
  const turns = turnsOf(data);
  if (currentPromptId !== null && !turns.some((turn) => turn.promptId === currentPromptId)) {
    // The turn on screen was removed, here or elsewhere.
    leaveTo(turns.length > 0 ? projectHref : '/');
    return;
  }

  /** @type {string|null} */
  let target = null;
  /** @type {string} */
  let targetHref = projectHref;
  if (scope.kind === 'project') {
    target = data.latestPromptId;
  } else if (scope.kind === 'session') {
    const session = data.sessions.find((candidate) => candidate.sessionId === scope.sessionId);
    if (!session) {
      leaveTo(projectHref);
      return;
    }
    target = session.latestPromptId;
    targetHref = session.href;
  }

  if (target !== null && target !== currentPromptId) {
    if (pageIsClean()) {
      reloadInPlace();
      return;
    }
    const turn = turns.find((candidate) => candidate.promptId === target);
    if (turn) showNotice(data, turn, targetHref);
    return;
  }

  const newest = arrivals.filter((turn) => turn.promptId !== currentPromptId).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  if (newest) showNotice(data, newest, newest.href);
}

/**
 * Nothing the user is in the middle of would be lost by a reload.
 */
function pageIsClean() {
  const popover = document.getElementById('ask-popover');
  if (popover && !popover.hidden) return false;
  if (document.querySelector('.branch-form')) return false;
  for (const field of document.querySelectorAll('textarea, input[type="text"]')) {
    if (/** @type {HTMLTextAreaElement|HTMLInputElement} */ (field).value.trim() !== '') return false;
  }
  return true;
}

/**
 * @param {Sidebar} data
 * @param {SidebarTurn} turn
 * @param {string} href Where "View" goes.
 */
function showNotice(data, turn, href) {
  const session = data.sessions.find((candidate) => candidate.sessionId === turn.sessionId);
  notice.replaceChildren();
  const text = document.createElement('span');
  text.className = 'follow-notice-text';
  text.append('New turn in ');
  const label = document.createElement('strong');
  label.textContent = session?.label ?? 'another session';
  text.append(label);
  const view = document.createElement('a');
  view.className = 'follow-notice-link';
  view.href = href;
  view.textContent = 'View';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'follow-notice-dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => {
    notice.hidden = true;
  });
  notice.append(text, view, dismiss);
  notice.hidden = false;
}

for (const type of ['store-changed', 'thread-created', 'thread-updated', 'turn-removed']) {
  events.addEventListener(type, () => {
    refreshSidebar();
  });
}

// ---- Removing a turn: two deliberate clicks -----------------------------------

/** @param {HTMLElement} row */
function arm(row) {
  disarm();
  const promptId = row.getAttribute('data-prompt-id');
  const button = row.querySelector('.turn-remove');
  if (!promptId || !(button instanceof HTMLButtonElement)) return;
  armedPromptId = promptId;
  row.setAttribute('data-armed', '');
  const count = Number(row.getAttribute('data-thread-count') ?? '0');
  const label = count === 0 ? 'Remove turn?' : `Remove turn and ${count} ${count === 1 ? 'thread' : 'threads'}?`;
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.focus();
}

function disarm() {
  if (armedPromptId === null) return;
  const row = sidebar.querySelector('.turn-row[data-armed]');
  if (row) {
    row.removeAttribute('data-armed');
    const button = row.querySelector('.turn-remove');
    if (button) {
      button.textContent = '×';
      button.setAttribute('aria-label', 'Remove this turn');
    }
  }
  armedPromptId = null;
}

/**
 * @param {string} promptId
 */
async function removeTurn(promptId) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(`/api/turns/${encodeURIComponent(promptId)}`, { method: 'DELETE' });
  } catch {
    disarm();
    return;
  }
  if (!response.ok) {
    disarm();
    await refreshSidebar();
    return;
  }
  const { next } = /** @type {{ next: string }} */ (await response.json());
  if (promptId === currentPromptId) {
    leaveTo(next);
    return;
  }
  disarm();
  await refreshSidebar();
}

sidebar.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('.turn-remove');
  if (!button) {
    disarm();
    return;
  }
  event.preventDefault();
  const row = /** @type {HTMLElement|null} */ (button.closest('.turn-row'));
  if (!row) return;
  const promptId = row.getAttribute('data-prompt-id');
  if (promptId !== null && promptId === armedPromptId) {
    removeTurn(promptId);
    return;
  }
  arm(row);
});

sidebar.addEventListener('mouseout', (event) => {
  if (armedPromptId === null || !(event.target instanceof Element)) return;
  const row = event.target.closest('.turn-row[data-armed]');
  if (row && !(event.relatedTarget instanceof Node && row.contains(event.relatedTarget))) disarm();
});

sidebar.addEventListener('focusout', (event) => {
  if (armedPromptId === null || !(event.target instanceof Element)) return;
  const row = event.target.closest('.turn-row[data-armed]');
  if (row && !(event.relatedTarget instanceof Node && row.contains(event.relatedTarget))) disarm();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') disarm();
});

document.addEventListener('mousedown', (event) => {
  if (armedPromptId === null || !(event.target instanceof Element)) return;
  if (!event.target.closest('.turn-row[data-armed]')) disarm();
});

decorateSidebar({ scrollIntoView: true });
