import { fileURLToPath } from 'node:url';
import { VERSION } from './version.js';
import { ingest } from './hooks/ingest.js';
import { carryBackCommand } from './store/carry-back.js';
import { init } from './hooks/init.js';
import { defaultSettingsPath, projectSettingsPath, setupHooks } from './hooks/setup-hooks.js';
import { Store, StoreError, defaultStateDir } from './store/store.js';
import { DEFAULT_PORT, createServer } from './web/server.js';
import { createDispatch } from './dispatch/dispatch.js';
import { dispatchSettings } from './dispatch/backends.js';
import { probe } from './lifecycle/probe.js';
import { projectUrl } from './lifecycle/report.js';
import { openInBrowser } from './lifecycle/browser.js';
import { LOG_FILE_NAME, report, startCommand } from './lifecycle/start.js';
import { stopCommand } from './lifecycle/stop.js';
import { statusCommand } from './lifecycle/status.js';

/**
 * @typedef {object} CliIo
 * @property {NodeJS.ReadableStream} stdin
 * @property {NodeJS.WritableStream} stdout
 * @property {NodeJS.WritableStream} stderr
 * @property {NodeJS.ProcessEnv} env
 */

const BIN_PATH = fileURLToPath(new URL('../bin/sidescreen.js', import.meta.url));

const USAGE = `sidescreen ${VERSION}

Usage:
  sidescreen init [options]               Set up the current directory: hooks in ./.claude/settings.json,
                                          skills in ./.claude/skills/
      --dry-run                             Report what would change without writing
  sidescreen ingest                       Read a Stop hook payload on stdin and store the turn
  sidescreen carry-back --emit            Print pending carry-back entries for the session in the
                                          UserPromptSubmit payload on stdin (or --session <id>)
  sidescreen setup hooks [options]        Register sidescreen's hooks in Claude Code settings
      --settings <path>                     Settings file to edit (default: ~/.claude/settings.json)
      --project                             Edit ./.claude/settings.json instead
      --dry-run                             Report what would change without writing
  sidescreen start [options]              Start the browser surface in the background and return.
                                          The server outlives this shell and the Claude Code
                                          session that ran it. Reports a server already running
                                          on the port and exits 0 without starting another.
      --port <n>                            Port to listen on (default: 7486)
      --open                                Open this directory's project in the default browser
  sidescreen stop [options]               Stop the background server and wait for the port to free
      --port <n>                            Port the server listens on (default: 7486)
  sidescreen status [options]             One line: is a server running on the port, which version, which pid
      --port <n>                            Port the server listens on (default: 7486)
  sidescreen serve [options]              Start the browser surface in the foreground, until Ctrl-C
      --port <n>                            Port to listen on (default: 7486)
      --open                                Open this directory's project in the default browser
  sidescreen --version                    Print the version
  sidescreen --help                       Print this help

Environment:
  SIDESCREEN_STATE_DIR                    Where the store lives (default: $XDG_STATE_HOME/sidescreen).
                                          A background server writes its output to ${LOG_FILE_NAME} there.
  SIDESCREEN_SUBAGENT                     Who answers an untagged first question: parent, claude, or codex
                                          (default: parent, the harness that produced the turn, on the
                                          turn's own model). A question starting with @claude or @codex
                                          picks a backend itself.
  SIDESCREEN_CLAUDE_BIN                   Claude Code CLI command (default: claude)
  SIDESCREEN_CODEX_BIN                    Codex CLI command (default: codex)
  SIDESCREEN_CLAUDE_MODEL                 Model for claude answers (default: the reviewed turn's model)
  SIDESCREEN_CODEX_MODEL                  Model for codex answers (default: the Codex CLI's own)
  SIDESCREEN_DISPATCH_TIMEOUT_MS          Time bound per question (default: 300000)
  SIDESCREEN_CONVENTIONS_FILES            Files forwarded as conventions, path-delimited
                                          (default: ~/.claude/CLAUDE.md, ./CLAUDE.md, ./AGENTS.md)
  SIDESCREEN_MENUBAR                      macOS: set to off to skip the menu bar icon that start launches
  SIDESCREEN_MENUBAR_BIN                  macOS: a program to run as the menu bar item instead of the shipped script
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

    case 'start':
      return start(rest, io);

    case 'stop':
      return stop(rest, io);

    case 'status':
      return status(rest, io);

    default:
      io.stderr.write(`sidescreen: unknown command "${command}"\n\n${USAGE}`);
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
    io.stderr.write(`sidescreen setup: expected "hooks", got "${target ?? ''}"\n\n${USAGE}`);
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
  const port = parsePort(options.port, 'serve', io);
  if (port === null) return 1;

  const cwd = process.cwd();
  const store = new Store(defaultStateDir(io.env));
  // Read once before listening, so a store that cannot be read fails the
  // start with its reason rather than failing every request afterwards.
  try {
    await store.read();
  } catch (error) {
    if (!(error instanceof StoreError)) throw error;
    io.stderr.write(`sidescreen serve: ${error.message}\n`);
    return 1;
  }
  const server = createServer({
    store,
    dispatch: createDispatch({ env: io.env, stateDir: store.stateDir }),
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
    // Taken. A sidescreen server on this store is success; anything else is not.
    const result = await probe(port);
    if (result.kind === 'none') {
      io.stderr.write(`sidescreen serve: 127.0.0.1:${port} was in use a moment ago and is free now; try again.\n`);
      return 1;
    }
    return report({ command: 'serve', result, found: true, port, cwd, stateDir: store.stateDir, openPage: options.open === true, stdout: io.stdout, stderr: io.stderr });
  }
  const settings = dispatchSettings(io.env);
  const project = projectUrl(url, cwd);
  io.stdout.write(`sidescreen listening on ${url}\n`);
  io.stdout.write(`this project: ${project} (${cwd})\n`);
  io.stdout.write(`sub-agent: ${describeSubagents(settings)}\n`);
  if (options.open === true) openInBrowser(project);

  await new Promise((resolve) => {
    const stop = () => {
      io.stdout.write('\nsidescreen shutting down\n');
      server.close().finally(() => resolve(undefined));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

/**
 * One line on who answers questions: the default backend, each CLI, and the
 * bounds every run keeps.
 *
 * @param {import('./dispatch/backends.js').DispatchSettings} settings
 */
export function describeSubagents(settings) {
  const origin = settings.subagent === 'parent' ? "the parent's harness, on the reviewed turn's model" : 'configured';
  const claude = `claude: ${settings.bins.claude}${settings.models.claude ? ` (model ${settings.models.claude})` : ''}`;
  const codex = `codex: ${settings.bins.codex}${settings.models.codex ? ` (model ${settings.models.codex})` : ''}`;
  return `default ${settings.defaultBackend} (${origin}); ${claude}; ${codex}; read-only, ${Math.round(settings.timeoutMs / 1000)}s timeout`;
}

/**
 * @param {string[]} argv
 * @param {CliIo} io
 * @returns {Promise<number>}
 */
async function start(argv, io) {
  const options = parseFlags(argv, { port: 'string', open: 'boolean' }, io);
  if (options === null) return 1;
  const port = parsePort(options.port, 'start', io);
  if (port === null) return 1;
  return startCommand({
    port,
    open: options.open === true,
    cwd: process.cwd(),
    env: io.env,
    stateDir: defaultStateDir(io.env),
    binPath: BIN_PATH,
    stdout: io.stdout,
    stderr: io.stderr,
  });
}

/**
 * @param {string[]} argv
 * @param {CliIo} io
 * @returns {Promise<number>}
 */
async function stop(argv, io) {
  const options = parseFlags(argv, { port: 'string' }, io);
  if (options === null) return 1;
  const port = parsePort(options.port, 'stop', io);
  if (port === null) return 1;
  return stopCommand({ port, stateDir: defaultStateDir(io.env), stdout: io.stdout, stderr: io.stderr });
}

/**
 * @param {string[]} argv
 * @param {CliIo} io
 * @returns {Promise<number>}
 */
async function status(argv, io) {
  const options = parseFlags(argv, { port: 'string' }, io);
  if (options === null) return 1;
  const port = parsePort(options.port, 'status', io);
  if (port === null) return 1;
  return statusCommand({ port, stateDir: defaultStateDir(io.env), stdout: io.stdout, stderr: io.stderr });
}

/**
 * The port from a `--port` value, or the default; null after reporting a bad one.
 *
 * @param {string|boolean|undefined} value
 * @param {string} command
 * @param {CliIo} io
 * @returns {number|null}
 */
function parsePort(value, command, io) {
  const port = typeof value === 'string' ? Number(value) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.stderr.write(`sidescreen ${command}: invalid port "${String(value)}"\n`);
    return null;
  }
  return port;
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
      io.stderr.write(`sidescreen: unexpected argument "${arg}"\n`);
      return null;
    }
    const name = arg.slice(2);
    const kind = spec[name];
    if (kind === undefined) {
      io.stderr.write(`sidescreen: unknown option "${arg}"\n`);
      return null;
    }
    if (kind === 'boolean') {
      result[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      io.stderr.write(`sidescreen: option "${arg}" requires a value\n`);
      return null;
    }
    result[name] = value;
    index += 1;
  }
  return result;
}
