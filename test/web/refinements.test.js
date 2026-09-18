/**
 * The second pass over the workspace in a real browser: colour scheme,
 * scrollbars and margins, the sidebar tree with its footer and menu, the
 * thread pane's pinned field, and the carry-back composer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from '../browser-helpers.js';
import { sampleTurn, startServer } from '../server-helpers.js';

const LIGHT_BG = 'rgb(255, 255, 255)';
const DARK_BG = 'rgb(20, 22, 26)';
const TRANSPARENT_PAIR = 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)';

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
    ['.sidebar', '.document-pane', '.thread-pane'].map((selector) => {
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
