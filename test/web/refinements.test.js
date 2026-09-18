/**
 * The second pass over the workspace in a real browser: colour scheme,
 * scrollbars and margins, the sidebar tree with its footer and menu, the
 * thread pane's pinned field, and the carry-back composer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragSelect, openBrowser } from '../browser-helpers.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { sampleTurn, startServer, turnHref, waitForAnswer } from '../server-helpers.js';
import { formatTime } from '../../src/format.js';
import { VERSION } from '../../src/version.js';
import { projectId } from '../../src/store/projects.js';

const LIGHT_BG = 'rgb(255, 255, 255)';
const DARK_BG = 'rgb(20, 22, 26)';
const TRANSPARENT_PAIR = 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)';
const ACCENT = 'rgb(36, 86, 214)';
const PROJECT = projectId('/Users/example/proj');

/**
 * @param {import('playwright').Page} page
 * @param {{ sidebarWidth?: number, threadWidth?: number|null, sidebarHidden?: boolean, theme?: string, composer?: string }} record
 */
function seedLayout(page, record) {
  return page.addInitScript((value) => {
    try {
      localStorage.setItem('sidescreen:layout', JSON.stringify(value));
    } catch {
      // Storage blocked: the page runs on defaults.
    }
  }, record);
}

/** @param {import('playwright').Page} page */
const bodyBackground = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

// ---- 2. Tokens, colour scheme, scrollbars, margins ------------------------------

test('2.1 a remembered dark scheme renders dark before any module runs, and no choice follows the system live', async (t) => {
  const { url } = await startServer(t);
  {
    const { page } = await openBrowser(t, { width: 1200, height: 800 });
    await page.emulateMedia({ colorScheme: 'light' });
    await seedLayout(page, { theme: 'dark' });
    await page.route('**/assets/workspace.js', (route) => route.abort());
    await page.goto(new URL('/turns/prompt-1', url).href);
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
    assert.equal(await bodyBackground(page), DARK_BG, 'dark on a light system, with the client module blocked');
  }
  {
    const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(new URL('/turns/prompt-1', url).href);
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-theme')), false, 'no choice, no attribute');
    assert.equal(await bodyBackground(page), DARK_BG, 'follows a dark system');
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await bodyBackground(page), LIGHT_BG, 'and follows the system as it changes');
    assert.deepEqual(consoleErrors, []);
  }
});

test('2.1 every colour token has a plain fallback declared right before its light-dark() value', async (t) => {
  const { url } = await startServer(t);
  const css = await (await fetch(new URL('/assets/app.css', url))).text();
  const lines = css.split('\n');
  const tokens = lines.map((line, index) => ({ line, index })).filter(({ line }) => /^\s*--[a-z-]+: light-dark\(/.test(line));
  assert.ok(tokens.length >= 15, `the palette is defined with light-dark(): ${tokens.length} tokens`);
  for (const { line, index } of tokens) {
    const name = /^\s*(--[a-z-]+):/.exec(line)?.[1];
    const previous = lines[index - 1] ?? '';
    assert.ok(name && previous.trim().startsWith(`${name}:`) && !previous.includes('light-dark('), `${name} has a plain fallback before it: "${previous.trim()}"`);
  }
  assert.match(css, /:root\s*\{\s*color-scheme: light dark;/);
  assert.match(css, /:root\[data-theme="dark"\]\s*\{\s*color-scheme: dark;\s*\}/);
  assert.match(css, /:root\[data-theme="light"\]\s*\{\s*color-scheme: light;\s*\}/);
  assert.doesNotMatch(css, /prefers-color-scheme/, 'the media query is gone; color-scheme decides');
});

test('2.2 scrollbars are thin and show their thumb on hover only, and the panes have their margins', async (t) => {
  const { url } = await startServer(t, { turns: [sampleTurn({ message: Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n') })] });
  await fetch(new URL('/api/turns/prompt-1/threads', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anchor: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 9 }, text: 'Paragraph' }, selectedText: 'Paragraph', question: 'q' }),
  });
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  await page.locator('.exchanges').waitFor();
  const styles = await page.evaluate(() =>
    ['.sidebar-scroll', '.document-pane', '.exchanges'].map((selector) => {
      const style = getComputedStyle(/** @type {Element} */ (document.querySelector(selector)));
      return { selector, scrollbarWidth: style.scrollbarWidth, scrollbarColor: style.scrollbarColor, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight };
    }),
  );
  for (const style of styles) {
    assert.equal(style.scrollbarWidth, 'thin', `${style.selector} has a thin scrollbar`);
    assert.equal(style.scrollbarColor, TRANSPARENT_PAIR, `${style.selector} hides the thumb at rest`);
  }
  assert.equal(styles[1].paddingLeft, '64px');
  assert.equal(styles[1].paddingRight, '64px');
  assert.equal(styles[2].paddingLeft, '40px');
  assert.equal(styles[2].paddingRight, '40px');

  await page.locator('.document-pane').hover({ position: { x: 20, y: 200 } });
  const hovered = await page.evaluate(() => getComputedStyle(/** @type {Element} */ (document.querySelector('.document-pane'))).scrollbarColor);
  assert.notEqual(hovered, TRANSPARENT_PAIR, 'the thumb appears under the pointer');
  assert.match(hovered, /0\.28\)/, 'in the translucent ink');
  assert.deepEqual(consoleErrors, []);
});

// ---- 3. Sidebar: tree, footer, rail, menu ------------------------------------------

/** @param {import('playwright').Page} page @param {string} selector */
const iconDisplays = (page, selector) => page.locator(`${selector} .session-marker .icon`).evaluateAll((icons) => icons.map((icon) => getComputedStyle(icon).display));

test('3.2 the sidebar is a tree: an icon and label per session, one-line bullets under a guide, a chevron and count when collapsed, start times when titles collide', async (t) => {
  const turns = [
    sampleTurn({ promptId: 'a1', sessionId: 'sess-a', receivedAt: '2026-01-01T00:00:00.000Z', message: 'A one.' }),
    sampleTurn({ promptId: 'a2', sessionId: 'sess-a', receivedAt: '2026-01-01T01:00:00.000Z', message: 'A two.' }),
    sampleTurn({ promptId: 'a3', sessionId: 'sess-a', receivedAt: '2026-01-01T02:00:00.000Z', message: 'A three, the newest of A.' }),
    sampleTurn({ promptId: 'b1', sessionId: 'sess-b', receivedAt: '2026-01-01T03:00:00.000Z', message: 'B one.' }),
    sampleTurn({ promptId: 'c1', sessionId: 'sess-c', receivedAt: '2026-01-01T04:00:00.000Z', message: 'C one.' }),
  ];
  const { url, store } = await startServer(t, { turns });
  await store.update((state) => {
    state.sessions['sess-a'].title = 'Same title';
    state.sessions['sess-b'].title = 'Same title';
    state.sessions['sess-c'].title = 'Another title';
  });
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL(turnHref(turns[2]), url).href);

  const sessionA = page.locator('.session[data-session-id="sess-a"]');
  assert.deepEqual(await iconDisplays(page, '.session[data-session-id="sess-a"]'), ['block', 'none', 'none'], 'expanded: the session icon shows, no chevron');
  const rows = sessionA.locator('.turn-row');
  assert.equal(await rows.count(), 3);
  for (let index = 0; index < 3; index += 1) {
    const box = await rows.nth(index).boundingBox();
    assert.ok(box && box.height <= 32, `turn row ${index} is one line: ${box?.height}px`);
  }
  const newest = rows.first().locator('.turn-link');
  assert.equal(await newest.locator('.turn-preview').textContent(), 'A three, the newest of A.');
  assert.equal(await newest.getAttribute('title'), formatTime(turns[2].receivedAt), 'the time is the tooltip');
  const timeBox = await newest.locator('.turn-time').boundingBox();
  assert.ok(timeBox && timeBox.width <= 1, 'and is not printed on the row');
  assert.equal(await sessionA.locator('.turn-list').evaluate((node) => getComputedStyle(node).borderLeftWidth), '1px', 'the turns hang from a guide');
  assert.equal(await page.locator('.turn-row[data-active] .turn-bullet').evaluate((node) => getComputedStyle(node).backgroundColor), ACCENT, 'the active bullet is filled');
  assert.equal(await page.locator('.turn-row:not([data-active]) .turn-bullet').first().evaluate((node) => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)', 'the others are hollow');
  assert.equal(await sessionA.locator('.session-count').isVisible(), false, 'no count while expanded');

  assert.equal(await sessionA.locator('.session-started').count(), 1, 'a shared title shows its start time');
  assert.equal(await page.locator('.session[data-session-id="sess-b"] .session-started').count(), 1);
  assert.equal(await page.locator('.session[data-session-id="sess-c"] .session-started').count(), 0, 'a unique title does not');
  assert.equal(await page.locator('.session-follow').count(), 0, 'the meta line and its Follow link are gone');

  await sessionA.locator('summary').click();
  assert.deepEqual(await iconDisplays(page, '.session[data-session-id="sess-a"]'), ['none', 'block', 'none'], 'collapsed: a chevron in place of the icon');
  assert.equal(await sessionA.locator('.session-count').isVisible(), true);
  assert.equal(await sessionA.locator('.session-count').textContent(), '3 turns');
  assert.equal(await rows.first().isVisible(), false);
  assert.deepEqual(consoleErrors, []);
});

test('3.3 the footer holds the toggle, the switch, and the version; hidden, the sidebar is a rail that keeps them; the header has no toggle', async (t) => {
  const { url } = await startServer(t);
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);

  assert.equal(await page.locator('.topbar #sidebar-toggle').count(), 0, 'no toggle in the header');
  const footer = page.locator('.sidebar-footer');
  assert.equal(await footer.locator('#sidebar-toggle').count(), 1);
  assert.equal(await footer.locator('#sidebar-toggle use').getAttribute('href'), '#icon-sidebar', 'the panel-left glyph');
  assert.equal(await footer.locator('#theme-switch').count(), 1);
  assert.equal(await footer.locator('.sidebar-version').textContent(), `v${VERSION}`);
  const footerBox = await footer.boundingBox();
  const sidebarBox = await page.locator('.sidebar').boundingBox();
  assert.ok(footerBox && sidebarBox && Math.abs(footerBox.y + footerBox.height - (sidebarBox.y + sidebarBox.height)) <= 1, 'the footer is at the sidebar\'s foot');

  await page.locator('#sidebar-toggle').click();
  const sidebar = await page.locator('.sidebar').boundingBox();
  assert.ok(sidebar && Math.abs(sidebar.width - 40) <= 1, `a 40px rail: ${sidebar?.width}`);
  assert.equal(await page.locator('.sidebar-scroll').isVisible(), false);
  assert.equal(await page.locator('.sidebar-version').isVisible(), false);
  for (const selector of ['#sidebar-toggle', '#theme-switch']) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 41 && box.y + box.height <= 800, `${selector} sits on the rail, at its foot`);
  }
  const document_ = await page.locator('.document-pane').boundingBox();
  assert.ok(document_ && Math.abs(document_.x - 40) <= 1, 'the document starts beside the rail');

  await page.reload();
  const afterReload = await page.locator('.sidebar').boundingBox();
  assert.ok(afterReload && Math.abs(afterReload.width - 40) <= 1, 'still a rail after a reload');
  await page.locator('#sidebar-toggle').click();
  assert.equal(await page.locator('.sidebar-scroll').isVisible(), true, 'and one click brings the sessions back');
  assert.deepEqual(consoleErrors, []);
});

test('3.4 the switch cycles system, light, dark, remembers the choice, and works on the rail', async (t) => {
  const { url } = await startServer(t);
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(new URL('/turns/prompt-1', url).href);
  const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const label = () => page.locator('#theme-switch').getAttribute('aria-label');
  const shownIcon = () => page.locator('.theme-icon').evaluateAll((icons) => icons.filter((icon) => getComputedStyle(icon).display !== 'none').map((icon) => icon.getAttribute('data-theme-icon')));

  assert.equal(await theme(), null);
  assert.equal(await bodyBackground(page), DARK_BG, 'following a dark system');
  assert.equal(await label(), 'Colour scheme: system. Switch to light');
  assert.deepEqual(await shownIcon(), ['system']);

  await page.locator('#theme-switch').click();
  assert.equal(await theme(), 'light');
  assert.equal(await bodyBackground(page), LIGHT_BG);
  assert.equal(await label(), 'Colour scheme: light. Switch to dark');
  assert.deepEqual(await shownIcon(), ['light']);

  await page.locator('#theme-switch').click();
  assert.equal(await theme(), 'dark');
  assert.equal(await bodyBackground(page), DARK_BG);
  assert.deepEqual(await shownIcon(), ['dark']);

  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  assert.equal(await theme(), 'dark', 'the choice survives a reload');
  assert.equal(await bodyBackground(page), DARK_BG, 'and beats the system');

  await page.locator('#sidebar-toggle').click();
  await page.locator('#theme-switch').click();
  assert.equal(await theme(), null, 'on the rail, the switch still cycles: back to system');
  assert.equal(await bodyBackground(page), LIGHT_BG);
  assert.deepEqual(consoleErrors, []);
});

test('3.5 the session menu follows a session or removes it in two activations, with the same cancels as a turn', async (t) => {
  const turns = Array.from({ length: 5 }, (_, index) => sampleTurn({ promptId: `a${index + 1}`, sessionId: 'sess-a', receivedAt: `2026-01-01T0${index}:00:00.000Z`, message: `A ${index + 1}.` }));
  turns.push(sampleTurn({ promptId: 'b1', sessionId: 'sess-b', receivedAt: '2026-01-01T06:00:00.000Z', message: 'B one, the other session.' }));
  const { url, store } = await startServer(t, { turns });
  const json = { 'Content-Type': 'application/json' };
  for (const question of ['one', 'two', 'three']) {
    await fetch(new URL('/api/turns/a1/threads', url), { method: 'POST', headers: json, body: JSON.stringify({ anchor: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 1 }, text: 'A' }, selectedText: 'A', question }) });
  }
  await fetch(new URL('/api/sessions/sess-a/carry-back', url), { method: 'POST', headers: json, body: JSON.stringify({ text: 'Owed to the terminal.' }) });
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL(turnHref(turns[0]), url).href);

  const sessionA = page.locator('.session[data-session-id="sess-a"]');
  const menuButton = sessionA.locator('.session-menu-button');
  assert.equal(await menuButton.evaluate((node) => getComputedStyle(node).visibility), 'hidden', 'the menu button waits for the pointer');
  await sessionA.hover();
  assert.equal(await menuButton.evaluate((node) => getComputedStyle(node).visibility), 'visible');
  await menuButton.click();
  const menu = page.locator('.session-menu');
  assert.deepEqual(await menu.locator('.session-menu-item').allTextContents(), ['Follow this session', 'Remove session…']);
  assert.equal(await menu.locator('[role="menuitemcheckbox"]').getAttribute('aria-checked'), 'false', 'a pinned page follows nothing');
  assert.equal(await menuButton.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  assert.equal(await menuButton.getAttribute('aria-expanded'), 'false');

  // Following from the menu.
  const sessionB = page.locator('.session[data-session-id="sess-b"]');
  await sessionB.hover();
  await sessionB.locator('.session-menu-button').click();
  await menu.locator('[role="menuitemcheckbox"]').click();
  await page.waitForURL(new URL(`/projects/${PROJECT}/sessions/sess-b`, url).href);
  assert.equal(await page.locator('.session[data-session-id="sess-b"]').getAttribute('data-followed'), '');
  await page.goto(new URL(turnHref(turns[0]), url).href);

  // Arming, and every way of cancelling.
  const arm = async () => {
    await sessionA.hover();
    await sessionA.locator('.session-menu-button').click();
    await menu.locator('[data-danger]').click();
    await sessionA.locator('.session-remove').waitFor();
  };
  await arm();
  assert.equal(await sessionA.getAttribute('data-armed'), '');
  assert.equal(await sessionA.locator('.session-remove').textContent(), 'Remove session, 5 turns and 3 threads?');
  assert.ok((await store.read()).sessions['sess-a'], 'nothing removed yet');
  await page.keyboard.press('Escape');
  assert.equal(await sessionA.locator('.session-remove').count(), 0, 'Escape cancels');
  await arm();
  await page.locator('#document').hover();
  assert.equal(await sessionA.locator('.session-remove').count(), 0, 'leaving the row cancels');
  await arm();
  await page.locator('#document').click({ position: { x: 20, y: 20 } });
  assert.equal(await sessionA.locator('.session-remove').count(), 0, 'a click elsewhere cancels');

  // The second activation removes; the page showing one of its turns moves to the project.
  await arm();
  await sessionA.locator('.session-remove').click();
  await page.waitForURL(new URL(`/projects/${PROJECT}`, url).href);
  assert.match((await page.locator('#document').textContent()) ?? '', /B one, the other session/);
  assert.equal(await page.locator('.session[data-session-id="sess-a"]').count(), 0);
  let state = await store.read();
  assert.equal(state.sessions['sess-a'], undefined);
  assert.equal(Object.values(state.turns).filter((turn) => turn.sessionId === 'sess-a').length, 0);
  assert.equal(Object.keys(state.threads).length, 0, 'its threads went with it');
  assert.equal(state.carryBack['sess-a']?.length, 1, 'carry-back survives');

  // Removing the project's only session leaves for the landing page.
  const only = page.locator('.session[data-session-id="sess-b"]');
  await only.hover();
  await only.locator('.session-menu-button').click();
  await menu.locator('[data-danger]').click();
  assert.equal(await only.locator('.session-remove').textContent(), 'Remove session and 1 turn?');
  await only.locator('.session-remove').click();
  await page.waitForURL(new URL('/', url).href);
  assert.equal(await page.locator('.project-name', { hasText: 'proj' }).count(), 0, 'the project is no longer listed');
  state = await store.read();
  assert.equal(Object.keys(state.sessions).length, 0);
  assert.deepEqual(consoleErrors, []);
});

// ---- 4. Thread pane -------------------------------------------------------------------

/** Answers at length, and slowly when asked to. */
/** @type {import('../../src/web/server.js').Dispatch} */
const threadStub = async ({ exchange }) => {
  if (exchange.question.startsWith('slow')) await sleep(1_200);
  return {
    ok: true,
    answer: { text: Array.from({ length: 40 }, (_, index) => `Point ${index + 1} of the answer to ${exchange.question}`).join('\n\n'), source: 'code', sourceDetail: 'src/x.js:1' },
    subAgentSessionId: 'sub-1',
  };
};

/** @param {string} url */
async function seedAnsweredThread(url) {
  const response = await fetch(new URL('/api/turns/prompt-1/threads', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anchor: { start: { path: [0], offset: 4 }, end: { path: [0], offset: 9 }, text: 'quick' }, selectedText: 'quick', question: 'first?' }),
  });
  const { thread } = await response.json();
  return waitForAnswer(url, thread.id);
}

/** @param {import('playwright').Page} page @param {string} selector */
const box = async (page, selector) => {
  const rect = await page.locator(selector).boundingBox();
  assert.ok(rect, `${selector} is on screen`);
  return rect;
};

test('4.1 the thread pane pins its top and its field, scrolls the exchanges to the newest, and leaves the position alone on a poll', async (t) => {
  const { url } = await startServer(t, { dispatch: threadStub });
  await seedAnsweredThread(url);
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  await page.locator('.source-badge').waitFor();

  const pane = await box(page, '.thread-pane');
  const top = await box(page, '.thread-top');
  const form = await box(page, '.follow-up-form');
  assert.ok(Math.abs(top.y - pane.y) <= 1, 'the chips and passage sit at the top of the pane');
  assert.ok(Math.abs(form.y + form.height - (pane.y + pane.height)) <= 1, 'the field sits at the foot of the pane');
  // The list is re-rendered on every event, so read it fresh inside one script rather than through a locator that may hold a replaced node.
  const exchanges = {
    /** @param {(node: HTMLElement) => unknown} read */
    evaluate: (read) => page.evaluate((source) => new Function('node', `return (${source})(node);`)(document.querySelector('.exchanges')), read.toString()),
  };
  const size = /** @type {{ scrollHeight: number, clientHeight: number }} */ (await exchanges.evaluate((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight })));
  assert.ok(size.scrollHeight > size.clientHeight + 100, 'the exchanges have room to scroll between them');
  assert.ok(top.y + top.height <= (await box(page, '.exchanges')).y + 1, 'and scroll below the top block');

  await page.locator('.follow-up-question').fill('slow second?');
  await page.keyboard.press('Enter');
  await page.locator('.exchange').nth(1).waitFor();
  const gap = /** @type {number} */ (await exchanges.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop));
  assert.ok(gap <= 2, `a sent follow-up scrolls into view: ${gap}px from the end`);
  assert.deepEqual(await box(page, '.thread-top'), top, 'the top block has not moved');
  assert.deepEqual(await box(page, '.follow-up-form'), form, 'nor has the field');

  await exchanges.evaluate((node) => {
    node.scrollTop = 40;
  });
  await page.locator('.exchange').nth(1).locator('.source-badge').waitFor({ timeout: 5_000 });
  assert.equal(await exchanges.evaluate((node) => node.scrollTop), 40, 'the answer arriving re-renders the same exchanges and leaves the reader where they were');
  assert.deepEqual(consoleErrors, []);
});

test('4.2 Enter sends a follow-up and a branch, Shift+Enter breaks a line, Escape closes the branch field, and no button remains', async (t) => {
  const { url } = await startServer(t, { dispatch: threadStub });
  await seedAnsweredThread(url);
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  await page.locator('.source-badge').waitFor();

  assert.equal(await page.locator('.follow-up-form button').count(), 0, 'no follow-up button');
  const field = page.locator('.follow-up-question');
  assert.equal(await field.getAttribute('placeholder'), 'Ask a follow-up…');
  await field.fill('line one');
  await page.keyboard.press('Shift+Enter');
  assert.equal(await field.inputValue(), 'line one\n', 'Shift+Enter breaks a line');
  assert.equal(await page.locator('.exchange').count(), 1, 'and sends nothing');
  await page.keyboard.press('Enter');
  await page.locator('.exchange').nth(1).locator('.source-badge').waitFor({ timeout: 5_000 });
  assert.equal(await page.locator('.exchange').nth(1).locator('.question').textContent(), 'line one');

  await page.locator('.branch-button').first().click();
  const branchForm = page.locator('.branch-form');
  await branchForm.waitFor();
  assert.equal(await branchForm.locator('button').count(), 0, 'no branch buttons');
  assert.match((await branchForm.locator('.branch-question').getAttribute('placeholder')) ?? '', /Enter sends, Esc cancels/);
  assert.equal(await branchForm.locator('.branch-question').evaluate((node) => document.activeElement === node), true, 'the field takes focus');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.branch-form').count(), 0, 'Escape closes it');
  assert.equal(await page.locator('.branch-tab').count(), 0, 'and nothing was sent');

  await page.locator('.branch-button').first().click();
  await page.locator('.branch-question').fill('sideways?');
  await page.keyboard.press('Enter');
  await page.locator('.branch-tab').nth(1).waitFor();
  assert.deepEqual(await page.locator('.branch-tab').allTextContents(), ['main', 'b1']);
  assert.equal(await page.locator('.thread .question').first().textContent(), 'sideways?');
  assert.deepEqual(consoleErrors, []);
});

test('4.3 the actions under an answer are two icon controls at the left, named by their tooltips', async (t) => {
  const { url } = await startServer(t, { dispatch: threadStub });
  await seedAnsweredThread(url);
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  await page.locator('.source-badge').waitFor();

  const actions = page.locator('.exchange-actions').first();
  assert.equal(await actions.evaluate((node) => getComputedStyle(node).justifyContent), 'flex-start');
  const carry = actions.locator('.carry-button');
  const branch = actions.locator('.branch-button');
  assert.equal(await carry.getAttribute('title'), 'Carry back this answer');
  assert.equal(await carry.getAttribute('aria-label'), 'Carry back this answer');
  assert.equal(await carry.locator('use').getAttribute('href'), '#icon-reply');
  assert.equal(await branch.getAttribute('title'), 'Branch from here');
  assert.equal(await branch.getAttribute('aria-label'), 'Branch from here');
  assert.equal(await branch.locator('use').getAttribute('href'), '#icon-code-branch');
  assert.equal(((await carry.textContent()) ?? '').trim(), '', 'no text, the tooltip names it');
  const answer = await box(page, '.answer');
  const carryBox = await box(page, '.exchange-actions .carry-button');
  const branchBox = await box(page, '.exchange-actions .branch-button');
  assert.ok(Math.abs(carryBox.x - answer.x) <= 2, `carry back sits at the answer's left edge: ${carryBox.x} vs ${answer.x}`);
  assert.ok(branchBox.x > carryBox.x && branchBox.x < answer.x + answer.width / 2, 'branch from here sits right after it');
  assert.deepEqual(consoleErrors, []);
});

// ---- 5. The carry-back composer ------------------------------------------------------

/** @param {import('playwright').Page} page */
const composerState = (page) => page.evaluate(() => document.documentElement.getAttribute('data-composer'));

/**
 * @param {number} actual
 * @param {number} expected
 * @param {string} what
 */
function near(actual, expected, what) {
  assert.ok(Math.abs(actual - expected) <= 1, `${what}: ${actual} is not within 1px of ${expected}`);
}

test('5.1 the composer floats in the document pane\'s corner in three remembered states, and follows the document on a narrow window', async (t) => {
  const long = sampleTurn({ message: Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1} of a long turn.`).join('\n\n') });
  const { url } = await startServer(t, { turns: [long] });
  const { page } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);

  const pane = await box(page, '.document-pane');
  const bar = await box(page, '.composer');
  assert.ok([null, 'minimized'].includes(await composerState(page)), 'minimized by default');
  assert.equal(await page.locator('.composer-body').isVisible(), false);
  assert.equal(await page.locator('#carry-back-title').textContent(), 'Carry back');
  assert.equal(await page.locator('#carry-back-count').textContent(), 'nothing pending');
  assert.ok(bar.width >= 320 && bar.width < pane.width - 32, `a compact bar sized to its content: ${bar.width}`);
  assert.ok(bar.height <= 48, `on one line: ${bar.height}`);
  near(bar.x + bar.width, pane.x + pane.width - 16, 'anchored 16px from the pane\'s right edge');
  near(bar.y + bar.height, pane.y + pane.height - 16, 'and 16px from its bottom');

  await page.locator('#composer-bar').click();
  assert.equal(await composerState(page), 'open');
  const open = await box(page, '.composer');
  assert.equal(open.width, pane.width - 32, 'open, it spans the pane with 16px insets');
  near(open.x, pane.x + 16, 'from the pane\'s left inset');
  assert.ok(open.height <= pane.height * 0.5 + 1, 'and takes at most half the pane\'s height');
  assert.equal(await page.locator('#carry-back-text').isVisible(), true);
  assert.equal(await page.locator('#composer-maximize').getAttribute('aria-label'), 'Maximize the carry-back list');

  await page.locator('#composer-maximize').click();
  assert.equal(await composerState(page), 'maximized');
  const maximized = await box(page, '.composer');
  assert.equal(maximized.width, pane.width - 32, 'maximized, the width is unchanged');
  near(maximized.height, pane.height * 0.75, 'and the height grows to three quarters of the pane, not all of it');
  assert.equal(await page.locator('#composer-maximize').getAttribute('aria-label'), 'Restore the carry-back list');

  await page.route((request) => /\/assets\/(workspace|app)\.js$/.test(request.href), (route) => route.abort());
  await page.reload();
  assert.equal(await composerState(page), 'maximized', 'the state is on the root before any module runs');
  assert.equal(await page.locator('.composer-body').isVisible(), true);
  await page.unrouteAll();
  await page.reload();

  await page.locator('#composer-maximize').click();
  assert.equal(await composerState(page), 'open', 'restore returns to open');
  await page.locator('#composer-minimize').click();
  assert.equal(await composerState(page), 'minimized');
  await page.evaluate(() => {
    const documentPane = /** @type {HTMLElement} */ (document.querySelector('.document-pane'));
    documentPane.scrollTop = documentPane.scrollHeight;
  });
  const end = await page.evaluate(() => ({
    pageScrollHeight: document.documentElement.scrollHeight,
    viewportHeight: innerHeight,
    lastLine: document.getElementById('document')?.getBoundingClientRect().bottom ?? Infinity,
    composerTop: document.querySelector('.composer')?.getBoundingClientRect().top ?? -Infinity,
  }));
  assert.ok(end.pageScrollHeight <= end.viewportHeight, 'no page scroll');
  assert.ok(end.lastLine <= end.composerTop, `the document's last line clears the bar: ${end.lastLine} vs ${end.composerTop}`);

  await page.setViewportSize({ width: 400, height: 800 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => getComputedStyle(/** @type {Element} */ (document.querySelector('.composer'))).position), 'static');
  const article = await box(page, '#document');
  const narrow = await box(page, '.composer');
  assert.ok(narrow.y >= article.y + article.height - 1, 'on a narrow window the composer follows the document');
});

test('5.2 entries are added with Enter, edited in place, removed with one control, and the text box grows with its text', async (t) => {
  const { url, store } = await startServer(t);
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  await page.locator('#composer-bar').click();
  assert.equal(await page.locator('#carry-back-add').count(), 0, 'no add button; Enter adds');
  const text = page.locator('#carry-back-text');
  assert.equal(await text.getAttribute('placeholder'), 'Enter a conclusion in your own words…');
  assert.equal(await page.locator('.carry-back-hint').textContent(), 'Send these lines back to the terminal, as context on your next prompt. Once sent, they leave this list.');
  const documentBefore = await box(page, '.document-pane');
  const single = (await box(page, '#carry-back-text')).height;

  await text.click();
  await page.keyboard.type('First line');
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type(`line ${index + 2}`);
  }
  assert.equal(await page.locator('.carry-back-entry').count(), 0, 'Shift+Enter adds nothing');
  assert.ok((await box(page, '#carry-back-text')).height > single + 40, 'the text box grew with five lines');
  assert.deepEqual(await box(page, '.document-pane'), documentBefore, 'and nothing else moved');

  await page.keyboard.press('Enter');
  await page.locator('.carry-back-entry').waitFor();
  assert.equal(await text.inputValue(), '');
  near((await box(page, '#carry-back-text')).height, single, 'the box shrinks back');
  const entry = page.locator('.carry-back-entry').first();
  assert.match((await entry.locator('.carry-back-entry-text').textContent()) ?? '', /^First line\nline 2/);
  assert.equal(await page.locator('#carry-back-count').textContent(), '1 pending');

  // Edit in place: Enter saves.
  await entry.locator('.carry-back-entry-text').click();
  const field = entry.locator('.carry-back-entry-edit');
  await field.waitFor();
  assert.equal(await field.evaluate((node) => document.activeElement === node), true, 'the field takes focus');
  await field.fill('Edited wording.');
  await page.keyboard.press('Enter');
  await entry.locator('.carry-back-entry-text').waitFor();
  assert.equal(await entry.locator('.carry-back-entry-text').textContent(), 'Edited wording.');
  assert.equal((await store.read()).carryBack['session-1']?.[0]?.text, 'Edited wording.', 'saved to the store');

  // Escape restores.
  await entry.locator('.carry-back-entry-text').click();
  await field.fill('Discarded wording.');
  await page.keyboard.press('Escape');
  await entry.locator('.carry-back-entry-text').waitFor();
  assert.equal(await entry.locator('.carry-back-entry-text').textContent(), 'Edited wording.');

  // Leaving the field saves a change.
  await entry.locator('.carry-back-entry-text').click();
  await field.fill('Blurred wording.');
  await page.locator('.carry-back-hint').click();
  await entry.locator('.carry-back-entry-text').waitFor();
  assert.equal(await entry.locator('.carry-back-entry-text').textContent(), 'Blurred wording.');
  assert.equal((await store.read()).carryBack['session-1']?.[0]?.text, 'Blurred wording.');

  // One control removes.
  const remove = entry.locator('.carry-back-remove');
  assert.equal(await remove.getAttribute('aria-label'), 'Remove this entry');
  await entry.hover();
  await remove.click();
  await entry.waitFor({ state: 'detached' });
  assert.equal(await page.locator('#carry-back-count').textContent(), 'nothing pending');
  assert.deepEqual(consoleErrors, []);
});

test('5.3 the carry-back action opens a minimized composer with the answer drafted and the text box focused', async (t) => {
  const { url } = await startServer(t, { dispatch: threadStub });
  await seedAnsweredThread(url);
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  await page.locator('.source-badge').waitFor();
  assert.equal(await page.locator('.composer-body').isVisible(), false, 'minimized to begin with');

  await page.locator('.carry-button').first().click();
  assert.equal(await composerState(page), 'open');
  const text = page.locator('#carry-back-text');
  assert.match(await text.inputValue(), /^Point 1 of the answer to first\?/, 'the answer is the draft');
  assert.equal(await text.evaluate((node) => document.activeElement === node), true, 'ready to edit');
  await page.keyboard.press('Enter');
  await page.locator('.carry-back-entry').waitFor();
  assert.match((await page.locator('.carry-back-entry-text').textContent()) ?? '', /^Point 1 of the answer to first\?/);
  assert.deepEqual(consoleErrors, []);
});

// ---- 7. Second review -----------------------------------------------------------------

test('7.1 on a wide window both reading columns stand clear of their panes\' edges', async (t) => {
  const { url } = await startServer(t, { dispatch: threadStub });
  await seedAnsweredThread(url);
  const { page, consoleErrors } = await openBrowser(t, { width: 1871, height: 868 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  await page.locator('.source-badge').waitFor();
  const pane = await box(page, '.document-pane');
  const article = await box(page, '#document');
  const left = article.x - pane.x;
  const right = pane.x + pane.width - (article.x + article.width);
  assert.ok(left >= 64 && right >= 64, `the document keeps at least 64px at each side: ${left} / ${right}`);
  assert.ok(Math.abs(left - right) <= 1, 'and is centred');
  const measured = await page.evaluate(() => {
    const articleStyle = getComputedStyle(/** @type {Element} */ (document.getElementById('document')));
    const exchangesStyle = getComputedStyle(/** @type {Element} */ (document.querySelector('.exchanges')));
    const articleMax = parseFloat(articleStyle.maxWidth);
    return { articleMax, ch: articleMax / 66, paddingLeft: parseFloat(exchangesStyle.paddingLeft), paddingRight: parseFloat(exchangesStyle.paddingRight) };
  });
  assert.ok(article.width <= measured.articleMax + 1, `the article is no wider than its 66ch column: ${article.width} vs ${measured.articleMax}`);
  const thread = await box(page, '.thread-pane');
  const exchanges = measured;
  assert.ok(exchanges.paddingLeft >= 40 && Math.abs(exchanges.paddingLeft - exchanges.paddingRight) <= 1, 'the thread column is centred with at least 40px at each side');
  assert.ok(thread.width - exchanges.paddingLeft - exchanges.paddingRight <= 72 * measured.ch + 1, 'and no wider than its 72ch column');
  assert.ok(exchanges.paddingLeft > 40, `at this width the column, not the 40px minimum, sets the margin: ${exchanges.paddingLeft}px`);
  assert.deepEqual(consoleErrors, []);
});

test('7.4 the landing page follows the colour scheme chosen in a workspace', async (t) => {
  const { url } = await startServer(t);
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.emulateMedia({ colorScheme: 'light' });
  await seedLayout(page, { theme: 'dark' });
  await page.goto(url);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  assert.equal(await bodyBackground(page), DARK_BG, 'the landing page is dark too');
  await page.goto(new URL('/nope', url).href);
  assert.equal(await bodyBackground(page), DARK_BG, 'and so is the error page');
  assert.deepEqual(consoleErrors.filter((message) => !/404/.test(message)), []);
});

test('7.6 the ask popover has no buttons: Enter asks, Escape closes', async (t) => {
  const { url } = await startServer(t, { dispatch: threadStub });
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  await dragSelect(page, 'quick brown');
  const popover = page.locator('#ask-popover');
  await popover.waitFor({ state: 'visible' });
  assert.equal(await popover.locator('button').count(), 0, 'no Cancel, no Ask');
  assert.equal(await page.locator('#ask-question').getAttribute('placeholder'), 'Ask about this…');
  await page.locator('#ask-question').fill('discarded?');
  await page.keyboard.press('Escape');
  await popover.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.thread').count(), 0, 'Escape asks nothing');

  await dragSelect(page, 'quick brown');
  await popover.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#ask-question').inputValue(), '', 'the field starts empty again');
  await page.locator('#ask-question').fill('why quick?');
  await page.keyboard.press('Enter');
  await page.locator('.thread .question').waitFor();
  assert.equal(await page.locator('.thread .question').textContent(), 'why quick?');
  await popover.waitFor({ state: 'hidden' });
  assert.deepEqual(consoleErrors, []);
});
