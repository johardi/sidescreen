/**
 * The second pass over the workspace in a real browser: colour scheme,
 * scrollbars and margins, the sidebar tree with its footer and menu, the
 * thread pane's pinned field, and the carry-back composer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../browser-helpers.js';
import { sampleTurn, startServer, turnHref } from '../server-helpers.js';
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
  const { page, consoleErrors } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  const styles = await page.evaluate(() =>
    ['.sidebar-scroll', '.document-pane', '.thread-pane'].map((selector) => {
      const style = getComputedStyle(/** @type {Element} */ (document.querySelector(selector)));
      return { selector, scrollbarWidth: style.scrollbarWidth, scrollbarColor: style.scrollbarColor, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight };
    }),
  );
  for (const style of styles) {
    assert.equal(style.scrollbarWidth, 'thin', `${style.selector} has a thin scrollbar`);
    assert.equal(style.scrollbarColor, TRANSPARENT_PAIR, `${style.selector} hides the thumb at rest`);
  }
  assert.equal(styles[1].paddingLeft, '40px');
  assert.equal(styles[1].paddingRight, '40px');
  assert.equal(styles[2].paddingLeft, '24px');
  assert.equal(styles[2].paddingRight, '24px');

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
