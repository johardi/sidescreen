/**
 * What a sub-agent backend has to provide. The dispatcher composes the
 * prompt, runs the command with stdin closed and a time bound, and reads the
 * answer; an adapter owns only what differs between CLIs: the command line,
 * how it is kept read-only, and how its output is read.
 *
 * This module exports no runtime values.
 *
 * @typedef {{ mode: 'new' } | { mode: 'fork', sessionId: string }} DispatchTarget
 * Where a dispatch starts from: a fresh session, or a fork of an answered one.
 */

/**
 * @typedef {object} CommandInput
 * @property {string} bin The CLI command.
 * @property {DispatchTarget} target
 * @property {string} prompt The whole prompt, passed as the final argument.
 * @property {string} cwd The project directory the sub-agent works in.
 * @property {string} schemaPath Path to the answer schema, for CLIs that take a file.
 * @property {string} schemaText The answer schema's text, for CLIs that take it inline.
 * @property {string|undefined} model A model to pin, or undefined for the CLI's default.
 * @property {string[]} readDirs Directories outside the project the sub-agent must be able to read.
 * @property {string} sessionName A recognizable name for the session, for CLIs that keep one.
 */

/**
 * @typedef {object} ParsedOutput
 * @property {string|null} sessionId The sub-agent session id the CLI minted.
 * @property {string|null} finalText The final message, to be read as a sourced answer.
 * @property {string[]} errors Error messages the CLI reported.
 * @property {string|null} model The model the CLI reports having used, when it says.
 */

/**
 * @typedef {object} BackendAdapter
 * @property {import('./backends.js').Backend} name
 * @property {(input: CommandInput) => { command: string, args: string[] }} command
 * @property {(stdout: string) => ParsedOutput} parseOutput
 */

export {};
