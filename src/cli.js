import { VERSION } from './version.js';

/**
 * @typedef {object} CliIo
 * @property {NodeJS.ReadableStream} stdin
 * @property {NodeJS.WritableStream} stdout
 * @property {NodeJS.WritableStream} stderr
 * @property {NodeJS.ProcessEnv} env
 */

const USAGE = `annotatr ${VERSION}

Usage:
  annotatr --version            Print the version
  annotatr --help               Print this help
`;

/**
 * Run the CLI.
 *
 * @param {string[]} argv Arguments after the program name.
 * @param {CliIo} io Streams and environment, injectable for tests.
 * @returns {Promise<number>} Process exit code.
 */
export async function main(argv, io) {
  const [command] = argv;

  if (command === '--version' || command === '-v' || command === 'version') {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    io.stdout.write(USAGE);
    return command === undefined ? 1 : 0;
  }

  io.stderr.write(`annotatr: unknown command "${command}"\n\n${USAGE}`);
  return 1;
}
