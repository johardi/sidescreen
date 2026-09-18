/**
 * The shell's movable parts: the handle on the sidebar's edge, the handle on
 * the thread pane's edge, the sidebar toggle in the header, and the record in
 * local storage that layout-boot.js applies before first paint.
 *
 * Widths are written to two custom properties on the root element, which the
 * grid in app.css reads. The thread pane keeps a fractional track, an equal
 * split with the document, until the user sizes it; from then on it is pixels.
 */

const STORAGE_KEY = 'sidescreen:layout';
/** Pixel limits. layout-boot.js repeats the ones it needs. */
const LIMITS = { sidebarMin: 180, sidebarMax: 480, sidebarDefault: 260, threadMin: 260, documentMin: 300, handle: 6 };
const KEY_STEP = 16;

/** @typedef {'system'|'light'|'dark'} Theme */
/** @typedef {{ sidebarWidth: number, threadWidth: number|null, sidebarHidden: boolean, theme: Theme }} LayoutState */
/** @typedef {'sidebar'|'thread'} Pane */

const THEMES = /** @type {Theme[]} */ (['system', 'light', 'dark']);

const root = document.documentElement;
const layout = /** @type {HTMLElement} */ (document.querySelector('.workspace-layout'));
const sidebar = /** @type {HTMLElement} */ (document.getElementById('sidebar'));
const sidebarHandle = /** @type {HTMLElement} */ (document.getElementById('sidebar-handle'));
const toggle = /** @type {HTMLButtonElement} */ (document.getElementById('sidebar-toggle'));
/** Absent on the empty workspace, which has no thread pane. */
const threadHandle = document.getElementById('thread-handle');
const threadPane = document.getElementById('thread-pane');

const state = readStored();

// ---- The record ----------------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isWidth(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** @returns {LayoutState} */
function readStored() {
  /** @type {LayoutState} */
  const defaults = { sidebarWidth: LIMITS.sidebarDefault, threadWidth: null, sidebarHidden: false, theme: 'system' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaults;
    const stored = /** @type {Partial<Record<keyof LayoutState, unknown>>} */ (JSON.parse(raw));
    return {
      sidebarWidth: isWidth(stored.sidebarWidth) ? stored.sidebarWidth : defaults.sidebarWidth,
      threadWidth: isWidth(stored.threadWidth) ? stored.threadWidth : null,
      sidebarHidden: stored.sidebarHidden === true,
      theme: THEMES.find((theme) => theme === stored.theme) ?? 'system',
    };
  } catch {
    return defaults;
  }
}

function writeStored() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...state }));
  } catch {
    // Storage unavailable. The layout still works for the life of the page.
  }
}

// ---- Fitting the window --------------------------------------------------------

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.round(Math.min(max, Math.max(min, value)));
}

/**
 * The widths to show: the user's, reduced only when the window cannot hold
 * them. The thread pane gives way first, then the sidebar.
 *
 * @returns {{ sidebar: number, thread: number|null }}
 */
function fitted() {
  const total = layout.clientWidth;
  const hasThread = threadPane !== null;
  const handles = (state.sidebarHidden ? 0 : LIMITS.handle) + (hasThread ? LIMITS.handle : 0);
  const others = LIMITS.documentMin + (hasThread ? LIMITS.threadMin : 0) + handles;
  const sidebarRoom = Math.max(LIMITS.sidebarMin, total - others);
  const sidebarWidth = state.sidebarHidden ? 0 : clamp(state.sidebarWidth, LIMITS.sidebarMin, Math.min(LIMITS.sidebarMax, sidebarRoom));
  let thread = state.threadWidth;
  if (hasThread && thread !== null) {
    const threadRoom = Math.max(LIMITS.threadMin, total - sidebarWidth - handles - LIMITS.documentMin);
    thread = clamp(thread, LIMITS.threadMin, threadRoom);
  }
  return { sidebar: sidebarWidth, thread };
}

/** Put the state on screen. Clamped values are shown, never written back. */
function apply() {
  const shown = fitted();
  root.style.setProperty('--sidebar-column', `${shown.sidebar}px`);
  root.style.setProperty('--handle-column', state.sidebarHidden ? '0px' : `${LIMITS.handle}px`);
  root.style.setProperty('--thread-column', shown.thread === null ? `minmax(${LIMITS.threadMin}px, 1fr)` : `${shown.thread}px`);
  root.toggleAttribute('data-sidebar-hidden', state.sidebarHidden);
  if (state.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state.theme);

  const label = state.sidebarHidden ? 'Show sidebar' : 'Hide sidebar';
  toggle.setAttribute('aria-pressed', String(state.sidebarHidden));
  toggle.setAttribute('aria-label', label);
  toggle.setAttribute('title', label);

  describe(sidebarHandle, shown.sidebar, LIMITS.sidebarMin, LIMITS.sidebarMax);
  if (threadHandle) describe(threadHandle, shown.thread ?? widthOf('thread'), LIMITS.threadMin, layout.clientWidth);
}

/**
 * @param {HTMLElement} handle
 * @param {number} now
 * @param {number} min
 * @param {number} max
 */
function describe(handle, now, min, max) {
  handle.setAttribute('aria-valuemin', String(min));
  handle.setAttribute('aria-valuemax', String(max));
  handle.setAttribute('aria-valuenow', String(Math.round(now)));
}

/**
 * The width a pane has on screen right now.
 *
 * @param {Pane} pane
 */
function widthOf(pane) {
  const element = pane === 'sidebar' ? sidebar : threadPane;
  return element ? element.getBoundingClientRect().width : 0;
}

// ---- Changing a width ------------------------------------------------------------

/**
 * Set a pane's width from a user action. The result is clamped to what fits
 * and becomes the recorded width, so a drag past the minimum stops there.
 *
 * @param {Pane} pane
 * @param {number} width
 */
function setWidth(pane, width) {
  if (pane === 'sidebar') state.sidebarWidth = width;
  else state.threadWidth = width;
  const shown = fitted();
  if (pane === 'sidebar') state.sidebarWidth = shown.sidebar;
  else state.threadWidth = shown.thread;
  apply();
}

/** @param {Pane} pane */
function reset(pane) {
  if (pane === 'sidebar') state.sidebarWidth = LIMITS.sidebarDefault;
  else state.threadWidth = null;
  apply();
  writeStored();
}

/**
 * @param {HTMLElement} handle
 * @param {Pane} pane
 */
function wireHandle(handle, pane) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthOf(pane);
    handle.setPointerCapture(event.pointerId);
    handle.setAttribute('data-dragging', '');
    document.body.setAttribute('data-resizing', '');
    const onMove = (/** @type {PointerEvent} */ move) => {
      const travel = move.clientX - startX;
      setWidth(pane, pane === 'sidebar' ? startWidth + travel : startWidth - travel);
    };
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      handle.removeAttribute('data-dragging');
      document.body.removeAttribute('data-resizing');
      writeStored();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  });

  handle.addEventListener('dblclick', () => reset(pane));

  handle.addEventListener('keydown', (event) => {
    const grow = pane === 'sidebar' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = pane === 'sidebar' ? 'ArrowLeft' : 'ArrowRight';
    const current = widthOf(pane);
    /** @type {number} */
    let next;
    if (event.key === grow) next = current + KEY_STEP;
    else if (event.key === shrink) next = current - KEY_STEP;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = Number.MAX_SAFE_INTEGER;
    else return;
    event.preventDefault();
    setWidth(pane, next);
    writeStored();
  });
}

// ---- Wiring ------------------------------------------------------------------------

wireHandle(sidebarHandle, 'sidebar');
if (threadHandle) wireHandle(threadHandle, 'thread');

toggle.addEventListener('click', () => {
  state.sidebarHidden = !state.sidebarHidden;
  apply();
  writeStored();
  if (!state.sidebarHidden) sidebar.querySelector('.turn-row[data-active]')?.scrollIntoView({ block: 'nearest' });
});

window.addEventListener('resize', apply);

apply();
