/**
 * `sidescreen status`: one line on whether a server answers at an address.
 */

import { probe, serverUrl } from './probe.js';
import { assess, problemLine, versionNote } from './report.js';

/**
 * @param {{ port: number, stateDir: string, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream }} options
 * @returns {Promise<number>} Exit code: 0 when a sidescreen server on this store answers.
 */
export async function statusCommand({ port, stateDir, stdout, stderr }) {
  const result = await probe(port);
  const assessment = await assess(result, stateDir);
  if (assessment === 'running' && result.kind === 'sidescreen') {
    stdout.write(`sidescreen ${result.version} is running at ${serverUrl(port)} (pid ${result.pid})\n`);
    const note = versionNote(result.version);
    if (note !== null) stdout.write(`${note}\n`);
    return 0;
  }
  if (assessment === 'none') {
    stdout.write(`no sidescreen server is running at 127.0.0.1:${port}\n`);
    return 1;
  }
  stderr.write(`${problemLine({ command: 'status', assessment: /** @type {Exclude<typeof assessment, 'none'|'running'>} */ (assessment), result, port, stateDir })}\n`);
  return 1;
}
