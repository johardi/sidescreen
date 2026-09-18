/**
 * 6.1: the lifecycle as sessions meet it. One session starts the server in
 * the background; a turn arrives from another process through
 * `sidescreen ingest`, exactly as the Stop hook delivers it; a second
 * session's `start` finds the server rather than starting another; and
 * `stop` frees the address. Everything runs through the real CLI.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { probe, serverUrl } from '../../src/lifecycle/probe.js';
import { FIXTURES, runCli, tempDir } from '../helpers.js';
import { freePort, stopServerAfter } from '../lifecycle/lifecycle-helpers.js';

test('6.1 one background server serves turns ingested by other processes, is found by a second start, and stops', async (t) => {
  const dir = await tempDir(t, 'sidescreen-e2e-lifecycle-');
  const project = await realpath(await tempDir(t, 'sidescreen-e2e-project-'));
  const stateDir = join(dir, 'state');
  const env = { SIDESCREEN_STATE_DIR: stateDir, SIDESCREEN_MENUBAR: 'off' };
  const port = await freePort();
  stopServerAfter(t, port, env);

  const first = await runCli(['start', '--port', String(port)], { env, cwd: project });
  assert.equal(first.code, 0, first.stderr);
  const running = await probe(port);
  assert.equal(running.kind, 'sidescreen');

  const payload = JSON.parse(await readFile(join(FIXTURES, 'stop-hook-payload.json'), 'utf8'));
  const ingest = await runCli(['ingest'], {
    env,
    input: JSON.stringify({ ...payload, cwd: project, prompt_id: 'e2e-lifecycle-1', transcript_path: join(dir, 'transcript.jsonl'), last_assistant_message: 'A turn from a session that did not start the server.' }),
  });
  assert.equal(ingest.code, 0, ingest.stderr);

  const response = await fetch(`${serverUrl(port)}api/turns`);
  assert.equal(response.status, 200);
  const { turns } = /** @type {{ turns: { promptId: string, preview: string }[] }} */ (await response.json());
  assert.ok(turns.some((turn) => turn.promptId === 'e2e-lifecycle-1'), 'the server reads the turn another process stored');

  const second = await runCli(['start', '--port', String(port)], { env, cwd: project });
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /is already running at/);
  const found = await probe(port);
  assert.deepEqual(found, running, 'the second start found the first server');

  const stopped = await runCli(['stop', '--port', String(port)], { env });
  assert.equal(stopped.code, 0, stopped.stderr);
  assert.deepEqual(await probe(port), { kind: 'none' });
});
