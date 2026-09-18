/**
 * The project workspace in a real browser: the sidebar, following the newest
 * turn, collapse state, and removing turns in two clicks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dragSelect, openBrowser } from '../browser-helpers.js';
import { sampleTurn, startServer, turnHref, waitForAnswer } from '../server-helpers.js';
import { tempDir } from '../helpers.js';
import { projectId } from '../../src/store/projects.js';
import { upsertSession } from '../../src/store/sessions.js';

/** @type {import('../../src/web/server.js').Dispatch} */
const answeringStub = async ({ exchange }) => ({
  ok: true,
  answer: { text: `Answer to ${exchange.question}`, source: 'code', sourceDetail: 'src/x.js:1' },
  subAgentSessionId: 'sub-1',
});

const CWD = '/Users/example/proj';
const PROJECT = projectId(CWD);

/** Two sessions in one project, interleaved in time, plus a turn from another project. */
function twoSessions() {
  return [
    sampleTurn({ promptId: 'a1', sessionId: 'sess-a', receivedAt: '2026-01-01T00:00:00.000Z', message: 'A one: the quick brown fox jumps over the lazy dog.' }),
    sampleTurn({ promptId: 'b1', sessionId: 'sess-b', receivedAt: '2026-01-01T00:30:00.000Z', message: 'B one.' }),
    sampleTurn({ promptId: 'a2', sessionId: 'sess-a', receivedAt: '2026-01-01T01:00:00.000Z', message: 'A two.' }),
    sampleTurn({ promptId: 'b2', sessionId: 'sess-b', receivedAt: '2026-01-01T01:30:00.000Z', message: 'B two, the newest of all.' }),
    sampleTurn({ promptId: 'o1', sessionId: 'sess-o', cwd: '/Users/example/other', receivedAt: '2026-01-02T00:00:00.000Z', message: 'Other project entirely.' }),
  ];
}

/**
 * Ingest a turn while a page is open, the way the Stop hook would: a store
 * write from outside the server, which the watcher turns into an event.
 *
 * @param {import('../../src/store/store.js').Store} store
 * @param {import('../../src/types.js').Turn} turn
 * @param {string|null} [title]
 */
async function arrive(store, turn, title = null) {
  await store.update((state) => {
    state.turns[turn.promptId] = turn;
    upsertSession(state, turn, title);
  });
}

/** @param {import('playwright').Page} page */
const mark = (page) => page.evaluate(() => document.documentElement.setAttribute('data-test-marker', 'set'));
/** @param {import('playwright').Page} page */
const marked = (page) => page.evaluate(() => document.documentElement.getAttribute('data-test-marker') === 'set');

test('5.1 the sidebar keeps two concurrent sessions apart, shows only this project, and marks the turn on screen', async (t) => {
  const { url, store } = await startServer(t, { turns: twoSessions() });
  await store.update((state) => {
    state.sessions['sess-b'].title = 'Carry-back feature testing';
  });
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(`/projects/${PROJECT}`, url).href);

  assert.equal(await page.locator('.topbar-project').textContent(), 'proj');
  assert.equal(await page.locator('.topbar-path').textContent(), CWD);
  assert.equal(await page.locator('.topbar-scope').textContent(), 'following the project');
  assert.match((await page.locator('#document').textContent()) ?? '', /B two, the newest of all/, 'the project address shows the newest turn of any session');

  const sessions = page.locator('.session');
  assert.equal(await sessions.count(), 2);
  assert.deepEqual(await sessions.locator('.session-title').allTextContents(), ['Carry-back feature testing', (await sessions.nth(1).locator('.session-title').textContent()) ?? '']);
  assert.equal(await sessions.nth(1).locator('.session-title').getAttribute('data-untitled'), '', 'an untitled session is labelled by its start time');
  assert.deepEqual(await sessions.nth(0).locator('.turn-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-prompt-id'))), ['b2', 'b1']);
  assert.deepEqual(await sessions.nth(1).locator('.turn-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-prompt-id'))), ['a2', 'a1']);
  assert.deepEqual(await sessions.locator('.session-count').allTextContents(), ['2 turns', '2 turns']);
  assert.equal(await page.locator('#sidebar').textContent().then((text) => /Other project/.test(text ?? '')), false, 'the other project is absent');

  const active = page.locator('.turn-row[data-active]');
  assert.equal(await active.count(), 1);
  assert.equal(await active.getAttribute('data-prompt-id'), 'b2');
  assert.equal(await active.locator('.turn-link').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('.topbar-scope').evaluate((node) => node.tagName), 'SPAN', 'following the project: the scope tag is a label, not a control');
  assert.equal(await page.locator('.sidebar-latest').count(), 0, 'the sidebar holds sessions and turns only');

  await page.locator('.turn-row[data-prompt-id="a1"] .turn-link').click();
  await page.waitForURL(new URL(turnHref(twoSessions()[0]), url).href);
  assert.equal(await page.locator('.topbar-scope').textContent(), 'pinned turn');
  assert.match((await page.locator('#document').textContent()) ?? '', /A one/);
  assert.equal(await page.locator('.turn-row[data-active]').getAttribute('data-prompt-id'), 'a1');
  assert.equal(await page.locator('.topbar-scope').getAttribute('href'), `/projects/${PROJECT}`, 'pinned: the scope tag is the way back to following');
  assert.deepEqual(consoleErrors, []);
});

test('4.1 a turn ingested while a pinned page is open appears in the sidebar without a reload, with a notice naming its session', async (t) => {
  const turns = twoSessions();
  const { url, store } = await startServer(t, { turns });
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(turnHref(turns[0]), url).href);
  await mark(page);

  const fresh = sampleTurn({ promptId: 'b3', sessionId: 'sess-b', receivedAt: '2026-01-01T02:00:00.000Z', message: 'B three, just in.' });
  await arrive(store, fresh, 'Carry-back feature testing');
  await page.locator('.turn-row[data-prompt-id="b3"]').waitFor({ timeout: 5_000 });
  assert.equal(await marked(page), true, 'the page did not reload');
  assert.match((await page.locator('#document').textContent()) ?? '', /A one/, 'the pinned turn stays on screen');

  const notice = page.locator('#follow-notice');
  await notice.waitFor({ state: 'visible' });
  assert.match((await notice.textContent()) ?? '', /New turn in Carry-back feature testing/);
  assert.equal(await notice.locator('.follow-notice-link').getAttribute('href'), turnHref(fresh));
  assert.deepEqual(await page.locator('.session').first().locator('.turn-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-prompt-id'))), ['b3', 'b2', 'b1']);
  assert.equal(await page.locator('.session').first().locator('.session-title').textContent(), 'Carry-back feature testing', 'the title that arrived with the turn is shown');

  await notice.locator('.follow-notice-dismiss').click();
  assert.equal(await notice.isVisible(), false);
  assert.deepEqual(consoleErrors, []);
});

test('4.2 following the project while idle shows a new turn from any session as it arrives', async (t) => {
  const { url, store } = await startServer(t, { turns: twoSessions() });
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(`/projects/${PROJECT}`, url).href);
  await mark(page);

  await arrive(store, sampleTurn({ promptId: 'a3', sessionId: 'sess-a', receivedAt: '2026-01-01T03:00:00.000Z', message: 'A three, brand new.' }));
  await page.locator('#document', { hasText: 'A three, brand new.' }).waitFor({ timeout: 5_000 });
  assert.equal(await marked(page), false, 'the page reloaded in place');
  assert.equal(page.url(), new URL(`/projects/${PROJECT}`, url).href, 'at the same address');
  assert.equal(await page.locator('.turn-row[data-active]').getAttribute('data-prompt-id'), 'a3');
  assert.deepEqual(consoleErrors, []);
});

test('4.2 following with the ask popover open keeps the current turn and offers the new one instead', async (t) => {
  const turns = twoSessions();
  const { url, store } = await startServer(t, { turns, dispatch: answeringStub });
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(`/projects/${PROJECT}`, url).href);
  await dragSelect(page, 'newest of all');
  await page.locator('#ask-popover').waitFor({ state: 'visible' });
  await page.locator('#ask-question').fill('Why the newest?');
  await mark(page);

  await arrive(store, sampleTurn({ promptId: 'a3', sessionId: 'sess-a', receivedAt: '2026-01-01T03:00:00.000Z', message: 'A three, while asking.' }));
  await page.locator('#follow-notice').waitFor({ state: 'visible', timeout: 5_000 });
  assert.equal(await marked(page), true, 'no reload while the popover is open');
  assert.equal(await page.locator('#ask-popover').isVisible(), true);
  assert.equal(await page.locator('#ask-question').inputValue(), 'Why the newest?', 'the typed question is intact');
  assert.match((await page.locator('#document').textContent()) ?? '', /B two/);
  assert.equal(await page.locator('#follow-notice .follow-notice-link').getAttribute('href'), `/projects/${PROJECT}`, 'viewing it means following again');
  assert.deepEqual(consoleErrors, []);
});

test('4.2 following one session ignores another session\'s turn except for the notice, and follows its own', async (t) => {
  const { url, store } = await startServer(t, { turns: twoSessions() });
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(`/projects/${PROJECT}/sessions/sess-a`, url).href);
  assert.match((await page.locator('#document').textContent()) ?? '', /A two/);
  assert.equal(await page.locator('.topbar-scope').textContent(), 'following this session');
  const sessionA = page.locator('.session[data-session-id="sess-a"]');
  assert.equal(await sessionA.getAttribute('data-followed'), '', 'the followed session is marked');
  await sessionA.hover();
  await sessionA.locator('.session-menu-button').click();
  assert.equal(await page.locator('.session-menu [role="menuitemcheckbox"]').getAttribute('aria-checked'), 'true', 'and its menu says it is followed');
  await page.keyboard.press('Escape');
  await page.locator('.session-menu').waitFor({ state: 'detached' });
  await mark(page);

  await arrive(store, sampleTurn({ promptId: 'b3', sessionId: 'sess-b', receivedAt: '2026-01-01T02:00:00.000Z', message: 'B three, elsewhere.' }));
  await page.locator('#follow-notice').waitFor({ state: 'visible', timeout: 5_000 });
  assert.equal(await marked(page), true, 'a turn in another session does not reload the page');
  assert.match((await page.locator('#document').textContent()) ?? '', /A two/);

  await arrive(store, sampleTurn({ promptId: 'a3', sessionId: 'sess-a', receivedAt: '2026-01-01T03:00:00.000Z', message: 'A three, followed.' }));
  await page.locator('#document', { hasText: 'A three, followed.' }).waitFor({ timeout: 5_000 });
  assert.equal(await marked(page), false, 'a turn in the followed session replaces the page');
  assert.equal(page.url(), new URL(`/projects/${PROJECT}/sessions/sess-a`, url).href);

  assert.equal(await page.locator('.topbar-scope').getAttribute('href'), `/projects/${PROJECT}`, 'following one session: the scope tag offers the project');
  await page.locator('.topbar-scope').click();
  await page.waitForURL(new URL(`/projects/${PROJECT}`, url).href);
  assert.match((await page.locator('#document').textContent()) ?? '', /A three, followed/, 'the scope tag returns to following the project, whose newest turn this is');
  assert.equal(await page.locator('.topbar-scope').evaluate((node) => node.tagName), 'SPAN', 'and is a label again');
  assert.deepEqual(consoleErrors, []);
});

test('4.1 collapsing a session is remembered within the tab, and the session on screen is always expanded', async (t) => {
  const turns = twoSessions();
  const { url } = await startServer(t, { turns });
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(turnHref(turns[3]), url).href);

  const sessionA = page.locator('.session[data-session-id="sess-a"] details');
  const sessionB = page.locator('.session[data-session-id="sess-b"] details');
  assert.equal(await sessionA.evaluate((details) => /** @type {HTMLDetailsElement} */ (details).open), true);
  await page.locator('.session[data-session-id="sess-a"] summary').click();
  assert.equal(await sessionA.evaluate((details) => /** @type {HTMLDetailsElement} */ (details).open), false);
  assert.equal(await page.locator('.session[data-session-id="sess-a"] .turn-row').first().isVisible(), false, 'its turns are hidden');
  assert.equal(await page.locator('.session[data-session-id="sess-a"] .session-count').textContent(), '2 turns');

  await page.locator('.turn-row[data-prompt-id="b1"] .turn-link').click();
  await page.waitForURL(new URL(turnHref(turns[1]), url).href);
  assert.equal(await sessionA.evaluate((details) => /** @type {HTMLDetailsElement} */ (details).open), false, 'still collapsed after navigating');
  assert.equal(await sessionB.evaluate((details) => /** @type {HTMLDetailsElement} */ (details).open), true);

  await page.goto(new URL(turnHref(turns[0]), url).href);
  assert.equal(await sessionA.evaluate((details) => /** @type {HTMLDetailsElement} */ (details).open), true, 'the session of the turn on screen is expanded regardless');
  assert.deepEqual(consoleErrors, []);
});

test('4.3 removing a turn takes two clicks, names its threads, cancels on Escape or leaving, and is keyboard reachable', async (t) => {
  const turns = twoSessions();
  const { url, store } = await startServer(t, { turns, dispatch: answeringStub });
  for (const question of ['one', 'two', 'three']) {
    const response = await fetch(new URL('/api/turns/b1/threads', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anchor: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 1 }, text: 'B' }, selectedText: 'B', question }),
    });
    const { thread } = await response.json();
    await waitForAnswer(url, thread.id);
  }
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(turnHref(turns[3]), url).href);

  const row = page.locator('.turn-row[data-prompt-id="b1"]');
  const button = row.locator('.turn-remove');
  assert.equal(await row.locator('.turn-threads').textContent(), '3');
  assert.equal(await button.evaluate((node) => getComputedStyle(node).visibility), 'hidden', 'hidden until the row is hovered');
  await row.hover();
  assert.equal(await button.evaluate((node) => getComputedStyle(node).visibility), 'visible');
  assert.equal(await button.getAttribute('aria-label'), 'Remove this turn');

  // First click arms and names what goes. Escape cancels.
  await button.click();
  assert.equal(await row.getAttribute('data-armed'), '');
  assert.equal(await button.textContent(), 'Remove turn and 3 threads?');
  assert.equal((await fetch(new URL('/api/turns/b1', url))).status, 200, 'nothing removed yet');
  await page.keyboard.press('Escape');
  assert.equal(await row.getAttribute('data-armed'), null);
  assert.equal(await button.textContent(), '×');

  // Arm again; moving the pointer off the row cancels.
  await row.hover();
  await button.click();
  assert.equal(await row.getAttribute('data-armed'), '');
  await page.locator('#document').hover();
  assert.equal(await row.getAttribute('data-armed'), null);
  assert.equal((await fetch(new URL('/api/turns/b1', url))).status, 200);

  // A turn without threads says so.
  const plain = page.locator('.turn-row[data-prompt-id="a1"]');
  await plain.hover();
  await plain.locator('.turn-remove').click();
  assert.equal(await plain.locator('.turn-remove').textContent(), 'Remove turn?');
  await page.keyboard.press('Escape');

  // Keyboard: tabbing from the link reaches the control, which becomes visible.
  await row.locator('.turn-link').focus();
  await page.keyboard.press('Tab');
  assert.equal(await button.evaluate((node) => document.activeElement === node), true);
  assert.equal(await button.evaluate((node) => getComputedStyle(node).visibility), 'visible');
  await page.keyboard.press('Escape');

  // Two clicks remove the turn and its threads.
  await row.hover();
  await button.click();
  await button.click();
  await row.waitFor({ state: 'detached', timeout: 5_000 });
  assert.equal((await fetch(new URL('/api/turns/b1', url))).status, 404);
  assert.equal((await fetch(new URL(turnHref(turns[1]), url))).status, 404, 'its address answers not found');
  const state = await store.read();
  assert.equal(Object.values(state.threads).filter((thread) => thread.promptId === 'b1').length, 0, 'its threads are gone');
  assert.equal(await page.locator('.session[data-session-id="sess-b"] .session-count').textContent(), '1 turn');
  assert.match((await page.locator('#document').textContent()) ?? '', /B two/, 'the turn on screen is untouched');
  assert.equal(page.url(), new URL(turnHref(turns[3]), url).href);
  assert.deepEqual(consoleErrors, []);
});

test('5.4 removing the past turn on screen moves to the project\'s follow address; a session\'s newest turn offers no remove control until a newer turn arrives', async (t) => {
  const turns = twoSessions();
  const { url, store } = await startServer(t, { turns });
  await fetch(new URL('/api/sessions/sess-b/carry-back', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Keep this conclusion.' }),
  });
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(turnHref(turns[1]), url).href);
  assert.equal(await page.locator('.carry-back-entry').count(), 1);

  const newest = page.locator('.turn-row[data-prompt-id="b2"]');
  await newest.hover();
  assert.equal(await newest.locator('.turn-remove').count(), 0, 'the newest turn of a session has no remove control');
  const olderInA = page.locator('.turn-row[data-prompt-id="a1"]');
  await olderInA.hover();
  assert.equal(await olderInA.locator('.turn-remove').count(), 1, 'an older turn does');

  const row = page.locator('.turn-row[data-prompt-id="b1"]');
  await row.hover();
  await row.locator('.turn-remove').click();
  await row.locator('.turn-remove').click();
  await page.waitForURL(new URL(`/projects/${PROJECT}`, url).href);
  assert.match((await page.locator('#document').textContent()) ?? '', /B two/, 'the project\'s newest turn');
  assert.equal(await page.locator('.turn-row[data-prompt-id="b1"]').count(), 0);
  assert.equal(await page.locator('.session[data-session-id="sess-b"] .session-count').textContent(), '1 turn');
  assert.equal(await page.locator('.turn-row[data-prompt-id="b2"] .turn-remove').count(), 0, 'still the newest, still not removable');
  let state = await store.read();
  assert.ok(state.sessions['sess-b'], 'the session stays');
  assert.equal(state.carryBack['sess-b']?.length, 1, 'carry-back for the session survives');

  // A newer turn arrives: the previous newest becomes removable without a reload.
  await mark(page);
  await arrive(store, sampleTurn({ promptId: 'b3', sessionId: 'sess-b', receivedAt: '2026-01-01T02:00:00.000Z', message: 'B three, just in.' }));
  await page.locator('.turn-row[data-prompt-id="b3"]').waitFor({ timeout: 5_000 });
  await page.locator('.turn-row[data-prompt-id="b2"] .turn-remove').waitFor({ state: 'attached', timeout: 5_000 });
  assert.equal(await page.locator('.turn-row[data-prompt-id="b3"] .turn-remove').count(), 0, 'the new newest has none');
  // The project page follows the newest turn, so it reloaded to show b3; the sidebar state is what matters here.
  state = await store.read();
  assert.ok(state.turns.b2);
  assert.deepEqual(consoleErrors, []);
});

test('5.2 a version 1 store opens in the workspace with its threads and carry-back, and removal leaves carry-back alone', async (t) => {
  const stateDir = await tempDir(t, 'sidescreen-v1-');
  const anchor = { start: { path: [0], offset: 4 }, end: { path: [0], offset: 9 }, text: 'quick' };
  const turn = sampleTurn();
  const v1 = {
    version: 1,
    turns: { [turn.promptId]: turn, older: sampleTurn({ promptId: 'older', receivedAt: '2026-01-01T00:00:00.000Z', message: 'Older turn.' }) },
    threads: {
      th1: {
        id: 'th1',
        promptId: turn.promptId,
        sessionId: turn.sessionId,
        parentThreadId: null,
        branchedFromExchangeId: null,
        anchor,
        selectedText: 'quick',
        exchanges: [{ id: 'ex1', question: 'Why quick?', status: 'answered', answer: { text: 'Because.', source: 'code', sourceDetail: 'x.js:1' }, error: null, subAgentSessionId: 's1', askedAt: '2026-01-02T00:00:00.000Z', answeredAt: '2026-01-02T00:00:01.000Z' }],
        subAgentSessionId: 's1',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    },
    carryBack: { [turn.sessionId]: [{ id: 'cb1', text: 'Carried from before.', threadId: 'th1', addedAt: '2026-01-02T00:00:00.000Z', emittedAt: null }] },
  };
  await writeFile(join(stateDir, 'store.json'), JSON.stringify(v1, null, 2), 'utf8');
  const { url } = await startServer(t, { turns: [], stateDir });
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(`/projects/${PROJECT}`, url).href);

  assert.equal(await page.locator('.session').count(), 1);
  assert.deepEqual(await page.locator('.turn-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-prompt-id'))), [turn.promptId, 'older']);
  assert.equal(await page.locator('#document mark[data-sidescreen-mark]').count(), 1, 'the old thread is anchored');
  assert.equal(await page.locator('.thread .question').textContent(), 'Why quick?');
  assert.deepEqual(await page.locator('.carry-back-entry-text').allTextContents(), ['Carried from before.']);

  assert.equal(await page.locator(`.turn-row[data-prompt-id="${turn.promptId}"] .turn-remove`).count(), 0, 'the newest turn cannot be removed');
  assert.equal(await page.locator('.thread .answer-by').textContent(), 'CODEX answered:', 'an answer from before backends were recorded was Codex');
  const row = page.locator('.turn-row[data-prompt-id="older"]');
  await row.hover();
  await row.locator('.turn-remove').click();
  assert.equal(await row.locator('.turn-remove').textContent(), 'Remove turn?');
  await row.locator('.turn-remove').click();
  await row.waitFor({ state: 'detached', timeout: 5_000 });
  assert.equal(await page.locator('#document mark[data-sidescreen-mark]').count(), 1, 'the turn on screen and its thread are untouched');
  assert.deepEqual(await page.locator('.carry-back-entry-text').allTextContents(), ['Carried from before.'], 'carry-back is still owed to the terminal');
  assert.deepEqual(consoleErrors, []);
});

test('the landing page picks up a new project on its own', async (t) => {
  const { url, store } = await startServer(t, { turns: twoSessions() });
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(url);
  assert.deepEqual(await page.locator('.project-name').allTextContents(), ['other', 'proj']);
  await arrive(store, sampleTurn({ promptId: 'n1', sessionId: 'sess-n', cwd: '/Users/example/newest', receivedAt: '2026-02-01T00:00:00.000Z', message: 'First turn of a new project.' }));
  await page.locator('.project-name', { hasText: 'newest' }).waitFor({ timeout: 5_000 });
  assert.deepEqual(await page.locator('.project-name').allTextContents(), ['newest', 'other', 'proj']);
  await page.locator('.project-link', { hasText: 'newest' }).click();
  await page.waitForURL(new URL(`/projects/${projectId('/Users/example/newest')}`, url).href);
  assert.match((await page.locator('#document').textContent()) ?? '', /First turn of a new project/);
  assert.deepEqual(consoleErrors, []);
});
