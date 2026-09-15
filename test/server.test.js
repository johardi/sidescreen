import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedHost } from '../src/server.js';
import { preview } from '../src/page.js';
import { rawRequest, sampleTurn, startServer, waitForAnswer } from './server-helpers.js';

test('isAllowedHost accepts loopback hostnames on the bound port only', () => {
  assert.ok(isAllowedHost('127.0.0.1:7486', 7486));
  assert.ok(isAllowedHost('localhost:7486', 7486));
  assert.ok(isAllowedHost('LOCALHOST:7486', 7486));
  assert.ok(isAllowedHost('[::1]:7486', 7486));
  assert.ok(!isAllowedHost('127.0.0.1:7487', 7486), 'wrong port');
  assert.ok(!isAllowedHost('127.0.0.1', 7486), 'no port means port 80');
  assert.ok(isAllowedHost('localhost', 80));
  assert.ok(!isAllowedHost('evil.example:7486', 7486));
  assert.ok(!isAllowedHost('127.0.0.1.evil.example:7486', 7486));
  assert.ok(!isAllowedHost('192.168.1.10:7486', 7486));
  assert.ok(!isAllowedHost(undefined, 7486));
  assert.ok(!isAllowedHost('', 7486));
  assert.ok(!isAllowedHost('localhost:7486:1', 7486));
});

test('an allowed Host is served', async (t) => {
  const { port } = await startServer(t);
  const viaIp = await rawRequest({ port, path: '/turns/prompt-1' });
  assert.equal(viaIp.status, 200);
  assert.match(viaIp.body, /The quick brown fox/);
  const viaLocalhost = await rawRequest({ port, path: '/turns/prompt-1', host: `localhost:${port}` });
  assert.equal(viaLocalhost.status, 200);
});

test('a missing Host is rejected with 400', async (t) => {
  const { port } = await startServer(t);
  const response = await rawRequest({ port, path: '/turns/prompt-1', host: null });
  assert.equal(response.status, 400);
  assert.doesNotMatch(response.body, /quick brown fox/);
});

test('a foreign Host is rejected with 403', async (t) => {
  const { port } = await startServer(t);
  for (const host of [`evil.example:${port}`, `10.0.0.5:${port}`, `127.0.0.1:${port + 1}`]) {
    const response = await rawRequest({ port, path: '/turns/prompt-1', host });
    assert.equal(response.status, 403, host);
    assert.doesNotMatch(response.body, /quick brown fox/);
  }
});

test('the server binds to loopback only', async (t) => {
  const { server } = await startServer(t);
  const address = server.server.address();
  assert.ok(address && typeof address === 'object');
  assert.equal(address.address, '127.0.0.1');
});

test('one page per turn: the turn page renders the message and 404s for unknown ids', async (t) => {
  const second = sampleTurn({ promptId: 'prompt-2', message: 'Second turn here.' });
  const { url } = await startServer(t, { turns: [sampleTurn(), second] });

  const page = await fetch(new URL('/turns/prompt-2', url));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<article id="document" class="document">\s*<p>Second turn here\.<\/p>/);
  assert.doesNotMatch(html, /quick brown fox/);
  assert.match(html, /<script id="turn-data" type="application\/json">/);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);

  const missing = await fetch(new URL('/turns/nope', url));
  assert.equal(missing.status, 404);
});

test('the index lists turns newest first and says when ingestion is unavailable', async (t) => {
  const older = sampleTurn({ promptId: 'old', receivedAt: '2026-01-01T00:00:00.000Z', message: 'Older turn' });
  const newer = sampleTurn({ promptId: 'new', receivedAt: '2026-02-01T00:00:00.000Z', message: 'Newer turn' });
  const { url } = await startServer(t, { turns: [older, newer] });
  const html = await (await fetch(url)).text();
  assert.ok(html.indexOf('Newer turn') < html.indexOf('Older turn'));
  assert.match(html, /ingestion unavailable/);

  const api = await (await fetch(new URL('/api/turns', url))).json();
  assert.deepEqual(api.turns.map((/** @type {{ promptId: string }} */ turn) => turn.promptId), ['new', 'old']);
});

test('assets are served from the public directory only', async (t) => {
  const { url } = await startServer(t);
  const css = await fetch(new URL('/assets/app.css', url));
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') ?? '', /text\/css/);
  assert.equal((await fetch(new URL('/assets/..%2F..%2Fpackage.json', url))).status, 404);
  assert.equal((await fetch(new URL('/assets/nope.js', url))).status, 404);
});

test('creating a thread stores anchor, selection, and question, then records the dispatched answer', async (t) => {
  const { url } = await startServer(t, {
    dispatch: async ({ turn, thread, exchange }) => ({
      ok: true,
      answer: { text: `Asked about "${thread.selectedText}" in ${turn.promptId}: ${exchange.question}`, source: 'code', sourceDetail: 'src/x.js:1' },
      subAgentSessionId: 'sub-1',
    }),
  });
  const anchor = { start: { path: [0], offset: 4 }, end: { path: [0], offset: 9 }, text: 'quick' };
  const response = await fetch(new URL('/api/turns/prompt-1/threads', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anchor, selectedText: 'quick', question: 'Why quick?' }),
  });
  assert.equal(response.status, 201);
  const { thread } = await response.json();
  assert.deepEqual(thread.anchor, anchor);
  assert.equal(thread.selectedText, 'quick');
  assert.equal(thread.exchanges[0].question, 'Why quick?');
  assert.equal(thread.exchanges[0].status, 'pending');

  const answered = await waitForAnswer(url, thread.id);
  assert.equal(answered.exchanges[0].status, 'answered');
  assert.equal(answered.exchanges[0].answer.text, 'Asked about "quick" in prompt-1: Why quick?');
  assert.equal(answered.exchanges[0].answer.source, 'code');
  assert.match(answered.exchanges[0].answerHtml, /<p>Asked about/);
  assert.equal(answered.subAgentSessionId, 'sub-1');
});

test('thread creation validates its body', async (t) => {
  const { url, port } = await startServer(t);
  const post = (/** @type {Record<string, unknown>} */ headers, /** @type {string} */ body) =>
    rawRequest({ port, path: '/api/turns/prompt-1/threads', method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

  assert.equal((await post({}, JSON.stringify({ question: 'no anchor' }))).status, 400);
  assert.equal((await post({}, '{"anchor": ')).status, 400);
  assert.equal((await post({ 'Content-Type': 'text/plain' }, '{}')).status, 415);
  assert.equal((await post({ Origin: 'https://evil.example' }, '{}')).status, 403);
  assert.equal((await post({ 'Sec-Fetch-Site': 'cross-site' }, '{}')).status, 403);
  const unknownTurn = await fetch(new URL('/api/turns/nope/threads', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anchor: { start: { path: [], offset: 0 }, end: { path: [], offset: 1 }, text: 'x' }, selectedText: 'x', question: 'q' }),
  });
  assert.equal(unknownTurn.status, 404);
});

test('a dispatcher failure marks the exchange failed with the reason', async (t) => {
  const { url } = await startServer(t, { dispatch: async () => ({ ok: false, error: 'stub exploded' }) });
  const response = await fetch(new URL('/api/turns/prompt-1/threads', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anchor: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 3 }, text: 'The' }, selectedText: 'The', question: 'q' }),
  });
  const { thread } = await response.json();
  const failed = await waitForAnswer(url, thread.id);
  assert.equal(failed.exchanges[0].status, 'failed');
  assert.equal(failed.exchanges[0].error, 'stub exploded');
});

test('server-sent events announce thread changes', async (t) => {
  const { url } = await startServer(t, {
    dispatch: async () => ({ ok: true, answer: { text: 'a', source: 'none', sourceDetail: '' }, subAgentSessionId: null }),
  });
  const controller = new AbortController();
  const events = await fetch(new URL('/api/events', url), { signal: controller.signal });
  t.after(() => controller.abort());
  const reader = events.body?.getReader();
  assert.ok(reader);

  await fetch(new URL('/api/turns/prompt-1/threads', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anchor: { start: { path: [0], offset: 0 }, end: { path: [0], offset: 3 }, text: 'The' }, selectedText: 'The', question: 'q' }),
  });

  let received = '';
  const deadline = Date.now() + 5_000;
  while (!/event: thread-updated/.test(received) && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    received += new TextDecoder().decode(value);
  }
  assert.match(received, /event: thread-created/);
  assert.match(received, /event: thread-updated/);
});

test('the turn list preview is the first line as plain text', () => {
  assert.equal(preview('# Summary of the **change**\n\nMore.'), 'Summary of the change');
  assert.equal(preview('\n\n- first `item` [link](http://x)\n'), 'first item link');
  assert.equal(preview('```js\ncode\n```\nAfter the fence.'), 'After the fence.');
  assert.equal(preview('> quoted *text*'), 'quoted text');
  const long = preview('x'.repeat(200));
  assert.ok(long.length <= 140 && long.endsWith('…'), long);
});
