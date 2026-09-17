/**
 * 2.2, 2.3, 2.5, 6.3: the Claude Code adapter, its stub, prompt parity across
 * backends, and the sub-agent's working directory.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, tempDir } from '../helpers.js';
import { sampleTurn } from '../server-helpers.js';
import { ANSWER_SCHEMA_PATH, dispatchQuestion, sessionNameFor } from '../../src/dispatch/dispatch.js';
import { READ_ONLY_TOOLS, RESTRICTED_ARGS, buildClaudeCommand, parseClaudeResult } from '../../src/dispatch/claude-adapter.js';
import { createThread } from '../../src/store/threads.js';
import { Store } from '../../src/store/store.js';
import { recordTurn } from '../../src/store/turns.js';

const STUB_CLAUDE = join(FIXTURES, 'stub-claude.js');
const STUB_CODEX = join(FIXTURES, 'stub-codex.js');

/** @type {import('../../src/dispatch/adapter.js').CommandInput} */
const COMMAND_BASE = {
  bin: 'claude',
  target: { mode: 'new' },
  prompt: 'PROMPT',
  cwd: '/proj',
  schemaPath: ANSWER_SCHEMA_PATH,
  schemaText: '{"type":"object"}',
  model: undefined,
  readDirs: [],
  sessionName: 'sidescreen: why?',
};

/**
 * @param {string} cwd
 * @param {import('../../src/dispatch/backends.js').Backend} backend
 * @param {string} [question]
 * @param {Record<string, string>} [extraEnv]
 * @param {Partial<import('../../src/types.js').Turn>} [turnOverrides]
 */
function fixture(cwd, backend, question = 'Why was this chosen?', extraEnv = {}, turnOverrides = {}) {
  const turn = sampleTurn({ cwd, transcriptPath: join(cwd, 'transcript.jsonl'), ...turnOverrides });
  const thread = createThread({
    turn,
    anchor: { start: { path: [0], offset: 4 }, end: { path: [0], offset: 9 }, text: 'quick' },
    selectedText: 'quick',
    question,
    backend,
  });
  return {
    turn,
    thread,
    exchange: thread.exchanges[0],
    question,
    target: /** @type {const} */ ({ mode: 'new' }),
    priorExchanges: [],
    gap: [],
    env: {
      ...process.env,
      SIDESCREEN_CLAUDE_BIN: STUB_CLAUDE,
      SIDESCREEN_CODEX_BIN: STUB_CODEX,
      SIDESCREEN_STATE_DIR: join(cwd, 'state'),
      SIDESCREEN_CONVENTIONS_FILES: join(cwd, 'none.md'),
      ...extraEnv,
    },
    stateDir: join(cwd, 'state'),
    timeoutMs: 10_000,
  };
}

// ---- 2.2: the command line ----------------------------------------------------

test('2.2 a new Claude session is print mode, restricted to the reading tools, with prompts denied and the schema inline', () => {
  const { command, args } = buildClaudeCommand(COMMAND_BASE);
  assert.equal(command, 'claude');
  assert.equal(args[0], '-p');
  for (const flag of RESTRICTED_ARGS) assert.ok(args.includes(flag), `carries ${flag}`);
  assert.deepEqual(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2), ['--tools', 'Read,Grep,Glob']);
  assert.deepEqual(args.slice(args.indexOf('--permission-prompts'), args.indexOf('--permission-prompts') + 2), ['--permission-prompts', 'none']);
  assert.ok(args.includes('--strict-mcp-config') && !args.includes('--mcp-config'), 'no MCP server is loaded, so no tool beyond the three reading tools exists');
  assert.deepEqual(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2), ['--output-format', 'json']);
  assert.deepEqual(args.slice(args.indexOf('--json-schema'), args.indexOf('--json-schema') + 2), ['--json-schema', '{"type":"object"}']);
  assert.deepEqual(args.slice(args.indexOf('--name'), args.indexOf('--name') + 2), ['--name', 'sidescreen: why?']);
  assert.ok(!args.includes('--resume') && !args.includes('--fork-session') && !args.includes('--model') && !args.includes('--add-dir'));
  assert.equal(args[args.length - 1], 'PROMPT', 'the prompt is the last argument, never piped');
  assert.equal(READ_ONLY_TOOLS, 'Read,Grep,Glob');
});

test('2.2 a fork resumes the session under a new id, and model and read directories are added when given', () => {
  const { args } = buildClaudeCommand({ ...COMMAND_BASE, target: { mode: 'fork', sessionId: 'sess-1' }, model: 'claude-fable-5-1', readDirs: ['/t', '/s'] });
  for (const flag of RESTRICTED_ARGS) assert.ok(args.includes(flag), `a fork still carries ${flag}`);
  assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 3), ['--resume', 'sess-1', '--fork-session']);
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'claude-fable-5-1']);
  assert.deepEqual(args.filter((arg, index) => args[index - 1] === '--add-dir'), ['/t', '/s']);
  assert.equal(args[args.length - 1], 'PROMPT');
});

test('2.2 no parameter can remove or widen the read-only flags', () => {
  const smuggled = /** @type {any} */ ({
    ...COMMAND_BASE,
    permissionMode: 'bypassPermissions',
    tools: 'Bash,Edit,Write',
    args: ['--dangerously-skip-permissions'],
    extra: ['--permission-mode', 'acceptEdits'],
    restricted: false,
  });
  for (const target of /** @type {import('../../src/dispatch/adapter.js').DispatchTarget[]} */ ([{ mode: 'new' }, { mode: 'fork', sessionId: 's' }])) {
    const { args } = buildClaudeCommand({ ...smuggled, target });
    const flagsOnly = args.slice(0, -1);
    for (const flag of RESTRICTED_ARGS) assert.ok(flagsOnly.includes(flag), `${target.mode} carries ${flag}`);
    for (const forbidden of ['--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions', 'acceptEdits', '--allowedTools', '--allow-dangerously-skip-permissions']) {
      assert.ok(!flagsOnly.includes(forbidden), `${target.mode} must not include ${forbidden}`);
    }
    assert.equal(flagsOnly.filter((arg) => arg === '--tools').length, 1);
    assert.equal(flagsOnly[flagsOnly.indexOf('--tools') + 1], READ_ONLY_TOOLS);
  }
});

test('2.2 the Claude adapter source names no writing tool, no shell, and no way past permissions', async () => {
  const source = await readFile(fileURLToPath(new URL('../../src/dispatch/claude-adapter.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /dangerously|bypassPermissions|acceptEdits|--permission-mode|--allowedTools/);
  assert.doesNotMatch(source, /'(Bash|Edit|Write|MultiEdit|NotebookEdit)'/);
  assert.equal((source.match(/READ_ONLY_TOOLS = '([^']+)'/) ?? [])[1], 'Read,Grep,Glob');
  assert.match(source, /'--restricted'/);
});

// ---- 2.2: reading the result ---------------------------------------------------

test('2.2 a structured result yields its session id, the structured answer as text, and the model used', () => {
  const parsed = parseClaudeResult(
    ['Some preamble that is not JSON', JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-9', result: '{"answer":"ok","source":"none","sourceDetail":""}', structured_output: { answer: 'ok', source: 'none', sourceDetail: '' }, modelUsage: { 'claude-haiku-4-5-20251001': {} }, permission_denials: [] })].join('\n'),
  );
  assert.deepEqual(parsed, { sessionId: 'sess-9', finalText: '{"answer":"ok","source":"none","sourceDetail":""}', errors: [], model: 'claude-haiku-4-5-20251001' });
});

test('2.2 without structured output the plain result is the text; an error result is an error; denials explain an empty answer', () => {
  assert.equal(parseClaudeResult(JSON.stringify({ type: 'result', is_error: false, session_id: 's', result: 'Plain.\n\nSource: code - x.js' })).finalText, 'Plain.\n\nSource: code - x.js');
  const failed = parseClaudeResult(JSON.stringify({ type: 'result', is_error: true, session_id: 's', result: 'Not logged in · Please run /login' }));
  assert.equal(failed.finalText, null);
  assert.deepEqual(failed.errors, ['Not logged in · Please run /login']);
  const denied = parseClaudeResult(JSON.stringify({ type: 'result', is_error: false, session_id: 's', result: '', permission_denials: [{ tool_name: 'Write' }, { tool_name: 'Bash' }] }));
  assert.equal(denied.finalText, null);
  assert.deepEqual(denied.errors, ['permission denied for Write, Bash']);
  assert.deepEqual(parseClaudeResult('this is not json\n'), { sessionId: null, finalText: null, errors: [], model: null });
  assert.deepEqual(parseClaudeResult(JSON.stringify({ type: 'system', session_id: 'x' })), { sessionId: null, finalText: null, errors: [], model: null }, 'only a result record counts');
});

// ---- 2.3: the stub, end to end through the dispatcher ------------------------------

test('2.3 a new question and a fork through the Claude stub yield the expected lineage, and stdin was closed', async (t) => {
  const cwd = await tempDir(t);
  const logPath = join(cwd, 'claude.log');
  const first = await dispatchQuestion({ ...fixture(cwd, 'claude', 'Why?', { STUB_CLAUDE_LOG_TO: logPath, STUB_CLAUDE_SESSION_ID: 'root-1' }), conventions: '' });
  assert.ok(first.ok, JSON.stringify(first));
  if (first.ok) {
    assert.equal(first.subAgentSessionId, 'root-1');
    assert.deepEqual(first.answer, { text: 'No documented intent found.', source: 'none', sourceDetail: '' });
    assert.equal(first.model, null, 'no model pinned and none reported');
  }
  const second = await dispatchQuestion({ ...fixture(cwd, 'claude', 'And then?', { STUB_CLAUDE_LOG_TO: logPath }), target: { mode: 'fork', sessionId: 'root-1' }, conventions: '' });
  assert.ok(second.ok, JSON.stringify(second));
  if (second.ok) assert.match(second.subAgentSessionId ?? '', /^fork-of-root-1-\d+$/);

  const log = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(log.length, 2, 'the stub exits 3 when stdin stays open, so two answers mean stdin was closed twice');
  assert.equal(log[0].subcommand, 'new');
  assert.equal(log[1].subcommand, 'fork');
  assert.equal(log[1].continuedSession, 'root-1');
  assert.equal(log[0].subagentMarker, '1', 'the child carries SIDESCREEN_SUBAGENT=1');
  assert.equal(log[1].subagentMarker, '1');
  assert.ok(log[0].prompt.includes("The agent's output being reviewed"));
  assert.ok(!log[1].prompt.includes("The agent's output being reviewed"), 'the fork already holds the document');
});

test('2.3 the Claude stub\'s failure modes surface as dispatch errors naming the backend', async (t) => {
  const cwd = await tempDir(t);
  const failed = await dispatchQuestion({ ...fixture(cwd, 'claude', 'q', { STUB_CLAUDE_MODE: 'fail' }), conventions: '' });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.match(failed.error, /claude sub-agent produced no answer \(exit code 1\): Not logged in/);
  const denied = await dispatchQuestion({ ...fixture(cwd, 'claude', 'q', { STUB_CLAUDE_MODE: 'denied' }), conventions: '' });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.match(denied.error, /permission denied for Write/);
  const hung = await dispatchQuestion({ ...fixture(cwd, 'claude', 'q', { STUB_CLAUDE_MODE: 'hang' }), timeoutMs: 400, conventions: '' });
  assert.equal(hung.ok, false);
  if (!hung.ok) assert.match(hung.error, /claude sub-agent did not answer within/);
});

test('the turn\'s recorded model pins the Claude run, an explicit setting wins, and the model used is reported back', async (t) => {
  const cwd = await tempDir(t);
  const argsFile = join(cwd, 'args.json');
  const pinned = await dispatchQuestion({ ...fixture(cwd, 'claude', 'q', { STUB_CLAUDE_ARGS_TO: argsFile }, { model: 'claude-fable-5-1' }), conventions: '' });
  assert.ok(pinned.ok);
  let args = JSON.parse(await readFile(argsFile, 'utf8'));
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'claude-fable-5-1']);
  if (pinned.ok) assert.equal(pinned.model, 'claude-fable-5-1', 'the stub reports the model it was given');

  const overridden = await dispatchQuestion({ ...fixture(cwd, 'claude', 'q', { STUB_CLAUDE_ARGS_TO: argsFile, SIDESCREEN_CLAUDE_MODEL: 'opus' }, { model: 'claude-fable-5-1' }), conventions: '' });
  assert.ok(overridden.ok);
  args = JSON.parse(await readFile(argsFile, 'utf8'));
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'opus']);

  await dispatchQuestion({ ...fixture(cwd, 'claude', 'q', { STUB_CLAUDE_ARGS_TO: argsFile }, { model: null }), conventions: '' });
  args = JSON.parse(await readFile(argsFile, 'utf8'));
  assert.ok(!args.includes('--model'), 'no recorded model and no setting means the CLI default');
  assert.equal(args[args.indexOf('--name') + 1], sessionNameFor('q'));
  assert.equal(sessionNameFor('  why   is the lock a directory?  '), 'sidescreen: why is the lock a directory?');
  assert.equal(sessionNameFor('x'.repeat(100)).length, 'sidescreen: '.length + 60);
});

test('the transcript\'s directory is granted for reading when it exists, and the slice\'s directory once one is written', async (t) => {
  const cwd = await tempDir(t);
  const argsFile = join(cwd, 'args.json');
  const transcriptDir = join(cwd, 'transcripts');
  await mkdir(transcriptDir);
  const turn = sampleTurn({ cwd, transcriptPath: join(transcriptDir, 's.jsonl') });
  await writeFile(turn.transcriptPath ?? '', JSON.stringify({ type: 'user', uuid: 'u1', parentUuid: null, message: { role: 'user', content: 'hi' } }) + '\n' + JSON.stringify({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: turn.message }] } }) + '\n', 'utf8');
  const input = fixture(cwd, 'claude', 'q', { STUB_CLAUDE_ARGS_TO: argsFile });
  const result = await dispatchQuestion({ ...input, turn, conventions: '' });
  assert.ok(result.ok, JSON.stringify(result));
  const args = JSON.parse(await readFile(argsFile, 'utf8'));
  const granted = args.filter((/** @type {string} */ arg, /** @type {number} */ index) => args[index - 1] === '--add-dir');
  assert.deepEqual(granted, [transcriptDir, join(cwd, 'state', 'turn-slices')]);

  const missing = fixture(cwd, 'claude', 'q', { STUB_CLAUDE_ARGS_TO: argsFile }, { transcriptPath: join(cwd, 'nowhere', 't.jsonl') });
  assert.ok((await dispatchQuestion({ ...missing, conventions: '' })).ok);
  assert.ok(!JSON.parse(await readFile(argsFile, 'utf8')).includes('--add-dir'), 'a directory that does not exist is not granted');
});

// ---- 2.5: prompt parity ---------------------------------------------------------------

test('2.5 the same question yields byte-identical prompts on both backends, and neither command line carries a backend-only channel', async (t) => {
  const cwd = await tempDir(t);
  await writeFile(join(cwd, 'rules.md'), 'RULE-PARITY: plain dashes only.\n', 'utf8');
  const claudePrompt = join(cwd, 'claude-prompt.txt');
  const codexPrompt = join(cwd, 'codex-prompt.txt');
  const claudeArgs = join(cwd, 'claude-args.json');
  const codexArgs = join(cwd, 'codex-args.json');
  const shared = { SIDESCREEN_CONVENTIONS_FILES: join(cwd, 'rules.md'), STUB_CLAUDE_PROMPT_TO: claudePrompt, STUB_CODEX_PROMPT_TO: codexPrompt, STUB_CLAUDE_ARGS_TO: claudeArgs, STUB_CODEX_ARGS_TO: codexArgs };
  const question = 'Why is the lock a directory?';
  assert.ok((await dispatchQuestion(fixture(cwd, 'claude', question, shared))).ok);
  assert.ok((await dispatchQuestion(fixture(cwd, 'codex', question, shared))).ok);
  const [fromClaude, fromCodex] = await Promise.all([readFile(claudePrompt, 'utf8'), readFile(codexPrompt, 'utf8')]);
  assert.equal(fromClaude, fromCodex, 'identical prompt text');
  assert.ok(fromClaude.includes('RULE-PARITY: plain dashes only.'), 'the rules live inside the prompt argument itself');
  assert.ok(fromClaude.includes(question));

  const backendOnly = ['--system-prompt', '--append-system-prompt', '--system-prompt-file', '--append-system-prompt-file', '--agents', '--agent', '--settings', '--mcp-config', '--plugin-dir', 'model_instructions_file', 'experimental_instructions_file', '--profile', '-p'];
  for (const [name, path] of [['claude', claudeArgs], ['codex', codexArgs]]) {
    const args = JSON.parse(await readFile(path, 'utf8')).slice(0, -1);
    for (const flag of backendOnly) {
      if (name === 'claude' && flag === '-p') continue;
      assert.ok(!args.includes(flag), `${name} must not carry ${flag}`);
      if (flag.startsWith('-') && flag !== '-p') assert.ok(!args.some((/** @type {string} */ arg) => arg.startsWith(`${flag}=`)), `${name} must not carry ${flag}=`);
    }
    assert.ok(!args.some((/** @type {string} */ arg) => /instructions/i.test(arg)), `${name} passes no instruction file`);
  }
});

// ---- 6.3: the sub-agent starts in the project root ---------------------------------

test('6.3 a turn ingested while the shell sat in a subdirectory still starts its sub-agent in the session\'s directory', async (t) => {
  const dir = await tempDir(t);
  const project = await realpath(await tempDir(t, 'sidescreen-project-'));
  const store = new Store(join(dir, 'state'));
  const payload = (/** @type {string} */ promptId, /** @type {string} */ cwd) => ({
    lastAssistantMessage: `message ${promptId}`,
    sessionId: 'sess-1',
    promptId,
    cwd,
    transcriptPath: null,
    stopHookActive: false,
  });
  await recordTurn(store, payload('p1', project));
  const moved = await recordTurn(store, payload('p2', join(project, 'openspec', 'changes', 'x')));
  assert.equal(moved.cwd, project);

  const logPath = join(dir, 'claude.log');
  const input = fixture(dir, 'claude', 'q', { STUB_CLAUDE_LOG_TO: logPath }, {});
  const result = await dispatchQuestion({ ...input, turn: moved, conventions: '' });
  assert.ok(result.ok, JSON.stringify(result));
  const [entry] = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(await realpath(entry.cwd), project, 'the sub-agent ran in the project root, not the subdirectory');
});
