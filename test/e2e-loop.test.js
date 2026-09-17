/**
 * 4.6: the whole loop, headless. A turn is ingested through the real CLI, the
 * real server is started through the real CLI, a range is selected by mouse in
 * a real browser, the question is dispatched through the real dispatch path to
 * a stub sub-agent, and the sourced answer renders.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BIN, FIXTURES, runCli, tempDir } from './helpers.js';
import { dragSelect, openBrowser } from './browser-helpers.js';
import { CONVENTIONS_HEADING } from '../src/dispatch-prompt.js';

const STUB_CODEX = join(FIXTURES, 'stub-codex.js');

/**
 * Start `sidescreen serve` as a child process and wait for its URL.
 *
 * @param {import('node:test').TestContext} t
 * @param {NodeJS.ProcessEnv} env
 */
async function serveViaCli(t, env) {
  const child = spawn(process.execPath, [BIN, 'serve', '--port', '0'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('close', resolve));
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
      const match = /sidescreen listening on (http:\/\/[^\s]+)/.exec(output);
      if (match) resolve(match[1]);
    });
    child.once('close', (code) => reject(new Error(`serve exited early with ${code}: ${stderr}`)));
  });
  return { url, child, stderr: () => stderr };
}

test('ingest, annotate, dispatch to a stub sub-agent, and render the sourced answer', async (t) => {
  const dir = await tempDir(t, 'sidescreen-loop-');
  const project = join(dir, 'project');
  const stateDir = join(dir, 'state');
  await mkdir(join(project, 'src'), { recursive: true });
  await writeFile(join(project, 'src', 'store.js'), 'export const lock = "directory";\n', 'utf8');
  await writeFile(join(project, 'CLAUDE.md'), 'RULE-E2E: plain dashes only.\n', 'utf8');
  const argsFile = join(dir, 'codex-args.json');
  const promptFile = join(dir, 'codex-prompt.txt');

  const env = {
    SIDESCREEN_STATE_DIR: stateDir,
    SIDESCREEN_CODEX_BIN: STUB_CODEX,
    SIDESCREEN_CONVENTIONS_FILES: join(project, 'CLAUDE.md'),
    STUB_CODEX_ARGS_TO: argsFile,
    STUB_CODEX_PROMPT_TO: promptFile,
    STUB_CODEX_THREAD_ID: 'codex-thread-e2e',
    STUB_CODEX_ANSWER_JSON: JSON.stringify({
      answer: 'The lock is a directory because `mkdir` is atomic everywhere Node runs.',
      source: 'transcript',
      sourceDetail: 'transcript turn 7',
    }),
  };

  // 1. Ingest a turn through the real CLI, as the Stop hook would.
  const payload = JSON.parse(await readFile(join(FIXTURES, 'stop-hook-payload.json'), 'utf8'));
  const ingest = await runCli(['ingest'], {
    env,
    input: JSON.stringify({
      ...payload,
      cwd: project,
      transcript_path: join(project, 'transcript.jsonl'),
      last_assistant_message: 'The store uses a directory lock so concurrent ingests are safe.\n\nRun `npm test` to confirm.',
    }),
  });
  assert.equal(ingest.code, 0, ingest.stderr);

  // 2. Serve through the real CLI.
  const { url, stderr } = await serveViaCli(t, env);

  // 3. Select a range by mouse and ask.
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(`/turns/${payload.prompt_id}`, url).href);
  await dragSelect(page, 'directory lock');
  await page.locator('#ask-popover').waitFor({ state: 'visible' });
  await page.locator('#ask-question').fill('Why a directory?');
  await page.locator('#ask-submit').click();

  // 4. The sourced answer renders.
  const thread = page.locator('.thread');
  const badge = thread.locator('.source-badge');
  await badge.waitFor({ timeout: 15_000 });
  assert.equal(await badge.getAttribute('data-source'), 'transcript');
  assert.equal(await badge.textContent(), 'source: transcript');
  assert.equal(await thread.locator('.source-detail').textContent(), 'transcript turn 7');
  assert.match((await thread.locator('.answer-body').textContent()) ?? '', /The lock is a directory because mkdir is atomic/);
  assert.equal(await thread.locator('.answer').getAttribute('data-status'), 'answered');
  assert.equal(await page.locator('#document mark[data-sidescreen-mark]').textContent(), 'directory lock');

  // 5. The real dispatch path built a read-only invocation in the turn's cwd with the conventions forwarded.
  const args = JSON.parse(await readFile(argsFile, 'utf8'));
  assert.equal(args[0], 'exec');
  assert.deepEqual(args.slice(args.indexOf('-s'), args.indexOf('-s') + 2), ['-s', 'read-only']);
  assert.deepEqual(args.slice(args.indexOf('-C'), args.indexOf('-C') + 2), ['-C', project]);
  const prompt = await readFile(promptFile, 'utf8');
  assert.ok(prompt.includes(CONVENTIONS_HEADING));
  assert.ok(prompt.includes('RULE-E2E: plain dashes only.'));
  assert.ok(prompt.includes('> directory lock'));
  assert.ok(prompt.includes('Why a directory?'));
  assert.ok(prompt.includes(join(project, 'transcript.jsonl')));

  // 6. The thread remembers its sub-agent session.
  const { threads } = await (await fetch(new URL(`/api/turns/${payload.prompt_id}`, url))).json();
  assert.equal(threads[0].subAgentSessionId, 'codex-thread-e2e');

  assert.deepEqual(consoleErrors, []);
  assert.equal(stderr(), '');
});
