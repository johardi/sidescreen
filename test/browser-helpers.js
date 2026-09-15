import { chromium } from 'playwright';

/**
 * Launch a browser for one test, closed when the test ends.
 *
 * @param {import('node:test').TestContext} t
 * @param {{ width?: number, height?: number }} [viewport]
 */
export async function openBrowser(t, { width = 1200, height = 800 } = {}) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  /** @type {string[]} */
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  return { browser, page, consoleErrors };
}

/**
 * Select text in the document by a real mouse drag, from just before the
 * first character of `needle` to just after its last.
 *
 * @param {import('playwright').Page} page
 * @param {string} needle Text that occurs once in one text node of the document.
 */
export async function dragSelect(page, needle) {
  const points = await page.evaluate((text) => {
    const root = document.getElementById('document');
    if (!root) throw new Error('no document');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.nodeValue?.indexOf(text) ?? -1;
      if (index < 0) continue;
      const first = document.createRange();
      first.setStart(node, index);
      first.setEnd(node, index + 1);
      const last = document.createRange();
      last.setStart(node, index + text.length - 1);
      last.setEnd(node, index + text.length);
      const a = first.getBoundingClientRect();
      const b = last.getBoundingClientRect();
      return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
    }
    throw new Error(`text not found: ${text}`);
  }, needle);
  await page.mouse.move(points.x1, points.y1);
  await page.mouse.down();
  await page.mouse.move(points.x2, points.y2, { steps: 8 });
  await page.mouse.up();
}
