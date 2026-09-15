import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { VERSION } from './version.js';
import { ingest } from './ingest.js';
import { defaultSettingsPath, setupHooks } from './setup-hooks.js';
import { Store, defaultStateDir } from './store.js';
import { DEFAULT_PORT, createServer } from './server.js';

/**
 * @typedef {object} CliIo
 * @property {NodeJS.ReadableStream} stdin
 * @property {NodeJS.WritableStream} stdout
 * @property {NodeJS.WritableStream} stderr
 * @property {NodeJS.ProcessEnv} env
 */

const BIN_PATH = fileURLToPath(new URL('../bin/annotatr.js', import.meta.url));

const USAGE = `annotatr ${VERSION}

Usage:
  annotatr ingest                         Read a Stop hook payload on stdin and store the turn
  annotatr setup hooks [options]          Register annotatr's hooks in Claude Code settings
      --settings <path>                     Settings file to edit (default: ~/.claude/settings.json)
      --project                             Edit ./.claude/settings.json instead
      --dry-run                             Report what would change without writing
  annotatr serve [options]                Start the browser surface on loopback
      --port <n>                            Port to listen on (default: 7486)
      --open                                Open the surface in the default browser
  annotatr --version                      Print the version
  annotatr --help                         Print this help

Environment:
  ANNOTATR_STATE_DIR                      Where the store lives (default: $XDG_STATE_HOME/annotatr)
`;

/**
 * Run the CLI.
 *
 * @param {string[]} argv Arguments after the program name.
 * @param {CliIo} io Streams and environment, injectable for tests.
 * @returns {Promise<number>} Process exit code.
 */
export async function main(argv, io) {
  const [command, ...rest] = argv;

  switch (command) {
    case '--version':
    case '-v':
    case 'version':
      io.stdout.write(`${VERSION}\n`);
      return 0;

    case undefined:
    case '--help':
    case '-h':
    case 'help':
      io.stdout.write(USAGE);
      return command === undefined ? 1 : 0;

    case 'ingest':
      return ingest(io);

    case 'setup':
      return setup(rest, io);

    case 'serve':
      return serve(rest, io);

    default:
      io.stderr.write(`annotatr: unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}

/**
 * @param {string[]} argv
 * @param {CliIo} io
 * @returns {Promise<number>}
 */
async function setup(argv, io) {
  const [target, ...rest] = argv;
  if (target !== 'hooks') {
    io.stderr.write(`annotatr setup: expected "hooks", got "${target ?? ''}"\n\n${USAGE}`);
    return 1;
  }
  const options = parseFlags(rest, { settings: 'string', project: 'boolean', 'dry-run': 'boolean' }, io);
  if (options === null) return 1;

  let settingsPath = defaultSettingsPath(io.env);
  if (typeof options.settings === 'string') settingsPath = options.settings;
  else if (options.project === true) settingsPath = join(process.cwd(), '.claude', 'settings.json');

  return setupHooks({
    settingsPath,
    binPath: BIN_PATH,
    stdout: io.stdout,
    stderr: io.stderr,
    dryRun: options['dry-run'] === true,
  });
}

/**
 * @param {string[]} argv
 * @param {CliIo} io
 * @returns {Promise<number>}
 */
async function serve(argv, io) {
  const options = parseFlags(argv, { port: 'string', open: 'boolean' }, io);
  if (options === null) return 1;
  const port = typeof options.port === 'string' ? Number(options.port) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.stderr.write(`annotatr serve: invalid port "${String(options.port)}"\n`);
    return 1;
  }

  const store = new Store(defaultStateDir(io.env));
  const server = createServer({
    store,
    dispatch: async () => ({ ok: false, error: 'Sub-agent dispatch is not configured in this build.' }),
    env: io.env,
    log: (message) => io.stderr.write(`${message}\n`),
  });
  const url = await server.listen({ port });
  io.stdout.write(`annotatr listening on ${url}\n`);
  if (options.open === true) openInBrowser(url);

  await new Promise((resolve) => {
    const stop = () => {
      io.stdout.write('\nannotatr shutting down\n');
      server.close().finally(() => resolve(undefined));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

/** @param {string} url */
function openInBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}

/**
 * Tiny flag parser: `--name value` for string flags, `--name` for booleans.
 *
 * @param {string[]} argv
 * @param {Record<string, 'string'|'boolean'>} spec
 * @param {CliIo} io
 * @returns {Record<string, string|boolean>|null} Parsed flags, or null after reporting an error.
 */
function parseFlags(argv, spec, io) {
  /** @type {Record<string, string|boolean>} */
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      io.stderr.write(`annotatr: unexpected argument "${arg}"\n`);
      return null;
    }
    const name = arg.slice(2);
    const kind = spec[name];
    if (kind === undefined) {
      io.stderr.write(`annotatr: unknown option "${arg}"\n`);
      return null;
    }
    if (kind === 'boolean') {
      result[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      io.stderr.write(`annotatr: option "${arg}" requires a value\n`);
      return null;
    }
    result[name] = value;
    index += 1;
  }
  return result;
}
