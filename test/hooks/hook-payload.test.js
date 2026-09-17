import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES } from '../helpers.js';
import { HookPayloadError, parseStopHookPayload } from '../../src/hooks/hook-payload.js';

const fixtureText = await readFile(join(FIXTURES, 'stop-hook-payload.json'), 'utf8');
const fixture = JSON.parse(fixtureText);

test('parses the observed Stop hook payload shape', () => {
  const payload = parseStopHookPayload(fixtureText);
  assert.deepEqual(payload, {
    lastAssistantMessage: 'banana',
    sessionId: fixture.session_id,
    promptId: fixture.prompt_id,
    cwd: fixture.cwd,
    transcriptPath: fixture.transcript_path,
    stopHookActive: false,
  });
});

test('accepts an already-parsed object', () => {
  const payload = parseStopHookPayload(fixture);
  assert.equal(payload.lastAssistantMessage, 'banana');
});

for (const field of ['last_assistant_message', 'session_id', 'prompt_id', 'cwd']) {
  test(`rejects a payload missing ${field}`, () => {
    const { [field]: _omitted, ...withoutField } = fixture;
    assert.throws(
      () => parseStopHookPayload(withoutField),
      (error) => error instanceof HookPayloadError && error.field === field && /missing required field/.test(error.message),
    );
  });

  test(`rejects a payload where ${field} is not a string`, () => {
    assert.throws(
      () => parseStopHookPayload({ ...fixture, [field]: 42 }),
      (error) => error instanceof HookPayloadError && error.field === field,
    );
  });

  test(`rejects a payload where ${field} is empty`, () => {
    assert.throws(
      () => parseStopHookPayload({ ...fixture, [field]: '   ' }),
      (error) => error instanceof HookPayloadError && error.field === field,
    );
  });
}

test('transcript_path is optional and becomes null when absent', () => {
  const { transcript_path: _omitted, ...withoutTranscript } = fixture;
  assert.equal(parseStopHookPayload(withoutTranscript).transcriptPath, null);
});

test('rejects a transcript_path that is not a string', () => {
  assert.throws(
    () => parseStopHookPayload({ ...fixture, transcript_path: ['nope'] }),
    (error) => error instanceof HookPayloadError && error.field === 'transcript_path',
  );
});

test('rejects text that is not JSON', () => {
  assert.throws(() => parseStopHookPayload('{not json'), (error) => error instanceof HookPayloadError && /not valid JSON/.test(error.message));
});

test('rejects JSON that is not an object', () => {
  assert.throws(() => parseStopHookPayload('[1, 2]'), HookPayloadError);
  assert.throws(() => parseStopHookPayload('"banana"'), HookPayloadError);
  assert.throws(() => parseStopHookPayload('null'), HookPayloadError);
});

test('reads stop_hook_active as a boolean', () => {
  assert.equal(parseStopHookPayload({ ...fixture, stop_hook_active: true }).stopHookActive, true);
  assert.equal(parseStopHookPayload({ ...fixture, stop_hook_active: 'yes' }).stopHookActive, false);
});
