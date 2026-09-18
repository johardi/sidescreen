// sidescreen-menubar: the menu bar item for the background server.
//
// This is JavaScript for Automation, run by macOS's own interpreter:
//   /usr/bin/osascript -l JavaScript sidescreen-menubar.js --port <n> --state-dir <dir> --node <path> --bin <path>
// It reaches AppKit through the ObjC bridge, so sidescreen ships no compiled
// code for the item and nothing has to be signed or built. It is a controller,
// not an owner: it watches the server through its health endpoint and acts
// through the CLI, and quitting it leaves the server alone.
//
// Two rules of this dialect, both of which crash or fail silently when broken:
//   1. Never pass Ref() for an object out-parameter such as NSError ** or
//      NSURLResponse **. osascript segfaults. Pass null and judge the result.
//   2. There are no ObjC blocks, so nothing with a completion handler can be
//      used. Timers and notifications with selectors on a registered class can.

ObjC.import('Cocoa');
ObjC.import('stdlib');

// ---- arguments ---------------------------------------------------------------

const argv = $.NSProcessInfo.processInfo.arguments.js.map((argument) => argument.js);
const scriptPath = argv.find((argument) => argument.endsWith('sidescreen-menubar.js')) || '';

function option(name) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
}

function writeOut(text) {
  $.NSFileHandle.fileHandleWithStandardOutput.writeData($.NSString.alloc.initWithUTF8String(text).dataUsingEncoding($.NSUTF8StringEncoding));
}

function readFile(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  return text.isNil() ? null : text.js;
}

if (argv.includes('--version')) {
  // Two directories up from the script: menubar/ is directly under the package
  // root. The path is as given on the command line, so a relative one is
  // resolved against the current directory first.
  const absolute = scriptPath.startsWith('/') ? scriptPath : `${$.NSFileManager.defaultManager.currentDirectoryPath.js}/${scriptPath}`;
  const packageRoot = $(absolute).stringByDeletingLastPathComponent.stringByDeletingLastPathComponent.js;
  const manifest = readFile(`${packageRoot}/package.json`);
  const version = manifest ? JSON.parse(manifest).version : 'unknown';
  writeOut(`sidescreen-menubar ${version}\n`);
  $.exit(0);
}

const port = option('--port');
const stateDir = option('--state-dir');
const node = option('--node');
const bin = option('--bin');
if (port === null || stateDir === null || node === null || bin === null) {
  console.log('usage: sidescreen-menubar --port <n> --state-dir <dir> --node <path> --bin <path>');
  $.exit(2);
}

// ---- one item per store ------------------------------------------------------

/** Run a program to completion and return its exit status and output. */
function runToEnd(file, args) {
  const task = $.NSTask.alloc.init;
  task.executableURL = $.NSURL.fileURLWithPath(file);
  task.arguments = args;
  const output = $.NSPipe.pipe;
  task.standardOutput = output;
  task.standardError = $.NSFileHandle.fileHandleWithNullDevice;
  task.launchAndReturnError(null);
  task.waitUntilExit;
  const text = $.NSString.alloc.initWithDataEncoding(output.fileHandleForReading.readDataToEndOfFile, $.NSUTF8StringEncoding);
  return { status: task.terminationStatus, out: text.isNil() ? '' : text.js };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The process list is live state, so there is nothing stale to reconcile.
// When two items start together, the one with the higher pid yields.
const ownPid = $.NSProcessInfo.processInfo.processIdentifier;
const others = runToEnd('/usr/bin/pgrep', ['-f', `sidescreen-menubar\\.js .*--state-dir ${escapeRegExp(stateDir)}( |$)`])
  .out.split('\n').map((line) => Number(line)).filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== ownPid);
if (others.some((pid) => pid < ownPid)) {
  console.log(`sidescreen-menubar: another item already runs for ${stateDir} (pid ${others.find((pid) => pid < ownPid)})`);
  $.exit(0);
}

// ---- state -------------------------------------------------------------------

const serverUrl = `http://127.0.0.1:${port}/`;
/** One of: unknown, stopped, running, busy, failed. `detail` carries the payload. */
let state = { kind: 'unknown' };
/** What the last poll saw, whatever the item shows. */
let lastObserved = { kind: 'unknown' };
/** What the poll had seen when a command failed; the failure yields once that changes. */
let observedAtFailure = { kind: 'unknown' };
let currentTask = null;
let currentAction = null;
let currentErrors = null;
let currentOutput = null;

function sameObservation(a, b) {
  return a.kind === b.kind && a.pid === b.pid;
}

/** Ask the server. Synchronous with a one-second timeout, null out-parameters (rule 1). */
function probe() {
  const url = $.NSURL.URLWithString(`${serverUrl}api/health`);
  const request = $.NSURLRequest.requestWithURLCachePolicyTimeoutInterval(url, $.NSURLRequestReloadIgnoringLocalCacheData, 1.0);
  const data = $.NSURLConnection.sendSynchronousRequestReturningResponseError(request, null, null);
  if (data.isNil()) return { kind: 'stopped' };
  const text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
  try {
    const health = JSON.parse(text.js);
    if (health.name === 'sidescreen' && typeof health.pid === 'number') return { kind: 'running', version: String(health.version), pid: health.pid };
  } catch (error) {
    // not sidescreen
  }
  return { kind: 'stopped' };
}

function setState(next) {
  const changed = next.kind !== state.kind || next.detail !== state.detail || next.pid !== state.pid;
  state = next;
  if (changed) render();
}

function observe(observed) {
  lastObserved = observed;
  if (state.kind === 'busy') return;
  if (state.kind === 'failed') {
    if (!sameObservation(observed, observedAtFailure)) setState(observed);
    return;
  }
  setState(observed);
}

// ---- the controller: every selector AppKit calls lands here --------------------

ObjC.registerSubclass({
  name: 'SideScreenMenubarController',
  methods: {
    'tick:': { types: ['void', ['id']], implementation: () => { try { observe(probe()); } catch (error) { console.log(`poll failed: ${error}`); } } },
    'openServer:': { types: ['void', ['id']], implementation: () => { $.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString(serverUrl)); } },
    'showLog:': { types: ['void', ['id']], implementation: () => { $.NSWorkspace.sharedWorkspace.openURL($.NSURL.fileURLWithPath(`${stateDir}/server.log`)); } },
    'startServer:': { types: ['void', ['id']], implementation: () => run('start', 'Starting SideScreen') },
    'stopServer:': { types: ['void', ['id']], implementation: () => run('stop', 'Stopping SideScreen') },
    'commandDone:': { types: ['void', ['id']], implementation: () => commandDone() },
    'quit:': { types: ['void', ['id']], implementation: () => { $.NSApp.terminate($()); } },
  },
});
const controller = $.SideScreenMenubarController.alloc.init;

/** Run `node <bin> <action> --port <n>` with this process's environment, which is what `sidescreen start` launched the item with. */
function run(action, label) {
  if (state.kind === 'busy') return;
  setState({ kind: 'busy', detail: label });
  const task = $.NSTask.alloc.init;
  task.executableURL = $.NSURL.fileURLWithPath(node);
  task.arguments = [bin, action, '--port', port];
  currentOutput = $.NSPipe.pipe;
  currentErrors = $.NSPipe.pipe;
  task.standardOutput = currentOutput;
  task.standardError = currentErrors;
  currentTask = task;
  currentAction = action;
  // Completion arrives as a notification with a selector (rule 2), so the menu stays responsive meanwhile.
  $.NSNotificationCenter.defaultCenter.addObserverSelectorNameObject(controller, 'commandDone:', 'NSTaskDidTerminateNotification', task);
  const launched = task.launchAndReturnError(null);
  if (!launched) {
    observedAtFailure = lastObserved;
    setState({ kind: 'failed', detail: `cannot run ${node}` });
  }
}

function commandDone() {
  const task = currentTask;
  if (task === null) return;
  $.NSNotificationCenter.defaultCenter.removeObserverNameObject(controller, 'NSTaskDidTerminateNotification', task);
  currentOutput.fileHandleForReading.readDataToEndOfFile;
  const errors = $.NSString.alloc.initWithDataEncoding(currentErrors.fileHandleForReading.readDataToEndOfFile, $.NSUTF8StringEncoding);
  const firstLine = (errors.isNil() ? '' : errors.js).split('\n').map((line) => line.trim()).find((line) => line !== '');
  const status = task.terminationStatus;
  const action = currentAction;
  currentTask = null;
  currentAction = null;
  if (status === 0) {
    setState({ kind: 'unknown' });
  } else {
    observedAtFailure = lastObserved;
    setState({ kind: 'failed', detail: firstLine || `sidescreen ${action} exited with status ${status}` });
  }
  observe(probe());
}

// ---- the item ----------------------------------------------------------------

const app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
const item = $.NSStatusBar.systemStatusBar.statusItemWithLength($.NSSquareStatusItemLength);

function symbol(name) {
  const image = $.NSImage.imageWithSystemSymbolNameAccessibilityDescription(name, 'SideScreen');
  image.setTemplate(true);
  return image;
}

function menuItem(title, selector, enabled) {
  const entry = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(title, selector, '');
  if (selector !== null) entry.setTarget(controller);
  entry.setEnabled(enabled);
  return entry;
}

function render() {
  const effective = state.kind === 'failed' ? lastObserved : state;
  const running = effective.kind === 'running';
  const settled = effective.kind !== 'unknown' && effective.kind !== 'busy';

  let symbolName = 'macwindow.on.rectangle';
  let status;
  let tooltip;
  switch (state.kind) {
    case 'unknown':
      status = 'Checking SideScreen…';
      tooltip = `Checking SideScreen (port: ${port})…`;
      break;
    case 'stopped':
      symbolName = 'rectangle.on.rectangle.slash';
      status = 'SideScreen is stopped';
      tooltip = `SideScreen is stopped (port: ${port})`;
      break;
    case 'running':
      status = 'SideScreen is running';
      tooltip = `SideScreen ${state.version} is running (port: ${port}, pid: ${state.pid})`;
      break;
    case 'busy':
      status = `${state.detail}…`;
      tooltip = `${state.detail} (port: ${port})…`;
      break;
    default:
      symbolName = 'rectangle.on.rectangle.slash';
      status = state.detail;
      tooltip = state.detail;
  }

  item.button.image = symbol(symbolName);
  item.button.toolTip = tooltip;

  const menu = $.NSMenu.alloc.init;
  menu.setAutoenablesItems(false);
  menu.addItem(menuItem(status, null, false));
  menu.addItem($.NSMenuItem.separatorItem);
  menu.addItem(menuItem('Open SideScreen', 'openServer:', running));
  menu.addItem(menuItem('Start', 'startServer:', settled && !running));
  menu.addItem(menuItem('Stop', 'stopServer:', settled && running));
  menu.addItem($.NSMenuItem.separatorItem);
  menu.addItem(menuItem('Show log', 'showLog:', true));
  menu.addItem($.NSMenuItem.separatorItem);
  menu.addItem(menuItem('Quit', 'quit:', true));
  item.setMenu(menu);
}

render();
observe(probe());
$.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(2, controller, 'tick:', $(), true);
app.run;
