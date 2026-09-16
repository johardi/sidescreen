import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version.js';
import { ingest } from './ingest.js';
import { carryBackCommand } from './carry-back.js';
import { init } from './init.js';
import { defaultSettingsPath, projectSettingsPath, setupHooks } from './setup-hooks.js';
import { Store, defaultStateDir } from './store.js';
import { DEFAULT_PORT, createServer } from './server.js';
import { projectId, projectPath } from './projects.js';
import { createCodexDispatch, dispatchSettings } from './dispatch.js';

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
  annotatr init [options]                 Set up the current directory: hooks in ./.claude/settings.json,
                                          skills in ./.claude/skills/
      --dry-run                             Report what would change without writing
  annotatr ingest                         Read a Stop hook payload on stdin and store the turn
  annotatr carry-back --emit              Print pending carry-back entries for the session in the
                                          UserPromptSubmit payload on stdin (or --session <id>)
  annotatr setup hooks [options]          Register annotatr's hooks in Claude Code settings
      --settings <path>                     Settings file to edit (default: ~/.claude/settings.json)
      --project                             Edit ./.claude/settings.json instead
      --dry-run                             Report what would change without writing
  annotatr serve [options]                Start the browser surface on loopback
      --port <n>                            Port to listen on (default: 7486)
      --open                                Open this directory's project in the default browser
  annotatr --version                      Print the version
  annotatr --help                         Print this help

Environment:
  ANNOTATR_STATE_DIR                      Where the store lives (default: $XDG_STATE_HOME/annotatr)
  ANNOTATR_CODEX_BIN                      Sub-agent command (default: codex)
  ANNOTATR_MODEL                          Model passed to the sub-agent (default: its own)
  ANNOTATR_DISPATCH_TIMEOUT_MS            Time bound per question (default: 300000)
  ANNOTATR_CONVENTIONS_FILES              Files forwarded as conventions, path-delimited
                                          (default: ~/.claude/CLAUDE.md, ./CLAUDE.md, ./AGENTS.md)
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

    case 'init':
      return initCommand(rest, io);

    case 'ingest':
      return ingest(io);

    case 'carry-back':
      return carryBackCommand(rest, io);

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
async function initCommand(argv, io) {
  const options = parseFlags(argv, { 'dry-run': 'boolean' }, io);
  if (options === null) return 1;
  return init({
    cwd: process.cwd(),
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
  else if (options.project === true) settingsPath = projectSettingsPath(process.cwd());

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

  const cwd = process.cwd();
  const store = new Store(defaultStateDir(io.env));
  const server = createServer({
    store,
    dispatch: createCodexDispatch({ env: io.env }),
    env: io.env,
    cwd,
    log: (message) => io.stderr.write(`${message}\n`),
  });
  /** @type {string} */
  let url;
  try {
    url = await server.listen({ port });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EADDRINUSE') throw error;
    io.stderr.write(
      `annotatr serve: 127.0.0.1:${port} is already in use. Another annotatr may be running there: open http://127.0.0.1:${port}/ instead, or choose another port with --port.\n`,
    );
    return 1;
  }
  const settings = dispatchSettings(io.env);
  const project = projectUrl(url, cwd);
  io.stdout.write(`annotatr listening on ${url}\n`);
  io.stdout.write(`this project: ${project} (${cwd})\n`);
  io.stdout.write(`sub-agent: ${settings.codexBin} (read-only, ${Math.round(settings.timeoutMs / 1000)}s timeout${settings.model ? `, model ${settings.model}` : ''})\n`);
  if (options.open === true) openInBrowser(project);

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

/**
 * The workspace address of a directory's project on a running server.
 *
 * @param {string} baseUrl
 * @param {string} cwd
 */
export function projectUrl(baseUrl, cwd) {
  return new URL(projectPath(projectId(cwd)), baseUrl).href;
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
