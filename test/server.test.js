import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isAllowedHost } from '../src/server.js';
import { preview } from '../src/page.js';
import { createCodexDispatch, READ_ONLY_CONFIG } from '../src/dispatch.js';
import { Store } from '../src/store.js';
import { FIXTURES, tempDir } from './helpers.js';
import { rawRequest, sampleTurn, startServer, turnHref, waitForAnswer } from './server-helpers.js';
import { projectId } from '../src/projects.js';

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
  assert.match(projectPage, /data-scope="project"/);
  assert.match(projectPage, /class="sidebar-latest" href="\/projects\/[0-9a-f]{12}" aria-current="page"/);

  const sessionPage = await (await fetch(new URL(`/projects/${project}/sessions/sess-b`, url))).text();
  assert.match(sessionPage, /<p>Only in B<\/p>/, 'the session address shows that session\'s newest turn');
  assert.match(sessionPage, /data-scope="session"/);
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
  const turns = [sampleTurn(), sampleTurn({ promptId: 'prompt-2', receivedAt: '2026-01-02T00:00:00.000Z' })];
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

  const last = await (await fetch(new URL('/api/turns/prompt-2', url), { method: 'DELETE' })).json();
  assert.equal(last.removed.sessionRemoved, true);
  assert.equal(last.next, '/', 'with no turn left in the project, the landing page is next');
  state = await store.read();
  assert.equal(state.sessions['session-1'], undefined);
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

// ---- Group 5: threads fork the answer they continue -------------------------

const STUB_CODEX = join(FIXTURES, 'stub-codex.js');
const ANCHOR = { start: { path: [0], offset: 4 }, end: { path: [0], offset: 9 }, text: 'quick' };

/**
 * A server whose dispatcher is the real codex path, pointed at the stub.
 *
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} [extraEnv]
 */
async function startWithStubCodex(t, extraEnv = {}) {
  const project = await tempDir(t, 'sidescreen-project-');
  const logPath = join(project, 'codex.log');
  const env = { ...process.env, SIDESCREEN_CODEX_BIN: STUB_CODEX, STUB_CODEX_LOG_TO: logPath, SIDESCREEN_CONVENTIONS_FILES: join(project, 'none.md'), ...extraEnv };
  const started = await startServer(t, { turns: [sampleTurn({ cwd: project })], dispatch: createCodexDispatch({ env }) });
  /** @returns {Promise<{ args: string[], prompt: string, subcommand: string, continuedSession: string|null }[]>} */
  const readLog = async () => (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { ...started, readLog };
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
  assert.equal(thread.subAgentSessionId, thread.exchanges[0].subAgentSessionId);

  const reloaded = (await new Store(stateDir).read()).threads[thread.id];
  assert.equal(reloaded.exchanges[0].subAgentSessionId, thread.exchanges[0].subAgentSessionId);
  assert.equal(reloaded.subAgentSessionId, thread.subAgentSessionId);
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
  assert.equal(updated.subAgentSessionId, updated.exchanges[1].subAgentSessionId, 'the thread points at its latest answer');
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
  /** @type {import('../src/dispatch.js').DispatchTarget[]} */
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
  assert.notEqual(answeredBranch.subAgentSessionId, parent.subAgentSessionId, 'branch and parent hold different session ids');

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
  assert.notEqual(leftThread.subAgentSessionId, rightThread.subAgentSessionId);
  assert.ok(leftThread.subAgentSessionId.startsWith(`fork-of-${source.subAgentSessionId}-`));
  assert.ok(rightThread.subAgentSessionId.startsWith(`fork-of-${source.subAgentSessionId}-`));
  assert.ok(elapsed < 2_000, `both ran concurrently (took ${elapsed}ms with a 300ms stub delay each)`);
  assert.equal((await readLog()).filter((entry) => entry.subcommand === 'fork').length, 2);
});
