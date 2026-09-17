import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, tempDir } from '../helpers.js';
import { sampleTurn } from '../server-helpers.js';
import { ANSWER_SCHEMA_PATH, STDIN_CLOSED, dispatchQuestion, parseAnswer, runCommand } from '../../src/dispatch/dispatch.js';
import { READ_ONLY_CONFIG, SANDBOX_POLICY, buildCodexCommand, parseCodexEvents } from '../../src/dispatch/codex-adapter.js';
import { CONVENTIONS_HEADING, SINCE_HEADING, buildFollowUpPrompt, buildPrompt } from '../../src/dispatch/dispatch-prompt.js';
import { loadConventions } from '../../src/dispatch/conventions.js';
import { dispatchSettings } from '../../src/dispatch/backends.js';
import { createThread } from '../../src/store/threads.js';

const STUB_CODEX = join(FIXTURES, 'stub-codex.js');

/** @type {import('../../src/dispatch/adapter.js').CommandInput} */
const COMMAND_BASE = { bin: 'codex', target: { mode: 'new' }, prompt: 'PROMPT', cwd: '/proj', schemaPath: ANSWER_SCHEMA_PATH, schemaText: '{}', model: undefined, readDirs: [], sessionName: 'sidescreen: q' };

/**
 * A turn, thread, and exchange ready to dispatch on Codex, with the options
 * that point the dispatcher at the stub and keep its files under `cwd`.
 *
 * @param {string} cwd
 * @param {string} [question]
 * @param {Record<string, string>} [extraEnv]
 */
function fixture(cwd, question = 'Why was this chosen?', extraEnv = {}) {
  const turn = sampleTurn({ cwd, transcriptPath: join(cwd, 'transcript.jsonl') });
  const thread = createThread({
    turn,
    anchor: { start: { path: [0], offset: 4 }, end: { path: [0], offset: 9 }, text: 'quick' },
    selectedText: 'quick',
    question,
    backend: 'codex',
  });
  return {
    turn,
    thread,
    exchange: thread.exchanges[0],
    question,
    target: /** @type {const} */ ({ mode: 'new' }),
    priorExchanges: [],
    gap: [],
    env: { ...process.env, SIDESCREEN_CODEX_BIN: STUB_CODEX, SIDESCREEN_STATE_DIR: join(cwd, 'state'), SIDESCREEN_CONVENTIONS_FILES: join(cwd, 'none.md'), ...extraEnv },
    stateDir: join(cwd, 'state'),
  };
}

// ---- 2.1: the Codex adapter, moved unchanged --------------------------------

test('a new Codex dispatch runs codex exec with the read-only sandbox and the turn cwd', () => {
  const { command, args } = buildCodexCommand(COMMAND_BASE);
  assert.equal(command, 'codex');
  assert.equal(args[0], 'exec');
  assert.deepEqual(args.slice(args.indexOf('-s'), args.indexOf('-s') + 2), ['-s', 'read-only']);
  assert.deepEqual(args.slice(args.indexOf('-C'), args.indexOf('-C') + 2), ['-C', '/proj']);
  assert.deepEqual(args.slice(args.indexOf('--output-schema'), args.indexOf('--output-schema') + 2), ['--output-schema', ANSWER_SCHEMA_PATH]);
  assert.ok(args.includes('--json'));
  assert.equal(args[args.length - 1], 'PROMPT', 'the prompt is an argument, never piped');
});

test('a Codex fork carries the read-only policy through the config override, since it takes no -s', () => {
  const fork = buildCodexCommand({ ...COMMAND_BASE, target: { mode: 'fork', sessionId: 'sess-1' } });
  assert.deepEqual(fork.args.slice(0, 4), ['exec', 'fork', '-c', READ_ONLY_CONFIG]);
  assert.deepEqual(fork.args.slice(-2), ['sess-1', 'PROMPT']);
});

test('the Codex model flag and binary follow the command input', () => {
  const { command, args } = buildCodexCommand({ ...COMMAND_BASE, bin: '/opt/codex', model: 'gpt-5' });
  assert.equal(command, '/opt/codex');
  assert.deepEqual(args.slice(args.indexOf('-m'), args.indexOf('-m') + 2), ['-m', 'gpt-5']);
  assert.ok(!buildCodexCommand(COMMAND_BASE).args.includes('-m'), 'no model flag without a model');
});

test('runCommand spawns with stdin attached to /dev/null', async () => {
  /** @type {unknown[]} */
  const calls = [];
  const { spawn } = await import('node:child_process');
  /** @type {typeof spawn} */
  const recordingSpawn = /** @type {any} */ ((/** @type {string} */ command, /** @type {string[]} */ args, /** @type {object} */ options) => {
    calls.push(options);
    return spawn(command, args, /** @type {any} */ (options));
  });
  await runCommand({ command: process.execPath, args: ['-e', ''], timeoutMs: 5_000, spawn: recordingSpawn });
  assert.equal(calls.length, 1);
  const options = /** @type {{ stdio: string[] }} */ (calls[0]);
  assert.equal(options.stdio[0], STDIN_CLOSED);
  assert.equal(STDIN_CLOSED, 'ignore', "Node attaches /dev/null for 'ignore'");
});

test('the child really sees end of input immediately', async () => {
  const result = await runCommand({
    command: process.execPath,
    args: ['-e', "process.stdin.on('end', () => process.stdout.write('EOF')); process.stdin.resume();"],
    timeoutMs: 5_000,
  });
  assert.equal(result.stdout, 'EOF');
  assert.equal(result.timedOut, false);
});

// ---- time bound and failures ------------------------------------------------

test('a command that never exits is stopped at the bound and reported as timed out', async () => {
  const started = Date.now();
  const result = await runCommand({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 300 });
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started < 3_000, 'did not wait longer than the bound plus the kill grace');
  assert.notEqual(result.exitCode, 0);
});

test('dispatchQuestion reports a failed answer when the sub-agent hangs', async (t) => {
  const cwd = await tempDir(t);
  const result = await dispatchQuestion({ ...fixture(cwd, 'q', { STUB_CODEX_MODE: 'hang' }), timeoutMs: 400, conventions: '' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /codex sub-agent did not answer within/);
});

test('2.6 a CLI that cannot be started names its backend and the setting that locates it, and no other backend is tried', async (t) => {
  const cwd = await tempDir(t);
  const claudeLog = join(cwd, 'claude.log');
  const missing = await dispatchQuestion({
    ...fixture(cwd, 'q', { SIDESCREEN_CODEX_BIN: join(cwd, 'no-such-binary'), SIDESCREEN_CLAUDE_BIN: join(FIXTURES, 'stub-claude.js'), STUB_CLAUDE_LOG_TO: claudeLog }),
    timeoutMs: 2_000,
    conventions: '',
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.match(missing.error, /^Could not start the codex CLI \(.*no-such-binary\)/);
    assert.match(missing.error, /Set SIDESCREEN_CODEX_BIN/);
  }
  await assert.rejects(readFile(claudeLog), 'the claude stub was never run');

  const failed = await dispatchQuestion({ ...fixture(cwd, 'q', { STUB_CODEX_MODE: 'fail' }), timeoutMs: 5_000, conventions: '' });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.match(failed.error, /codex sub-agent produced no answer \(exit code 1\): stub-codex: simulated failure/);
});

// ---- conventions travel in every prompt -------------------------------------

test('the forwarded conventions block appears in the constructed prompt', () => {
  const prompt = buildPrompt({
    question: 'Why?',
    selectedText: 'quick',
    message: 'The quick brown fox.',
    cwd: '/proj',
    transcriptPath: '/t.jsonl',
    conventions: 'RULE-XYZ: never use the em dash.',
    promptId: 'p1',
  });
  const headingIndex = prompt.indexOf(CONVENTIONS_HEADING);
  assert.ok(headingIndex >= 0);
  assert.ok(prompt.indexOf('RULE-XYZ: never use the em dash.') > headingIndex);
  assert.ok(prompt.includes('/t.jsonl'), 'the transcript path is offered as an evidence source');
  assert.ok(prompt.includes('> quick'));
  assert.ok(prompt.includes('The quick brown fox.'));
  assert.ok(prompt.includes('Why?'));
});

test('an empty conventions set is still stated, so the block is never silently absent', () => {
  const prompt = buildPrompt({ question: 'q', selectedText: 's', message: 'm', cwd: '/p', transcriptPath: null, conventions: '   ', promptId: 'p' });
  assert.ok(prompt.includes(`${CONVENTIONS_HEADING}\n`));
  assert.ok(prompt.includes('(none found)'));
  assert.ok(prompt.includes('not available for this turn'));
});

test('loadConventions reads the configured files and skips missing ones', async (t) => {
  const dir = await tempDir(t);
  const rules = join(dir, 'rules.md');
  await writeFile(rules, '# House rules\n\nRULE-ABC applies.\n', 'utf8');
  const { text, sources } = await loadConventions({ cwd: dir, env: { SIDESCREEN_CONVENTIONS_FILES: `${rules}:${join(dir, 'missing.md')}` } });
  assert.deepEqual(sources, [rules]);
  assert.ok(text.includes('RULE-ABC applies.'));
  assert.ok(text.includes(`### From ${rules}`));
});

test('loadConventions defaults to the global CLAUDE.md and the project CLAUDE.md and AGENTS.md', async (t) => {
  const home = await tempDir(t, 'home-');
  const cwd = await tempDir(t, 'proj-');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(home, '.claude'));
  await writeFile(join(home, '.claude', 'CLAUDE.md'), 'GLOBAL-RULE', 'utf8');
  await writeFile(join(cwd, 'AGENTS.md'), 'PROJECT-AGENTS-RULE', 'utf8');
  const { text, sources } = await loadConventions({ cwd, env: {}, home });
  assert.deepEqual(sources, [join(home, '.claude', 'CLAUDE.md'), join(cwd, 'AGENTS.md')]);
  assert.ok(text.includes('GLOBAL-RULE') && text.includes('PROJECT-AGENTS-RULE'));
});

test('the real dispatch path forwards conventions loaded from disk', async (t) => {
  const cwd = await tempDir(t);
  const rules = join(cwd, 'rules.md');
  await writeFile(rules, 'RULE-FROM-DISK: sentences on their own lines.', 'utf8');
  const promptFile = join(cwd, 'prompt.txt');
  const result = await dispatchQuestion({ ...fixture(cwd, 'q', { SIDESCREEN_CONVENTIONS_FILES: rules, STUB_CODEX_PROMPT_TO: promptFile }), timeoutMs: 10_000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  const prompt = await readFile(promptFile, 'utf8');
  assert.ok(prompt.includes(CONVENTIONS_HEADING));
  assert.ok(prompt.includes('RULE-FROM-DISK: sentences on their own lines.'));
});

// ---- every answer declares a source -----------------------------------------

for (const source of /** @type {const} */ (['code', 'transcript', 'spec', 'none'])) {
  test(`a structured answer with source "${source}" is accepted as declared`, () => {
    const answer = parseAnswer(JSON.stringify({ answer: `Because ${source}.`, source, sourceDetail: source === 'none' ? '' : `${source} detail` }));
    assert.deepEqual(answer, { text: `Because ${source}.`, source, sourceDetail: source === 'none' ? '' : `${source} detail` });
  });

  test(`a plain-text answer ending in "Source: ${source}" is accepted as declared`, () => {
    const answer = parseAnswer(`Because.\n\nSource: ${source} - some detail`);
    assert.deepEqual(answer, { text: 'Because.', source, sourceDetail: 'some detail' });
  });
}

test('an answer that declares no source is kept but marked undeclared', () => {
  assert.deepEqual(parseAnswer('Just a guess.'), { text: 'Just a guess.', source: 'undeclared', sourceDetail: '' });
  assert.deepEqual(parseAnswer(JSON.stringify({ answer: 'x', source: 'vibes', sourceDetail: '' })), {
    text: JSON.stringify({ answer: 'x', source: 'vibes', sourceDetail: '' }),
    source: 'undeclared',
    sourceDetail: '',
  });
});

test('no answer text at all is not an answer', () => {
  assert.equal(parseAnswer(null), null);
  assert.equal(parseAnswer('   \n'), null);
});

test('the dispatcher passes the declared source, the session id, and the pinned model through to the result', async (t) => {
  const cwd = await tempDir(t);
  for (const source of ['code', 'transcript', 'spec', 'none']) {
    const result = await dispatchQuestion({
      ...fixture(cwd, 'q', { STUB_CODEX_ANSWER_JSON: JSON.stringify({ answer: 'A', source, sourceDetail: 'D' }), STUB_CODEX_THREAD_ID: `thread-${source}`, SIDESCREEN_CODEX_MODEL: 'gpt-5.4' }),
      timeoutMs: 10_000,
      conventions: '',
    });
    assert.ok(result.ok, JSON.stringify(result));
    if (result.ok) {
      assert.equal(result.answer.source, source);
      assert.equal(result.answer.sourceDetail, 'D');
      assert.equal(result.subAgentSessionId, `thread-${source}`);
      assert.equal(result.model, 'gpt-5.4', 'Codex does not report its model, so the pinned one is recorded');
    }
  }
});

test('parseCodexEvents reads the thread id and the last agent message, ignoring noise', () => {
  const events = parseCodexEvents(
    [
      'Reading additional input from stdin...',
      JSON.stringify({ type: 'thread.started', thread_id: 'abc' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'thinking' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'first' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'final' } }),
      '{not json',
      JSON.stringify({ type: 'turn.completed', usage: {} }),
    ].join('\n'),
  );
  assert.deepEqual(events, { sessionId: 'abc', finalText: 'final', errors: [], model: null });
  assert.deepEqual(parseCodexEvents(JSON.stringify({ type: 'error', message: 'boom' })).errors, ['boom']);
});

test('"no documented intent found" is a successful answer, not a failure', async (t) => {
  const cwd = await tempDir(t);
  const result = await dispatchQuestion({ ...fixture(cwd), timeoutMs: 10_000, conventions: '' });
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) {
    assert.deepEqual(result.answer, { text: 'No documented intent found.', source: 'none', sourceDetail: '' });
    assert.match(result.subAgentSessionId ?? '', /^stub-thread-\d+$/);
  }
});

// ---- no write-capable Codex dispatch can be constructed ----------------------

test('no Codex command can be constructed with a write-capable sandbox', () => {
  const forbidden = ['workspace-write', 'danger-full-access', '--dangerously-bypass-approvals-and-sandbox', '--approve-for-me', '--add-dir', '--full-auto'];
  const targets = /** @type {import('../../src/dispatch/adapter.js').DispatchTarget[]} */ ([{ mode: 'new' }, { mode: 'fork', sessionId: 's' }]);
  for (const target of targets) {
    // A caller trying to smuggle a policy in has no parameter to use; extra options are ignored.
    const { args } = buildCodexCommand(/** @type {any} */ ({ ...COMMAND_BASE, target, sandbox: 'workspace-write', policy: 'danger-full-access', args: ['--add-dir', '/'], readDirs: ['/'] }));
    const flagsOnly = args.slice(0, -1);
    for (const flag of forbidden) assert.ok(!flagsOnly.includes(flag), `${target.mode} must not include ${flag}`);
    assert.ok(flagsOnly.includes(READ_ONLY_CONFIG), `${target.mode} carries the read-only config override`);
    if (target.mode === 'new') {
      assert.equal(flagsOnly.filter((arg) => arg === '-s').length, 1);
      assert.equal(flagsOnly[flagsOnly.indexOf('-s') + 1], SANDBOX_POLICY);
    }
  }
  assert.equal(SANDBOX_POLICY, 'read-only');
});

test('the Codex adapter source has no sandbox parameter and only ever names read-only', async () => {
  const source = await readFile(fileURLToPath(new URL('../../src/dispatch/codex-adapter.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /workspace-write|danger-full-access|dangerously-bypass/);
  assert.doesNotMatch(source, /sandbox\s*[:=]\s*(?!'read-only'|`|SANDBOX_POLICY)/, 'no configurable sandbox value');
  assert.equal((source.match(/SANDBOX_POLICY = '([^']+)'/) ?? [])[1], 'read-only');
});

// ---- 2.4: settings ------------------------------------------------------------

test('2.4 dispatch settings come from the environment with safe defaults', () => {
  assert.deepEqual(dispatchSettings({}), {
    subagent: 'parent',
    defaultBackend: 'claude',
    bins: { claude: 'claude', codex: 'codex' },
    models: { claude: undefined, codex: undefined },
    timeoutMs: 300_000,
  });
  const configured = dispatchSettings({
    SIDESCREEN_SUBAGENT: 'Codex',
    SIDESCREEN_CLAUDE_BIN: '/x/claude',
    SIDESCREEN_CODEX_BIN: '/x/codex',
    SIDESCREEN_CLAUDE_MODEL: 'opus',
    SIDESCREEN_CODEX_MODEL: 'gpt-5',
    SIDESCREEN_DISPATCH_TIMEOUT_MS: '1500',
  });
  assert.deepEqual(configured, {
    subagent: 'codex',
    defaultBackend: 'codex',
    bins: { claude: '/x/claude', codex: '/x/codex' },
    models: { claude: 'opus', codex: 'gpt-5' },
    timeoutMs: 1_500,
  });
  assert.equal(dispatchSettings({ SIDESCREEN_SUBAGENT: 'claude' }).defaultBackend, 'claude');
  assert.equal(dispatchSettings({ SIDESCREEN_SUBAGENT: 'gpt' }).subagent, 'parent', 'an unknown value is treated as parent');
  assert.equal(dispatchSettings({ SIDESCREEN_DISPATCH_TIMEOUT_MS: 'nope' }).timeoutMs, 300_000);
  assert.equal('SIDESCREEN_MODEL' in dispatchSettings({ SIDESCREEN_MODEL: 'm' }), false, 'the old single model setting is gone');
  assert.equal(dispatchSettings({ SIDESCREEN_MODEL: 'm' }).models.codex, undefined);
});

// ---- continuing an answer forks its session --------------------------------

test('the follow-up prompt carries the rules, the conventions, and the question, but not the document again', () => {
  const prompt = buildFollowUpPrompt({ question: 'Why brown?', selectedText: 'quick', conventions: 'RULE-FU: be brief.' });
  assert.ok(prompt.includes(CONVENTIONS_HEADING));
  assert.ok(prompt.includes('RULE-FU: be brief.'));
  assert.ok(prompt.includes('Why brown?'));
  assert.ok(prompt.includes('> quick'));
  assert.ok(prompt.includes('read-only'));
  assert.ok(prompt.includes('source'));
  assert.ok(!prompt.includes("The agent's output being reviewed"));
  assert.ok(!prompt.includes(SINCE_HEADING), 'no gap section without a gap');
});

test('dispatching with a fork target runs codex exec fork on that session with the follow-up prompt', async (t) => {
  const cwd = await tempDir(t);
  const argsFile = join(cwd, 'args.json');
  const promptFile = join(cwd, 'prompt.txt');
  const result = await dispatchQuestion({
    ...fixture(cwd, 'A follow-up?', { STUB_CODEX_ARGS_TO: argsFile, STUB_CODEX_PROMPT_TO: promptFile }),
    target: { mode: 'fork', sessionId: 'parent-session' },
    timeoutMs: 10_000,
    conventions: 'RULE-FORK',
  });
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) assert.ok(result.subAgentSessionId?.startsWith('fork-of-parent-session-'));

  const args = JSON.parse(await readFile(argsFile, 'utf8'));
  assert.deepEqual(args.slice(0, 2), ['exec', 'fork']);
  assert.ok(args.includes(READ_ONLY_CONFIG));
  assert.ok(args.includes('--skip-git-repo-check'));
  assert.equal(args[args.length - 2], 'parent-session');
  const prompt = await readFile(promptFile, 'utf8');
  assert.ok(prompt.includes('A follow-up?'));
  assert.ok(prompt.includes('RULE-FORK'));
  assert.ok(!prompt.includes("The agent's output being reviewed"));
});
