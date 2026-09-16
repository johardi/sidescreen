import http from 'node:http';
import { Store } from '../src/store.js';
import { createServer } from '../src/server.js';
import { turnFromPayload } from '../src/turns.js';
import { upsertSession } from '../src/sessions.js';
import { projectId, turnPath } from '../src/projects.js';
import { tempDir } from './helpers.js';

/**
 * A turn document for tests.
 *
 * @param {Partial<import('../src/types.js').Turn>} [overrides]
 * @returns {import('../src/types.js').Turn}
 */
export function sampleTurn(overrides = {}) {
  return {
    ...turnFromPayload({
      lastAssistantMessage: 'The quick brown fox jumps over the lazy dog.\n\nA second paragraph with `inline code` and **bold** text.',
      sessionId: 'session-1',
      promptId: 'prompt-1',
      cwd: '/Users/example/proj',
      transcriptPath: '/Users/example/.claude/projects/x/session-1.jsonl',
      stopHookActive: false,
    }),
    ...overrides,
  };
}

/**
 * Start a server on an ephemeral port with a fresh store, torn down after the test.
 *
 * @param {import('node:test').TestContext} t
 * @param {{ dispatch?: import('../src/server.js').Dispatch, turns?: import('../src/types.js').Turn[], env?: NodeJS.ProcessEnv, stateDir?: string }} [options]
 */
export async function startServer(t, { dispatch, turns = [sampleTurn()], env = { HOME: '/nonexistent' }, stateDir: givenStateDir } = {}) {
  const stateDir = givenStateDir ?? (await tempDir(t, 'annotatr-server-'));
  const store = new Store(stateDir);
  await store.update((state) => {
    for (const turn of turns) {
      state.turns[turn.promptId] = turn;
      upsertSession(state, turn);
    }
  });
  const server = createServer({
    store,
    dispatch: dispatch ?? (async () => ({ ok: false, error: 'no dispatcher in this test' })),
    env,
    cwd: stateDir,
  });
  const url = await server.listen({ port: 0 });
  t.after(() => server.close());
  return { server, store, url, port: server.port, stateDir };
}

/**
 * The pinned address of a turn.
 *
 * @param {Pick<import('../src/types.js').Turn, 'cwd'|'sessionId'|'promptId'>} turn
 */
export function turnHref(turn) {
  return turnPath(projectId(turn.cwd), turn.sessionId, turn.promptId);
}

/**
 * A raw HTTP request that lets tests control the Host header exactly.
 *
 * @param {{ port: number, path?: string, method?: string, host?: string|null, headers?: Record<string, string>, body?: string }} options
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: string }>}
 */
export function rawRequest({ port, path = '/', method = 'GET', host = `127.0.0.1:${port}`, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        setHost: false,
        headers: { ...(host === null ? {} : { Host: host }), ...headers },
      },
      (response) => {
        /** @type {Buffer[]} */
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

/**
 * Poll until a thread's first exchange leaves the pending state.
 *
 * @param {string} url Base URL.
 * @param {string} threadId
 * @param {number} [timeoutMs]
 */
export async function waitForAnswer(url, threadId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await fetch(new URL(`/api/threads/${threadId}`, url));
    const { thread } = await response.json();
    if (thread.exchanges.every((/** @type {{ status: string }} */ exchange) => exchange.status !== 'pending')) return thread;
    if (Date.now() > deadline) throw new Error(`thread ${threadId} still pending after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
