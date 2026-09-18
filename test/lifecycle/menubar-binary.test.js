import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DEFAULT_SCRIPT_PATH, OSASCRIPT } from '../../src/lifecycle/menubar.js';
import { VERSION } from '../../src/version.js';

const execFileAsync = promisify(execFile);
const darwin = process.platform === 'darwin';

test('3.1 the shipped script prints the package version through osascript', { skip: !darwin && 'macOS only' }, async () => {
  const { stdout } = await execFileAsync(OSASCRIPT, ['-l', 'JavaScript', DEFAULT_SCRIPT_PATH, '--version']);
  assert.equal(stdout.trim(), `sidescreen-menubar ${VERSION}`);
});

// The compiled Swift helper is kept for a future signed build; it is checked only when someone has built it.
const SWIFT_HELPER = fileURLToPath(new URL('../../native/bin/sidescreen-menubar', import.meta.url));
const swiftBuilt = await access(SWIFT_HELPER).then(() => true, () => false);

test('3.1 the compiled Swift helper, when built, prints the package version and holds both architectures', { skip: !darwin ? 'macOS only' : !swiftBuilt ? 'unbuilt; run npm run build:menubar to check it' : false }, async () => {
  const { stdout } = await execFileAsync(SWIFT_HELPER, ['--version']);
  assert.equal(stdout.trim(), `sidescreen-menubar ${VERSION}`);
  const archs = (await execFileAsync('lipo', ['-archs', SWIFT_HELPER])).stdout.trim().split(/\s+/).sort();
  assert.deepEqual(archs, ['arm64', 'x86_64']);
});
