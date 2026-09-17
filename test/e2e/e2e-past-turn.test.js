/**
 * 6.4: the bug as a user met it. A session's later turn arrives with a
 * working directory other than the session's, because the agent's shell had
 * moved into a subdirectory. Clicking that turn in the sidebar used to
 * redirect to a project derived from the turn's own directory, which no
 * session has, and the page said "Project not found".
 *
 * Everything real: the turns arrive through `sidescreen ingest`, the server
 * runs through `sidescreen serve`, and a real browser clicks the sidebar.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES, runCli, serveViaCli, tempDir } from '../helpers.js';
import { openBrowser } from '../browser-helpers.js';
import { projectId } from '../../src/store/projects.js';

test('6.4 a turn ingested while the shell sat in a subdirectory opens from the sidebar instead of "Project not found"', async (t) => {
  const dir = await tempDir(t, 'sidescreen-past-turn-');
  const project = await realpath(await tempDir(t, 'sidescreen-project-'));
  const stateDir = join(dir, 'state');
  const env = { SIDESCREEN_STATE_DIR: stateDir };
  const payload = JSON.parse(await readFile(join(FIXTURES, 'stop-hook-payload.json'), 'utf8'));

  const turns = [
    { prompt_id: 'first', cwd: project, last_assistant_message: 'First turn, from the project root.' },
    { prompt_id: 'moved', cwd: join(project, 'openspec', 'changes', 'select-sub-agent-backend'), last_assistant_message: 'Moved turn, finished while the shell sat in a subdirectory.' },
    { prompt_id: 'third', cwd: project, last_assistant_message: 'Third turn, back at the root.' },
  ];
  for (const turn of turns) {
    const ingest = await runCli(['ingest'], { env, input: JSON.stringify({ ...payload, ...turn, transcript_path: join(dir, 'transcript.jsonl') }) });
    assert.equal(ingest.code, 0, ingest.stderr);
  }

  const { url, stderr } = await serveViaCli(t, env);
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(`/projects/${projectId(project)}`, url).href);
  assert.match((await page.locator('#document').textContent()) ?? '', /Third turn/, 'the project page shows the newest turn');
  assert.equal(await page.locator('.session').count(), 1, 'one session, whatever directory each turn reported');
  assert.deepEqual(await page.locator('.turn-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-prompt-id'))), ['third', 'moved', 'first']);

  await page.locator('.turn-row[data-prompt-id="moved"] .turn-link').click();
  await page.waitForURL(new URL(`/projects/${projectId(project)}/sessions/${payload.session_id}/turns/moved`, url).href);
  const body = (await page.locator('body').textContent()) ?? '';
  assert.doesNotMatch(body, /Project not found/);
  assert.match((await page.locator('#document').textContent()) ?? '', /Moved turn, finished while the shell sat in a subdirectory/);
  assert.equal(await page.locator('.topbar-path').textContent(), project, 'shown under the project, not the subdirectory');
  assert.equal(await page.locator('.turn-row[data-active]').getAttribute('data-prompt-id'), 'moved');

  await page.locator('.turn-row[data-prompt-id="first"] .turn-link').click();
  await page.waitForURL(new URL(`/projects/${projectId(project)}/sessions/${payload.session_id}/turns/first`, url).href);
  assert.match((await page.locator('#document').textContent()) ?? '', /First turn, from the project root/);
  assert.deepEqual(consoleErrors, []);
  assert.equal(stderr(), '');
});
