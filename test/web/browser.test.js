import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser, dragSelect } from '../browser-helpers.js';
import { sampleTurn, startServer, waitForAnswer } from '../server-helpers.js';
import { runCli } from '../helpers.js';
import { setTimeout as sleep } from 'node:timers/promises';

/** @type {import('../../src/web/server.js').Dispatch} */
const codeSourcedStub = async ({ exchange }) => ({
  ok: true,
  answer: { text: `Because of \`${exchange.question}\`.`, source: 'code', sourceDetail: 'src/store.js:42' },
  subAgentSessionId: 'sub-1',
});

test('selecting part of a sentence and asking creates a thread with the expected range', async (t) => {
  const { url } = await startServer(t, { dispatch: codeSourcedStub });
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL('/turns/prompt-1', url).href);

  await dragSelect(page, 'ick brown fo');
  const popover = page.locator('#ask-popover');
  await popover.waitFor({ state: 'visible' });
  await assert.doesNotReject(async () => {
    const quoted = await page.locator('#ask-selection').textContent();
    assert.equal(quoted, 'ick brown fo');
  });

  await page.locator('#ask-question').fill('Why is the fox quick?');
  await page.keyboard.press('Enter');

  const threadSection = page.locator('.thread');
  await threadSection.waitFor();
  assert.equal(await threadSection.locator('.question').textContent(), 'Why is the fox quick?');
  assert.equal(await threadSection.locator('.thread-selection').textContent(), 'ick brown fo');
  await popover.waitFor({ state: 'hidden' });

  const { threads } = await (await fetch(new URL('/api/turns/prompt-1', url))).json();
  assert.equal(threads.length, 1);
  assert.deepEqual(threads[0].anchor, {
    start: { path: [0], offset: 'The qu'.length },
    end: { path: [0], offset: 'The quick brown fo'.length },
    text: 'ick brown fo',
  });
  assert.equal(threads[0].selectedText, 'ick brown fo');
  assert.equal(threads[0].exchanges[0].question, 'Why is the fox quick?');

  const badge = threadSection.locator('.source-badge');
  await badge.waitFor();
  assert.equal(await badge.getAttribute('data-source'), 'code');
  assert.equal(await badge.textContent(), 'source: code');
  assert.equal(await threadSection.locator('.source-detail').textContent(), 'src/store.js:42');
  assert.match((await threadSection.locator('.answer-body').textContent()) ?? '', /Because of Why is the fox quick\?/);

  const mark = page.locator('#document mark[data-sidescreen-mark]');
  assert.equal(await mark.count(), 1);
  assert.equal(await mark.textContent(), 'ick brown fo');
  assert.equal(await mark.getAttribute('data-index'), '1');
  assert.deepEqual(consoleErrors, []);
});

test('a selection outside the document, or an empty one, opens no popover', async (t) => {
  const { url } = await startServer(t);
  const { page } = await openBrowser(t);
  await page.goto(new URL('/turns/prompt-1', url).href);
  await page.locator('.brand').click({ trial: true });
  await page.locator('#document p').first().click();
  await page.waitForTimeout(50);
  assert.equal(await page.locator('#ask-popover').isVisible(), false);
});

test('anchored threads are marked inline and clicking a mark activates its thread', async (t) => {
  const { url } = await startServer(t, { dispatch: codeSourcedStub });
  const create = (/** @type {object} */ anchor, /** @type {string} */ selectedText, /** @type {string} */ question) =>
    fetch(new URL('/api/turns/prompt-1/threads', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anchor, selectedText, question }),
    });
  await create({ start: { path: [0], offset: 4 }, end: { path: [0], offset: 9 }, text: 'quick' }, 'quick', 'first?');
  await create({ start: { path: [1], offset: 2 }, end: { path: [1], offset: 8 }, text: 'second' }, 'second', 'second?');

  const { page } = await openBrowser(t);
  await page.goto(new URL('/turns/prompt-1', url).href);
  const marks = page.locator('#document mark[data-sidescreen-mark]');
  assert.equal(await marks.count(), 2);
  assert.deepEqual(await marks.allTextContents(), ['quick', 'second']);
  assert.equal(await page.locator('.thread .question').textContent(), 'second?', 'the newest thread is active by default');

  await marks.first().click();
  assert.equal(await page.locator('.thread .question').textContent(), 'first?');
  assert.equal(await marks.first().getAttribute('data-active'), '');
  assert.equal(await page.locator('.thread-chip[aria-pressed="true"]').textContent(), '#1');
});

test('the layout holds at 400px with no horizontal page scroll', async (t) => {
  const stress = sampleTurn({
    promptId: 'stress',
    message: [
      '# A heading that is fairly long for a narrow screen',
      '',
      'A paragraph containing a very long unbroken token: ' + 'x'.repeat(120) + ' and a URL https://example.com/' + 'segment/'.repeat(20),
      '',
      '```js',
      'const veryLongLine = ' + JSON.stringify('y'.repeat(200)) + ';',
      '```',
      '',
      '| column one | column two | column three | column four |',
      '| --- | --- | --- | --- |',
      '| ' + 'z'.repeat(40) + ' | b | c | d |',
    ].join('\n'),
  });
  const { url } = await startServer(t, { turns: [stress], dispatch: codeSourcedStub });
  await fetch(new URL('/api/turns/stress/threads', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anchor: { start: { path: [1], offset: 2 }, end: { path: [1], offset: 11 }, text: 'paragraph' },
      selectedText: 'paragraph',
      question: 'A question that is itself rather long so that it wraps inside the narrow thread column?',
    }),
  });

  const { page, consoleErrors } = await openBrowser(t, { width: 400, height: 800 });
  await page.goto(new URL('/turns/stress', url).href);
  await page.locator('.source-badge').waitFor();

  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(widths.html <= widths.viewport, `html scrollWidth ${widths.html} exceeds viewport ${widths.viewport}`);
  assert.ok(widths.body <= widths.viewport, `body scrollWidth ${widths.body} exceeds viewport ${widths.viewport}`);

  const [documentBox, threadBox] = await Promise.all([
    page.locator('.document-pane').boundingBox(),
    page.locator('.thread-pane').boundingBox(),
  ]);
  assert.ok(documentBox && threadBox);
  assert.ok(threadBox.y >= documentBox.y + documentBox.height - 1, 'the thread column stacks below the document on a narrow screen');
  assert.ok(threadBox.width <= 400);
  assert.equal(await page.locator('#document mark[data-sidescreen-mark]').count(), 1);
  assert.deepEqual(consoleErrors, []);
});

test('on a wide screen the thread column sits beside the document, the same width until the user sizes it', async (t) => {
  const { url } = await startServer(t);
  const { page } = await openBrowser(t, { width: 1200, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  const [documentBox, threadBox] = await Promise.all([
    page.locator('.document-pane').boundingBox(),
    page.locator('.thread-pane').boundingBox(),
  ]);
  assert.ok(documentBox && threadBox);
  assert.ok(threadBox.x >= documentBox.x + documentBox.width - 1);
  assert.ok(Math.abs(threadBox.width - documentBox.width) <= 1, `document ${documentBox.width} and thread pane ${threadBox.width} start equal`);
});

test('every source value renders as a badge beside the answer, and "none" is an answer, not an error', async (t) => {
  const sources = /** @type {const} */ (['code', 'transcript', 'spec', 'none', 'undeclared']);
  let call = 0;
  const { url } = await startServer(t, {
    dispatch: async () => {
      const source = sources[call++ % sources.length];
      return {
        ok: true,
        answer: {
          text: source === 'none' ? 'No documented intent found.' : `Answer from ${source}.`,
          source,
          sourceDetail: source === 'none' || source === 'undeclared' ? '' : `${source} detail`,
        },
        subAgentSessionId: null,
      };
    },
  });
  for (let index = 0; index < sources.length; index += 1) {
    await fetch(new URL('/api/turns/prompt-1/threads', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anchor: { start: { path: [0], offset: index }, end: { path: [0], offset: index + 1 }, text: 'x' },
        selectedText: 'x',
        question: `q${index}`,
      }),
    });
  }
  const { page } = await openBrowser(t);
  await page.goto(new URL('/turns/prompt-1', url).href);
  await page.locator('.source-badge').waitFor();

  const expectedLabels = { code: 'source: code', transcript: 'source: transcript', spec: 'source: spec', none: 'source: none', undeclared: 'source not declared' };
  for (const [index, source] of sources.entries()) {
    await page.locator(`.thread-chip:has-text("#${index + 1}")`).click();
    const thread = page.locator('.thread');
    await thread.locator(`.source-badge[data-source="${source}"]`).waitFor();
    assert.equal(await thread.locator('.source-badge').textContent(), expectedLabels[source]);
    assert.equal(await thread.locator('.answer').getAttribute('data-status'), 'answered');
    assert.equal(await thread.locator('.answer-error').count(), 0);
    if (source === 'none') {
      assert.match((await thread.locator('.answer-body').textContent()) ?? '', /No documented intent found\./);
      assert.equal(await thread.locator('.source-detail').count(), 0);
    } else if (source !== 'undeclared') {
      assert.equal(await thread.locator('.source-detail').textContent(), `${source} detail`);
    }
  }
});

// ---- Group 5: follow-ups, branches, tabs -------------------------------------

/** @type {import('../../src/web/server.js').Dispatch} */
const lineageStub = async ({ exchange, target }) => ({
  ok: true,
  answer: { text: `Answer to ${exchange.question}`, source: 'code', sourceDetail: 'src/x.js:1' },
  subAgentSessionId: target.mode === 'new' ? `root-${exchange.id}` : `fork-of-${target.sessionId}-${exchange.id}`,
});

/** @param {string} url */
async function seedThread(url, question = 'first?') {
  const response = await fetch(new URL('/api/turns/prompt-1/threads', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anchor: { start: { path: [0], offset: 4 }, end: { path: [0], offset: 9 }, text: 'quick' }, selectedText: 'quick', question }),
  });
  const { thread } = await response.json();
  return waitForAnswer(url, thread.id);
}

test('a follow-up typed in the thread column appends an answered exchange to the same thread', async (t) => {
  const { url } = await startServer(t, { dispatch: lineageStub });
  const thread = await seedThread(url);
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL('/turns/prompt-1', url).href);

  await page.locator('.follow-up-question').fill('and then?');
  await page.keyboard.press('Enter');
  await page.locator('.exchange').nth(1).waitFor();
  await page.locator('.exchange').nth(1).locator('.source-badge').waitFor();
  assert.deepEqual(await page.locator('.exchange .question').allTextContents(), ['first?', 'and then?']);
  assert.equal(await page.locator('.branch-tabs').count(), 0, 'no tabs until a branch exists');

  const { thread: updated } = await (await fetch(new URL(`/api/threads/${thread.id}`, url))).json();
  assert.equal(updated.exchanges.length, 2);
  assert.ok(updated.exchanges[1].subAgentSessionId.startsWith(`fork-of-${updated.exchanges[0].subAgentSessionId}-`));
  assert.deepEqual(consoleErrors, []);
});

test('branching from an answer opens a sibling tab with its own question, and the mark count is unchanged', async (t) => {
  const { url } = await startServer(t, { dispatch: lineageStub });
  await seedThread(url);
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL('/turns/prompt-1', url).href);

  await page.locator('.branch-button').first().click();
  await page.locator('.branch-question').fill('sideways?');
  await page.locator('.branch-submit').click();

  const tabs = page.locator('.branch-tab');
  await tabs.nth(1).waitFor();
  assert.deepEqual(await tabs.allTextContents(), ['main', 'b1']);
  assert.equal(await page.locator('.branch-tab[aria-selected="true"]').textContent(), 'b1');
  assert.equal(await page.locator('.thread .question').textContent(), 'sideways?');
  assert.match((await page.locator('.thread-lineage').textContent()) ?? '', /Branched from answer 1 of main/);
  await page.locator('.thread .source-badge').waitFor();
  assert.equal(await page.locator('#document mark[data-sidescreen-mark]').count(), 1, 'a branch shares its parent\'s anchor');

  await tabs.first().click();
  assert.equal(await page.locator('.thread .question').textContent(), 'first?');
  assert.equal(await page.locator('.branch-tab[aria-selected="true"]').textContent(), 'main');
  assert.deepEqual(consoleErrors, []);
});

test('5.5 five sibling branches stay usable as tabs at 400px width', async (t) => {
  const { url } = await startServer(t, { dispatch: lineageStub });
  const root = await seedThread(url);
  for (let index = 1; index <= 5; index += 1) {
    const response = await fetch(new URL(`/api/threads/${root.id}/branches`, url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exchangeId: root.exchanges[0].id, question: `branch ${index}?` }),
    });
    assert.equal(response.status, 201);
    const { thread } = await response.json();
    await waitForAnswer(url, thread.id);
  }

  const { page, consoleErrors } = await openBrowser(t, { width: 400, height: 800 });
  await page.goto(new URL('/turns/prompt-1', url).href);
  const tabs = page.locator('.branch-tab');
  assert.equal(await tabs.count(), 6);
  assert.deepEqual(await tabs.allTextContents(), ['main', 'b1', 'b2', 'b3', 'b4', 'b5']);

  for (let index = 0; index < 6; index += 1) {
    const box = await tabs.nth(index).boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 400, `tab ${index} is within the viewport`);
    await tabs.nth(index).click();
    assert.equal(await page.locator('.thread .question').textContent(), index === 0 ? 'first?' : `branch ${index}?`);
  }
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, html: document.documentElement.scrollWidth }));
  assert.ok(widths.html <= widths.viewport, 'no horizontal page scroll');
  assert.equal(await page.locator('.thread-chip').count(), 1, 'branches are not extra top-level threads');
  assert.deepEqual(consoleErrors, []);
});

// ---- 5.1: which backend answered ---------------------------------------------------

test('5.1 each answer opens with a quiet line naming its backend, the model in its tooltip, and the pending line names the backend', async (t) => {
  let call = 0;
  const { url } = await startServer(t, {
    dispatch: async ({ exchange }) => {
      if (exchange.question.startsWith('slow')) await sleep(1_500);
      call += 1;
      return {
        ok: true,
        answer: { text: `Answer ${call} from ${exchange.backend}`, source: 'code', sourceDetail: 'src/x.js:1' },
        subAgentSessionId: `s-${call}`,
        model: exchange.backend === 'claude' ? 'claude-fable-5-1' : null,
      };
    },
  });
  const thread = await seedThread(url, 'first?');
  await fetch(new URL(`/api/threads/${thread.id}/exchanges`, url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: '@codex second?' }),
  });
  await waitForAnswer(url, thread.id);

  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL('/turns/prompt-1', url).href);
  const labels = page.locator('.exchange .answer-by');
  await labels.nth(1).waitFor();
  assert.deepEqual(await labels.allTextContents(), ['Claude answered:', 'CODEX answered:']);
  assert.equal(await labels.nth(0).getAttribute('data-backend'), 'claude');
  assert.equal(await labels.nth(0).getAttribute('title'), 'Answered by Claude on claude-fable-5-1');
  assert.equal(await labels.nth(1).getAttribute('title'), 'Answered by CODEX', 'no model known for the codex answer');
  const firstAnswer = page.locator('.exchange').first().locator('.answer');
  const [labelBox, bodyBox, badgeBox] = await Promise.all([labels.nth(0).boundingBox(), firstAnswer.locator('.answer-body').boundingBox(), firstAnswer.locator('.source-badge').boundingBox()]);
  assert.ok(labelBox && bodyBox && badgeBox && labelBox.y + labelBox.height <= bodyBox.y + 1, 'the label sits above the answer body');
  assert.ok(labelBox && badgeBox && labelBox.height < badgeBox.height * 1.6, 'and is no louder than the source badge');
  assert.equal(await labels.nth(0).evaluate((node) => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)', 'no fill colour');
  assert.equal(await page.locator('.follow-up-question').getAttribute('placeholder'), 'Ask a follow-up… (@claude or @codex to switch)');

  await page.locator('.follow-up-question').fill('slow third?');
  await page.keyboard.press('Enter');
  const pending = page.locator('.exchange').nth(2).locator('.answer-pending');
  await pending.waitFor();
  assert.match((await pending.textContent()) ?? '', /^Asking CODEX…/, 'sticky: the follow-up goes to the backend that answered last, and says so while pending');
  await page.locator('.exchange').nth(2).locator('.answer-by').waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('.exchange').nth(2).locator('.answer-by').textContent(), 'CODEX answered:');
  assert.deepEqual(consoleErrors, []);
});

// ---- Group 6: carry back -----------------------------------------------------

test('6.1 carry-back entries added in the page survive a reload, and an answer can seed one', async (t) => {
  const { url } = await startServer(t, { dispatch: lineageStub });
  await seedThread(url, 'why the lock?');
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL('/turns/prompt-1', url).href);
  assert.equal(await page.locator('#carry-back-count').textContent(), 'nothing pending');

  await page.locator('#carry-back-text').fill('The directory lock stays.');
  await page.keyboard.press('Enter');
  await page.locator('.carry-back-entry').waitFor();
  assert.equal(await page.locator('#carry-back-count').textContent(), '1 pending');

  await page.locator('.carry-button').first().click();
  assert.equal(await page.locator('#carry-back-text').inputValue(), 'Answer to why the lock?', 'the answer text seeds the draft');
  await page.locator('#carry-back-add').click();
  await page.locator('.carry-back-entry').nth(1).waitFor();

  await page.reload();
  await page.locator('.carry-back-entry').nth(1).waitFor();
  assert.deepEqual(await page.locator('.carry-back-entry-text').allTextContents(), ['The directory lock stays.', 'Answer to why the lock?']);
  assert.equal(await page.locator('#carry-back-count').textContent(), '2 pending');

  await page.locator('.carry-back-remove').nth(1).click();
  await page.locator('.carry-back-entry').nth(1).waitFor({ state: 'detached' });
  await page.reload();
  assert.deepEqual(await page.locator('.carry-back-entry-text').allTextContents(), ['The directory lock stays.']);
  assert.deepEqual(consoleErrors, []);
});

test('entries leave the page once they have been carried back, and the page learns it live', async (t) => {
  const { url, stateDir } = await startServer(t);
  for (const text of ['First conclusion.', 'Second conclusion.']) {
    await fetch(new URL('/api/sessions/session-1/carry-back', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  }
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL('/turns/prompt-1', url).href);
  assert.equal(await page.locator('.carry-back-entry').count(), 2);
  assert.equal(await page.locator('#carry-back-count').textContent(), '2 pending');
  assert.equal(await page.locator('#carry-back-sent').textContent(), '');

  // The next prompt's hook emits from another process; the page must notice on its own.
  const emitted = await runCli(['carry-back', '--emit', '--session', 'session-1'], { env: { SIDESCREEN_STATE_DIR: stateDir } });
  assert.equal(emitted.code, 0, emitted.stderr);
  assert.match(emitted.stdout, /First conclusion.\n- Second conclusion./);

  await page.locator('.carry-back-entry').first().waitFor({ state: 'detached', timeout: 5_000 });
  assert.equal(await page.locator('.carry-back-entry').count(), 0, 'sent entries are no longer listed');
  assert.equal(await page.locator('#carry-back-count').textContent(), 'nothing pending');
  assert.equal(await page.locator('#carry-back-sent').textContent(), '2 sent to the terminal');

  await page.reload();
  assert.equal(await page.locator('.carry-back-entry').count(), 0, 'and they stay gone after a reload');
  assert.equal(await page.locator('#carry-back-sent').textContent(), '2 sent to the terminal');
  assert.deepEqual(consoleErrors, []);
});
