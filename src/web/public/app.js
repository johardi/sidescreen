/**
 * The turn page: selection capture, anchored threads, and the thread column.
 */

import { describeRange, resolveAnchor } from './anchor.js';
import { clearMarks, wrapRange } from './marks.js';
import { familyOf, rootOf, rootThreads } from './thread-tree.js';
import { events } from './events.js';
import { composerState, rememberComposer } from './layout.js';

/** @typedef {import('../../store/threads.js').Exchange & { answerHtml: string|null }} PresentedExchange */
/** @typedef {Omit<import('../../store/threads.js').Thread, 'exchanges'> & { exchanges: PresentedExchange[], detached?: boolean }} PresentedThread */
/** @typedef {import('../../types.js').Turn} Turn */
/** @typedef {import('../../store/carry-back.js').CarryBackEntry} CarryBackEntry */

const dataElement = /** @type {HTMLScriptElement} */ (document.getElementById('turn-data'));
const initial = /** @type {{ turn: Turn, threads: PresentedThread[], carryBack: CarryBackEntry[] }} */ (JSON.parse(dataElement.textContent ?? '{}'));

const documentElement = /** @type {HTMLElement} */ (document.getElementById('document'));
/** The scrolling pane around the document, and the popover's positioning context. */
const documentPane = /** @type {HTMLElement} */ (document.getElementById('document-pane'));
const threadPane = /** @type {HTMLElement} */ (document.getElementById('thread-pane'));
const popover = /** @type {HTMLFormElement} */ (document.getElementById('ask-popover'));
const selectionQuote = /** @type {HTMLElement} */ (document.getElementById('ask-selection'));
const questionInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('ask-question'));
const composerBar = /** @type {HTMLElement} */ (document.getElementById('composer-bar'));
const composerMinimize = /** @type {HTMLButtonElement} */ (document.getElementById('composer-minimize'));
const composerMaximize = /** @type {HTMLButtonElement} */ (document.getElementById('composer-maximize'));
const carryBackCount = /** @type {HTMLElement} */ (document.getElementById('carry-back-count'));
const carryBackSent = /** @type {HTMLElement} */ (document.getElementById('carry-back-sent'));
const carryBackList = /** @type {HTMLElement} */ (document.getElementById('carry-back-list'));
const carryBackForm = /** @type {HTMLFormElement} */ (document.getElementById('carry-back-form'));
const carryBackText = /** @type {HTMLTextAreaElement} */ (document.getElementById('carry-back-text'));

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
  /** What the exchanges list showed at the last render, to tell a new exchange from a re-render of the same ones. */
  shown: /** @type {{ threadId: string|null, exchanges: number }} */ ({ threadId: null, exchanges: 0 }),
  /** @type {ReturnType<typeof setTimeout>|null} Clears the sent note when its half minute is up. */
  sentNoteTimer: null,
};

/** How each backend is named where the user reads it. */
const BACKEND_LABELS = /** @type {Record<string, string>} */ ({ claude: 'Claude', codex: 'CODEX' });

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
 * Place the popover just under the selection, in the document pane's own
 * scroll coordinates, so it travels with the passage when the pane scrolls.
 *
 * @param {DOMRect} rect Selection rectangle in viewport coordinates.
 * @param {string} text Selected text.
 */
function showPopover(rect, text) {
  selectionQuote.textContent = text.length > 240 ? `${text.slice(0, 237)}…` : text;
  popover.hidden = false;
  popover.removeAttribute('data-error');
  const pane = documentPane.getBoundingClientRect();
  const margin = 16;
  const width = popover.offsetWidth;
  const maxLeft = Math.max(margin, documentPane.clientWidth - width - margin);
  const left = Math.min(Math.max(margin, rect.left - pane.left), maxLeft) + documentPane.scrollLeft;
  popover.style.left = `${left}px`;
  popover.style.top = `${rect.bottom - pane.top + documentPane.scrollTop + 8}px`;
  questionInput.focus({ preventScroll: true });
}

function hidePopover() {
  if (popover.hidden) return;
  popover.hidden = true;
  questionInput.value = '';
  state.pendingAnchor = null;
}

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
  questionInput.disabled = true;
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
    questionInput.disabled = false;
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
  const mark = event.target.closest('mark[data-sidescreen-mark]');
  if (!(mark instanceof HTMLElement) || !mark.dataset.threadId) return;
  state.activeThreadId = mark.dataset.threadId;
  render();
});

/**
 * What the reader has typed into a field, and whether they are in it, so a
 * re-render of the thread pane on an event hands it back rather than losing it.
 *
 * @param {HTMLTextAreaElement|null} field
 */
function draftOf(field) {
  if (!field) return null;
  return { value: field.value, focused: document.activeElement === field, start: field.selectionStart, end: field.selectionEnd };
}

/**
 * @param {HTMLTextAreaElement|null} field
 * @param {ReturnType<typeof draftOf>} draft
 * @param {{ focusWhenNew?: boolean }} [options] Focus a field that did not exist before the render, such as a branch field just opened.
 */
function restoreDraft(field, draft, { focusWhenNew = false } = {}) {
  if (!field) return;
  if (draft && !field.disabled) {
    field.value = draft.value;
    if (draft.focused) {
      field.focus({ preventScroll: true });
      field.setSelectionRange(draft.start, draft.end);
    }
  } else if (!draft && focusWhenNew) {
    field.focus();
  }
}

function renderThreadPane() {
  const previous = threadPane.querySelector('.exchanges');
  const previousScroll = previous ? previous.scrollTop : 0;
  const followUpDraft = draftOf(threadPane.querySelector('.follow-up-question'));
  const branchDraft = draftOf(threadPane.querySelector('.branch-question'));
  threadPane.replaceChildren();
  const roots = rootThreads(state.threads);
  const active = activeThread();
  if (roots.length === 0 || active === null) {
    threadPane.append(element('p', { class: 'thread-empty' }, 'Select text in the document to ask about it.'));
    state.shown = { threadId: null, exchanges: 0 };
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
  const section = renderThread(active, root, roots.indexOf(root) + 1, list);
  threadPane.append(section);

  // A new exchange, or another thread, brings the newest exchange's question to the top of the list; a re-render of the same exchanges stays where the reader was.
  const exchanges = /** @type {HTMLElement} */ (section.querySelector('.exchanges'));
  const grew = state.shown.threadId !== active.id || active.exchanges.length > state.shown.exchanges;
  const newest = exchanges.lastElementChild;
  exchanges.scrollTop = grew ? (newest instanceof HTMLElement ? newest.offsetTop - exchanges.offsetTop : exchanges.scrollHeight) : previousScroll;
  state.shown = { threadId: active.id, exchanges: active.exchanges.length };

  // Whatever was being typed comes back, in the same field, with the caret where it was; a branch field just opened takes focus.
  restoreDraft(section.querySelector('.follow-up-question'), followUpDraft);
  restoreDraft(section.querySelector('.branch-question'), branchDraft, { focusWhenNew: true });
}

/**
 * The thread as a column: chips, header, and tabs fixed at the top, the
 * exchanges scrolling in the middle, the follow-up field fixed at the foot.
 *
 * @param {PresentedThread} thread The thread being shown, possibly a branch.
 * @param {PresentedThread} root The root of its family.
 * @param {number} index 1-based position of the root among the turn's threads.
 * @param {HTMLElement} chips The list of the turn's threads.
 */
function renderThread(thread, root, index, chips) {
  const top = element('div', { class: 'thread-top' });
  top.append(chips);
  const header = element('header', { class: 'thread-header' });
  header.append(element('span', { class: 'thread-index' }, `Thread #${index}`));
  header.append(element('blockquote', { class: 'thread-selection' }, root.selectedText));
  if (root.detached) {
    header.append(element('p', { class: 'thread-detached' }, 'The document changed since this was anchored; the highlight may be off.'));
  }
  top.append(header);

  const family = familyOf(state.threads, root);
  if (family.length > 1) top.append(renderBranchTabs(family, thread));
  if (thread.parentThreadId !== null) top.append(element('p', { class: 'thread-lineage' }, lineageText(thread)));

  const exchanges = element('ol', { class: 'exchanges' });
  for (const exchange of thread.exchanges) {
    const item = element('li', { class: 'exchange', 'data-exchange-id': exchange.id });
    item.append(element('div', { class: 'question' }, exchange.question));
    item.append(renderAnswer(exchange));
    if (exchange.status === 'answered' && exchange.subAgentSessionId) {
      const actions = element('div', { class: 'exchange-actions' });
      const carryButton = iconButton('carry-button', 'reply', 'Carry back this answer');
      carryButton.addEventListener('click', () => {
        if (carryBackText.value.trim() === '') carryBackText.value = answerPlainText(exchange);
        carryBackText.dataset.threadId = thread.id;
        if (composerState() === 'minimized') setComposer('open');
        fitTextarea(carryBackText);
        carryBackText.focus();
      });
      const branchButton = iconButton('branch-button', 'code-branch', 'Branch from here');
      branchButton.addEventListener('click', () => {
        state.branchingFrom = state.branchingFrom === exchange.id ? null : exchange.id;
        render();
      });
      actions.append(carryButton, branchButton);
      item.append(actions);
      if (state.branchingFrom === exchange.id) item.append(renderBranchForm(thread, exchange));
    }
    exchanges.append(item);
  }

  const section = element('section', { class: 'thread', 'data-thread-id': thread.id });
  section.append(top, exchanges, renderFollowUpForm(thread));
  return section;
}

/**
 * A compact control showing one of the page's icons, named by its tooltip
 * and its accessible label.
 *
 * @param {string} className
 * @param {string} iconName A symbol in the page's sprite.
 * @param {string} label
 */
function iconButton(className, iconName, label) {
  const button = element('button', { type: 'button', class: `icon-button ${className}`, title: label, 'aria-label': label });
  button.innerHTML = `<svg class="icon" aria-hidden="true" focusable="false"><use href="#icon-${iconName}"></use></svg>`;
  return button;
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
    answer.append(element('p', { class: 'answer-pending' }, pendingText(exchange)));
  } else if (exchange.status === 'failed') {
    answer.append(element('p', { class: 'answer-error' }, `Could not get an answer: ${exchange.error ?? 'unknown error'}`));
  } else if (exchange.answer) {
    answer.append(answeredBy(exchange));
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

/** @param {string} backend */
function backendLabel(backend) {
  return BACKEND_LABELS[backend] ?? backend;
}

/**
 * Who answered, quietly, above the answer: "Claude answered:" or "CODEX
 * answered:", with the model in the tooltip when known.
 *
 * @param {PresentedExchange} exchange
 */
function answeredBy(exchange) {
  const label = backendLabel(exchange.backend);
  const title = exchange.model ? `Answered by ${label} on ${exchange.model}` : `Answered by ${label}`;
  return element('p', { class: 'answer-by', 'data-backend': exchange.backend, title }, `${label} answered:`);
}

/** @param {PresentedExchange} exchange */
function pendingText(exchange) {
  return `Asking ${backendLabel(exchange.backend)}… ${elapsedSince(exchange.askedAt)}`;
}

/**
 * The follow-up field at the foot of the thread pane. Enter sends, Shift+Enter
 * breaks a line; there is no button.
 *
 * @param {PresentedThread} thread
 */
function renderFollowUpForm(thread) {
  const last = thread.exchanges[thread.exchanges.length - 1];
  const waiting = last !== undefined && last.status === 'pending';
  const form = element('form', { class: 'follow-up-form' });
  const input = element('textarea', {
    class: 'follow-up-question',
    rows: '2',
    'aria-label': 'Follow-up question. Enter sends, Shift+Enter breaks a line',
    placeholder: waiting ? 'Waiting for the current answer…' : 'Ask a follow-up…',
  });
  input.disabled = waiting;
  input.addEventListener('keydown', submitOnEnter(form));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (question === '') return;
    input.disabled = true;
    try {
      const { thread: updated } = /** @type {{ thread: PresentedThread }} */ (await postJson(`/api/threads/${encodeURIComponent(thread.id)}/exchanges`, { question }));
      mergeThread(updated);
      input.value = '';
      render();
      schedulePoll();
    } catch (error) {
      showFormError(form, /** @type {Error} */ (error));
      input.disabled = false;
    }
  });
  form.append(input);
  return form;
}

/**
 * The field for a new branch, under the answer it branches from. Enter sends,
 * Escape closes it.
 *
 * @param {PresentedThread} thread
 * @param {PresentedExchange} exchange
 */
function renderBranchForm(thread, exchange) {
  const form = element('form', { class: 'branch-form' });
  const input = element('textarea', {
    class: 'branch-question',
    rows: '2',
    'aria-label': 'Question for the new branch. Enter sends, Escape cancels',
    placeholder: 'Ask on a new branch… Enter sends, Esc cancels',
  });
  const submit = submitOnEnter(form);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      state.branchingFrom = null;
      render();
      return;
    }
    submit(event);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (question === '') return;
    input.disabled = true;
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
      input.disabled = false;
    }
  });
  form.append(input);
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

// ---- The composer: carry back, floating in the document pane's corner ----------------

/** Name what the maximize control will do from the state the composer is in. */
function syncComposerLabels() {
  const maximized = composerState() === 'maximized';
  composerMaximize.setAttribute('aria-label', maximized ? 'Restore the carry-back list' : 'Maximize the carry-back list');
  composerMaximize.setAttribute('title', maximized ? 'Restore' : 'Maximize');
}

/** @param {import('./layout.js').ComposerState} next */
function setComposer(next) {
  rememberComposer(next);
  syncComposerLabels();
}

composerBar.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('button')) return;
  setComposer(composerState() === 'minimized' ? 'open' : 'minimized');
});
composerMinimize.addEventListener('click', () => setComposer('minimized'));
composerMaximize.addEventListener('click', () => setComposer(composerState() === 'maximized' ? 'open' : 'maximized'));
syncComposerLabels();

/**
 * Let a text area grow with what is typed; the stylesheet caps it and scrolls past the cap.
 *
 * @param {HTMLTextAreaElement} field
 */
function fitTextarea(field) {
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight + 2}px`;
}

/**
 * The entry being edited when the list is about to be re-rendered, so the
 * edit survives an event's refresh.
 *
 * @returns {{ id: string, value: string, start: number, end: number }|null}
 */
function editingEntry() {
  const field = carryBackList.querySelector('.carry-back-entry-edit');
  if (!(field instanceof HTMLTextAreaElement) || field.hasAttribute('data-done')) return null;
  const id = field.closest('.carry-back-entry')?.getAttribute('data-entry-id');
  return id ? { id, value: field.value, start: field.selectionStart, end: field.selectionEnd } : null;
}

/**
 * The field an entry's text becomes when it is edited in place: Enter saves,
 * Escape restores, and leaving the field saves a change.
 *
 * @param {CarryBackEntry} entry
 * @param {{ value: string, start: number, end: number }|null} draft What was typed before a re-render, if any.
 */
function editField(entry, draft) {
  const field = element('textarea', { class: 'carry-back-entry-edit', rows: '1', 'aria-label': 'Edit this entry. Enter saves, Escape cancels' });
  field.value = draft ? draft.value : entry.text;
  /** @param {boolean} save */
  const finish = async (save) => {
    if (field.hasAttribute('data-done')) return;
    field.setAttribute('data-done', '');
    const text = field.value.trim();
    if (!save || text === '' || text === entry.text) {
      renderCarryBack();
      return;
    }
    try {
      const { entries } = /** @type {{ entries: CarryBackEntry[] }} */ (
        await sendJson('PATCH', `/api/sessions/${encodeURIComponent(state.turn.sessionId)}/carry-back/${encodeURIComponent(entry.id)}`, { text })
      );
      state.carryBack = entries;
      renderCarryBack();
    } catch (error) {
      renderCarryBack();
      showFormError(carryBackForm, /** @type {Error} */ (error));
    }
  };
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  field.addEventListener('blur', () => finish(true));
  field.addEventListener('input', () => fitTextarea(field));
  return field;
}

/**
 * @param {HTMLTextAreaElement} field
 * @param {{ start: number, end: number }|null} caret
 */
function focusEdit(field, caret) {
  fitTextarea(field);
  field.focus();
  const at = caret ?? { start: field.value.length, end: field.value.length };
  field.setSelectionRange(at.start, at.end);
}

/** How long the note about the latest batch sent to the terminal stays on screen. */
const SENT_NOTE_MS = 30_000;

/**
 * The note for the moment of sending: how many entries the latest emit
 * carried, shown for half a minute after it, then gone. Entries emitted
 * together share one timestamp, which is what makes them a batch.
 */
function sentNote() {
  if (state.sentNoteTimer !== null) {
    clearTimeout(state.sentNoteTimer);
    state.sentNoteTimer = null;
  }
  const emitted = state.carryBack.filter((entry) => entry.emittedAt !== null);
  if (emitted.length === 0) return '';
  const latest = emitted.reduce((newest, entry) => (/** @type {string} */ (entry.emittedAt) > newest ? /** @type {string} */ (entry.emittedAt) : newest), /** @type {string} */ (emitted[0].emittedAt));
  const age = Date.now() - new Date(latest).getTime();
  if (age >= SENT_NOTE_MS) return '';
  state.sentNoteTimer = setTimeout(renderCarryBack, SENT_NOTE_MS - age + 50);
  const batch = emitted.filter((entry) => entry.emittedAt === latest).length;
  return `${batch} sent to the terminal`;
}

function renderCarryBack() {
  const pending = state.carryBack.filter((entry) => entry.emittedAt === null);
  carryBackCount.textContent = pending.length === 0 ? 'nothing pending' : `${pending.length} pending`;
  carryBackSent.textContent = sentNote();
  const editing = editingEntry();
  carryBackList.replaceChildren();
  // Sent entries have done their job and would only invite a second reading; the count above is their trace.
  for (const entry of pending) {
    const item = element('li', { class: 'carry-back-entry', 'data-entry-id': entry.id });
    if (editing && editing.id === entry.id) {
      const field = editField(entry, editing);
      item.append(field);
      carryBackList.append(item);
      focusEdit(field, editing);
    } else {
      const text = element('button', { type: 'button', class: 'carry-back-entry-text', title: 'Edit this entry' }, entry.text);
      text.addEventListener('click', () => {
        const field = editField(entry, null);
        text.replaceWith(field);
        focusEdit(field, null);
      });
      item.append(text);
    }
    const remove = iconButton('carry-back-remove', 'xmark', 'Remove this entry');
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
    if (!item.isConnected) carryBackList.append(item);
  }
}

carryBackText.addEventListener('keydown', submitOnEnter(carryBackForm));
carryBackText.addEventListener('input', () => fitTextarea(carryBackText));
carryBackForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = carryBackText.value.trim();
  if (text === '') return;
  carryBackText.disabled = true;
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
    carryBackText.disabled = false;
    fitTextarea(carryBackText);
    carryBackText.focus();
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
function postJson(path, body) {
  return sendJson('POST', path, body);
}

/**
 * @param {'POST'|'PATCH'} method
 * @param {string} path
 * @param {unknown} body
 * @returns {Promise<unknown>}
 */
async function sendJson(method, path, body) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
  // The frame marks the page quiet while it is leaving or removing something: the turn may already be gone.
  if (document.documentElement.hasAttribute('data-quiet')) return;
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

for (const type of ['thread-created', 'thread-updated', 'carry-back-updated', 'store-changed']) {
  events.addEventListener(type, () => {
    refresh();
  });
}

setInterval(() => {
  for (const pendingNode of threadPane.querySelectorAll('.answer-pending')) {
    const exchangeId = pendingNode.closest('[data-exchange-id]')?.getAttribute('data-exchange-id');
    const exchange = state.threads.flatMap((thread) => thread.exchanges).find((candidate) => candidate.id === exchangeId);
    if (exchange) pendingNode.textContent = pendingText(exchange);
  }
}, 1_000);

render();
schedulePoll();
