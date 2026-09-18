/**
 * The workspace frame: the sidebar of sessions and turns, following the
 * newest turn, the session menu, and removing turns and sessions. The
 * document, threads, and carry-back live in app.js and are only present when
 * the page shows a turn.
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
/** The part of the sidebar the server re-renders; the footer below it stays. */
const sidebarScroll = /** @type {HTMLElement} */ (document.getElementById('sidebar-scroll'));
const notice = /** @type {HTMLElement} */ (document.getElementById('follow-notice'));

const { project, scope, currentPromptId } = initial;
const projectHref = `/projects/${encodeURIComponent(project.id)}`;
const collapsedKey = `sidescreen:collapsed:${project.id}`;
/** The sidebar as the server last described it: counts and addresses for the menu and the confirmations. */
let latestSidebar = initial.sidebar;
/** Every turn the sidebar has shown so far, to tell arrivals from what was already there. */
const knownPromptIds = new Set(turnsOf(initial.sidebar).map((turn) => turn.promptId));
/** @type {{ kind: 'turn'|'session', id: string }|null} The row whose remove control is waiting for its second activation. */
let armed = null;
/** Set once this page has decided to go elsewhere, so a later event cannot start a second navigation. */
let leaving = false;
/**
 * Set while this page's own removal request is in flight. The server announces
 * the removal before it answers, and a refresh in between would ask for a
 * project that may already be gone; the removal refreshes or leaves itself.
 */
let removing = false;
/** @type {HTMLElement|null} The session menu on screen, if any, and the button that opened it. */
let openMenu = null;
/** @type {HTMLButtonElement|null} */
let menuButton = null;

/**
 * Tell the rest of the page, app.js included, that nothing should be fetched:
 * this page is leaving, or a removal it asked for is in flight.
 */
function syncQuiet() {
  document.documentElement.toggleAttribute('data-quiet', leaving || removing);
}

/** @param {boolean} value */
function setRemoving(value) {
  removing = value;
  syncQuiet();
}

/** @param {string} href */
function leaveTo(href) {
  if (leaving) return;
  leaving = true;
  syncQuiet();
  window.location.assign(href);
}

function reloadInPlace() {
  if (leaving) return;
  leaving = true;
  syncQuiet();
  window.location.reload();
}

/** @param {Sidebar} data */
function turnsOf(data) {
  return data.sessions.flatMap((session) => session.turns);
}

/**
 * @param {number} count
 * @param {string} noun
 */
function plural(count, noun) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
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
  for (const session of sidebar.querySelectorAll('.session')) {
    const sessionId = session.getAttribute('data-session-id');
    session.toggleAttribute('data-followed', scope.kind === 'session' && sessionId === scope.sessionId);
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

/** @param {string} sessionId */
function sessionRowFor(sessionId) {
  for (const row of sidebar.querySelectorAll('.session')) {
    if (row.getAttribute('data-session-id') === sessionId) return /** @type {HTMLElement} */ (row);
  }
  return null;
}

// ---- Live updates and following ----------------------------------------------

async function refreshSidebar() {
  if (leaving || removing) return;
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
  latestSidebar = data;
  const arrivals = turnsOf(data).filter((turn) => !knownPromptIds.has(turn.promptId));
  for (const turn of turnsOf(data)) knownPromptIds.add(turn.promptId);
  // A refresh must not cancel a confirmation in progress: re-arm the same row in the new markup.
  const armedBefore = armed;
  armed = null;
  closeMenu();
  sidebarScroll.innerHTML = data.sidebarHtml;
  decorateSidebar({ scrollIntoView: false });
  if (armedBefore?.kind === 'turn') {
    const row = rowFor(armedBefore.id);
    if (row) armTurn(row);
  } else if (armedBefore?.kind === 'session') {
    const row = sessionRowFor(armedBefore.id);
    if (row) armSession(row);
  }
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

for (const type of ['store-changed', 'thread-created', 'thread-updated', 'turn-removed', 'session-removed']) {
  events.addEventListener(type, () => {
    refreshSidebar();
  });
}

// ---- The session menu -----------------------------------------------------------

/**
 * @param {string} text
 * @param {Record<string, string>} attributes
 */
function menuItem(text, attributes) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'session-menu-item';
  for (const [name, value] of Object.entries(attributes)) item.setAttribute(name, value);
  item.textContent = text;
  return item;
}

/**
 * Open the menu for a session row next to its button: follow the session,
 * or start removing it.
 *
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} row
 */
function openSessionMenu(button, row) {
  closeMenu();
  disarm();
  const sessionId = row.getAttribute('data-session-id');
  const href = row.getAttribute('data-session-href');
  if (!sessionId) return;
  const followed = scope.kind === 'session' && scope.sessionId === sessionId;
  const menu = document.createElement('div');
  menu.className = 'session-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Session menu');
  const follow = menuItem('Follow this session', { role: 'menuitemcheckbox', 'aria-checked': String(followed) });
  follow.addEventListener('click', () => {
    closeMenu();
    if (href && !followed) leaveTo(href);
  });
  const remove = menuItem('Remove session…', { role: 'menuitem', 'data-danger': '' });
  remove.addEventListener('click', () => {
    closeMenu();
    armSession(row);
  });
  menu.append(follow, remove);
  document.body.append(menu);
  const rect = button.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${left}px`;
  button.setAttribute('aria-expanded', 'true');
  openMenu = menu;
  menuButton = button;
  follow.focus();
}

function closeMenu() {
  if (openMenu === null) return;
  openMenu.remove();
  openMenu = null;
  menuButton?.setAttribute('aria-expanded', 'false');
  menuButton = null;
}

sidebarScroll.addEventListener('scroll', closeMenu);
window.addEventListener('resize', closeMenu);

// ---- Removing a turn or a session: two deliberate activations -------------------

/** @param {HTMLElement} row */
function armTurn(row) {
  disarm();
  const promptId = row.getAttribute('data-prompt-id');
  const button = row.querySelector('.turn-remove');
  if (!promptId || !(button instanceof HTMLButtonElement)) return;
  armed = { kind: 'turn', id: promptId };
  row.setAttribute('data-armed', '');
  const count = Number(row.getAttribute('data-thread-count') ?? '0');
  const label = count === 0 ? 'Remove turn?' : `Remove turn and ${plural(count, 'thread')}?`;
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.focus();
}

/** @param {HTMLElement} row */
function armSession(row) {
  disarm();
  const sessionId = row.getAttribute('data-session-id');
  if (!sessionId) return;
  const session = latestSidebar.sessions.find((candidate) => candidate.sessionId === sessionId);
  const turns = session?.turns.length ?? 0;
  const threads = session?.turns.reduce((sum, turn) => sum + turn.threadCount, 0) ?? 0;
  const label = threads === 0 ? `Remove session and ${plural(turns, 'turn')}?` : `Remove session, ${plural(turns, 'turn')} and ${plural(threads, 'thread')}?`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'session-remove';
  button.textContent = label;
  button.setAttribute('aria-label', label);
  armed = { kind: 'session', id: sessionId };
  row.setAttribute('data-armed', '');
  row.append(button);
  button.focus();
}

function disarm() {
  if (armed === null) return;
  for (const row of sidebar.querySelectorAll('[data-armed]')) {
    row.removeAttribute('data-armed');
    const turnButton = row.querySelector('.turn-remove');
    if (turnButton) {
      turnButton.textContent = '×';
      turnButton.setAttribute('aria-label', 'Remove this turn');
    }
    row.querySelector('.session-remove')?.remove();
  }
  armed = null;
}

/**
 * @param {string} promptId
 */
async function removeTurn(promptId) {
  /** @type {Response} */
  let response;
  setRemoving(true);
  try {
    response = await fetch(`/api/turns/${encodeURIComponent(promptId)}`, { method: 'DELETE' });
  } catch {
    setRemoving(false);
    disarm();
    return;
  }
  if (!response.ok) {
    setRemoving(false);
    disarm();
    await refreshSidebar();
    return;
  }
  const { next } = /** @type {{ next: string }} */ (await response.json());
  if (promptId === currentPromptId) {
    leaveTo(next);
    return;
  }
  setRemoving(false);
  disarm();
  await refreshSidebar();
}

/**
 * @param {string} sessionId
 */
async function removeSession(sessionId) {
  const session = latestSidebar.sessions.find((candidate) => candidate.sessionId === sessionId);
  const onScreen = (currentPromptId !== null && session?.turns.some((turn) => turn.promptId === currentPromptId)) || (scope.kind === 'session' && scope.sessionId === sessionId);
  /** @type {Response} */
  let response;
  setRemoving(true);
  try {
    response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  } catch {
    setRemoving(false);
    disarm();
    return;
  }
  if (!response.ok) {
    setRemoving(false);
    disarm();
    await refreshSidebar();
    return;
  }
  const { next } = /** @type {{ next: string }} */ (await response.json());
  if (onScreen) {
    leaveTo(next);
    return;
  }
  setRemoving(false);
  disarm();
  await refreshSidebar();
}

sidebar.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const menuTrigger = event.target.closest('.session-menu-button');
  if (menuTrigger instanceof HTMLButtonElement) {
    event.preventDefault();
    const row = /** @type {HTMLElement|null} */ (menuTrigger.closest('.session'));
    if (!row) return;
    if (openMenu !== null && menuButton === menuTrigger) closeMenu();
    else openSessionMenu(menuTrigger, row);
    return;
  }
  const sessionConfirm = event.target.closest('.session-remove');
  if (sessionConfirm) {
    event.preventDefault();
    const sessionId = sessionConfirm.closest('.session')?.getAttribute('data-session-id');
    if (sessionId && armed?.kind === 'session' && armed.id === sessionId) removeSession(sessionId);
    return;
  }
  const button = event.target.closest('.turn-remove');
  if (!button) {
    disarm();
    return;
  }
  event.preventDefault();
  const row = /** @type {HTMLElement|null} */ (button.closest('.turn-row'));
  if (!row) return;
  const promptId = row.getAttribute('data-prompt-id');
  if (promptId !== null && armed?.kind === 'turn' && armed.id === promptId) {
    removeTurn(promptId);
    return;
  }
  armTurn(row);
});

/**
 * Whether leaving `target` for `related` leaves the armed row altogether.
 *
 * @param {EventTarget|null} target
 * @param {EventTarget|null} related
 */
function leavesArmedRow(target, related) {
  if (armed === null || !(target instanceof Element)) return false;
  const row = target.closest('.turn-row[data-armed], .session[data-armed]');
  return row !== null && !(related instanceof Node && row.contains(related));
}

sidebar.addEventListener('mouseout', (event) => {
  if (leavesArmedRow(event.target, event.relatedTarget)) disarm();
});

sidebar.addEventListener('focusout', (event) => {
  if (leavesArmedRow(event.target, event.relatedTarget)) disarm();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  disarm();
  if (openMenu !== null) {
    const button = menuButton;
    closeMenu();
    button?.focus();
  }
});

document.addEventListener('mousedown', (event) => {
  if (!(event.target instanceof Element)) return;
  if (armed !== null && !event.target.closest('.turn-row[data-armed], .session[data-armed]')) disarm();
  if (openMenu !== null && !openMenu.contains(event.target) && event.target !== menuButton && !menuButton?.contains(event.target)) closeMenu();
});

decorateSidebar({ scrollIntoView: true });
