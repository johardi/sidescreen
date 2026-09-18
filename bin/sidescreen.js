#!/usr/bin/env node
import { main } from '../src/cli.js';

// A reader that goes away early, such as `sidescreen start | head -1`, closes
// the pipe; that is the reader's choice, not an error worth a stack trace.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EPIPE') process.exit(0);
    throw error;
  });
}

process.exitCode = await main(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
});
