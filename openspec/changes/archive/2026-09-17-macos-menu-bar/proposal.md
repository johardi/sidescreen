## Why

Once `sidescreen start` returns, the background server has no presence on the machine: the only way to learn whether it is running, or to stop it, is another terminal command.
On macOS, users expect a background service to show itself in the menu bar and to be controllable from there.
A menu bar item gives the server a face and puts start, stop, and open one click away, without a terminal.

## What Changes

- **A menu bar item appears with the background server on macOS.**
  When `sidescreen start` leaves a server running on this store, whether it started one or found one, it also launches the item, detached, so the item outlives the command and the session the same way the server does.
  At most one item runs per store; a second launch finds the first and leaves quietly.
  Quitting the item leaves the server running.
  `SIDESCREEN_MENUBAR=off` disables it, and on other operating systems nothing is attempted.
  The foreground `serve` never launches it.
- **The item shows the server's state and offers its controls.**
  It asks the server's health endpoint every two seconds and shows "SideScreen is running" or "SideScreen is stopped", with the port, version, and process id in the icon's tooltip.
  Its menu offers Open SideScreen, Start, Stop, Show log, and Quit, with Start offered only when nothing answers and Open and Stop only when something does.
  Start and Stop run the same `sidescreen start` and `sidescreen stop` a user would type, with the environment the item was launched with, so the item and the terminal always agree on the store and the port.
  While a command runs the item says so, and a failure's first line stays on the status line until the state next changes.
- **The item is a script run by macOS's own JavaScript interpreter, not a binary of ours.**
  It is one JavaScript for Automation file, shipped as source and run by `/usr/bin/osascript`, which calls the same AppKit classes a native app would.
  The project therefore ships no compiled code, needs no Apple Developer account, no build step at publish, and no developer tools on the user's Mac, and publishing works from any platform.
  This shape was chosen after the compiled alternative was blocked on the developer's own managed Mac: CrowdStrike Falcon quarantines a freshly built, ad-hoc-signed binary on first execution, while a script run by an Apple-signed interpreter was allowed with the full behaviour, at the same memory as the compiled helper.
- **The compiled Swift helper stays in the repository as the future signed option.**
  Its source and build script remain, unbuilt and unshipped.
  `SIDESCREEN_MENUBAR_BIN` launches any program in its place, with the same arguments, which is how a signed and notarized build of it would be switched in later without changing the CLI.
- **The documentation gains a section on the icon.**
  What the menu offers, how to turn the icon off, how to bring it back after quitting it (`sidescreen start`), where its log lives, and how the item is run.

## Capabilities

### New Capabilities

- `macos-menu-bar`: the menu bar item that accompanies a background server on macOS: when it appears, what it shows, what it can do, and how it is shipped and run.

### Modified Capabilities

- `package-distribution`: the requirement that the installed copy is self-sufficient gains the macOS item's script, and the package-contents scenario names it.

`server-lifecycle`, introduced by the active change `run-server-in-background`, is unchanged: the item consumes its health endpoint and its `start` and `stop` commands exactly as they are.

## Impact

Affected code:

- `menubar/sidescreen-menubar.js`: the item, about two hundred lines of JavaScript for Automation: argument parsing, the single-instance check, the status item and menu, the health poller, and the command runner.
- `src/lifecycle/menubar.js`: deciding whether to launch, building the `osascript` command or the override, and launching it detached with absolute paths as arguments.
- `src/lifecycle/start.js`: launching the item on each success path.
- `src/cli.js`: the two environment variables in the usage text.
- `package.json`: `menubar` in `files`; `prepublishOnly` back to the checks alone; `build:menubar` kept for the retained Swift helper.
- `native/menubar/*.swift` and `scripts/build-menubar.sh`: kept as the future signed option, with a note in the source on why they are not shipped.
- Tests: the launch decision, the command built for the default and the override, a fake item that records what it was launched with, the opt-out, the missing-script note, and a `--version` smoke test of the shipped script through `osascript` on macOS.
- `README.md`: the new section and the two settings in the configuration table.
- `openspec/specs/package-distribution/spec.md`: through the delta in this change.

Unchanged surfaces:

- The server, its health endpoint, `stop`, `status`, and `serve`.
- Hooks, ingestion, carry-back, and the store.

### Non-goals

Deliberately out of scope, each for a stated reason.

- **Starting at login, or supervision by launchd.** The item is a controller for a server the user starts; keeping the server alive across logins is a different feature with the plist fragility the previous change ruled out.
- **A Dock icon or a window.** The item is an accessory in the menu bar only; the browser is the surface.
- **A tray icon on Windows or Linux.** Each needs its own native code; macOS is where the request came from.
- **Signing and notarizing the Swift helper now.** It needs an Apple Developer account; the source is kept so that can happen later without redesign.
- **Electron or a Python bridge as the host.** Both were measured or examined: Electron passes the same endpoint agent on reputation but costs 307 MB on disk and 220 MB of memory; a Python bridge is how Serena does it and would add a foreign runtime to a Node tool.
- **Notifying when a new turn arrives.** A plausible later use of the item, recorded as an open question in the design.
- **One icon controlling several servers.** One item per store, on the port it was launched with; a user with two stores gets two items, each naming its port in the tooltip.
