/**
 * 7.5: the Claude Code sub-agent, for real. The exact command the adapter
 * builds is run against the installed `claude`, in a project whose settings
 * register a Stop hook and a UserPromptSubmit hook that would leave marker
 * files. The sub-agent is asked to read a file in an added directory, to
 * create a file, and to run a shell command. It must read, must not write,
 * must have no shell, and the hooks must stay silent.
 *
 * This spends API credit and needs a logged-in `claude`, so it only runs when
 * SIDESCREEN_E2E_CLAUDE=1 is set. Otherwise it is skipped with a reason.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tempDir } from '../helpers.js';
import { buildClaudeCommand, parseClaudeResult } from '../../src/dispatch/claude-adapter.js';
import { ANSWER_SCHEMA_PATH } from '../../src/dispatch/dispatch.js';
import { SUBAGENT_MARKER } from '../../src/hooks/ingest.js';

const execFileAsync = promisify(execFile);

const optedIn = process.env.SIDESCREEN_E2E_CLAUDE === '1';
const claudeAvailable = await execFileAsync('claude', ['--version']).then(() => true, () => false);

const REPORT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    fileText: { type: 'string', description: 'The exact text of the file you were asked to read, or empty if you could not read it.' },
    couldWrite: { type: 'boolean', description: 'Whether you managed to create the file.' },
    couldRunShell: { type: 'boolean', description: 'Whether you managed to run the shell command.' },
    tools: { type: 'array', items: { type: 'string' }, description: 'The exact names of every tool available to you in this session.' },
    notes: { type: 'string' },
  },
  required: ['fileText', 'couldWrite', 'couldRunShell', 'tools', 'notes'],
  additionalProperties: false,
});

/**
 * Environment for a nested claude run: drop the markers of the session this
 * test may itself be running inside, so the child starts fresh.
 *
 * @param {Record<string, string>} extra
 * @returns {NodeJS.ProcessEnv}
 */
function childEnv(extra) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_') || key === 'CLAUDE_PID' || key === 'CLAUDE_EFFORT') continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

/** @param {string} path */
const exists = (path) => access(path).then(() => true, () => false);

test(
  '7.5 a restricted Claude sub-agent reads an added directory, cannot write, has no shell, and fires none of the project\'s hooks',
  { skip: !optedIn ? 'set SIDESCREEN_E2E_CLAUDE=1 to run against a real claude' : !claudeAvailable ? 'claude is not on PATH' : false },
  async (t) => {
    const dir = await tempDir(t, 'sidescreen-restricted-');
    const project = join(dir, 'project');
    const outside = join(dir, 'outside');
    await mkdir(join(project, '.claude'), { recursive: true });
    await mkdir(outside);
    await writeFile(join(project, 'src.js'), 'export const lock = "directory";\n', 'utf8');
    await writeFile(join(outside, 'transcript.jsonl'), 'SECRET-TRANSCRIPT-LINE-4821\n', 'utf8');
    const stopMarker = join(dir, 'STOP_HOOK_FIRED');
    const promptMarker = join(dir, 'PROMPT_HOOK_FIRED');
    await writeFile(
      join(project, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: `touch ${JSON.stringify(stopMarker)}` }] }],
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: `touch ${JSON.stringify(promptMarker)}` }] }],
        },
      }),
      'utf8',
    );

    const wanted = join(project, 'WROTE.txt');
    const prompt = [
      'Do three things, then report.',
      `1. Read ${join(outside, 'transcript.jsonl')} and put its exact text in fileText.`,
      `2. Try to create a file at ${wanted} containing the word hello, with any tool you have. Set couldWrite to whether it worked.`,
      '3. Try to run the shell command `ls` with any tool you have. Set couldRunShell to whether it worked.',
      '4. List the exact names of every tool you have available in tools.',
      'Put anything else worth saying in notes.',
    ].join('\n');
    const { command, args } = buildClaudeCommand({
      bin: 'claude',
      target: { mode: 'new' },
      prompt,
      cwd: project,
      schemaPath: ANSWER_SCHEMA_PATH,
      schemaText: REPORT_SCHEMA,
      model: 'haiku',
      readDirs: [outside],
      sessionName: 'sidescreen: restricted probe',
    });

    const { stdout } = await execFileAsync(command, args, { cwd: project, env: childEnv({ [SUBAGENT_MARKER]: '1' }), timeout: 180_000, maxBuffer: 10_000_000 });
    const parsed = parseClaudeResult(stdout);
    assert.ok(parsed.sessionId, 'a session id came back');
    assert.deepEqual(parsed.errors, [], 'no error, no denial');
    assert.ok(parsed.finalText, 'an answer came back');
    const report = JSON.parse(parsed.finalText);
    assert.match(report.fileText, /SECRET-TRANSCRIPT-LINE-4821/, 'the added directory was readable');
    assert.equal(report.couldWrite, false, 'the sub-agent reports it could not write');
    assert.equal(report.couldRunShell, false, 'the sub-agent reports it had no shell');
    assert.equal(await exists(wanted), false, 'and indeed nothing was written');
    assert.equal(await exists(stopMarker), false, 'the project Stop hook did not fire');
    assert.equal(await exists(promptMarker), false, 'the project UserPromptSubmit hook did not fire');
    assert.equal(parsed.model !== null && /haiku/.test(parsed.model), true, `the model used is reported: ${parsed.model}`);
    assert.ok(Array.isArray(report.tools) && report.tools.length > 0, 'the sub-agent listed its tools');
    for (const tool of report.tools) {
      assert.doesNotMatch(String(tool), /mcp|canva|drive|slack|bash|shell|write|edit|notebook|web/i, `no tool beyond the reading set: ${tool}`);
    }
    t.diagnostic(`restricted probe ran on ${parsed.model}; tools: ${report.tools.join(', ')}; notes: ${String(report.notes).slice(0, 160)}`);
    void readFile;
  },
);
