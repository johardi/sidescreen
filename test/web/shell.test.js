/**
 * The workspace as a fixed shell in a real browser: nothing but the panes
 * scrolls, the sidebar and thread pane are sized and hidden by the user, and
 * the browser remembers the arrangement across the reloads following performs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragSelect, openBrowser } from '../browser-helpers.js';
import { sampleTurn, startServer, turnHref } from '../server-helpers.js';
import { projectId } from '../../src/store/projects.js';
import { upsertSession } from '../../src/store/sessions.js';

const CWD = '/Users/example/proj';
const PROJECT = projectId(CWD);
const ACCENT = 'rgb(36, 86, 214)';

/** Design limits, mirrored from layout.js. */
const SIDEBAR_DEFAULT = 260;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;
const THREAD_MIN = 260;
const DOCUMENT_MIN = 300;
const HANDLE = 6;
const RAIL = 40;

/** @type {import('../../src/web/server.js').Dispatch} */
const longAnswerStub = async ({ exchange }) => ({
  ok: true,
  answer: { text: Array.from({ length: 60 }, (_, index) => `Point ${index + 1} about ${exchange.question}`).join('\n\n'), source: 'code', sourceDetail: 'src/x.js:1' },
  subAgentSessionId: 'sub-1',
});

/** A turn tall enough to scroll in any window. */
function longTurn(overrides = {}) {
  return sampleTurn({
    message: Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1} of a long turn: the quick brown fox jumps over the lazy dog.`).join('\n\n'),
    ...overrides,
  });
}

/**
 * @param {string} url
 * @param {string} promptId
 */
async function seedLongThread(url, promptId = 'prompt-1') {
  const response = await fetch(new URL(`/api/turns/${promptId}/threads`, url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anchor: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 9 }, text: 'Paragraph' }, selectedText: 'Paragraph', question: 'a long thread?' }),
  });
  assert.equal(response.status, 201);
}

/**
 * Ingest a turn while a page is open, the way the Stop hook would.
 *
 * @param {import('../../src/store/store.js').Store} store
 * @param {import('../../src/types.js').Turn} turn
 */
async function arrive(store, turn) {
  await store.update((state) => {
    state.turns[turn.promptId] = turn;
    upsertSession(state, turn, null);
  });
}

/** @param {import('playwright').Page} page */
function shell(page) {
  return page.evaluate(() => {
    /** @param {string} selector */
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      pageScrollHeight: document.documentElement.scrollHeight,
      pageScrollWidth: document.documentElement.scrollWidth,
      pageScrollY: scrollY,
      header: box('.topbar'),
      sidebar: box('.sidebar'),
      document: box('.document-pane'),
      thread: box('.thread-pane'),
      composer: box('.composer'),
    };
  });
}

/** @param {import('playwright').Page} page */
function widths(page) {
  return page.evaluate(() => {
    /** @param {string} selector */
    // Fractional tracks land on sub-pixels; whole pixels are what the assertions mean.
    const width = (selector) => Math.round(document.querySelector(selector)?.getBoundingClientRect().width ?? 0);
    return { sidebar: width('.sidebar'), document: width('.document-pane'), thread: width('.thread-pane') };
  });
}

/**
 * Drag a handle horizontally by a distance, with a real pointer.
 *
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {number} distance Positive to the right.
 */
async function dragHandle(page, selector, distance) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `${selector} is on screen`);
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(200, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + distance, y, { steps: 8 });
  await page.mouse.up();
}

/**
 * @param {import('playwright').Page} page
 * @param {{ sidebarWidth?: number, threadWidth?: number|null, sidebarHidden?: boolean }} record
 */
function seedLayout(page, record) {
  return page.addInitScript((value) => {
    try {
      localStorage.setItem('sidescreen:layout', JSON.stringify(value));
    } catch {
      // The test that blocks storage seeds nothing.
    }
  }, record);
}

/**
 * Resize the window and wait for the page to have handled the resize event.
 *
 * @param {import('playwright').Page} page
 * @param {number} width
 * @param {number} height
 */
async function resizeWindow(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/**
 * @param {number} actual
 * @param {number} expected
 * @param {string} what
 */
function near(actual, expected, what) {
  assert.ok(Math.abs(actual - expected) <= 1, `${what}: ${actual} is not within 1px of ${expected}`);
}

test('3.1 the shell fits the window: only the panes scroll, and the header, sidebar, and carry-back zone stay put', async (t) => {
  const { url } = await startServer(t, { turns: [longTurn()], dispatch: longAnswerStub });
  await seedLongThread(url);
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  await page.locator('.source-badge').waitFor();

  const before = await shell(page);
  assert.ok(before.header && before.sidebar && before.document && before.thread && before.composer);
  assert.ok(before.pageScrollHeight <= before.viewport.height, `the page itself has nothing to scroll: ${before.pageScrollHeight} vs ${before.viewport.height}`);
  assert.ok(before.pageScrollWidth <= before.viewport.width);
  assert.equal(before.header.y, 0, 'the header is at the top');
  near(before.sidebar.y + before.sidebar.height, before.viewport.height, 'the sidebar runs the full height');
  near(before.composer.x + before.composer.width, before.document.x + before.document.width - 16, 'the composer sits 16px from the document pane\'s right edge');
  near(before.composer.y + before.composer.height, before.document.y + before.document.height - 16, 'and 16px from its bottom');

  const scrolled = await page.evaluate(() => {
    const documentPane = /** @type {HTMLElement} */ (document.querySelector('.document-pane'));
    const exchanges = /** @type {HTMLElement} */ (document.querySelector('.exchanges'));
    documentPane.scrollTop = documentPane.scrollHeight;
    exchanges.scrollTop = exchanges.scrollHeight;
    return { document: documentPane.scrollTop, thread: exchanges.scrollTop };
  });
  assert.ok(scrolled.document > 400, `the document pane scrolled on its own: ${scrolled.document}`);
  assert.ok(scrolled.thread > 100, `the exchanges scrolled on their own: ${scrolled.thread}`);

  const after = await shell(page);
  assert.deepEqual(after.header, before.header, 'the header has not moved');
  assert.deepEqual(after.composer, before.composer, 'the composer has not moved');
  const lastLine = await page.evaluate(() => document.getElementById('document')?.getBoundingClientRect().bottom ?? Infinity);
  assert.ok(after.composer && lastLine <= after.composer.y, `the document's last line clears the composer's bar: ${lastLine} vs ${after.composer?.y}`);
  assert.deepEqual(after.sidebar, before.sidebar, 'the sidebar has not moved');
  assert.deepEqual(after.thread, before.thread, 'the thread pane has not moved');
  assert.equal(after.pageScrollY, 0);
  assert.ok(after.pageScrollHeight <= after.viewport.height);
  assert.deepEqual(consoleErrors, [], 'no console error, the favicon included');
});

test('3.2 the open composer caps its height and scrolls its entries, with the text box still in view', async (t) => {
  const { url } = await startServer(t);
  for (let index = 0; index < 30; index += 1) {
    await fetch(new URL('/api/sessions/session-1/carry-back', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `Conclusion number ${index + 1}, kept for the terminal.` }),
    });
  }
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  await page.locator('.carry-back-entry').nth(29).waitFor({ state: 'attached' });
  await page.locator('#composer-bar').click();

  const pane = await page.locator('.document-pane').boundingBox();
  const composer = await page.locator('.composer').boundingBox();
  assert.ok(pane && composer);
  assert.ok(composer.height <= pane.height * 0.5 + 1, `the composer stops at half the pane: ${composer.height}`);
  const list = await page.locator('.carry-back-list').evaluate((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }));
  assert.ok(list.scrollHeight > list.clientHeight + 100, 'the entries scroll inside it');
  for (const selector of ['#carry-back-title', '#carry-back-text']) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box && box.y >= composer.y && box.y + box.height <= composer.y + composer.height + 1, `${selector} stays in view`);
  }
  const page_ = await shell(page);
  assert.ok(page_.pageScrollHeight <= page_.viewport.height, 'and the page still does not scroll');
  assert.deepEqual(consoleErrors, []);
});

test('3.3 the ask popover sits under its selection after the document pane has scrolled', async (t) => {
  const { url } = await startServer(t, { turns: [longTurn()] });
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);

  await page.locator('#document p', { hasText: 'Paragraph 40 of' }).scrollIntoViewIfNeeded();
  const scrollTop = await page.locator('.document-pane').evaluate((node) => node.scrollTop);
  assert.ok(scrollTop > 500, `the document pane is scrolled: ${scrollTop}`);
  assert.equal(await page.evaluate(() => scrollY), 0, 'the page is not');

  await dragSelect(page, 'Paragraph 40 of');
  const popover = page.locator('#ask-popover');
  await popover.waitFor({ state: 'visible' });
  // The question box has focus by now, so measure the passage itself rather than the live selection.
  const selectionBottom = await page.evaluate(() => {
    const paragraph = [...document.querySelectorAll('#document p')].find((node) => node.textContent?.startsWith('Paragraph 40 of'));
    const range = document.createRange();
    range.setStart(/** @type {Node} */ (paragraph?.firstChild), 0);
    range.setEnd(/** @type {Node} */ (paragraph?.firstChild), 'Paragraph 40 of'.length);
    return range.getBoundingClientRect().bottom;
  });
  const box = await popover.boundingBox();
  assert.ok(box);
  assert.ok(box.y >= selectionBottom && box.y <= selectionBottom + 12, `the popover opens just under the selection: ${box.y} vs ${selectionBottom}`);
  assert.ok(box.y + box.height <= 800, 'and within the window');

  await page.locator('.document-pane').evaluate((node) => {
    node.scrollTop -= 100;
  });
  const moved = await popover.boundingBox();
  assert.ok(moved);
  near(moved.y, box.y + 100, 'the popover travels with the passage when the pane scrolls');
  assert.deepEqual(consoleErrors, []);
});

test('4.1 dragging the handles resizes the panes, stops at the minimums, and the document starts two fifths wider than the thread pane', async (t) => {
  const { url } = await startServer(t);
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);

  const start = await widths(page);
  assert.equal(start.sidebar, SIDEBAR_DEFAULT);
  assert.ok(Math.abs(start.document - start.thread * 1.4) <= 2, `seven to five before any drag: ${start.document} vs ${start.thread}`);
  near(start.sidebar + HANDLE + start.document + HANDLE + start.thread, 1200, 'the three panes and two handles fill the window');

  await dragHandle(page, '#thread-handle', -120);
  let now = await widths(page);
  near(now.thread, start.thread + 120, 'the thread pane widens by the drag');
  near(now.document, start.document - 120, 'the document gives the same amount');
  assert.equal(now.sidebar, start.sidebar, 'the sidebar is untouched');

  await dragHandle(page, '#sidebar-handle', 30);
  const afterSidebar = await widths(page);
  near(afterSidebar.sidebar, start.sidebar + 30, 'the sidebar widens by the drag');
  near(afterSidebar.document, now.document - 30, 'the document gives the same amount');
  near(afterSidebar.thread, now.thread, 'the thread pane is untouched');

  await dragHandle(page, '#sidebar-handle', 200);
  const squeezed = await widths(page);
  assert.equal(squeezed.sidebar, SIDEBAR_MAX, 'the sidebar widens to its maximum');
  assert.equal(squeezed.document, DOCUMENT_MIN, 'the document stops at its minimum');
  assert.equal(squeezed.thread, 1200 - SIDEBAR_MAX - DOCUMENT_MIN - 2 * HANDLE, 'and the thread pane gives way instead');

  await dragHandle(page, '#sidebar-handle', -1000);
  now = await widths(page);
  assert.equal(now.sidebar, SIDEBAR_MIN, 'the sidebar stops at its minimum');
  await dragHandle(page, '#thread-handle', 2000);
  now = await widths(page);
  assert.equal(now.thread, THREAD_MIN, 'the thread pane stops at its minimum');
  await dragHandle(page, '#thread-handle', -2000);
  now = await widths(page);
  assert.equal(now.document, DOCUMENT_MIN, 'the document never shrinks below its minimum');
  near(now.sidebar + HANDLE + now.document + HANDLE + now.thread, 1200, 'and everything still fits');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'with no horizontal scroll');
  assert.deepEqual(consoleErrors, []);
});

test('4.2 the handles answer the keyboard, and a double activation restores the default', async (t) => {
  const { url } = await startServer(t);
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  const start = await widths(page);

  const sidebarHandle = page.locator('#sidebar-handle');
  assert.equal(await sidebarHandle.getAttribute('role'), 'separator');
  assert.equal(await sidebarHandle.getAttribute('aria-orientation'), 'vertical');
  await sidebarHandle.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal((await widths(page)).sidebar, SIDEBAR_DEFAULT + 32, 'two steps right');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await widths(page)).sidebar, SIDEBAR_DEFAULT + 16, 'one step back');
  assert.equal(await sidebarHandle.getAttribute('aria-valuenow'), String(SIDEBAR_DEFAULT + 16));
  await page.keyboard.press('Home');
  assert.equal((await widths(page)).sidebar, SIDEBAR_MIN);
  await page.keyboard.press('End');
  assert.equal((await widths(page)).sidebar, SIDEBAR_MAX);
  await sidebarHandle.dblclick();
  assert.equal((await widths(page)).sidebar, SIDEBAR_DEFAULT, 'a double activation restores the default');

  const threadHandle = page.locator('#thread-handle');
  await threadHandle.focus();
  await page.keyboard.press('ArrowLeft');
  near((await widths(page)).thread, start.thread + 16, 'left widens the thread pane');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  near((await widths(page)).thread, start.thread - 16, 'right narrows it');
  await page.keyboard.press('Home');
  assert.equal((await widths(page)).thread, THREAD_MIN);
  await page.keyboard.press('End');
  assert.equal((await widths(page)).document, DOCUMENT_MIN, 'End takes all the document can give');
  await threadHandle.dblclick();
  const reset = await widths(page);
  assert.ok(Math.abs(reset.document - reset.thread * 1.4) <= 2, `a double activation restores the seven-to-five split: ${reset.document} vs ${reset.thread}`);
  assert.deepEqual(consoleErrors, []);
});

test('4.3 the toggle hides the sidebar and shows it again, and following continues while it is hidden', async (t) => {
  const turns = [
    sampleTurn({ promptId: 'a1', sessionId: 'sess-a', receivedAt: '2026-01-01T00:00:00.000Z', message: 'A one.' }),
    sampleTurn({ promptId: 'a2', sessionId: 'sess-a', receivedAt: '2026-01-01T01:00:00.000Z', message: 'A two, the newest.' }),
  ];
  const { url, store } = await startServer(t, { turns });
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL(`/projects/${PROJECT}`, url).href);
  const toggle = page.locator('#sidebar-toggle');
  assert.equal(await toggle.getAttribute('aria-label'), 'Hide sidebar');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  const shown = await widths(page);

  await toggle.click();
  assert.equal((await widths(page)).sidebar, RAIL, 'the sidebar collapses to a rail');
  assert.equal(await page.locator('.sidebar-scroll').isVisible(), false, 'the sessions are gone');
  assert.equal(await page.locator('#sidebar-handle').isVisible(), false, 'and so is the handle');
  assert.equal(await toggle.getAttribute('aria-label'), 'Show sidebar');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  const hidden = await widths(page);
  near(hidden.document + hidden.thread, shown.document + shown.thread + shown.sidebar + HANDLE - RAIL, 'the document and thread pane take the freed width');
  near((await shell(page)).document?.x ?? -1, RAIL, 'the document now starts beside the rail');
  const toggleBox = await toggle.boundingBox();

  await arrive(store, sampleTurn({ promptId: 'a3', sessionId: 'sess-a', receivedAt: '2026-01-01T02:00:00.000Z', message: 'A three, arriving hidden.' }));
  await page.locator('#document', { hasText: 'A three, arriving hidden.' }).waitFor({ timeout: 5_000 });
  assert.equal((await widths(page)).sidebar, RAIL, 'the new turn shows and the sidebar stays a rail through the reload');
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-sidebar-hidden')), true);
  assert.deepEqual(await toggle.boundingBox(), toggleBox, 'the toggle has not moved');

  await toggle.click();
  assert.equal(await page.locator('.sidebar-scroll').isVisible(), true);
  assert.equal((await widths(page)).sidebar, SIDEBAR_DEFAULT, 'back at the width it had');
  assert.equal(await toggle.getAttribute('aria-label'), 'Hide sidebar');
  const active = page.locator('.turn-row[data-active]');
  assert.equal(await active.getAttribute('data-prompt-id'), 'a3');
  assert.equal(await active.isVisible(), true, 'with the turn on screen marked');
  assert.deepEqual(consoleErrors, []);
});

test('4.4 a smaller window clamps the panes without writing the clamped widths back', async (t) => {
  const { url } = await startServer(t);
  const { page, consoleErrors } = await openBrowser(t, { width: 1440, height: 900 });
  await seedLayout(page, { sidebarWidth: 480, threadWidth: 600, sidebarHidden: false });
  await page.goto(new URL('/turns/prompt-1', url).href);
  assert.deepEqual(await widths(page), { sidebar: 480, document: 1440 - 480 - 600 - 2 * HANDLE, thread: 600 });

  await resizeWindow(page, 900, 800);
  const squeezed = await widths(page);
  assert.equal(squeezed.thread, THREAD_MIN, 'the thread pane gives way first');
  assert.equal(squeezed.document, DOCUMENT_MIN, 'the document keeps its minimum');
  assert.equal(squeezed.sidebar, 900 - DOCUMENT_MIN - THREAD_MIN - 2 * HANDLE, 'then the sidebar takes what is left');
  const state = await shell(page);
  assert.ok(state.pageScrollWidth <= 900 && state.pageScrollHeight <= 800, 'no page scroll');
  for (const pane of [state.sidebar, state.document, state.thread]) assert.ok(pane && pane.x >= 0 && pane.x + pane.width <= 900 + 1, 'every pane is in view');

  await resizeWindow(page, 1440, 900);
  assert.deepEqual(await widths(page), { sidebar: 480, document: 1440 - 480 - 600 - 2 * HANDLE, thread: 600 }, 'the set widths come back');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sidescreen:layout') ?? 'null')), { sidebarWidth: 480, threadWidth: 600, sidebarHidden: false }, 'nothing was written back');
  assert.deepEqual(consoleErrors, []);
});

test('5.1 the blocking script applies the stored layout before any module runs', async (t) => {
  const { url } = await startServer(t);
  {
    const { page } = await openBrowser(t, { width: 1200, height: 800 });
    await seedLayout(page, { sidebarWidth: 320, threadWidth: 400, sidebarHidden: false });
    await page.route('**/assets/workspace.js', (route) => route.abort());
    await page.goto(new URL('/turns/prompt-1', url).href);
    assert.deepEqual(await widths(page), { sidebar: 320, document: 1200 - 320 - 400 - 2 * HANDLE, thread: 400 }, 'with the module blocked, the widths are the stored ones');
  }
  {
    const { page } = await openBrowser(t, { width: 1200, height: 800 });
    await seedLayout(page, { sidebarWidth: 320, threadWidth: null, sidebarHidden: true });
    await page.route('**/assets/workspace.js', (route) => route.abort());
    await page.goto(new URL('/turns/prompt-1', url).href);
    assert.equal((await widths(page)).sidebar, RAIL, 'a rail before any module runs');
    near((await shell(page)).document?.x ?? -1, RAIL, 'and the document starts beside it');
  }
});

test('5.2 the layout survives a reload, applies to another project in the same browser, and does without storage', async (t) => {
  const turns = [sampleTurn(), sampleTurn({ promptId: 'o1', sessionId: 'sess-o', cwd: '/Users/example/other', message: 'Other project.' })];
  const { url } = await startServer(t, { turns });
  {
    const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
    await page.goto(new URL('/turns/prompt-1', url).href);
    await dragHandle(page, '#thread-handle', -100);
    await page.locator('#sidebar-toggle').click();
    const set = await widths(page);
    assert.equal(set.sidebar, RAIL);

    await page.reload();
    assert.deepEqual(await widths(page), set, 'the same after a reload');
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-pressed'), 'true');

    await page.goto(new URL(turnHref(turns[1]), url).href);
    assert.deepEqual(await widths(page), set, 'and in another project');
    const record = await page.evaluate(() => JSON.parse(localStorage.getItem('sidescreen:layout') ?? 'null'));
    assert.equal(record.version, 1);
    assert.equal(record.sidebarHidden, true);
    assert.equal(record.threadWidth, set.thread);
    assert.deepEqual(consoleErrors, []);
  }
  {
    const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('storage is blocked');
        },
      });
    });
    await page.goto(new URL('/turns/prompt-1', url).href);
    const start = await widths(page);
    assert.equal(start.sidebar, SIDEBAR_DEFAULT, 'defaults without storage');
    assert.ok(Math.abs(start.document - start.thread * 1.4) <= 2, `seven to five without storage: ${start.document} vs ${start.thread}`);
    await dragHandle(page, '#thread-handle', -100);
    near((await widths(page)).thread, start.thread + 100, 'resizing still works for the life of the page');
    await page.locator('#sidebar-toggle').click();
    assert.equal((await widths(page)).sidebar, RAIL, 'so does hiding');
    assert.deepEqual(consoleErrors, [], 'and nothing is logged about it');
  }
});

test('3.1 the empty workspace is the same shell with three columns: the sidebar still resizes and hides', async (t) => {
  const { url, stateDir } = await startServer(t, { turns: [] });
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL(`/projects/${projectId(stateDir)}`, url).href);
  await page.locator('.workspace-empty').waitFor();
  assert.equal(await page.locator('#thread-handle').count(), 0, 'no thread pane, no handle for it');
  assert.equal(await page.locator('.composer').count(), 0);
  const state = await shell(page);
  assert.ok(state.pageScrollHeight <= state.viewport.height, 'no page scroll');
  near((state.sidebar?.width ?? 0) + HANDLE + (state.document?.width ?? 0), 1200, 'the sidebar, its handle, and the document fill the window');

  await dragHandle(page, '#sidebar-handle', 100);
  assert.equal((await widths(page)).sidebar, SIDEBAR_DEFAULT + 100);
  await page.locator('#sidebar-toggle').click();
  assert.equal((await widths(page)).sidebar, RAIL);
  near((await shell(page)).document?.x ?? -1, RAIL, 'the document takes everything beside the rail');
  assert.deepEqual(consoleErrors, []);
});

test('2.1 the header centres the project name, truncates a long path, and takes focus in order with a visible ring', async (t) => {
  const deep = `/Users/example/${'a-rather-deep-directory/'.repeat(8)}proj`;
  const turn = sampleTurn({ cwd: deep, sessionId: 'sess-deep' });
  const { url } = await startServer(t, { turns: [turn] });
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL(turnHref(turn), url).href);

  for (const width of [1200, 1440]) {
    await resizeWindow(page, width, 800);
    const centre = await page.locator('.topbar-center').boundingBox();
    assert.ok(centre);
    near(centre.x + centre.width / 2, width / 2, `the name and its tag are centred at ${width}`);
    const path = await page.locator('.topbar-path').evaluate((node) => ({ text: node.textContent, title: node.getAttribute('title'), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, height: node.getBoundingClientRect().height, overflow: getComputedStyle(node).textOverflow }));
    assert.equal(path.text, deep);
    assert.equal(path.title, deep, 'the full path is in the tooltip');
    assert.ok(path.scrollWidth > path.clientWidth, 'the path is longer than its column');
    assert.ok(path.height < 24, 'and does not wrap');
    assert.equal(path.overflow, 'ellipsis');
  }
  const header = await page.locator('.topbar').boundingBox();
  assert.ok(header && header.y === 0);

  // The browser starts tabbing from the turn the sidebar scrolled into view, so begin from the header: onto the title, then back one.
  await page.locator('.brand').focus();
  await page.keyboard.press('Shift+Tab');
  for (const expected of ['topbar-back', 'brand', 'topbar-scope']) {
    const focused = await page.evaluate(() => {
      const element = /** @type {HTMLElement} */ (document.activeElement);
      const style = getComputedStyle(element);
      return { className: element.className, outlineStyle: style.outlineStyle, outlineColor: style.outlineColor };
    });
    assert.ok(focused.className.split(' ').includes(expected), `focus reaches ${expected}, got ${focused.className}`);
    assert.equal(focused.outlineStyle, 'solid', `${expected} shows a focus ring`);
    assert.equal(focused.outlineColor, ACCENT, `${expected}'s ring is the accent`);
    await page.keyboard.press('Tab');
  }
  assert.deepEqual(consoleErrors, []);
});
