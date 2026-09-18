import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NEWEST_TURN_ERROR, isAllowedHost } from '../../src/web/server.js';
import { preview } from '../../src/web/page.js';
import { createDispatch } from '../../src/dispatch/dispatch.js';
import { READ_ONLY_CONFIG } from '../../src/dispatch/codex-adapter.js';
import { EARLIER_HEADING, SINCE_HEADING } from '../../src/dispatch/dispatch-prompt.js';
import { upsertSession } from '../../src/store/sessions.js';
import { Store } from '../../src/store/store.js';
import { FIXTURES, tempDir } from '../helpers.js';
import { rawRequest, sampleTurn, startServer, turnHref, waitForAnswer } from '../server-helpers.js';
import { projectId } from '../../src/store/projects.js';
import { VERSION } from '../../src/version.js';

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
  const path = turnHref(sampleTurn());
  const viaIp = await rawRequest({ port, path });
  assert.equal(viaIp.status, 200);
  assert.match(viaIp.body, /The quick brown fox/);
  const viaLocalhost = await rawRequest({ port, path, host: `localhost:${port}` });
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

test('one page per turn: the pinned address renders that turn only, and unknown ids answer 404', async (t) => {
  const second = sampleTurn({ promptId: 'prompt-2', message: 'Second turn here.' });
  const { url } = await startServer(t, { turns: [sampleTurn(), second] });

  const page = await fetch(new URL(turnHref(second), url));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<article id="document" class="document">\s*<p>Second turn here\.<\/p>/);
  const article = /<article id="document" class="document">([\s\S]*?)<\/article>/.exec(html)?.[1] ?? '';
  assert.doesNotMatch(article, /quick brown fox/, 'the other turn is in the sidebar, not in the document');
  assert.match(html, /<script id="turn-data" type="application\/json">/);
  assert.match(html, /<script id="workspace-data" type="application\/json">/);
  assert.match(html, /data-scope="turn"/);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);

  const project = projectId(second.cwd);
  const missing = await fetch(new URL(`/projects/${project}/sessions/session-1/turns/nope`, url));
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /href="\/">All projects/);
  assert.equal((await fetch(new URL(`/projects/${project}/sessions/nope`, url))).status, 404);
  assert.equal((await fetch(new URL('/projects/nope', url))).status, 404);
  assert.equal((await fetch(new URL('/turns/nope', url))).status, 404);
});

test('the former turn address, and any address naming the wrong project or session, redirect to the pinned address', async (t) => {
  const turn = sampleTurn();
  const other = sampleTurn({ promptId: 'elsewhere', sessionId: 'session-9', cwd: '/Users/example/other' });
  const { url, port } = await startServer(t, { turns: [turn, other] });
  const canonical = turnHref(turn);

  const legacy = await rawRequest({ port, path: '/turns/prompt-1' });
  assert.equal(legacy.status, 302);
  assert.equal(legacy.headers.location, canonical);

  const wrongProject = await rawRequest({ port, path: `/projects/${projectId(other.cwd)}/sessions/session-1/turns/prompt-1` });
  assert.equal(wrongProject.status, 302);
  assert.equal(wrongProject.headers.location, canonical);

  const wrongSession = await rawRequest({ port, path: `/projects/${projectId(turn.cwd)}/sessions/session-9/turns/prompt-1` });
  assert.equal(wrongSession.status, 302);
  assert.equal(wrongSession.headers.location, canonical);

  const sessionUnderWrongProject = await rawRequest({ port, path: `/projects/${projectId(other.cwd)}/sessions/session-1` });
  assert.equal(sessionUnderWrongProject.status, 302);
  assert.equal(sessionUnderWrongProject.headers.location, `/projects/${projectId(turn.cwd)}/sessions/session-1`);

  const followed = await fetch(new URL('/turns/prompt-1', url));
  assert.equal(followed.status, 200);
  assert.match(await followed.text(), /The quick brown fox/);
});

test('the project and session addresses show the newest turn in their scope and say what they follow', async (t) => {
  const olderA = sampleTurn({ promptId: 'a-old', sessionId: 'sess-a', receivedAt: '2026-01-01T00:00:00.000Z', message: 'Older in A' });
  const newerA = sampleTurn({ promptId: 'a-new', sessionId: 'sess-a', receivedAt: '2026-01-03T00:00:00.000Z', message: 'Newer in A' });
  const onlyB = sampleTurn({ promptId: 'b-only', sessionId: 'sess-b', receivedAt: '2026-01-02T00:00:00.000Z', message: 'Only in B' });
  const { url } = await startServer(t, { turns: [olderA, newerA, onlyB] });
  const project = projectId(olderA.cwd);

  const projectPage = await (await fetch(new URL(`/projects/${project}`, url))).text();
  assert.match(projectPage, /<p>Newer in A<\/p>/, 'the project address shows the newest turn of any session');
  assert.match(projectPage, /<span class="topbar-scope" data-scope="project">/, 'following the project: the scope tag is a label');
  assert.doesNotMatch(projectPage, /sidebar-latest/, 'the sidebar holds sessions and turns only');

  const sessionPage = await (await fetch(new URL(`/projects/${project}/sessions/sess-b`, url))).text();
  assert.match(sessionPage, /<p>Only in B<\/p>/, 'the session address shows that session\'s newest turn');
  assert.match(sessionPage, new RegExp(`<a class="topbar-scope" data-scope="session" href="/projects/${project}"`), 'following a session: the scope tag returns to the project');

  const pinnedPage = await (await fetch(new URL(`/projects/${project}/sessions/sess-a/turns/a-old`, url))).text();
  assert.match(pinnedPage, new RegExp(`<a class="topbar-scope" data-scope="turn" href="/projects/${project}"`), 'pinned: the scope tag returns to the project');
});

test('the header reads back, title, sidebar toggle, centred name with scope tag, then path, with no time', async (t) => {
  const { url } = await startServer(t);
  const page = await (await fetch(new URL('/turns/prompt-1', url))).text();
  const header = /<header class="topbar">([\s\S]*?)<\/header>/.exec(page)?.[1] ?? '';
  const order = ['class="topbar-back icon-button" href="/"', 'class="brand" href="/">SideScreen<', 'id="sidebar-toggle"', 'class="topbar-center"', 'class="topbar-project">proj<', 'class="topbar-scope"', 'class="topbar-path"'];
  const positions = order.map((needle) => header.indexOf(needle));
  assert.ok(positions.every((position) => position >= 0), `every header part is present: ${JSON.stringify(positions)}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'and in this order');
  assert.doesNotMatch(header, /<time/, 'the turn\'s time is on its sidebar row, not in the header');
  assert.doesNotMatch(header, /All projects</, 'the text link gave way to the back control');
  assert.match(header, /aria-label="All projects"/);
  assert.match(page, /<title>SideScreen: proj: prompt-1<\/title>/);
});

test('the landing page lists projects newest first with name, path, and session count, and is empty without turns', async (t) => {
  const alpha = sampleTurn({ promptId: 'p-alpha', sessionId: 'sess-alpha', cwd: '/w/alpha', receivedAt: '2026-01-01T00:00:00.000Z' });
  const beta1 = sampleTurn({ promptId: 'p-beta-1', sessionId: 'sess-beta-1', cwd: '/w/beta', receivedAt: '2026-01-02T00:00:00.000Z' });
  const beta2 = sampleTurn({ promptId: 'p-beta-2', sessionId: 'sess-beta-2', cwd: '/w/beta', receivedAt: '2026-01-03T00:00:00.000Z' });
  const { url } = await startServer(t, { turns: [alpha, beta1, beta2] });
  const html = await (await fetch(url)).text();
  assert.ok(html.indexOf('/w/beta') < html.indexOf('/w/alpha'), 'the project with the newer turn comes first');
  assert.match(html, /class="project-name">beta<\/span>/);
  assert.match(html, /class="project-path">\/w\/beta<\/span>/);
  assert.match(html, /class="project-sessions">2 sessions<\/span>/);
  assert.match(html, /class="project-sessions">1 session<\/span>/);
  assert.doesNotMatch(html, /quick brown fox/, 'no turn text on the landing page');
  const api = await (await fetch(new URL('/api/projects', url))).json();
  assert.deepEqual(api.projects.map((/** @type {{ cwd: string, sessionCount: number }} */ project) => [project.cwd, project.sessionCount]), [['/w/beta', 2], ['/w/alpha', 1]]);

  const { url: emptyUrl } = await startServer(t, { turns: [] });
  const emptyHtml = await (await fetch(emptyUrl)).text();
  assert.match(emptyHtml, /No project has delivered a turn yet/);
  assert.doesNotMatch(emptyHtml, /class="project-link"/);
});

test('the sidebar keeps two concurrent sessions apart, orders them by latest turn, and the project endpoint carries the same data', async (t) => {
  const turns = [
    sampleTurn({ promptId: 'a1', sessionId: 'sess-a', receivedAt: '2026-01-01T00:00:00.000Z', message: 'A one' }),
    sampleTurn({ promptId: 'b1', sessionId: 'sess-b', receivedAt: '2026-01-01T00:30:00.000Z', message: 'B one' }),
    sampleTurn({ promptId: 'a2', sessionId: 'sess-a', receivedAt: '2026-01-01T01:00:00.000Z', message: 'A two' }),
    sampleTurn({ promptId: 'b2', sessionId: 'sess-b', receivedAt: '2026-01-01T01:30:00.000Z', message: 'B two' }),
    sampleTurn({ promptId: 'elsewhere', sessionId: 'sess-x', cwd: '/Users/example/other', receivedAt: '2026-01-02T00:00:00.000Z', message: 'Other project' }),
  ];
  const { url } = await startServer(t, { turns });
  const project = projectId(turns[0].cwd);
  const data = await (await fetch(new URL(`/api/projects/${project}`, url))).json();
  assert.deepEqual(
    data.sessions.map((/** @type {{ sessionId: string, turns: { promptId: string }[], latestPromptId: string }} */ session) => [session.sessionId, session.turns.map((turn) => turn.promptId), session.latestPromptId]),
    [
      ['sess-b', ['b2', 'b1'], 'b2'],
      ['sess-a', ['a2', 'a1'], 'a2'],
    ],
    'two sessions, each with its own turns newest first, the session with the newer turn first',
  );
  assert.equal(data.latestPromptId, 'b2');
  assert.equal(data.project.cwd, turns[0].cwd);
  assert.doesNotMatch(data.sidebarHtml, /Other project/, 'the other project does not appear');
  assert.match(data.sidebarHtml, /class="turn-preview">B two</);
  assert.equal(data.sessions[0].title, null);
  assert.equal(typeof data.sessions[0].label, 'string');
  assert.equal(data.sessions[0].turns[0].threadCount, 0);

  const missing = await fetch(new URL('/api/projects/nope', url));
  assert.equal(missing.status, 404);
});

test('DELETE removes a turn and its threads behind the same-origin check, and says where the page goes next', async (t) => {
  const turns = [sampleTurn({ receivedAt: '2026-01-01T00:00:00.000Z' }), sampleTurn({ promptId: 'prompt-2', receivedAt: '2026-01-02T00:00:00.000Z' })];
  const { url, port, store } = await startServer(t, {
    turns,
    dispatch: async () => ({ ok: true, answer: { text: 'a', source: 'none', sourceDetail: '' }, subAgentSessionId: null }),
  });
  const project = projectId(turns[0].cwd);
  const anchor = { start: { path: [0], offset: 0 }, end: { path: [0], offset: 3 }, text: 'The' };
  for (const question of ['one', 'two']) {
    const created = await fetch(new URL('/api/turns/prompt-1/threads', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anchor, selectedText: 'The', question }),
    });
    assert.equal(created.status, 201);
  }
  await fetch(new URL('/api/sessions/session-1/carry-back', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Keep this.' }),
  });

  assert.equal((await rawRequest({ port, path: '/api/turns/prompt-1', method: 'DELETE', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await rawRequest({ port, path: '/api/turns/prompt-1', method: 'DELETE', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(new URL('/api/turns/nope', url), { method: 'DELETE' })).status, 404);

  const removed = await fetch(new URL('/api/turns/prompt-1', url), { method: 'DELETE' });
  assert.equal(removed.status, 200);
  const body = await removed.json();
  assert.deepEqual(body.removed, { promptId: 'prompt-1', sessionId: 'session-1', projectId: project, removedThreads: 2, sessionRemoved: false });
  assert.equal(body.next, `/projects/${project}`);
  let state = await store.read();
  assert.equal(state.turns['prompt-1'], undefined);
  assert.deepEqual(Object.keys(state.threads), []);
  assert.equal(state.carryBack['session-1'].length, 1, 'carry-back survives');
  assert.equal((await fetch(new URL(turnHref(turns[0]), url))).status, 404, 'the removed turn\'s address answers not found');

  const newest = await fetch(new URL('/api/turns/prompt-2', url), { method: 'DELETE' });
  assert.equal(newest.status, 409, "a session's newest turn cannot be removed");
  assert.equal((await newest.json()).error, NEWEST_TURN_ERROR);
  state = await store.read();
  assert.ok(state.turns['prompt-2'], 'the newest turn remains');
  assert.ok(state.sessions['session-1'], 'and so does its session');
  assert.equal(state.carryBack['session-1'].length, 1);
});

test('the ingestion warning is about the selected project, not the directory the server started in', async (t) => {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const project = await tempDir(t, 'sidescreen-hooked-');
  await mkdir(join(project, '.claude'), { recursive: true });
  await writeFile(
    join(project, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node /x/bin/sidescreen.js ingest' }] }] } }),
    'utf8',
  );
  const hooked = sampleTurn({ promptId: 'hooked', sessionId: 'sess-hooked', cwd: project, message: 'Hooked project' });
  const bare = sampleTurn({ promptId: 'bare', sessionId: 'sess-bare', cwd: '/Users/example/bare', message: 'Bare project' });
  const { url, stateDir } = await startServer(t, { turns: [hooked, bare] });
  assert.notEqual(stateDir, project, 'the server was started somewhere else');

  const hookedPage = await (await fetch(new URL(`/projects/${projectId(project)}`, url))).text();
  assert.doesNotMatch(hookedPage, /ingestion unavailable/);
  const barePage = await (await fetch(new URL(`/projects/${projectId('/Users/example/bare')}`, url))).text();
  assert.match(barePage, /ingestion unavailable for bare/);
  const api = await (await fetch(new URL(`/api/projects/${projectId(project)}`, url))).json();
  assert.equal(api.ingestionAvailable, true);
});

test('the server\'s own directory is a project before it has delivered a turn, shown as an empty workspace', async (t) => {
  const { url, stateDir } = await startServer(t, { turns: [] });
  const page = await fetch(new URL(`/projects/${projectId(stateDir)}`, url));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /No turns yet from/);
  assert.match(html, /class="sidebar-empty"/);
  assert.doesNotMatch(html, /id="turn-data"/, 'no document, so no document script');
  assert.match(html, /id="workspace-data"/, 'but the sidebar script is there to fill in on the first turn');
  const landing = await (await fetch(url)).text();
  assert.doesNotMatch(landing, /class="project-link"/, 'the landing page lists only projects that have delivered a turn');
});

test('assets are served from the public directory only', async (t) => {
  const { url } = await startServer(t);
  const css = await fetch(new URL('/assets/app.css', url));
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') ?? '', /text\/css/);
  assert.equal((await fetch(new URL('/assets/..%2F..%2Fpackage.json', url))).status, 404);
  assert.equal((await fetch(new URL('/assets/nope.js', url))).status, 404);
});

test('the favicon is served as SVG, and the icons carry the Font Awesome license comment', async (t) => {
  const { url } = await startServer(t);
  const favicon = await fetch(new URL('/assets/favicon.svg', url));
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get('content-type'), 'image/svg+xml');
  assert.match(await favicon.text(), /Font Awesome Free .* License - https:\/\/fontawesome\.com\/license\/free/);
  for (const path of ['/', '/turns/prompt-1', '/nope']) {
    const page = await (await fetch(new URL(path, url))).text();
    assert.match(page, /<link rel="icon" type="image\/svg\+xml" href="\/assets\/favicon\.svg">/, `${path} links the favicon`);
  }
  const workspace = await (await fetch(new URL('/turns/prompt-1', url))).text();
  assert.match(workspace, /<svg class="icon-sprite"[^>]*><!--! Font Awesome Free .* License - https:\/\/fontawesome\.com\/license\/free/);
  assert.match(workspace, /<symbol id="icon-arrow-left"/);
  assert.match(workspace, /<symbol id="icon-table-columns"/);
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
  assert.equal(answered.exchanges[0].subAgentSessionId, 'sub-1');
  assert.equal(answered.exchanges[0].backend, 'claude', 'an untagged first question goes to the default backend');
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

// ---- Group 5: threads fork the answer they continue -------------------------

const STUB_CODEX = join(FIXTURES, 'stub-codex.js');
const ANCHOR = { start: { path: [0], offset: 4 }, end: { path: [0], offset: 9 }, text: 'quick' };

const STUB_CLAUDE = join(FIXTURES, 'stub-claude.js');

/** @typedef {{ args: string[], prompt: string, subcommand: string, continuedSession: string|null, cwd: string, model?: string|null }} StubRun */

/**
 * @param {string} path
 * @returns {Promise<StubRun[]>} One entry per run, or none when the stub never ran.
 */
async function readStubLog(path) {
  try {
    return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * A server whose dispatcher is the real dispatch path, pointed at both stubs,
 * with Codex as the default so untagged questions exercise it.
 *
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} [extraEnv]
 */
async function startWithStubCodex(t, extraEnv = {}) {
  return startWithStubs(t, { SIDESCREEN_SUBAGENT: 'codex', ...extraEnv });
}

/**
 * A server whose dispatcher is the real dispatch path, pointed at a stub for
 * each backend. The turn records the model that produced it.
 *
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} [extraEnv]
 */
async function startWithStubs(t, extraEnv = {}) {
  const project = await tempDir(t, 'sidescreen-project-');
  const stateDir = await tempDir(t, 'sidescreen-state-');
  const codexLog = join(project, 'codex.log');
  const claudeLog = join(project, 'claude.log');
  const env = {
    ...process.env,
    HOME: '/nonexistent',
    SIDESCREEN_CODEX_BIN: STUB_CODEX,
    SIDESCREEN_CLAUDE_BIN: STUB_CLAUDE,
    STUB_CODEX_LOG_TO: codexLog,
    STUB_CLAUDE_LOG_TO: claudeLog,
    SIDESCREEN_CONVENTIONS_FILES: join(project, 'none.md'),
    SIDESCREEN_STATE_DIR: stateDir,
    ...extraEnv,
  };
  const started = await startServer(t, { stateDir, env, turns: [sampleTurn({ cwd: project, model: 'claude-fable-5-1' })], dispatch: createDispatch({ env, stateDir }) });
  return { ...started, project, readLog: () => readStubLog(codexLog), codex: () => readStubLog(codexLog), claude: () => readStubLog(claudeLog) };
}

/**
 * @param {string} url
 * @param {string} path
 * @param {unknown} body
 */
const postJson = (url, path, body) =>
  fetch(new URL(path, url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** @param {string} url */
async function createAnsweredThread(url, question = 'Why quick?') {
  const response = await postJson(url, '/api/turns/prompt-1/threads', { anchor: ANCHOR, selectedText: 'quick', question });
  assert.equal(response.status, 201);
  const { thread } = await response.json();
  return waitForAnswer(url, thread.id);
}

test('5.1 each answered exchange records its own sub-agent session id, and it survives a store reload', async (t) => {
  const { url, stateDir } = await startWithStubCodex(t);
  const thread = await createAnsweredThread(url);
  assert.match(thread.exchanges[0].subAgentSessionId, /^stub-thread-\d+$/);
  assert.equal(thread.exchanges[0].backend, 'codex');

  const reloaded = (await new Store(stateDir).read()).threads[thread.id];
  assert.equal(reloaded.exchanges[0].subAgentSessionId, thread.exchanges[0].subAgentSessionId);
  assert.equal(reloaded.exchanges[0].backend, 'codex');
  assert.equal('subAgentSessionId' in reloaded, false, 'no thread-level copy of the session id');
});

test('5.2 a follow-up forks the session of the answer it continues, and that answer keeps its id', async (t) => {
  const { url, readLog } = await startWithStubCodex(t);
  const thread = await createAnsweredThread(url);
  const firstSession = thread.exchanges[0].subAgentSessionId;

  const response = await postJson(url, `/api/threads/${thread.id}/exchanges`, { question: 'And why brown?' });
  assert.equal(response.status, 201);
  const updated = await waitForAnswer(url, thread.id);
  assert.equal(updated.exchanges.length, 2);
  assert.equal(updated.exchanges[1].question, 'And why brown?');
  assert.equal(updated.exchanges[1].status, 'answered');

  const log = await readLog();
  assert.equal(log.length, 2);
  assert.equal(log[0].subcommand, 'new');
  assert.equal(log[1].subcommand, 'fork', 'a follow-up is a fork, not a cold start');
  assert.equal(log[1].continuedSession, firstSession, 'it forks the session of the answer it continues');
  assert.equal(log[1].args[0], 'exec');
  assert.ok(log[1].args.includes(READ_ONLY_CONFIG), 'the fork carries the read-only policy');
  assert.ok(log[1].prompt.includes('## Conventions forwarded from the user'));
  assert.ok(log[1].prompt.includes('And why brown?'));
  assert.ok(!log[1].prompt.includes("The agent's output being reviewed"), 'the forked session already holds the document');

  assert.equal(updated.exchanges[0].subAgentSessionId, firstSession, "the continued answer's session id is unchanged");
  assert.ok(updated.exchanges[1].subAgentSessionId.startsWith(`fork-of-${firstSession}-`));
});

test('a follow-up while the current answer is pending is refused', async (t) => {
  const { url } = await startWithStubCodex(t, { STUB_CODEX_DELAY_MS: '1500' });
  const created = await postJson(url, '/api/turns/prompt-1/threads', { anchor: ANCHOR, selectedText: 'quick', question: 'q' });
  const { thread } = await created.json();
  const refused = await postJson(url, `/api/threads/${thread.id}/exchanges`, { question: 'too soon' });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /Wait for the current answer/);
  await waitForAnswer(url, thread.id, 10_000);
});

test('a follow-up after a failed first answer starts fresh, since there is no session to fork', async (t) => {
  /** @type {import('../../src/dispatch/dispatch.js').DispatchTarget[]} */
  const targets = [];
  let calls = 0;
  const { url } = await startServer(t, {
    dispatch: async ({ target }) => {
      targets.push(target);
      calls += 1;
      if (calls === 1) return { ok: false, error: 'first try exploded' };
      return { ok: true, answer: { text: 'ok', source: 'code', sourceDetail: '' }, subAgentSessionId: 'fresh' };
    },
  });
  const created = await postJson(url, '/api/turns/prompt-1/threads', { anchor: ANCHOR, selectedText: 'quick', question: 'q' });
  const { thread } = await created.json();
  const failed = await waitForAnswer(url, thread.id);
  assert.equal(failed.exchanges[0].status, 'failed');

  const branchFromFailed = await postJson(url, `/api/threads/${thread.id}/branches`, { exchangeId: failed.exchanges[0].id, question: 'b' });
  assert.equal(branchFromFailed.status, 409, 'a failed answer has no session to branch from');

  assert.equal((await postJson(url, `/api/threads/${thread.id}/exchanges`, { question: 'again' })).status, 201);
  const retried = await waitForAnswer(url, thread.id);
  assert.equal(retried.exchanges[1].status, 'answered');
  assert.deepEqual(targets.map((target) => target.mode), ['new', 'new']);
});

test('5.3 a branch forks the exchange it was taken from, not the thread\'s latest, and leaves the parent untouched', async (t) => {
  const { url, readLog } = await startWithStubCodex(t);
  const thread = await createAnsweredThread(url);
  assert.equal((await postJson(url, `/api/threads/${thread.id}/exchanges`, { question: 'follow-up' })).status, 201);
  const parent = await waitForAnswer(url, thread.id);
  const [first, second] = parent.exchanges;
  assert.notEqual(first.subAgentSessionId, second.subAgentSessionId);
  const parentBefore = JSON.stringify(parent);

  const response = await postJson(url, `/api/threads/${thread.id}/branches`, { exchangeId: first.id, question: 'sideways from the first answer' });
  assert.equal(response.status, 201);
  const { thread: branch } = await response.json();
  assert.equal(branch.parentThreadId, thread.id);
  assert.equal(branch.branchedFromExchangeId, first.id);
  assert.deepEqual(branch.anchor, thread.anchor);
  assert.equal(branch.selectedText, thread.selectedText);
  const answeredBranch = await waitForAnswer(url, branch.id);

  const log = await readLog();
  assert.equal(log.length, 3);
  assert.equal(log[2].subcommand, 'fork');
  assert.equal(log[2].continuedSession, first.subAgentSessionId, 'the branch forks the first answer, not the latest');
  assert.ok(answeredBranch.exchanges[0].subAgentSessionId.startsWith(`fork-of-${first.subAgentSessionId}-`));
  assert.notEqual(answeredBranch.exchanges[0].subAgentSessionId, second.subAgentSessionId, 'branch and parent hold different session ids');

  const parentAfter = await (await fetch(new URL(`/api/threads/${thread.id}`, url))).json();
  assert.equal(JSON.stringify(parentAfter.thread), parentBefore, 'answering the branch did not mutate the parent');

  assert.equal((await postJson(url, `/api/threads/${thread.id}/branches`, { exchangeId: 'nope', question: 'x' })).status, 404);
  assert.equal((await postJson(url, '/api/threads/nope/branches', { exchangeId: first.id, question: 'x' })).status, 404);
});

test('5.4 two branches dispatched at once both land on their own threads', async (t) => {
  const { url, readLog } = await startWithStubCodex(t, { STUB_CODEX_DELAY_MS: '300' });
  const thread = await createAnsweredThread(url);
  const source = thread.exchanges[0];

  const started = Date.now();
  const [left, right] = await Promise.all([
    postJson(url, `/api/threads/${thread.id}/branches`, { exchangeId: source.id, question: 'left?' }),
    postJson(url, `/api/threads/${thread.id}/branches`, { exchangeId: source.id, question: 'right?' }),
  ]);
  assert.equal(left.status, 201);
  assert.equal(right.status, 201);
  const [leftThread, rightThread] = await Promise.all([
    left.json().then((body) => waitForAnswer(url, body.thread.id, 10_000)),
    right.json().then((body) => waitForAnswer(url, body.thread.id, 10_000)),
  ]);
  const elapsed = Date.now() - started;

  assert.notEqual(leftThread.id, rightThread.id);
  assert.equal(leftThread.exchanges[0].question, 'left?');
  assert.equal(rightThread.exchanges[0].question, 'right?');
  assert.equal(leftThread.exchanges[0].status, 'answered');
  assert.equal(rightThread.exchanges[0].status, 'answered');
  assert.notEqual(leftThread.exchanges[0].subAgentSessionId, rightThread.exchanges[0].subAgentSessionId);
  assert.ok(leftThread.exchanges[0].subAgentSessionId.startsWith(`fork-of-${source.subAgentSessionId}-`));
  assert.ok(rightThread.exchanges[0].subAgentSessionId.startsWith(`fork-of-${source.subAgentSessionId}-`));
  assert.ok(elapsed < 2_000, `both ran concurrently (took ${elapsed}ms with a 300ms stub delay each)`);
  assert.equal((await readLog()).filter((entry) => entry.subcommand === 'fork').length, 2);
});


// ---- 3.5: who answers, and from where ---------------------------------------------

/**
 * @param {string} url
 * @param {string} threadId
 * @param {string} question
 */
async function followUp(url, threadId, question) {
  const response = await postJson(url, `/api/threads/${threadId}/exchanges`, { question });
  assert.equal(response.status, 201, await response.text());
  return waitForAnswer(url, threadId);
}

test('3.5 an untagged first question goes to the parent\'s harness pinned to the turn\'s model; a leading @codex goes to Codex with the tag stripped from the prompt but kept in the question', async (t) => {
  const { url, claude, codex } = await startWithStubs(t);
  const viaDefault = await createAnsweredThread(url, 'Why quick?');
  assert.equal(viaDefault.exchanges[0].backend, 'claude');
  assert.equal(viaDefault.exchanges[0].status, 'answered');
  assert.equal(viaDefault.exchanges[0].model, 'claude-fable-5-1', 'the model the answer ran on is recorded');
  let claudeRuns = await claude();
  assert.equal(claudeRuns.length, 1);
  assert.equal(claudeRuns[0].model, 'claude-fable-5-1', 'pinned to the model the transcript named for the turn');
  assert.equal(claudeRuns[0].subcommand, 'new');
  assert.deepEqual(await codex(), [], 'Codex was not needed');

  const tagged = await createAnsweredThread(url, '@codex Why quick?');
  assert.equal(tagged.exchanges[0].backend, 'codex');
  assert.equal(tagged.exchanges[0].question, '@codex Why quick?', 'stored as typed');
  const codexRuns = await codex();
  assert.equal(codexRuns.length, 1);
  assert.ok(codexRuns[0].prompt.includes('## The question\n\nWhy quick?\n'), 'the tag is stripped from the prompt');
  assert.ok(!codexRuns[0].prompt.includes('@codex'));
  assert.equal(codexRuns[0].subcommand, 'new');

  const upper = await createAnsweredThread(url, '@CODEX and this?');
  assert.equal(upper.exchanges[0].backend, 'codex');
  claudeRuns = await claude();
  assert.equal(claudeRuns.length, 1, 'no further claude runs');

  const bare = await postJson(url, '/api/turns/prompt-1/threads', { anchor: ANCHOR, selectedText: 'quick', question: '@codex' });
  assert.equal(bare.status, 400);
  assert.match((await bare.json()).error, /question after the backend tag/);
});

test('3.5 a tag in the middle of a question routes it with the token removed; an address or an escaped tag is text and the question travels unchanged', async (t) => {
  const { url, claude, codex } = await startWithStubs(t);
  const thread = await createAnsweredThread(url, 'Why quick?');
  const plain = await followUp(url, thread.id, 'mail me@codex.com and \\@codex about @codex.com');
  assert.equal(plain.exchanges[1].backend, 'claude', 'no tag, so the follow-up stays with the backend that answered last');
  let claudeRuns = await claude();
  assert.equal(claudeRuns.length, 2);
  assert.equal(claudeRuns[1].subcommand, 'fork');
  assert.equal(claudeRuns[1].continuedSession, thread.exchanges[0].subAgentSessionId);
  assert.ok(claudeRuns[1].prompt.includes('mail me@codex.com and \\@codex about @codex.com'), 'the question reaches the sub-agent unchanged');
  assert.deepEqual(await codex(), []);

  const switched = await followUp(url, thread.id, 'does @codex agree with this?');
  assert.equal(switched.exchanges[2].backend, 'codex');
  assert.equal(switched.exchanges[2].question, 'does @codex agree with this?', 'stored as typed');
  const codexRuns = await codex();
  assert.equal(codexRuns.length, 1);
  assert.ok(codexRuns[0].prompt.includes('## The question\n\ndoes agree with this?\n'), 'the token is removed from the prompt');
  claudeRuns = await claude();
  assert.equal(claudeRuns.length, 2, 'claude was not asked again');
});

test('3.5 sticky follow-ups, a switch that carries the thread as text, and a switch back that forks the earlier session with the gap', async (t) => {
  const { url, claude, codex } = await startWithStubs(t, { STUB_CLAUDE_ANSWER_JSON: JSON.stringify({ answer: 'CLAUDE-A1 because mkdir is atomic.', source: 'transcript', sourceDetail: 'turn 7' }), STUB_CODEX_ANSWER_JSON: JSON.stringify({ answer: 'CODEX-ANSWER yes, agreed.', source: 'code', sourceDetail: 'src/store.js:12' }) });
  const thread = await createAnsweredThread(url, 'Why is the lock a directory?');
  const s1 = thread.exchanges[0].subAgentSessionId;

  // Switch: no codex answer yet, so a cold start carrying the earlier exchange as text.
  let updated = await followUp(url, thread.id, '@codex do you agree?');
  assert.equal(updated.exchanges[1].backend, 'codex');
  assert.equal(updated.exchanges[1].status, 'answered');
  let codexRuns = await codex();
  assert.equal(codexRuns.length, 1);
  assert.equal(codexRuns[0].subcommand, 'new', 'no codex session to fork');
  assert.ok(codexRuns[0].prompt.includes(EARLIER_HEADING));
  assert.ok(codexRuns[0].prompt.includes('Question: Why is the lock a directory?'));
  assert.ok(codexRuns[0].prompt.includes('CLAUDE-A1 because mkdir is atomic.'));
  assert.ok(codexRuns[0].prompt.includes('answered by claude'));
  assert.ok(codexRuns[0].prompt.includes('## The question\n\ndo you agree?\n'));
  const s2 = updated.exchanges[1].subAgentSessionId;

  // Sticky: no tag continues with codex, forking its own last session, no gap.
  updated = await followUp(url, thread.id, 'What about a network drive?');
  assert.equal(updated.exchanges[2].backend, 'codex');
  codexRuns = await codex();
  assert.equal(codexRuns.length, 2);
  assert.equal(codexRuns[1].subcommand, 'fork');
  assert.equal(codexRuns[1].continuedSession, s2);
  assert.ok(!codexRuns[1].prompt.includes(SINCE_HEADING), 'nothing happened between its answers');
  assert.ok(!codexRuns[1].prompt.includes(EARLIER_HEADING));

  // Switch back: fork the newest claude session, with both codex exchanges as the gap.
  updated = await followUp(url, thread.id, '@claude and your view?');
  assert.equal(updated.exchanges[3].backend, 'claude');
  assert.equal(updated.exchanges[3].status, 'answered');
  const claudeRuns = await claude();
  assert.equal(claudeRuns.length, 2);
  assert.equal(claudeRuns[1].subcommand, 'fork');
  assert.equal(claudeRuns[1].continuedSession, s1, 'the newest claude answer, not the thread\'s latest');
  assert.ok(claudeRuns[1].prompt.includes(SINCE_HEADING));
  assert.ok(claudeRuns[1].prompt.includes('another sub-agent (codex)'));
  assert.ok(claudeRuns[1].prompt.includes('Question: do you agree?'), 'the tag is stripped in the gap too');
  assert.ok(claudeRuns[1].prompt.includes('Question: What about a network drive?'));
  assert.ok(claudeRuns[1].prompt.includes('CODEX-ANSWER yes, agreed.'));
  assert.ok(!claudeRuns[1].prompt.includes("The agent's output being reviewed"), 'a fork does not repeat the document');
  assert.ok(updated.exchanges[3].subAgentSessionId.startsWith(`fork-of-${s1}-`));
});

test('3.5 a tagged branch sees the lineage up to its branch point only, and an untagged branch stays with the answer it branches from', async (t) => {
  const { url, claude, codex } = await startWithStubs(t);
  const thread = await createAnsweredThread(url, 'FIRST-Q?');
  await followUp(url, thread.id, 'SECOND-Q?');
  const parent = await followUp(url, thread.id, 'THIRD-Q?');
  const [first, second] = parent.exchanges;

  const tagged = await postJson(url, `/api/threads/${thread.id}/branches`, { exchangeId: second.id, question: '@codex sideways?' });
  assert.equal(tagged.status, 201);
  const taggedBranch = await waitForAnswer(url, (await tagged.json()).thread.id);
  assert.equal(taggedBranch.exchanges[0].backend, 'codex');
  assert.equal(taggedBranch.exchanges[0].question, '@codex sideways?');
  const codexRuns = await codex();
  assert.equal(codexRuns.length, 1);
  assert.equal(codexRuns[0].subcommand, 'new');
  assert.ok(codexRuns[0].prompt.includes('Question: FIRST-Q?'));
  assert.ok(codexRuns[0].prompt.includes('Question: SECOND-Q?'));
  assert.ok(!codexRuns[0].prompt.includes('THIRD-Q?'), 'asked after the branch point');

  const plain = await postJson(url, `/api/threads/${thread.id}/branches`, { exchangeId: first.id, question: 'plain sideways?' });
  assert.equal(plain.status, 201);
  const plainBranch = await waitForAnswer(url, (await plain.json()).thread.id);
  assert.equal(plainBranch.exchanges[0].backend, 'claude');
  const claudeRuns = await claude();
  assert.equal(claudeRuns[claudeRuns.length - 1].subcommand, 'fork');
  assert.equal(claudeRuns[claudeRuns.length - 1].continuedSession, first.subAgentSessionId, 'the branch forks the answer it was taken from');
});

test('3.5 a backend whose CLI cannot be started fails the exchange by name, and the other backend is not asked instead', async (t) => {
  const { url, claude } = await startWithStubs(t, { SIDESCREEN_CODEX_BIN: '/nonexistent/codex' });
  const response = await postJson(url, '/api/turns/prompt-1/threads', { anchor: ANCHOR, selectedText: 'quick', question: '@codex why?' });
  assert.equal(response.status, 201);
  const { thread } = await response.json();
  const failed = await waitForAnswer(url, thread.id);
  assert.equal(failed.exchanges[0].status, 'failed');
  assert.equal(failed.exchanges[0].backend, 'codex');
  assert.match(failed.exchanges[0].error, /Could not start the codex CLI/);
  assert.match(failed.exchanges[0].error, /SIDESCREEN_CODEX_BIN/);
  assert.deepEqual(await claude(), [], 'claude was not asked in its place');
});

test('3.5 SIDESCREEN_SUBAGENT=codex changes the default for untagged first questions, and a tag still overrides it', async (t) => {
  const { url, claude, codex } = await startWithStubs(t, { SIDESCREEN_SUBAGENT: 'codex' });
  const untagged = await createAnsweredThread(url, 'Why quick?');
  assert.equal(untagged.exchanges[0].backend, 'codex');
  assert.equal((await codex()).length, 1);
  const tagged = await createAnsweredThread(url, '@claude Why quick?');
  assert.equal(tagged.exchanges[0].backend, 'claude');
  assert.equal((await claude()).length, 1);
});

// ---- 5.2: the presentation carries the backend and the model --------------------------

test('5.2 thread and turn responses carry the backend and the model', async (t) => {
  const { url } = await startWithStubs(t);
  const thread = await createAnsweredThread(url, 'Why quick?');
  const { thread: presented } = await (await fetch(new URL(`/api/threads/${thread.id}`, url))).json();
  assert.equal(presented.exchanges[0].backend, 'claude');
  assert.equal(presented.exchanges[0].model, 'claude-fable-5-1');
  const turnPage = await (await fetch(new URL('/api/turns/prompt-1', url))).json();
  assert.equal(turnPage.turn.model, 'claude-fable-5-1');
  assert.equal(turnPage.threads[0].exchanges[0].backend, 'claude');
});

// ---- 5.3: only past turns can be removed --------------------------------------------------

test('5.3 the newest turn of a session is refused, an older one is removed, and a turn becomes removable once a newer one arrives', async (t) => {
  const older = sampleTurn({ promptId: 'older', receivedAt: '2026-01-01T00:00:00.000Z' });
  const newer = sampleTurn({ promptId: 'newer', receivedAt: '2026-01-02T00:00:00.000Z' });
  const { url, store } = await startServer(t, { turns: [older, newer] });
  const project = projectId(older.cwd);

  const refused = await fetch(new URL('/api/turns/newer', url), { method: 'DELETE' });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, NEWEST_TURN_ERROR);
  assert.ok((await store.read()).turns.newer, 'still there');

  let sidebar = await (await fetch(new URL(`/api/projects/${project}`, url))).json();
  assert.deepEqual(sidebar.sessions[0].turns.map((/** @type {{ promptId: string, removable: boolean }} */ turn) => [turn.promptId, turn.removable]), [['newer', false], ['older', true]]);
  const newestRow = /<li class="turn-row" data-prompt-id="newer"[\s\S]*?<\/li>/.exec(sidebar.sidebarHtml)?.[0] ?? '';
  const olderRow = /<li class="turn-row" data-prompt-id="older"[\s\S]*?<\/li>/.exec(sidebar.sidebarHtml)?.[0] ?? '';
  assert.doesNotMatch(newestRow, /turn-remove/, 'no remove control on the newest row');
  assert.match(olderRow, /turn-remove/);

  const removed = await fetch(new URL('/api/turns/older', url), { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).next, `/projects/${project}`);

  const newest = sampleTurn({ promptId: 'newest', receivedAt: '2026-01-03T00:00:00.000Z' });
  await store.update((state) => {
    state.turns[newest.promptId] = newest;
    upsertSession(state, newest);
  });
  sidebar = await (await fetch(new URL(`/api/projects/${project}`, url))).json();
  assert.deepEqual(sidebar.sessions[0].turns.map((/** @type {{ promptId: string, removable: boolean }} */ turn) => [turn.promptId, turn.removable]), [['newest', false], ['newer', true]]);
  assert.equal((await fetch(new URL('/api/turns/newer', url), { method: 'DELETE' })).status, 200, 'removable now that a newer turn exists');
  assert.equal((await fetch(new URL('/api/turns/newest', url), { method: 'DELETE' })).status, 409);
});

// ---- 6.2: a turn's addresses come from its session ----------------------------------------------

test('6.2 a turn ingested from a subdirectory lives under its session\'s project: the sidebar link renders, the legacy link redirects there, and it is the project\'s newest', async (t) => {
  const first = sampleTurn({ promptId: 'first', receivedAt: '2026-01-01T00:00:00.000Z', message: 'First turn.' });
  const moved = sampleTurn({ promptId: 'moved', receivedAt: '2026-01-02T00:00:00.000Z', message: 'Moved turn.', cwd: '/Users/example/proj/openspec/changes/x' });
  const { url, port, store } = await startServer(t, { turns: [first, moved] });
  const project = projectId(first.cwd);

  const state = await store.read();
  assert.equal(state.turns.moved.cwd, first.cwd, 'the store holds the session\'s directory for the turn');
  assert.equal(Object.keys(state.sessions).length, 1, 'no second session for the subdirectory');

  const sidebar = await (await fetch(new URL(`/api/projects/${project}`, url))).json();
  const link = sidebar.sessions[0].turns.find((/** @type {{ promptId: string }} */ turn) => turn.promptId === 'moved').href;
  assert.equal(link, `/projects/${project}/sessions/session-1/turns/moved`);
  const page = await rawRequest({ port, path: link });
  assert.equal(page.status, 200, 'no redirect, no not-found');
  assert.match(page.body, /Moved turn\./);

  const legacy = await rawRequest({ port, path: '/turns/moved' });
  assert.equal(legacy.status, 302);
  assert.equal(legacy.headers.location, link);

  const projectPage = await (await fetch(new URL(`/projects/${project}`, url))).text();
  assert.match(projectPage, /<p>Moved turn\.<\/p>/, 'the project page shows it as the newest turn');
  assert.equal((await fetch(new URL(`/projects/${projectId(moved.cwd)}`, url))).status, 404, 'the subdirectory is not a project');
  assert.doesNotMatch(projectPage, /Project not found/);
});

test('1.1 GET /api/health names sidescreen, the version, the pid, and the state directory, uncached, behind the Host check', async (t) => {
  const { port, stateDir } = await startServer(t);
  const ok = await rawRequest({ port, path: '/api/health' });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { name: 'sidescreen', version: VERSION, pid: process.pid, stateDir: resolve(stateDir) });
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.match(ok.headers['content-type'] ?? '', /application\/json/);

  const refused = await rawRequest({ port, path: '/api/health', host: `evil.example:${port}` });
  assert.equal(refused.status, 403);
});

test('DELETE /api/sessions/<id> removes a session with its turns and threads, keeps carry-back, and says where the page goes next', async (t) => {
  const a1 = sampleTurn({ promptId: 'a1', sessionId: 'sess-a', receivedAt: '2026-01-01T00:00:00.000Z' });
  const a2 = sampleTurn({ promptId: 'a2', sessionId: 'sess-a', receivedAt: '2026-01-01T01:00:00.000Z' });
  const b1 = sampleTurn({ promptId: 'b1', sessionId: 'sess-b', receivedAt: '2026-01-01T02:00:00.000Z' });
  const { url, port, store } = await startServer(t, { turns: [a1, a2, b1] });
  const project = projectId(a1.cwd);
  const json = { 'Content-Type': 'application/json' };
  const anchor = { start: { path: [0], offset: 0 }, end: { path: [0], offset: 3 }, text: 'The' };
  assert.equal((await fetch(new URL('/api/turns/a1/threads', url), { method: 'POST', headers: json, body: JSON.stringify({ anchor, selectedText: 'The', question: 'q' }) })).status, 201);
  assert.equal((await fetch(new URL('/api/sessions/sess-a/carry-back', url), { method: 'POST', headers: json, body: JSON.stringify({ text: 'Owed to the terminal.' }) })).status, 201);

  assert.equal((await rawRequest({ port, path: '/api/sessions/sess-a', method: 'DELETE', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(new URL('/api/sessions/nope', url), { method: 'DELETE' })).status, 404);
  assert.ok((await store.read()).sessions['sess-a'], 'nothing removed yet');

  const removed = await fetch(new URL('/api/sessions/sess-a', url), { method: 'DELETE' });
  assert.equal(removed.status, 200);
  const payload = await removed.json();
  assert.deepEqual(payload.removed, { sessionId: 'sess-a', projectId: project, removedTurns: 2, removedThreads: 1 });
  assert.equal(payload.next, `/projects/${project}`, 'the project still has another session');
  let state = await store.read();
  assert.equal(state.sessions['sess-a'], undefined);
  assert.deepEqual(Object.keys(state.turns), ['b1']);
  assert.equal(Object.keys(state.threads).length, 0);
  assert.equal(state.carryBack['sess-a']?.length, 1, 'carry-back survives the session');
  assert.equal((await fetch(new URL(`/projects/${project}/sessions/sess-a`, url))).status, 404);
  assert.equal((await fetch(new URL(`/projects/${project}/sessions/sess-a/turns/a1`, url))).status, 404);

  const last = await fetch(new URL('/api/sessions/sess-b', url), { method: 'DELETE' });
  assert.equal(last.status, 200);
  assert.equal((await last.json()).next, '/', 'no session left in the project');
  assert.equal((await fetch(new URL(`/projects/${project}`, url))).status, 404);

  const a3 = sampleTurn({ promptId: 'a3', sessionId: 'sess-a', receivedAt: '2026-01-01T03:00:00.000Z' });
  await store.update((latest) => {
    latest.turns.a3 = a3;
    upsertSession(latest, a3);
  });
  const sidebar = await (await fetch(new URL(`/api/projects/${project}`, url))).json();
  assert.deepEqual(sidebar.sessions.map((/** @type {{ sessionId: string }} */ session) => session.sessionId), ['sess-a'], 'the session delivers again and reappears');
  state = await store.read();
  assert.equal(state.carryBack['sess-a']?.length, 1, 'still owed');
});
