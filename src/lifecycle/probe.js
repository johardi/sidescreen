/**
 * Ask an address whether a sidescreen server answers there.
 *
 * The port is the only registry of a running server: nothing on disk records
 * it. Every lifecycle command, and `serve` on a taken port, starts here.
 */

import http from 'node:http';

/**
 * @typedef {{ kind: 'none' }
 *   | { kind: 'foreign' }
 *   | { kind: 'unanswering' }
 *   | { kind: 'sidescreen', version: string, pid: number, stateDir: string }} ProbeResult
 *
 * `none`: nothing listens there. `foreign`: something answers, but not as
 * sidescreen. `unanswering`: the connection is accepted but nothing comes
 * back in time. `sidescreen`: a server identified itself.
 */

export const HEALTH_PATH = '/api/health';
export const DEFAULT_PROBE_TIMEOUT_MS = 2_000;
const MAX_HEALTH_BODY_BYTES = 16_384;

/** @param {number} port */
export function serverUrl(port) {
  return `http://127.0.0.1:${port}/`;
}

/**
 * @param {number} port
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<ProbeResult>}
 */
export function probe(port, { timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    /** @param {ProbeResult} result */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = http.get(
      { host: '127.0.0.1', port, path: HEALTH_PATH, timeout: timeoutMs, headers: { Accept: 'application/json' } },
      (response) => {
        /** @type {Buffer[]} */
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_HEALTH_BODY_BYTES) {
            response.destroy();
            finish({ kind: 'foreign' });
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => finish(classify(response.statusCode, Buffer.concat(chunks).toString('utf8'))));
        response.on('error', () => finish({ kind: 'foreign' }));
      },
    );
    request.on('timeout', () => {
      request.destroy();
      finish({ kind: 'unanswering' });
    });
    request.on('error', (error) => {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      finish(code === 'ECONNREFUSED' ? { kind: 'none' } : { kind: 'foreign' });
    });
  });
}

/**
 * @param {number|undefined} status
 * @param {string} body
 * @returns {ProbeResult}
 */
function classify(status, body) {
  if (status !== 200) return { kind: 'foreign' };
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: 'foreign' };
  }
  if (parsed === null || typeof parsed !== 'object') return { kind: 'foreign' };
  const { name, version, pid, stateDir } = /** @type {Record<string, unknown>} */ (parsed);
  if (name !== 'sidescreen' || typeof version !== 'string' || typeof pid !== 'number' || typeof stateDir !== 'string') {
    return { kind: 'foreign' };
  }
  return { kind: 'sidescreen', version, pid, stateDir };
}
