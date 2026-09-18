/**
 * One vocabulary for every report about a server on an address, shared by
 * `start`, `stop`, `status`, and `serve` on a taken port, so an agent or a
 * user reads the same words whichever command they ran.
 */

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VERSION } from '../version.js';
import { projectId, projectPath } from '../store/projects.js';
import { serverUrl } from './probe.js';

/** @typedef {import('./probe.js').ProbeResult} ProbeResult */

/**
 * What a probe result means for a command that would use `stateDir`.
 *
 * @typedef {'none'|'running'|'mismatch'|'foreign'|'unanswering'} Assessment
 *
 * `running` is a sidescreen server reading this command's store; `mismatch`
 * is a sidescreen server reading another one.
 */

/**
 * @param {ProbeResult} result
 * @param {string} stateDir The state directory this command would use.
 * @returns {Promise<Assessment>}
 */
export async function assess(result, stateDir) {
  if (result.kind !== 'sidescreen') return result.kind;
  return (await sameDirectory(result.stateDir, stateDir)) ? 'running' : 'mismatch';
}

/**
 * Whether two paths name one directory, tolerating a symlink such as macOS's
 * `/var` to `/private/var` when both exist.
 *
 * @param {string} a
 * @param {string} b
 */
async function sameDirectory(a, b) {
  if (resolve(a) === resolve(b)) return true;
  const [realA, realB] = await Promise.all([realpath(a).catch(() => null), realpath(b).catch(() => null)]);
  return realA !== null && realA === realB;
}

/**
 * The workspace address of a directory's project on a server.
 *
 * @param {string} baseUrl
 * @param {string} cwd
 */
export function projectUrl(baseUrl, cwd) {
  return new URL(projectPath(projectId(cwd)), baseUrl).href;
}

/**
 * The sentence added when the running server is not the installed version.
 *
 * @param {string} runningVersion
 * @returns {string|null}
 */
export function versionNote(runningVersion) {
  if (runningVersion === VERSION) return null;
  return `The running server is sidescreen ${runningVersion}; this command is ${VERSION}. Run \`sidescreen stop\` then \`sidescreen start\` to switch to the installed version.`;
}

/**
 * The lines that report a sidescreen server on this command's store.
 *
 * @param {{ result: Extract<ProbeResult, { kind: 'sidescreen' }>, port: number, cwd: string, found: boolean }} options
 *   `found` says the server was already there; otherwise it came up during this command.
 * @returns {string[]}
 */
export function runningLines({ result, port, cwd, found }) {
  const url = serverUrl(port);
  const lines = [
    found ? `sidescreen is already running at ${url} (pid ${result.pid})` : `sidescreen running at ${url} (pid ${result.pid})`,
    `this project: ${projectUrl(url, cwd)} (${cwd})`,
  ];
  const note = versionNote(result.version);
  if (note !== null) lines.push(note);
  return lines;
}

/**
 * The one-line report for an address this command cannot use.
 *
 * @param {{ command: string, assessment: Exclude<Assessment, 'none'|'running'>, result: ProbeResult, port: number, stateDir: string }} options
 */
export function problemLine({ command, assessment, result, port, stateDir }) {
  const address = `127.0.0.1:${port}`;
  switch (assessment) {
    case 'mismatch': {
      const theirs = result.kind === 'sidescreen' ? result.stateDir : '(unknown)';
      if (command === 'start' || command === 'serve') {
        return `sidescreen ${command}: the sidescreen server at ${address} reads ${theirs}, but this command would use ${stateDir}. Turns stored here would not appear there. Stop that server first, set SIDESCREEN_STATE_DIR to match it, or choose another port with --port.`;
      }
      return `sidescreen ${command}: the sidescreen server at ${address} reads ${theirs}, not ${stateDir}. Set SIDESCREEN_STATE_DIR to match it before acting on that server.`;
    }
    case 'foreign':
      return `sidescreen ${command}: ${address} is in use by something other than sidescreen. Choose another port with --port.`;
    case 'unanswering':
      return `sidescreen ${command}: ${address} is in use by something that is not answering as sidescreen. If it is a stuck sidescreen server, find it by port (for example: lsof -i :${port}) and stop it, or choose another port with --port.`;
  }
}
