import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { resolve } from 'node:path';
import { probe } from '../../src/lifecycle/probe.js';
import { VERSION } from '../../src/version.js';
import { startServer } from '../server-helpers.js';
import { foreignServerAfter, freePort, httpServerAfter } from './lifecycle-helpers.js';

test('1.2 a port nothing listens on is none', async () => {
  const port = await freePort();
  assert.deepEqual(await probe(port), { kind: 'none' });
});

test('1.2 a sidescreen server identifies itself with version, pid, and state directory', async (t) => {
  const { port, stateDir } = await startServer(t);
  assert.deepEqual(await probe(port), { kind: 'sidescreen', version: VERSION, pid: process.pid, stateDir: resolve(stateDir) });
});

test('1.2 a server answering something else is foreign, whatever it answers', async (t) => {
  const json = await foreignServerAfter(t);
  assert.deepEqual(await probe(json.port), { kind: 'foreign' });

  const text = await httpServerAfter(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('sidescreen');
  });
  assert.deepEqual(await probe(text.port), { kind: 'foreign' });

  const notFound = await httpServerAfter(t, (_req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'sidescreen', version: '1', pid: 1, stateDir: '/x' }));
  });
  assert.deepEqual(await probe(notFound.port), { kind: 'foreign' });

  const incomplete = await httpServerAfter(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'sidescreen', version: '1' }));
  });
  assert.deepEqual(await probe(incomplete.port), { kind: 'foreign' });
});

test('1.2 a socket that accepts and never answers is unanswering', async (t) => {
  /** @type {net.Socket[]} */
  const held = [];
  const server = net.createServer((socket) => held.push(socket));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  t.after(() => {
    for (const socket of held) socket.destroy();
    server.close();
  });
  const address = server.address();
  const port = address !== null && typeof address === 'object' ? address.port : 0;
  assert.deepEqual(await probe(port, { timeoutMs: 300 }), { kind: 'unanswering' });
});
