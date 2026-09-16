/**
 * The local HTTP server behind the browser surface.
 *
 * It binds to loopback only and answers only to loopback hostnames in the
 * Host header, so a page on another origin cannot reach it through DNS
 * rebinding. State-changing requests additionally have to be same-origin.
 */

import http from 'node:http';
import { watch } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { renderMarkdown } from './render-markdown.js';
import { renderErrorPage, renderIndexPage, renderTurnPage } from './page.js';
import { listTurns } from './turns.js';
import { createThread, createExchange, latestForkable, listThreadsForTurn, validateAnchor } from './threads.js';
import { isIngestHookRegistered } from './setup-hooks.js';
import { STORE_FILE_NAME } from './store.js';

/** @typedef {import('./types.js').Turn} Turn */
/** @typedef {import('./threads.js').Thread} Thread */
/** @typedef {import('./threads.js').Exchange} Exchange */
/** @typedef {import('./threads.js').Answer} Answer */

/**
 * @typedef {object} DispatchInput
 * @property {Turn} turn
 * @property {Thread} thread
 * @property {Exchange} exchange
 * @property {import('./dispatch.js').DispatchTarget} target Which sub-agent session to start from.
 */

/**
 * @typedef {{ ok: true, answer: Answer, subAgentSessionId: string|null } | { ok: false, error: string }} DispatchResult
 */

/** @typedef {(input: DispatchInput) => Promise<DispatchResult>} Dispatch */

export const DEFAULT_PORT = 7486;
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const MAX_BODY_BYTES = 1_000_000;
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const ASSET_TYPES = /** @type {Record<string, string>} */ ({
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
});
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

/**
 * Whether a Host header names this server.
 *
 * @param {string|undefined} hostHeader
 * @param {number} port The port the server is listening on.
 * @returns {boolean}
 */
export function isAllowedHost(hostHeader, port) {
  if (typeof hostHeader !== 'string' || hostHeader.trim() === '') return false;
  const parsed = splitHostHeader(hostHeader.trim());
  if (parsed === null) return false;
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())) return false;
  return parsed.port === (port === 80 ? null : port) || parsed.port === port;
}

/**
 * @param {string} value
 * @returns {{ hostname: string, port: number|null }|null}
 */
function splitHostHeader(value) {
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(value);
  if (!match) return null;
  return { hostname: match[1], port: match[2] === undefined ? null : Number(match[2]) };
}

export class AnnotatrServer {
  /** @type {Set<http.ServerResponse>} */
  #eventClients = new Set();
  /** @type {Set<Promise<void>>} */
  #inFlight = new Set();
  /** @type {import('node:fs').FSWatcher|null} */
  #watcher = null;
  /** @type {NodeJS.Timeout|null} */
  #watchDebounce = null;
  /** @type {NodeJS.Timeout|null} */
  #heartbeat = null;

  /**
   * @param {{ store: import('./store.js').Store, dispatch: Dispatch, env?: NodeJS.ProcessEnv, cwd?: string, log?: (message: string) => void }} options
   */
  constructor({ store, dispatch, env = process.env, cwd = process.cwd(), log = () => {} }) {
    this.store = store;
    this.dispatch = dispatch;
    this.env = env;
    this.cwd = cwd;
    this.log = log;
    this.server = http.createServer((req, res) => {
      this.#handle(req, res).catch((error) => {
        this.log(`request failed: ${/** @type {Error} */ (error).stack ?? error}`);
        if (!res.headersSent) sendText(res, 500, 'Internal error');
        else res.end();
      });
    });
    this.server.keepAliveTimeout = 5_000;
  }

  /** The port actually bound, or 0 before listen(). */
  get port() {
    const address = this.server.address();
    return address !== null && typeof address === 'object' ? address.port : 0;
  }

  get url() {
    return `http://127.0.0.1:${this.port}/`;
  }

  /**
   * @param {{ port?: number, host?: string }} [options]
   * @returns {Promise<string>} The base URL.
   */
  async listen({ port = DEFAULT_PORT, host = '127.0.0.1' } = {}) {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.off('error', reject);
        resolve(undefined);
      });
    });
    await this.#watchStore();
    this.#heartbeat = setInterval(() => {
      for (const client of this.#eventClients) client.write(': ping\n\n');
    }, 25_000);
    this.#heartbeat.unref();
    return this.url;
  }

  async close() {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    if (this.#watchDebounce) clearTimeout(this.#watchDebounce);
    this.#watcher?.close();
    for (const client of this.#eventClients) client.end();
    this.#eventClients.clear();
    await Promise.race([Promise.allSettled([...this.#inFlight]), sleep(1_000)]);
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(() => resolve(undefined)));
  }

  /**
   * Tell connected pages something changed. They refetch what they show.
   *
   * @param {{ type: string, [key: string]: unknown }} event
   */
  broadcast(event) {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of this.#eventClients) client.write(payload);
  }

  async #watchStore() {
    await mkdir(this.store.stateDir, { recursive: true });
    try {
      this.#watcher = watch(this.store.stateDir, (_eventType, filename) => {
        if (filename !== null && filename !== STORE_FILE_NAME) return;
        if (this.#watchDebounce) clearTimeout(this.#watchDebounce);
        this.#watchDebounce = setTimeout(() => this.broadcast({ type: 'store-changed' }), 100);
      });
      this.#watcher.on('error', (error) => this.log(`store watch failed: ${error.message}`));
    } catch (error) {
      this.log(`store watch unavailable: ${/** @type {Error} */ (error).message}`);
    }
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async #handle(req, res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

    if (req.headers.host === undefined || req.headers.host.trim() === '') {
      sendText(res, 400, 'Host header required');
      return;
    }
    if (!isAllowedHost(req.headers.host, this.port)) {
      sendText(res, 403, 'This server only answers to loopback hostnames');
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const method = req.method ?? 'GET';
    const path = url.pathname;

    /** @type {RegExpExecArray|null} */
    let match;

    if (method === 'GET' && path === '/') return this.#index(res);
    if (method === 'GET' && (match = /^\/turns\/([^/]+)$/.exec(path))) return this.#turnPage(res, decodeURIComponent(match[1]));
    if (method === 'GET' && (match = /^\/assets\/([^/]+)$/.exec(path))) return this.#asset(res, match[1]);
    if (method === 'GET' && path === '/api/turns') return this.#apiTurns(res);
    if (method === 'GET' && (match = /^\/api\/turns\/([^/]+)$/.exec(path))) return this.#apiTurn(res, decodeURIComponent(match[1]));
    if (method === 'POST' && (match = /^\/api\/turns\/([^/]+)\/threads$/.exec(path))) return this.#apiCreateThread(req, res, decodeURIComponent(match[1]));
    if (method === 'GET' && (match = /^\/api\/threads\/([^/]+)$/.exec(path))) return this.#apiThread(res, decodeURIComponent(match[1]));
    if (method === 'POST' && (match = /^\/api\/threads\/([^/]+)\/exchanges$/.exec(path))) return this.#apiFollowUp(req, res, decodeURIComponent(match[1]));
    if (method === 'POST' && (match = /^\/api\/threads\/([^/]+)\/branches$/.exec(path))) return this.#apiBranch(req, res, decodeURIComponent(match[1]));
    if (method === 'GET' && path === '/api/events') return this.#events(req, res);

    if (path.startsWith('/api/')) sendJson(res, 404, { error: 'Not found' });
    else sendHtml(res, 404, renderErrorPage('Not found', `No page at ${path}.`));
  }

  /** @param {http.ServerResponse} res */
  async #index(res) {
    const state = await this.store.read();
    sendHtml(res, 200, renderIndexPage({ turns: listTurns(state), ingestionAvailable: await this.#ingestionAvailable() }));
  }

  /**
   * @param {http.ServerResponse} res
   * @param {string} promptId
   */
  async #turnPage(res, promptId) {
    const state = await this.store.read();
    const turn = state.turns[promptId];
    if (!turn) {
      sendHtml(res, 404, renderErrorPage('Turn not found', 'No turn with that id has been ingested.'));
      return;
    }
    sendHtml(
      res,
      200,
      renderTurnPage({
        turn,
        documentHtml: renderMarkdown(turn.message),
        threads: listThreadsForTurn(state, promptId).map(presentThread),
        ingestionAvailable: await this.#ingestionAvailable(),
      }),
    );
  }

  /**
   * @param {http.ServerResponse} res
   * @param {string} name
   */
  async #asset(res, name) {
    const safeName = basename(name);
    const type = ASSET_TYPES[extname(safeName)];
    if (safeName !== name || type === undefined) {
      sendText(res, 404, 'Not found');
      return;
    }
    try {
      const body = await readFile(join(PUBLIC_DIR, safeName));
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.byteLength });
      res.end(body);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') sendText(res, 404, 'Not found');
      else throw error;
    }
  }

  /** @param {http.ServerResponse} res */
  async #apiTurns(res) {
    const state = await this.store.read();
    sendJson(res, 200, {
      turns: listTurns(state).map((turn) => ({ ...turn, message: undefined, preview: turn.message.slice(0, 200) })),
    });
  }

  /**
   * @param {http.ServerResponse} res
   * @param {string} promptId
   */
  async #apiTurn(res, promptId) {
    const state = await this.store.read();
    const turn = state.turns[promptId];
    if (!turn) {
      sendJson(res, 404, { error: 'Turn not found' });
      return;
    }
    sendJson(res, 200, {
      turn,
      documentHtml: renderMarkdown(turn.message),
      threads: listThreadsForTurn(state, promptId).map(presentThread),
    });
  }

  /**
   * @param {http.ServerResponse} res
   * @param {string} threadId
   */
  async #apiThread(res, threadId) {
    const state = await this.store.read();
    const thread = state.threads[threadId];
    if (!thread) {
      sendJson(res, 404, { error: 'Thread not found' });
      return;
    }
    sendJson(res, 200, { thread: presentThread(thread) });
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @param {string} promptId
   */
  async #apiCreateThread(req, res, promptId) {
    const body = await this.#readJsonBody(req, res);
    if (body === null) return;
    const anchor = validateAnchor(body.anchor);
    const selectedText = typeof body.selectedText === 'string' ? body.selectedText : null;
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!anchor || selectedText === null || question === '') {
      sendJson(res, 400, { error: 'Expected { anchor, selectedText, question }' });
      return;
    }

    /** @type {Thread|null} */
    let thread = null;
    const latestState = await this.store.update((state) => {
      const turn = state.turns[promptId];
      if (!turn) return;
      thread = createThread({ turn, anchor, selectedText, question });
      state.threads[thread.id] = thread;
    });
    if (thread === null) {
      sendJson(res, 404, { error: 'Turn not found' });
      return;
    }
    const created = /** @type {Thread} */ (thread);
    this.broadcast({ type: 'thread-created', threadId: created.id, promptId });
    this.#track(this.#answerExchange(created.id, created.exchanges[0].id, { mode: 'new', cwd: latestState.turns[promptId].cwd }));
    sendJson(res, 201, { thread: presentThread(created) });
  }

  /**
   * Ask a follow-up in an existing thread. It forks the session of the
   * newest answered exchange, so the thread's context carries forward.
   *
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @param {string} threadId
   */
  async #apiFollowUp(req, res, threadId) {
    const body = await this.#readJsonBody(req, res);
    if (body === null) return;
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (question === '') {
      sendJson(res, 400, { error: 'Expected { question }' });
      return;
    }

    /** @type {{ ok: { thread: Thread, exchange: Exchange, target: import('./dispatch.js').DispatchTarget }|null, failure: { status: number, error: string }|null }} */
    const outcome = { ok: null, failure: null };
    await this.store.update((state) => {
      const thread = state.threads[threadId];
      const turn = thread ? state.turns[thread.promptId] : undefined;
      if (!thread || !turn) {
        outcome.failure = { status: 404, error: 'Thread not found' };
        return;
      }
      const last = thread.exchanges[thread.exchanges.length - 1];
      if (last && last.status === 'pending') {
        outcome.failure = { status: 409, error: 'Wait for the current answer before asking a follow-up' };
        return;
      }
      const forkable = latestForkable(thread);
      const exchange = createExchange(question);
      thread.exchanges.push(exchange);
      outcome.ok = {
        thread,
        exchange,
        target: forkable ? { mode: 'fork', sessionId: /** @type {string} */ (forkable.subAgentSessionId) } : { mode: 'new', cwd: turn.cwd },
      };
    });
    if (outcome.failure !== null || outcome.ok === null) {
      const { status, error } = outcome.failure ?? { status: 500, error: 'Follow-up was not recorded' };
      sendJson(res, status, { error });
      return;
    }
    const { thread, exchange, target } = outcome.ok;
    this.broadcast({ type: 'thread-updated', threadId });
    this.#track(this.#answerExchange(threadId, exchange.id, target));
    sendJson(res, 201, { thread: presentThread(thread), exchangeId: exchange.id });
  }

  /**
   * Branch a new thread from one answered exchange. The branch forks that
   * exchange's session, so it sees the conversation up to that answer only,
   * however far the parent thread has moved on since.
   *
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @param {string} parentThreadId
   */
  async #apiBranch(req, res, parentThreadId) {
    const body = await this.#readJsonBody(req, res);
    if (body === null) return;
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const exchangeId = typeof body.exchangeId === 'string' ? body.exchangeId : '';
    if (question === '' || exchangeId === '') {
      sendJson(res, 400, { error: 'Expected { exchangeId, question }' });
      return;
    }

    /** @type {{ ok: { branch: Thread, sessionId: string }|null, failure: { status: number, error: string }|null }} */
    const outcome = { ok: null, failure: null };
    await this.store.update((state) => {
      const parent = state.threads[parentThreadId];
      const turn = parent ? state.turns[parent.promptId] : undefined;
      if (!parent || !turn) {
        outcome.failure = { status: 404, error: 'Thread not found' };
        return;
      }
      const exchange = parent.exchanges.find((candidate) => candidate.id === exchangeId);
      if (!exchange) {
        outcome.failure = { status: 404, error: 'Exchange not found in that thread' };
        return;
      }
      if (exchange.status !== 'answered' || !exchange.subAgentSessionId) {
        outcome.failure = { status: 409, error: 'Only an answered exchange can be branched from' };
        return;
      }
      const branch = createThread({
        turn,
        anchor: parent.anchor,
        selectedText: parent.selectedText,
        question,
        parentThreadId: parent.id,
        branchedFromExchangeId: exchange.id,
      });
      state.threads[branch.id] = branch;
      outcome.ok = { branch, sessionId: exchange.subAgentSessionId };
    });
    if (outcome.failure !== null || outcome.ok === null) {
      const { status, error } = outcome.failure ?? { status: 500, error: 'Branch was not recorded' };
      sendJson(res, status, { error });
      return;
    }
    const { branch, sessionId } = outcome.ok;
    this.broadcast({ type: 'thread-created', threadId: branch.id, promptId: branch.promptId });
    this.#track(this.#answerExchange(branch.id, branch.exchanges[0].id, { mode: 'fork', sessionId }));
    sendJson(res, 201, { thread: presentThread(branch) });
  }

  /**
   * Run the dispatcher for one exchange and record the outcome.
   *
   * @param {string} threadId
   * @param {string} exchangeId
   * @param {import('./dispatch.js').DispatchTarget} target
   */
  async #answerExchange(threadId, exchangeId, target) {
    const state = await this.store.read();
    const thread = state.threads[threadId];
    const exchange = thread?.exchanges.find((candidate) => candidate.id === exchangeId);
    const turn = thread ? state.turns[thread.promptId] : undefined;
    if (!thread || !exchange || !turn) return;

    /** @type {DispatchResult} */
    let result;
    try {
      result = await this.dispatch({ turn, thread, exchange, target });
    } catch (error) {
      result = { ok: false, error: /** @type {Error} */ (error).message };
    }

    await this.store.update((latest) => {
      const owner = latest.threads[threadId];
      const targetExchange = owner?.exchanges.find((candidate) => candidate.id === exchangeId);
      if (!owner || !targetExchange) return;
      targetExchange.answeredAt = new Date().toISOString();
      if (result.ok) {
        targetExchange.status = 'answered';
        targetExchange.answer = result.answer;
        targetExchange.error = null;
        targetExchange.subAgentSessionId = result.subAgentSessionId;
        if (result.subAgentSessionId) owner.subAgentSessionId = result.subAgentSessionId;
      } else {
        targetExchange.status = 'failed';
        targetExchange.error = result.error;
      }
    });
    this.broadcast({ type: 'thread-updated', threadId });
  }

  /** @param {Promise<void>} promise */
  #track(promise) {
    const tracked = promise
      .catch((error) => this.log(`dispatch failed: ${/** @type {Error} */ (error).stack ?? error}`))
      .finally(() => this.#inFlight.delete(tracked));
    this.#inFlight.add(tracked);
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  #events(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    this.#eventClients.add(res);
    req.on('close', () => this.#eventClients.delete(res));
  }

  /**
   * Read a same-origin JSON body, or answer with an error and return null.
   *
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @returns {Promise<Record<string, unknown>|null>}
   */
  async #readJsonBody(req, res) {
    const origin = req.headers.origin;
    if (typeof origin === 'string') {
      /** @type {string|undefined} */
      let originHost;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = undefined;
      }
      if (originHost === undefined || !isAllowedHost(originHost, this.port)) {
        sendJson(res, 403, { error: 'Cross-origin requests are not accepted' });
        return null;
      }
    }
    const fetchSite = req.headers['sec-fetch-site'];
    if (typeof fetchSite === 'string' && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      sendJson(res, 403, { error: 'Cross-site requests are not accepted' });
      return null;
    }
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      sendJson(res, 415, { error: 'Expected application/json' });
      return null;
    }

    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        sendJson(res, 413, { error: 'Body too large' });
        return null;
      }
      chunks.push(chunk);
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      return parsed;
    } catch {
      sendJson(res, 400, { error: 'Body must be a JSON object' });
      return null;
    }
  }

  async #ingestionAvailable() {
    return isIngestHookRegistered({ env: this.env, cwd: this.cwd });
  }
}

/**
 * The client-facing shape of a thread: the stored thread plus rendered answers.
 *
 * @param {Thread} thread
 * @returns {Thread & { exchanges: (Exchange & { answerHtml: string|null })[] }}
 */
export function presentThread(thread) {
  return {
    ...thread,
    exchanges: thread.exchanges.map((exchange) => ({
      ...exchange,
      answerHtml: exchange.answer ? renderMarkdown(exchange.answer.text) : null,
    })),
  };
}

/**
 * @param {{ store: import('./store.js').Store, dispatch: Dispatch, env?: NodeJS.ProcessEnv, cwd?: string, log?: (message: string) => void }} options
 */
export function createServer(options) {
  return new AnnotatrServer(options);
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {string} text
 */
function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {string} html
 */
function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} value
 */
function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
