/**
 * The turn page: selection capture, anchored threads, and the thread column.
 */

import { describeRange, resolveAnchor } from './anchor.js';
import { clearMarks, wrapRange } from './marks.js';

/** @typedef {import('../threads.js').Thread & { exchanges: (import('../threads.js').Exchange & { answerHtml: string|null })[], detached?: boolean }} PresentedThread */
/** @typedef {import('../types.js').Turn} Turn */

const dataElement = /** @type {HTMLScriptElement} */ (document.getElementById('turn-data'));
const initial = /** @type {{ turn: Turn, threads: PresentedThread[] }} */ (JSON.parse(dataElement.textContent ?? '{}'));

const documentElement = /** @type {HTMLElement} */ (document.getElementById('document'));
const threadPane = /** @type {HTMLElement} */ (document.getElementById('thread-pane'));
const popover = /** @type {HTMLFormElement} */ (document.getElementById('ask-popover'));
const selectionQuote = /** @type {HTMLElement} */ (document.getElementById('ask-selection'));
const questionInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('ask-question'));
const cancelButton = /** @type {HTMLButtonElement} */ (document.getElementById('ask-cancel'));
const submitButton = /** @type {HTMLButtonElement} */ (document.getElementById('ask-submit'));

const state = {
  turn: initial.turn,
  /** @type {PresentedThread[]} */
  threads: initial.threads ?? [],
  /** @type {string|null} */
  activeThreadId: null,
  /** @type {import('./anchor.js').Anchor|null} */
  pendingAnchor: null,
  /** @type {ReturnType<typeof setTimeout>|null} */
  pollTimer: null,
};

const SOURCE_LABELS = /** @type {Record<string, string>} */ ({
  code: 'source: code',
  transcript: 'source: transcript',
  spec: 'source: spec',
  none: 'source: none',
  undeclared: 'source not declared',
});

// ---- Selection capture -----------------------------------------------------

/**
 * The current selection as an anchor, if it lies inside the document.
 *
 * @returns {{ anchor: import('./anchor.js').Anchor, rect: DOMRect }|null}
 */
function captureSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!documentElement.contains(range.startContainer) || !documentElement.contains(range.endContainer)) return null;
  try {
    const anchor = describeRange(range, documentElement);
    if (anchor.text.trim() === '') return null;
    return { anchor, rect: range.getBoundingClientRect() };
  } catch {
    return null;
  }
}

function onSelectionRelease() {
  const captured = captureSelection();
  if (captured === null) return;
  state.pendingAnchor = captured.anchor;
  showPopover(captured.rect, captured.anchor.text);
}

documentElement.addEventListener('mouseup', () => {
  // Let the browser finish updating the selection before reading it.
  setTimeout(onSelectionRelease, 0);
});

document.addEventListener('keyup', (event) => {
  if (event.shiftKey && event.key.startsWith('Arrow')) onSelectionRelease();
});

document.addEventListener('mousedown', (event) => {
  if (!(event.target instanceof Node) || popover.contains(event.target)) return;
  hidePopover();
});

// ---- Ask popover -----------------------------------------------------------

/**
 * @param {DOMRect} rect Selection rectangle in viewport coordinates.
 * @param {string} text Selected text.
 */
function showPopover(rect, text) {
  selectionQuote.textContent = text.length > 240 ? `${text.slice(0, 237)}…` : text;
  popover.hidden = false;
  popover.removeAttribute('data-error');
  const margin = 16;
  const width = popover.offsetWidth;
  const maxLeft = Math.max(margin, document.documentElement.clientWidth - width - margin);
  const left = Math.min(Math.max(margin, rect.left + window.scrollX), maxLeft + window.scrollX);
  popover.style.left = `${left}px`;
  popover.style.top = `${rect.bottom + window.scrollY + 8}px`;
  questionInput.focus({ preventScroll: true });
}

function hidePopover() {
  if (popover.hidden) return;
  popover.hidden = true;
  questionInput.value = '';
  state.pendingAnchor = null;
}

cancelButton.addEventListener('click', hidePopover);

questionInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hidePopover();
  } else if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    popover.requestSubmit();
  }
});

popover.addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  const anchor = state.pendingAnchor;
  if (question === '' || anchor === null) return;
  submitButton.disabled = true;
  try {
    const response = await fetch(`/api/turns/${encodeURIComponent(state.turn.promptId)}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anchor, selectedText: anchor.text, question }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Request failed with ${response.status}`);
    }
    const { thread } = /** @type {{ thread: PresentedThread }} */ (await response.json());
    state.threads = [...state.threads.filter((existing) => existing.id !== thread.id), thread];
    state.activeThreadId = thread.id;
    hidePopover();
    window.getSelection()?.removeAllRanges();
    render();
    schedulePoll();
  } catch (error) {
    popover.setAttribute('data-error', /** @type {Error} */ (error).message);
    selectionQuote.textContent = `Could not create the thread: ${/** @type {Error} */ (error).message}`;
  } finally {
    submitButton.disabled = false;
  }
});

// ---- Rendering -------------------------------------------------------------

function render() {
  applyMarks();
  renderThreadPane();
}

function applyMarks() {
  clearMarks(documentElement);
  state.threads.forEach((thread, index) => {
    /** @type {Range} */
    let range;
    try {
      range = resolveAnchor(thread.anchor, documentElement);
    } catch {
      thread.detached = true;
      return;
    }
    thread.detached = range.toString() !== thread.anchor.text;
    /** @type {Record<string, string>} */
    const attributes = { 'data-thread-id': thread.id };
    if (thread.id === state.activeThreadId) attributes['data-active'] = '';
    const marks = wrapRange(range, attributes);
    const last = marks[marks.length - 1];
    if (last) last.setAttribute('data-index', String(index + 1));
  });
}

documentElement.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const mark = event.target.closest('mark[data-annotatr-mark]');
  if (!(mark instanceof HTMLElement) || !mark.dataset.threadId) return;
  state.activeThreadId = mark.dataset.threadId;
  render();
});

function renderThreadPane() {
  threadPane.replaceChildren();
  if (state.threads.length === 0) {
    threadPane.append(element('p', { class: 'thread-empty' }, 'Select text in the document to ask about it.'));
    return;
  }
  const active = state.threads.find((thread) => thread.id === state.activeThreadId) ?? state.threads[state.threads.length - 1];
  state.activeThreadId = active.id;

  const list = element('ul', { class: 'thread-list' });
  state.threads.forEach((thread, index) => {
    const chip = element(
      'button',
      { type: 'button', class: 'thread-chip', 'aria-pressed': String(thread.id === active.id), 'data-thread-id': thread.id },
      `#${index + 1}`,
    );
    chip.addEventListener('click', () => {
      state.activeThreadId = thread.id;
      render();
    });
    const item = element('li');
    item.append(chip);
    list.append(item);
  });
  threadPane.append(list, renderThread(active, state.threads.indexOf(active) + 1));
}

/**
 * @param {PresentedThread} thread
 * @param {number} index 1-based position among the turn's threads.
 */
function renderThread(thread, index) {
  const header = element('header', { class: 'thread-header' });
  header.append(element('span', { class: 'thread-index' }, `Thread #${index}`));
  header.append(element('blockquote', { class: 'thread-selection' }, thread.selectedText));
  if (thread.detached) {
    header.append(element('p', { class: 'thread-detached' }, 'The document changed since this was anchored; the highlight may be off.'));
  }

  const exchanges = element('ol', { class: 'exchanges' });
  for (const exchange of thread.exchanges) {
    const item = element('li', { class: 'exchange', 'data-exchange-id': exchange.id });
    item.append(element('div', { class: 'question' }, exchange.question));
    item.append(renderAnswer(exchange));
    exchanges.append(item);
  }

  const section = element('section', { class: 'thread', 'data-thread-id': thread.id });
  section.append(header, exchanges);
  return section;
}

/**
 * @param {PresentedThread['exchanges'][number]} exchange
 */
function renderAnswer(exchange) {
  const answer = element('div', { class: 'answer', 'data-status': exchange.status });
  if (exchange.status === 'pending') {
    answer.append(element('p', { class: 'answer-pending' }, `Asking the sub-agent… ${elapsedSince(exchange.askedAt)}`));
  } else if (exchange.status === 'failed') {
    answer.append(element('p', { class: 'answer-error' }, `Could not get an answer: ${exchange.error ?? 'unknown error'}`));
  } else if (exchange.answer) {
    const body = element('div', { class: 'answer-body' });
    body.innerHTML = exchange.answerHtml ?? '';
    answer.append(body);
    const source = element('footer', { class: 'answer-source' });
    source.append(
      element('span', { class: 'source-badge', 'data-source': exchange.answer.source }, SOURCE_LABELS[exchange.answer.source] ?? `source: ${exchange.answer.source}`),
    );
    if (exchange.answer.sourceDetail) source.append(element('span', { class: 'source-detail' }, exchange.answer.sourceDetail));
    answer.append(source);
  }
  return answer;
}

/** @param {string} iso */
function elapsedSince(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string>} [attributes]
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
function element(tag, attributes = {}, text) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---- Live updates ----------------------------------------------------------

async function refresh() {
  try {
    const response = await fetch(`/api/turns/${encodeURIComponent(state.turn.promptId)}`);
    if (!response.ok) return;
    const data = /** @type {{ turn: Turn, documentHtml: string, threads: PresentedThread[] }} */ (await response.json());
    if (data.turn.receivedAt !== state.turn.receivedAt) {
      state.turn = data.turn;
      clearMarks(documentElement);
      documentElement.innerHTML = data.documentHtml;
    }
    state.threads = data.threads;
    render();
  } finally {
    schedulePoll();
  }
}

function schedulePoll() {
  if (state.pollTimer !== null) clearTimeout(state.pollTimer);
  const pending = state.threads.some((thread) => thread.exchanges.some((exchange) => exchange.status === 'pending'));
  if (!pending) return;
  state.pollTimer = setTimeout(refresh, 3_000);
}

const events = new EventSource('/api/events');
for (const type of ['thread-created', 'thread-updated', 'store-changed']) {
  events.addEventListener(type, () => {
    refresh();
  });
}

setInterval(() => {
  for (const pendingNode of threadPane.querySelectorAll('.answer-pending')) {
    const exchangeId = pendingNode.closest('[data-exchange-id]')?.getAttribute('data-exchange-id');
    const exchange = state.threads.flatMap((thread) => thread.exchanges).find((candidate) => candidate.id === exchangeId);
    if (exchange) pendingNode.textContent = `Asking the sub-agent… ${elapsedSince(exchange.askedAt)}`;
  }
}, 1_000);

render();
schedulePoll();
