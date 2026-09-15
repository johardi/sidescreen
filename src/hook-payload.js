/**
 * Parsing of Claude Code hook payloads.
 *
 * The Stop hook delivers the turn's final text in `last_assistant_message`.
 * This module never touches `transcript_path`: the transcript is written
 * asynchronously and can lag the turn that just finished.
 */

export class HookPayloadError extends Error {
  /**
   * @param {string} message
   * @param {string} [field] The payload field that was missing or malformed.
   */
  constructor(message, field) {
    super(message);
    this.name = 'HookPayloadError';
    this.field = field;
  }
}

/**
 * @typedef {object} StopHookPayload
 * @property {string} lastAssistantMessage
 * @property {string} sessionId
 * @property {string} promptId
 * @property {string} cwd
 * @property {string|null} transcriptPath
 * @property {boolean} stopHookActive
 */

const REQUIRED_STRING_FIELDS = /** @type {const} */ ([
  'last_assistant_message',
  'session_id',
  'prompt_id',
  'cwd',
]);

/**
 * Parse a `Stop` hook payload.
 *
 * @param {string|unknown} input Raw JSON text, or an already-parsed value.
 * @returns {StopHookPayload}
 * @throws {HookPayloadError} When the payload is not an object or a required field is missing.
 */
export function parseStopHookPayload(input) {
  const raw = toObject(input);

  for (const field of REQUIRED_STRING_FIELDS) {
    requireNonEmptyString(raw, field);
  }

  const transcriptPath = raw.transcript_path;
  if (transcriptPath !== undefined && transcriptPath !== null && typeof transcriptPath !== 'string') {
    throw new HookPayloadError('Field "transcript_path" must be a string when present', 'transcript_path');
  }

  return {
    lastAssistantMessage: /** @type {string} */ (raw.last_assistant_message),
    sessionId: /** @type {string} */ (raw.session_id),
    promptId: /** @type {string} */ (raw.prompt_id),
    cwd: /** @type {string} */ (raw.cwd),
    transcriptPath: typeof transcriptPath === 'string' && transcriptPath !== '' ? transcriptPath : null,
    stopHookActive: raw.stop_hook_active === true,
  };
}

/**
 * @param {string|unknown} input
 * @returns {Record<string, unknown>}
 */
function toObject(input) {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (error) {
      throw new HookPayloadError(`Payload is not valid JSON: ${/** @type {Error} */ (error).message}`);
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HookPayloadError('Payload must be a JSON object');
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {Record<string, unknown>} raw
 * @param {string} field
 */
function requireNonEmptyString(raw, field) {
  const value = raw[field];
  if (value === undefined || value === null) {
    throw new HookPayloadError(`Payload is missing required field "${field}"`, field);
  }
  if (typeof value !== 'string') {
    throw new HookPayloadError(`Field "${field}" must be a string`, field);
  }
  if (value.trim() === '') {
    throw new HookPayloadError(`Field "${field}" must not be empty`, field);
  }
}
