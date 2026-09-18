## Context

See `proposal.md` for motivation and the `macos-menu-bar` delta for the behaviour this design has to produce.

What exists, and what constrains the approach:

- The change `run-server-in-background` gives this one everything it consumes: `sidescreen start` returns once a server answers, `GET /api/health` names the server's version, pid, and state directory, and `sidescreen stop` shuts it down.
  `start` carries the user's environment into the server; the item has to carry the same environment into the commands it runs, or it would act on another store.
- Node has no way to draw in the menu bar.
  The item has to reach AppKit through something else, and the project ships as a plain npm package.
- A process launched from a menu bar item, or by `start` from a shell, does not have the user's shell PATH; `node` under a version manager is not findable by name from there.
- Facts established on this machine on 2026-09-17, a Mac managed with Jamf and running CrowdStrike Falcon:
  - A Swift helper compiled with the Command Line Tools ran for over an hour, then Falcon began killing every execution with SIGKILL and removing the file within the same second.
    Rebuilding did not help: each build is a fresh, ad-hoc-signed Mach-O the sensor has never seen, and that is what it judges.
  - The same behaviour, a status item polling health every two seconds and spawning `node`, ran without interference as a JavaScript for Automation script under `/usr/bin/osascript`, which is signed by Apple.
    Memory was 61 MB against 62 MB for the compiled helper; the item was up 0.1 s after launch.
  - Electron passed too, on reputation, at 307 MB on disk and 220 MB of memory.
    The Swift source run through the `swift` interpreter passed at 252 MB.
    A Tauri binary would be a fresh Mach-O like the Swift one.
  - In JXA, `Ref()` out-parameters for object pointers crash `osascript` inside `JSOCRefPrototypeCreate`; passing null for them works.
    ObjC blocks are not available, so nothing that needs a completion handler can be used; timers and notifications with selectors on a registered subclass can.
- Serena, a Python project with the same need, does the same thing in Python: `pystray` over PyObjC inside the interpreter the user already trusts, a detached singleton manager found through a fixed port, the accessory activation policy, and UI mutations marshalled to the main thread.

## Goals / Non-Goals

**Goals:**

- The item is a controller, not an owner.
  It observes the server through the health endpoint and acts through the CLI, so its lifetime and the server's are independent and nothing it does is unavailable from a terminal.
- No compiled code of the project's own runs for the item, so an endpoint agent has nothing unknown to judge and publishing needs no Mac and no signing identity.
- The command line the item is launched with is the same whichever program plays the item, so a signed native build can be substituted later through one environment variable.
- Every piece the CLI can test is in JavaScript with a fake item; the script is small enough to check by hand from a written checklist.

**Non-Goals:**

- Owning the server process.
  Rejected below.
- A general tray abstraction for other platforms.
- Any UI beyond a status item and its menu.

## Decisions

### A controller that polls, not a supervisor that owns

The item polls `http://127.0.0.1:<port>/api/health` every two seconds with a one-second timeout and derives its state from the answer.
Start and Stop run `sidescreen start --port <n>` and `sidescreen stop --port <n>` as child processes; the poll then reflects the result.

Alternative considered: the item spawns and owns the server, and Quit stops it.
That couples two lifetimes that the previous change deliberately separated; the server would then die when the item is quit, or a crashed item would orphan a server it thought it owned.

### The item runs inside Apple's interpreter

The item is `menubar/sidescreen-menubar.js`, a JavaScript for Automation script, launched as `/usr/bin/osascript -l JavaScript <script> --port <n> --state-dir <dir> --node <path> --bin <path>`.
`ObjC.import('Cocoa')` gives it `NSStatusBar`, `NSMenu`, `NSImage` with SF Symbols, `NSTask`, `NSTimer`, and `NSWorkspace`, the same classes the Swift helper uses.
Actions and timers target methods of a class registered with `ObjC.registerSubclass`, which is how JXA takes selectors.

Why this over the alternatives, all measured on this machine:

- The compiled Swift helper is the right shape and the lightest, but without a Developer ID it is blocked by the endpoint agent on the developer's own Mac, and by construction on any managed Mac with the same policy.
  It stays in the repository, unbuilt, as the future signed option.
- Electron passes, but is 307 MB on disk, 220 MB of memory, and a 100 MB download at install for a status line with five entries.
- The `swift` interpreter passes, but keeps LLVM resident at 252 MB, and needs the Command Line Tools on the user's Mac.
- A Python bridge is Serena's answer and would add a foreign runtime to a Node tool.

The cost is a thinly documented dialect with two hard rules, no `Ref()` for object out-parameters and no blocks, which the script observes and its comments name.

### Absolute paths travel as arguments; the environment travels as the environment

`start` passes `--node <process.execPath>` and `--bin <bin/sidescreen.js>` so the item never looks anything up on PATH, and its Start and Stop run exactly the `node` and the `sidescreen` that launched it.
`SIDESCREEN_STATE_DIR` and every other `SIDESCREEN_*` setting reach the CLI the item runs the way they reached `start`, because `NSTask` inherits the environment.

### One item per store, by the process list

`flock` is not reachable from JXA, so on launch the script asks `pgrep -f` for another `osascript` running the same script with the same `--state-dir`, excluding its own pid, and exits 0 quietly when one exists.
The process list is live state, so there is nothing stale to reconcile, which is the property the previous change wanted from the port and the compiled helper had from the lock.

`start` therefore launches the item on every success, unconditionally; deduplication is the item's own concern, and the cost of a redundant launch is one `osascript` that exits within a fraction of a second.

### Launched by `start`, on every success path, and by nothing else

After `start` has reported a running server on this store, whether it started it, found it, or lost the race to it, it calls the launcher.
The launcher is a no-op on any platform but darwin and when `SIDESCREEN_MENUBAR` is `off`.
It builds the command: `SIDESCREEN_MENUBAR_BIN` when set, run directly with the four arguments; otherwise `/usr/bin/osascript -l JavaScript <script>` with the same four.
When the shipped script is missing it writes one line to stderr and returns; the exit code of `start` is unaffected.
It spawns detached with stdin ignored and stdout and stderr appended to `<state dir>/menubar.log`, and calls `unref()`.
The log is appended rather than truncated, because every `start` launches an item and the one that finds another running must not wipe the log of the one that stays; each launch adds at most a line.

`serve` never launches the item, because a foreground server has a terminal in front of it.
`stop` never touches the item, because the item shows the stopped state within a poll and offers Start.

### The script is small and single-purpose

One file, in this order: argument parsing and `--version`, which reads the version from the package manifest two directories up; the single-instance check; the controller class with `tick:`, `openServer:`, `showLog:`, `startServer:`, `stopServer:`, `commandDone:`, and `quit:`; the status item and the menu; the timer; `app.run`.

State is one string with a payload: `unknown`, `stopped`, `running` with version and pid, `busy` with a label, `failed` with a message.
The poll is `NSURLConnection.sendSynchronousRequestReturningResponseError(request, null, null)` with a one-second timeout on the request; it returns nil for a closed port and data for an answer, and the body decides between `running` and `foreign`.
It blocks the main thread for at most one second, and only when the server accepts and does not answer.
Start and Stop launch an `NSTask` and return; `NSTaskDidTerminateNotification` on the registered class reads the exit status and the first non-empty line of stderr, so the menu stays responsive while a command runs for up to five seconds.
`failed` shows that line and yields to the next poll that observes a change from what was observed when the command failed.
The icon is `macwindow.on.rectangle` while running, checking, or busy, and `rectangle.on.rectangle.slash` while stopped or failed, both as template images; the first menu entry reads "SideScreen is running" or "SideScreen is stopped", and the tooltip carries the port, version, and pid.
The Dock is kept clear with the accessory activation policy.

### The Swift helper stays as the future signed option

`native/menubar/*.swift` and `scripts/build-menubar.sh` remain unchanged and unbuilt, with a comment at the top of `main.swift` saying why they are not shipped and how they are switched in: build, sign with a Developer ID, notarize, and set `SIDESCREEN_MENUBAR_BIN` to the binary, whose command line already matches the script's.
`native` leaves the `files` list, `prepublishOnly` goes back to `npm run check`, and `build:menubar` stays in the scripts for that day.

### Tests use a fake item and check the real script only for its version

Everything the CLI does is tested through `SIDESCREEN_MENUBAR_BIN` pointed at a shell script that records its arguments and environment: the arguments, the inherited `SIDESCREEN_STATE_DIR`, the launch on both the started and the found path, the silence under `SIDESCREEN_MENUBAR=off`, and the one-line note when the shipped script is missing.
The command construction is a pure function of the environment, tested for the default (`/usr/bin/osascript -l JavaScript <script> ...`) and the override.
The launch decision is a pure function of platform and environment, tested for darwin, darwin with the opt-out, and linux.
The real script gets one test on macOS: `osascript -l JavaScript menubar/sidescreen-menubar.js --version` prints the package version.

The menu itself is checked by hand against the scenarios in the spec, and the outcome is recorded in the task.

## Risks / Trade-offs

- [No automated test can click the menu] → the script is kept to a state value, a poller, and a command runner; the manual checklist in the tasks walks every spec scenario, and the result is recorded with the date.
- [JXA is thinly documented and has crash-on-misuse rules] → the two rules are named at the top of the script and observed throughout; every ObjC call the script makes was exercised in the probes.
- [`osascript` is a frequent vehicle for macOS malware, so an endpoint agent could still judge the behaviour] → the exact behaviour, a long-lived status item polling loopback and spawning `node`, ran unhindered on the same agent that blocked the compiled helper; if a policy elsewhere disagrees, `SIDESCREEN_MENUBAR=off` silences the launch and the server is unaffected.
- [The poll blocks the main thread for up to a second when the server accepts and does not answer] → loopback and our own server; a stuck server is already a failure the CLI reports.
- [The item's environment can drift from the terminal's] → documented: the item runs the commands with the environment `start` had when it launched the item; quitting the item and running `start` again refreshes it.
- [Two items for two stores could confuse] → every tooltip names the port, and this is the correct picture: two stores are two servers.
- [The Swift helper could rot while unbuilt] → its smoke test still runs whenever someone builds it, and it is small; rot shows up as a failed build the day it is wanted.

## Migration Plan

- No store or server change.
- A user upgrading sees the item appear on the next `sidescreen start`; no setup step.
- Rollback: uninstall the package and choose Quit in the item's menu; the server, if running, is stopped with `sidescreen stop` as before.

## Open Questions

- Whether the item should signal a newly ingested turn, for example by a brief change of the icon, using the server's event stream.
  Deferrable: it adds to the item without changing how it is launched or controlled.
