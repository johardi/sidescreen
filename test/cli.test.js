import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/annotatr.js', import.meta.url));
const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));

test('--version prints the package.json version', async () => {
  const { version } = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const { stdout } = await execFileAsync(process.execPath, [bin, '--version']);
  assert.equal(stdout.trim(), version);
});

test('an unknown command exits non-zero with usage on stderr', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [bin, 'frobnicate']),
    /** @param {{ code: number, stderr: string }} error */
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /unknown command "frobnicate"/);
      assert.match(error.stderr, /Usage:/);
      return true;
    },
  );
});
