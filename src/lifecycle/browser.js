import { spawn } from 'node:child_process';

/**
 * Open a URL in the default browser through the platform's opener, found on PATH.
 *
 * @param {string} url
 */
export function openInBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}
