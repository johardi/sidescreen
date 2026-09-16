/**
 * The turn page: selection capture, anchored threads, and the thread column.
 */

import { describeRange, resolveAnchor } from './anchor.js';
import { clearMarks, wrapRange } from './marks.js';
import { familyOf, rootOf, rootThreads } from './thread-tree.js';

/** @typedef {import('../threads.js').Exchange & { answerHtml: string|null }} PresentedExchange */
/** @typedef {Omit<import('../threads.js').Thread, 'exchanges'> & { exchanges: PresentedExchange[], detached?: boolean }} PresentedThread */
/** @typedef {import('../types.js').Turn} Turn */
/** @typedef {import('../carry-back.js').CarryBackEntry} CarryBackEntry */

const dataElement = /** @type {HTMLScriptElement} */ (document.getElementById('turn-data'));
const initial = /** @type {{ turn: Turn, threads: PresentedThread[], carryBack: CarryBackEntry[] }} */ (JSON.parse(dataElement.textContent ?? '{}'));

const documentElement = /** @type {HTMLElement} */ (document.getElementById('document'));
const threadPane = /** @type {HTMLElement} */ (document.getElementById('thread-pane'));
const popover = /** @type {HTMLFormElement} */ (document.getElementById('ask-popover'));
const selectionQuote = /** @type {HTMLElement} */ (document.getElementById('ask-selection'));
const questionInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('ask-question'));
const cancelButton = /** @type {HTMLButtonElement} */ (document.getElementById('ask-cancel'));
const submitButton = /** @type {HTMLButtonElement} */ (document.getElementById('ask-submit'));
const carryBackSection = /** @type {HTMLElement} */ (document.getElementById('carry-back'));
const carryBackCount = /** @type {HTMLElement} */ (document.getElementById('carry-back-count'));
const carryBackList = /** @type {HTMLElement} */ (document.getElementById('carry-back-list'));
const carryBackForm = /** @type {HTMLFormElement} */ (document.getElementById('carry-back-form'));
const carryBackText = /** @type {HTMLTextAreaElement} */ (document.getElementById('carry-back-text'));
const carryBackAdd = /** @type {HTMLButtonElement} */ (document.getElementById('carry-back-add'));

const state = {
  turn: initial.turn,
  /** @type {PresentedThread[]} */
  threads: initial.threads ?? [],
  /** @type {CarryBackEntry[]} */
  carryBack: initial.carryBack ?? [],
  /** @type {string|null} */
  activeThreadId: null,
  /** @type {import('./anchor.js').Anchor|null} */
  pendingAnchor: null,
  /** @type {string|null} The exchange whose branch form is open. */
  branchingFrom: null,
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
    const { thread } = /** @type {{ thread: PresentedThread }} */ (
      await postJson(`/api/turns/${encodeURIComponent(state.turn.promptId)}/threads`, { anchor, selectedText: anchor.text, question })
    );
    mergeThread(thread);
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
  renderCarryBack();
}

/** The thread shown in the column: the chosen one, else the newest root. */
function activeThread() {
  const chosen = state.threads.find((thread) => thread.id === state.activeThreadId);
  if (chosen) return chosen;
  const roots = rootThreads(state.threads);
  return roots[roots.length - 1] ?? null;
}

function applyMarks() {
  clearMarks(documentElement);
  const active = activeThread();
  const activeRootId = active ? rootOf(state.threads, active).id : null;
  rootThreads(state.threads).forEach((thread, index) => {
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
    if (thread.id === activeRootId) attributes['data-active'] = '';
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
  const roots = rootThreads(state.threads);
  const active = activeThread();
  if (roots.length === 0 || active === null) {
    threadPane.append(element('p', { class: 'thread-empty' }, 'Select text in the document to ask about it.'));
    return;
  }
  state.activeThreadId = active.id;
  const root = rootOf(state.threads, active);

  const list = element('ul', { class: 'thread-list' });
  roots.forEach((thread, index) => {
    const chip = element(
      'button',
      { type: 'button', class: 'thread-chip', 'aria-pressed': String(thread.id === root.id), 'data-thread-id': thread.id },
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
  threadPane.append(list, renderThread(active, root, roots.indexOf(root) + 1));
}

/**
 * @param {PresentedThread} thread The thread being shown, possibly a branch.
 * @param {PresentedThread} root The root of its family.
 * @param {number} index 1-based position of the root among the turn's threads.
 */
function renderThread(thread, root, index) {
  const header = element('header', { class: 'thread-header' });
  header.append(element('span', { class: 'thread-index' }, `Thread #${index}`));
  header.append(element('blockquote', { class: 'thread-selection' }, root.selectedText));
  if (root.detached) {
    header.append(element('p', { class: 'thread-detached' }, 'The document changed since this was anchored; the highlight may be off.'));
  }

  const section = element('section', { class: 'thread', 'data-thread-id': thread.id });
  section.append(header);

  const family = familyOf(state.threads, root);
  if (family.length > 1) section.append(renderBranchTabs(family, thread));
  if (thread.parentThreadId !== null) section.append(element('p', { class: 'thread-lineage' }, lineageText(thread)));

  const exchanges = element('ol', { class: 'exchanges' });
  thread.exchanges.forEach((exchange, position) => {
    const item = element('li', { class: 'exchange', 'data-exchange-id': exchange.id });
    item.append(element('div', { class: 'question' }, exchange.question));
    item.append(renderAnswer(exchange));
    if (exchange.status === 'answered' && exchange.subAgentSessionId) {
      const actions = element('div', { class: 'exchange-actions' });
      const carryButton = element('button', { type: 'button', class: 'carry-button', title: 'Draft a carry-back entry from this answer' }, 'Carry back');
      carryButton.addEventListener('click', () => {
        if (carryBackText.value.trim() === '') carryBackText.value = answerPlainText(exchange);
        carryBackText.dataset.threadId = thread.id;
        carryBackSection.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        carryBackText.focus({ preventScroll: true });
      });
      actions.append(carryButton);
      const branchButton = element('button', { type: 'button', class: 'branch-button', title: `Start a new line of questioning from answer ${position + 1}` }, 'Branch from here');
      branchButton.addEventListener('click', () => {
        state.branchingFrom = state.branchingFrom === exchange.id ? null : exchange.id;
        render();
      });
      actions.append(branchButton);
      item.append(actions);
      if (state.branchingFrom === exchange.id) item.append(renderBranchForm(thread, exchange));
    }
    exchanges.append(item);
  });
  section.append(exchanges, renderFollowUpForm(thread));
  return section;
}

/**
 * @param {PresentedThread[]} family Root first, then branches.
 * @param {PresentedThread} active
 */
function renderBranchTabs(family, active) {
  const tabs = element('div', { class: 'branch-tabs', role: 'tablist', 'aria-label': 'Branches of this thread' });
  family.forEach((member, position) => {
    const tab = element(
      'button',
      {
        type: 'button',
        role: 'tab',
        class: 'branch-tab',
        'aria-selected': String(member.id === active.id),
        'data-thread-id': member.id,
        title: position === 0 ? 'The original line of questioning' : lineageText(member),
      },
      familyLabel(family, member),
    );
    tab.addEventListener('click', () => {
      state.activeThreadId = member.id;
      state.branchingFrom = null;
      render();
    });
    tabs.append(tab);
  });
  return tabs;
}

/**
 * @param {PresentedThread[]} family
 * @param {PresentedThread} member
 */
function familyLabel(family, member) {
  const position = family.indexOf(member);
  return position <= 0 ? 'main' : `b${position}`;
}

/** @param {PresentedThread} thread */
function lineageText(thread) {
  const parent = state.threads.find((candidate) => candidate.id === thread.parentThreadId);
  if (!parent) return 'Branched from another thread';
  const answerNumber = parent.exchanges.findIndex((exchange) => exchange.id === thread.branchedFromExchangeId) + 1;
  const parentLabel = familyLabel(familyOf(state.threads, parent), parent);
  return `Branched from answer ${answerNumber || '?'} of ${parentLabel}`;
}

/**
 * @param {PresentedExchange} exchange
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

/** @param {PresentedThread} thread */
function renderFollowUpForm(thread) {
  const last = thread.exchanges[thread.exchanges.length - 1];
  const waiting = last !== undefined && last.status === 'pending';
  const form = element('form', { class: 'follow-up-form' });
  const input = element('textarea', {
    class: 'follow-up-question',
    rows: '2',
    'aria-label': 'Follow-up question',
    placeholder: waiting ? 'Waiting for the current answer…' : 'Ask a follow-up…',
  });
  const button = element('button', { type: 'submit', class: 'button-primary follow-up-button' }, 'Follow up');
  input.disabled = waiting;
  button.disabled = waiting;
  input.addEventListener('keydown', submitOnEnter(form));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (question === '') return;
    button.disabled = true;
    try {
      const { thread: updated } = /** @type {{ thread: PresentedThread }} */ (await postJson(`/api/threads/${encodeURIComponent(thread.id)}/exchanges`, { question }));
      mergeThread(updated);
      render();
      schedulePoll();
    } catch (error) {
      showFormError(form, /** @type {Error} */ (error));
      button.disabled = false;
    }
  });
  const actions = element('div', { class: 'form-actions' });
  actions.append(button);
  form.append(input, actions);
  return form;
}

/**
 * @param {PresentedThread} thread
 * @param {PresentedExchange} exchange
 */
function renderBranchForm(thread, exchange) {
  const form = element('form', { class: 'branch-form' });
  const input = element('textarea', { class: 'branch-question', rows: '2', 'aria-label': 'Question for the new branch', placeholder: 'Ask on a new branch…' });
  const cancel = element('button', { type: 'button', class: 'button-secondary' }, 'Cancel');
  const button = element('button', { type: 'submit', class: 'button-primary branch-submit' }, 'Ask on a branch');
  cancel.addEventListener('click', () => {
    state.branchingFrom = null;
    render();
  });
  input.addEventListener('keydown', submitOnEnter(form));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (question === '') return;
    button.disabled = true;
    try {
      const { thread: branch } = /** @type {{ thread: PresentedThread }} */ (
        await postJson(`/api/threads/${encodeURIComponent(thread.id)}/branches`, { exchangeId: exchange.id, question })
      );
      mergeThread(branch);
      state.activeThreadId = branch.id;
      state.branchingFrom = null;
      render();
      schedulePoll();
    } catch (error) {
      showFormError(form, /** @type {Error} */ (error));
      button.disabled = false;
    }
  });
  const actions = element('div', { class: 'form-actions' });
  actions.append(cancel, button);
  form.append(input, actions);
  setTimeout(() => input.focus({ preventScroll: true }), 0);
  return form;
}

/** @param {HTMLFormElement} form */
function submitOnEnter(form) {
  return (/** @type {KeyboardEvent} */ event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  };
}

/**
 * @param {HTMLFormElement} form
 * @param {Error} error
 */
function showFormError(form, error) {
  form.querySelector('.form-error')?.remove();
  form.append(element('p', { class: 'form-error' }, error.message));
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

// ---- Carry back --------------------------------------------------------------

function renderCarryBack() {
  const pending = state.carryBack.filter((entry) => entry.emittedAt === null);
  carryBackCount.textContent = pending.length === 0 ? 'nothing pending' : `${pending.length} pending`;
  carryBackList.replaceChildren();
  for (const entry of state.carryBack) {
    const item = element('li', { class: 'carry-back-entry', 'data-entry-id': entry.id, 'data-state': entry.emittedAt === null ? 'pending' : 'sent' });
    item.append(element('span', { class: 'carry-back-entry-text' }, entry.text));
    if (entry.emittedAt === null) {
      const remove = element('button', { type: 'button', class: 'carry-back-remove', 'aria-label': 'Remove this entry' }, 'Remove');
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          const response = await fetch(`/api/sessions/${encodeURIComponent(state.turn.sessionId)}/carry-back/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
          if (!response.ok) throw new Error(`Request failed with ${response.status}`);
          const { entries } = /** @type {{ entries: CarryBackEntry[] }} */ (await response.json());
          state.carryBack = entries;
          renderCarryBack();
        } catch {
          remove.disabled = false;
        }
      });
      item.append(remove);
    } else {
      item.append(element('span', { class: 'carry-back-sent', title: `Sent to the terminal at ${entry.emittedAt}` }, 'sent'));
    }
    carryBackList.append(item);
  }
}

carryBackText.addEventListener('keydown', submitOnEnter(carryBackForm));
carryBackForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = carryBackText.value.trim();
  if (text === '') return;
  carryBackAdd.disabled = true;
  try {
    const { entries } = /** @type {{ entries: CarryBackEntry[] }} */ (
      await postJson(`/api/sessions/${encodeURIComponent(state.turn.sessionId)}/carry-back`, { text, threadId: carryBackText.dataset.threadId ?? null })
    );
    state.carryBack = entries;
    carryBackText.value = '';
    delete carryBackText.dataset.threadId;
    renderCarryBack();
  } catch (error) {
    showFormError(carryBackForm, /** @type {Error} */ (error));
  } finally {
    carryBackAdd.disabled = false;
  }
});

/** @param {PresentedExchange} exchange */
function answerPlainText(exchange) {
  const scratch = document.createElement('div');
  scratch.innerHTML = exchange.answerHtml ?? '';
  return (scratch.textContent ?? '').trim();
}

// ---- Data ------------------------------------------------------------------

/**
 * @param {string} path
 * @param {unknown} body
 * @returns {Promise<unknown>}
 */
async function postJson(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const payload = /** @type {{ error?: string }} */ (await response.json().catch(() => ({})));
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }
  return response.json();
}

/** @param {PresentedThread} thread */
function mergeThread(thread) {
  const index = state.threads.findIndex((existing) => existing.id === thread.id);
  if (index >= 0) state.threads[index] = thread;
  else state.threads.push(thread);
}

// ---- Live updates ----------------------------------------------------------

async function refresh() {
  try {
    const response = await fetch(`/api/turns/${encodeURIComponent(state.turn.promptId)}`);
    if (!response.ok) return;
    const data = /** @type {{ turn: Turn, documentHtml: string, threads: PresentedThread[], carryBack: CarryBackEntry[] }} */ (await response.json());
    if (data.turn.receivedAt !== state.turn.receivedAt) {
      state.turn = data.turn;
      clearMarks(documentElement);
      documentElement.innerHTML = data.documentHtml;
    }
    state.threads = data.threads;
    state.carryBack = data.carryBack ?? [];
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
for (const type of ['thread-created', 'thread-updated', 'carry-back-updated', 'store-changed']) {
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
