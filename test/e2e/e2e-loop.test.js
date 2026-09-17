/**
 * The whole loop, headless. A turn is ingested through the real CLI, the
 * real server is started through the real CLI, a range is selected by mouse in
 * a real browser, the question is dispatched through the real dispatch path to
 * a stub sub-agent, and the sourced answer renders with the backend that gave
 * it. Once per backend, and once more with a switch of backend mid-thread.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES, runCli, serveViaCli, tempDir } from '../helpers.js';
import { dragSelect, openBrowser } from '../browser-helpers.js';
import { CONVENTIONS_HEADING, EARLIER_HEADING } from '../../src/dispatch/dispatch-prompt.js';
import { RESTRICTED_ARGS } from '../../src/dispatch/claude-adapter.js';

const STUB_CODEX = join(FIXTURES, 'stub-codex.js');
const STUB_CLAUDE = join(FIXTURES, 'stub-claude.js');

/**
 * @param {string} path
 * @returns {Promise<{ args: string[], prompt: string, subcommand: string, continuedSession: string|null, cwd: string, model?: string|null, subagentMarker: string|null }[]>}
 */
async function readStubLog(path) {
  try {
    return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * A project with a rule file, a state directory, and a turn ingested through
 * the real CLI with a transcript that names the model.
 *
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} [extraEnv]
 */
async function setUp(t, extraEnv = {}) {
  const dir = await tempDir(t, 'sidescreen-loop-');
  const project = join(dir, 'project');
  const stateDir = join(dir, 'state');
  await mkdir(join(project, 'src'), { recursive: true });
  await writeFile(join(project, 'src', 'store.js'), 'export const lock = "directory";\n', 'utf8');
  await writeFile(join(project, 'CLAUDE.md'), 'RULE-E2E: plain dashes only.\n', 'utf8');
  const message = 'The store uses a directory lock so concurrent ingests are safe.\n\nRun `npm test` to confirm.';
  const transcriptPath = join(project, 'transcript.jsonl');
  await writeFile(
    transcriptPath,
    [
      JSON.stringify({ type: 'user', uuid: 'u1', parentUuid: null, message: { role: 'user', content: 'Why a directory lock?' } }),
      JSON.stringify({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'text', text: message }] } }),
    ].join('\n') + '\n',
    'utf8',
  );
  const codexLog = join(dir, 'codex.log');
  const claudeLog = join(dir, 'claude.log');
  const env = {
    SIDESCREEN_STATE_DIR: stateDir,
    SIDESCREEN_CODEX_BIN: STUB_CODEX,
    SIDESCREEN_CLAUDE_BIN: STUB_CLAUDE,
    SIDESCREEN_CONVENTIONS_FILES: join(project, 'CLAUDE.md'),
    STUB_CODEX_LOG_TO: codexLog,
    STUB_CLAUDE_LOG_TO: claudeLog,
    STUB_CODEX_THREAD_ID: 'codex-thread-e2e',
    STUB_CLAUDE_SESSION_ID: 'claude-session-e2e',
    STUB_CODEX_ANSWER_JSON: JSON.stringify({ answer: 'CODEX-E2E: the lock is a directory because `mkdir` is atomic everywhere Node runs.', source: 'transcript', sourceDetail: 'transcript turn 7' }),
    STUB_CLAUDE_ANSWER_JSON: JSON.stringify({ answer: 'CLAUDE-E2E: the lock is a directory because `mkdir` is atomic everywhere Node runs.', source: 'code', sourceDetail: 'src/store.js:1' }),
    ...extraEnv,
  };

  const payload = JSON.parse(await readFile(join(FIXTURES, 'stop-hook-payload.json'), 'utf8'));
  const ingest = await runCli(['ingest'], { env, input: JSON.stringify({ ...payload, cwd: project, transcript_path: transcriptPath, last_assistant_message: message }) });
  assert.equal(ingest.code, 0, ingest.stderr);
  const { url, stderr } = await serveViaCli(t, env);
  return { project, stateDir, env, payload, url, stderr, codex: () => readStubLog(codexLog), claude: () => readStubLog(claudeLog) };
}

/**
 * Select the range by mouse, ask, and wait for the answer.
 *
 * @param {import('playwright').Page} page
 * @param {string} question
 */
async function askInBrowser(page, question) {
  await dragSelect(page, 'directory lock');
  await page.locator('#ask-popover').waitFor({ state: 'visible' });
  await page.locator('#ask-question').fill(question);
  await page.locator('#ask-submit').click();
  const thread = page.locator('.thread');
  await thread.locator('.source-badge').waitFor({ timeout: 15_000 });
  return thread;
}

test('ingest, annotate, dispatch to the Claude stub by default on the turn\'s model, and render the sourced answer with its backend', async (t) => {
  const { project, url, stderr, payload, codex, claude } = await setUp(t);
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(`/turns/${payload.prompt_id}`, url).href);
  const thread = await askInBrowser(page, 'Why a directory?');

  const badge = thread.locator('.source-badge');
  assert.equal(await badge.getAttribute('data-source'), 'code');
  assert.equal(await thread.locator('.source-detail').textContent(), 'src/store.js:1');
  assert.match((await thread.locator('.answer-body').textContent()) ?? '', /CLAUDE-E2E/);
  assert.equal(await thread.locator('.answer').getAttribute('data-status'), 'answered');
  assert.equal(await thread.locator('.answer-by').textContent(), 'Claude answered:');
  assert.equal(await thread.locator('.answer-by').getAttribute('title'), 'Answered by Claude on claude-fable-5-1');
  assert.equal(await page.locator('#document mark[data-sidescreen-mark]').textContent(), 'directory lock');

  const [run] = await claude();
  assert.ok(run, 'the claude stub ran');
  assert.deepEqual(await codex(), [], 'codex was not needed');
  assert.equal(run.args[0], '-p');
  for (const flag of RESTRICTED_ARGS) assert.ok(run.args.includes(flag), `restricted: ${flag}`);
  assert.equal(run.model, 'claude-fable-5-1', "pinned to the model the transcript named for the turn");
  assert.equal(run.subagentMarker, '1', 'the child carries the sub-agent marker');
  assert.equal(await import('node:fs/promises').then((fs) => fs.realpath(run.cwd)), await import('node:fs/promises').then((fs) => fs.realpath(project)));
  assert.ok(run.prompt.includes(CONVENTIONS_HEADING));
  assert.ok(run.prompt.includes('RULE-E2E: plain dashes only.'));
  assert.ok(run.prompt.includes('> directory lock'));
  assert.ok(run.prompt.includes('Why a directory?'));
  assert.ok(run.prompt.includes(join(project, 'transcript.jsonl')));
  assert.ok(run.prompt.includes('turn-slices'), 'the turn slice was cut and named');

  const { threads } = await (await fetch(new URL(`/api/turns/${payload.prompt_id}`, url))).json();
  assert.equal(threads[0].exchanges[0].subAgentSessionId, 'claude-session-e2e');
  assert.equal(threads[0].exchanges[0].backend, 'claude');
  assert.equal(threads[0].exchanges[0].model, 'claude-fable-5-1');
  assert.deepEqual(consoleErrors, []);
  assert.equal(stderr(), '');
});

test('ingest, annotate, dispatch to the Codex stub with @codex, and render the sourced answer with its backend', async (t) => {
  const { project, url, stderr, payload, codex, claude } = await setUp(t);
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(`/turns/${payload.prompt_id}`, url).href);
  const thread = await askInBrowser(page, '@codex Why a directory?');

  assert.equal(await thread.locator('.source-badge').getAttribute('data-source'), 'transcript');
  assert.equal(await thread.locator('.source-detail').textContent(), 'transcript turn 7');
  assert.match((await thread.locator('.answer-body').textContent()) ?? '', /CODEX-E2E/);
  assert.equal(await thread.locator('.answer-by').textContent(), 'CODEX answered:');
  assert.equal(await thread.locator('.question').textContent(), '@codex Why a directory?', 'the question is shown as typed');

  const [run] = await codex();
  assert.ok(run, 'the codex stub ran');
  assert.deepEqual(await claude(), [], 'claude was not asked');
  assert.equal(run.args[0], 'exec');
  assert.deepEqual(run.args.slice(run.args.indexOf('-s'), run.args.indexOf('-s') + 2), ['-s', 'read-only']);
  assert.deepEqual(run.args.slice(run.args.indexOf('-C'), run.args.indexOf('-C') + 2), ['-C', project]);
  assert.ok(run.prompt.includes('## The question\n\nWhy a directory?\n'), 'the tag is stripped from the prompt');
  assert.ok(run.prompt.includes('RULE-E2E: plain dashes only.'));

  const { threads } = await (await fetch(new URL(`/api/turns/${payload.prompt_id}`, url))).json();
  assert.equal(threads[0].exchanges[0].subAgentSessionId, 'codex-thread-e2e');
  assert.equal(threads[0].exchanges[0].backend, 'codex');
  assert.deepEqual(consoleErrors, []);
  assert.equal(stderr(), '');
});

test('a follow-up tagged @codex switches backend mid-thread, carries the first answer as text, and shows both labels', async (t) => {
  const { url, stderr, payload, codex, claude } = await setUp(t);
  const { page, consoleErrors } = await openBrowser(t);
  await page.goto(new URL(`/turns/${payload.prompt_id}`, url).href);
  await askInBrowser(page, 'Why a directory?');

  await page.locator('.follow-up-question').fill('@codex do you agree?');
  await page.keyboard.press('Enter');
  const second = page.locator('.exchange').nth(1);
  await second.locator('.answer-pending').waitFor();
  assert.match((await second.locator('.answer-pending').textContent()) ?? '', /^Asking CODEX…/);
  await second.locator('.source-badge').waitFor({ timeout: 15_000 });
  assert.deepEqual(await page.locator('.exchange .answer-by').allTextContents(), ['Claude answered:', 'CODEX answered:']);
  assert.match((await second.locator('.answer-body').textContent()) ?? '', /CODEX-E2E/);

  const [codexRun] = await codex();
  assert.equal(codexRun.subcommand, 'new', 'no codex session to fork, so a cold start');
  assert.ok(codexRun.prompt.includes(EARLIER_HEADING));
  assert.ok(codexRun.prompt.includes('Question: Why a directory?'));
  assert.ok(codexRun.prompt.includes('CLAUDE-E2E'), 'the first answer travels as text');
  assert.ok(codexRun.prompt.includes('## The question\n\ndo you agree?\n'));
  assert.equal((await claude()).length, 1, 'claude answered once and was not asked again');

  await page.locator('.follow-up-question').fill('and on Windows?');
  await page.keyboard.press('Enter');
  const third = page.locator('.exchange').nth(2);
  await third.locator('.source-badge').waitFor({ timeout: 15_000 });
  assert.equal(await third.locator('.answer-by').textContent(), 'CODEX answered:', 'sticky: an untagged follow-up stays with codex');
  const runs = await codex();
  assert.equal(runs.length, 2);
  assert.equal(runs[1].subcommand, 'fork');
  assert.equal(runs[1].continuedSession, 'codex-thread-e2e');
  assert.deepEqual(consoleErrors, []);
  assert.equal(stderr(), '');
});
