import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, tempDir } from './helpers.js';
import { sampleTurn } from './server-helpers.js';
import {
  ANSWER_SCHEMA_PATH,
  READ_ONLY_CONFIG,
  SANDBOX_POLICY,
  STDIN_CLOSED,
  buildCommand,
  dispatchQuestion,
  dispatchSettings,
  parseAnswer,
  parseCodexEvents,
  runCommand,
} from '../src/dispatch.js';
import { CONVENTIONS_HEADING, buildPrompt } from '../src/dispatch-prompt.js';
import { loadConventions } from '../src/conventions.js';
import { createThread } from '../src/threads.js';

const STUB_CODEX = join(FIXTURES, 'stub-codex.js');

/** A turn, thread, and exchange ready to dispatch. */
function fixture(/** @type {string} */ cwd, question = 'Why was this chosen?') {
  const turn = sampleTurn({ cwd, transcriptPath: join(cwd, 'transcript.jsonl') });
  const thread = createThread({
    turn,
    anchor: { start: { path: [0], offset: 4 }, end: { path: [0], offset: 9 }, text: 'quick' },
    selectedText: 'quick',
    question,
  });
  return { turn, thread, exchange: thread.exchanges[0] };
}

// ---- 4.1: command construction and closed stdin ---------------------------

test('a new dispatch runs codex exec with the read-only sandbox and the turn cwd', () => {
  const { command, args } = buildCommand({ target: { mode: 'new', cwd: '/proj' }, prompt: 'PROMPT' });
  assert.equal(command, 'codex');
  assert.equal(args[0], 'exec');
  assert.deepEqual(args.slice(args.indexOf('-s'), args.indexOf('-s') + 2), ['-s', 'read-only']);
  assert.deepEqual(args.slice(args.indexOf('-C'), args.indexOf('-C') + 2), ['-C', '/proj']);
  assert.deepEqual(args.slice(args.indexOf('--output-schema'), args.indexOf('--output-schema') + 2), ['--output-schema', ANSWER_SCHEMA_PATH]);
  assert.ok(args.includes('--json'));
  assert.equal(args[args.length - 1], 'PROMPT', 'the prompt is an argument, never piped');
});

test('resume and fork carry the read-only policy through the config override, since they take no -s', () => {
  const resume = buildCommand({ target: { mode: 'resume', sessionId: 'sess-1' }, prompt: 'P' });
  assert.deepEqual(resume.args.slice(0, 4), ['exec', 'resume', '-c', READ_ONLY_CONFIG]);
  assert.deepEqual(resume.args.slice(-2), ['sess-1', 'P']);
  const fork = buildCommand({ target: { mode: 'fork', sessionId: 'sess-1' }, prompt: 'P' });
  assert.deepEqual(fork.args.slice(0, 4), ['exec', 'fork', '-c', READ_ONLY_CONFIG]);
  assert.deepEqual(fork.args.slice(-2), ['sess-1', 'P']);
});

test('the model flag and the codex binary are configurable', () => {
  const { command, args } = buildCommand({ target: { mode: 'new', cwd: '/p' }, prompt: 'P', codexBin: '/opt/codex', model: 'gpt-5' });
  assert.equal(command, '/opt/codex');
  assert.deepEqual(args.slice(args.indexOf('-m'), args.indexOf('-m') + 2), ['-m', 'gpt-5']);
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

// ---- 4.2: time bound --------------------------------------------------------

test('a command that never exits is stopped at the bound and reported as timed out', async () => {
  const started = Date.now();
  const result = await runCommand({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 300 });
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started < 3_000, 'did not wait longer than the bound plus the kill grace');
  assert.notEqual(result.exitCode, 0);
});

test('dispatchQuestion reports a failed answer when the sub-agent hangs', async (t) => {
  const cwd = await tempDir(t);
  const result = await dispatchQuestion({
    ...fixture(cwd),
    codexBin: STUB_CODEX,
    env: { ...process.env, STUB_CODEX_MODE: 'hang' },
    timeoutMs: 400,
    conventions: '',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /did not answer within/);
});

test('dispatchQuestion reports a failed answer when the sub-agent cannot start or exits without output', async (t) => {
  const cwd = await tempDir(t);
  const missing = await dispatchQuestion({ ...fixture(cwd), codexBin: join(cwd, 'no-such-binary'), timeoutMs: 2_000, conventions: '' });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /Could not start/);

  const failed = await dispatchQuestion({ ...fixture(cwd), codexBin: STUB_CODEX, env: { ...process.env, STUB_CODEX_MODE: 'fail' }, timeoutMs: 5_000, conventions: '' });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.match(failed.error, /produced no answer \(exit code 1\): stub-codex: simulated failure/);
});

// ---- 4.3: conventions travel in every prompt -------------------------------

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
  const { text, sources } = await loadConventions({ cwd: dir, env: { ANNOTATR_CONVENTIONS_FILES: `${rules}:${join(dir, 'missing.md')}` } });
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
  const result = await dispatchQuestion({
    ...fixture(cwd),
    codexBin: STUB_CODEX,
    env: { ...process.env, ANNOTATR_CONVENTIONS_FILES: rules, STUB_CODEX_PROMPT_TO: promptFile },
    timeoutMs: 10_000,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const prompt = await readFile(promptFile, 'utf8');
  assert.ok(prompt.includes(CONVENTIONS_HEADING));
  assert.ok(prompt.includes('RULE-FROM-DISK: sentences on their own lines.'));
});

// ---- 4.4: every answer declares a source -----------------------------------

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

test('the dispatcher passes the declared source through to the result', async (t) => {
  const cwd = await tempDir(t);
  for (const source of ['code', 'transcript', 'spec', 'none']) {
    const result = await dispatchQuestion({
      ...fixture(cwd),
      codexBin: STUB_CODEX,
      env: { ...process.env, STUB_CODEX_ANSWER_JSON: JSON.stringify({ answer: 'A', source, sourceDetail: 'D' }), STUB_CODEX_THREAD_ID: `thread-${source}` },
      timeoutMs: 10_000,
      conventions: '',
    });
    assert.ok(result.ok, JSON.stringify(result));
    if (result.ok) {
      assert.equal(result.answer.source, source);
      assert.equal(result.answer.sourceDetail, 'D');
      assert.equal(result.subAgentSessionId, `thread-${source}`);
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
  assert.deepEqual(events, { threadId: 'abc', finalText: 'final', errors: [] });
  assert.deepEqual(parseCodexEvents(JSON.stringify({ type: 'error', message: 'boom' })).errors, ['boom']);
});

// ---- 4.5: "no documented intent found" is an answer -------------------------

test('"no documented intent found" is a successful answer, not a failure', async (t) => {
  const cwd = await tempDir(t);
  const result = await dispatchQuestion({ ...fixture(cwd), codexBin: STUB_CODEX, env: { ...process.env }, timeoutMs: 10_000, conventions: '' });
  assert.deepEqual(result, {
    ok: true,
    answer: { text: 'No documented intent found.', source: 'none', sourceDetail: '' },
    subAgentSessionId: result.ok ? result.subAgentSessionId : null,
  });
});

// ---- 7.1: no write-capable dispatch can be constructed ----------------------

test('no dispatch path can be constructed with a write-capable sandbox', () => {
  const forbidden = ['workspace-write', 'danger-full-access', '--dangerously-bypass-approvals-and-sandbox', '--approve-for-me', '--add-dir', '--full-auto'];
  const targets = /** @type {import('../src/dispatch.js').DispatchTarget[]} */ ([
    { mode: 'new', cwd: '/p' },
    { mode: 'resume', sessionId: 's' },
    { mode: 'fork', sessionId: 's' },
  ]);
  for (const target of targets) {
    // A caller trying to smuggle a policy in has no parameter to use; extra options are ignored.
    const { args } = buildCommand(/** @type {any} */ ({ target, prompt: 'P', sandbox: 'workspace-write', policy: 'danger-full-access', args: ['--add-dir', '/'] }));
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

test('the dispatch module source has no sandbox parameter and only ever names read-only', async () => {
  const source = await readFile(fileURLToPath(new URL('../src/dispatch.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /workspace-write|danger-full-access|dangerously-bypass/);
  assert.doesNotMatch(source, /sandbox\s*[:=]\s*(?!'read-only'|`|SANDBOX_POLICY)/, 'no configurable sandbox value');
  assert.equal((source.match(/SANDBOX_POLICY = '([^']+)'/) ?? [])[1], 'read-only');
});

test('dispatch settings come from the environment with safe defaults', () => {
  assert.deepEqual(dispatchSettings({}), { codexBin: 'codex', timeoutMs: 300_000, model: undefined });
  assert.deepEqual(dispatchSettings({ ANNOTATR_CODEX_BIN: '/x/codex', ANNOTATR_DISPATCH_TIMEOUT_MS: '1500', ANNOTATR_MODEL: 'm' }), {
    codexBin: '/x/codex',
    timeoutMs: 1_500,
    model: 'm',
  });
  assert.equal(dispatchSettings({ ANNOTATR_DISPATCH_TIMEOUT_MS: 'nope' }).timeoutMs, 300_000);
});
