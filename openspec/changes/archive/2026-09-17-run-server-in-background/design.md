## Context

See `proposal.md` for motivation and the `server-lifecycle` delta for the behaviour this design has to produce.

What exists, and what constrains the approach:

- `sidescreen serve` in `src/cli.js` builds the store and the server, listens, prints three lines, opens the browser when asked, and then waits for SIGINT or SIGTERM before closing.
  A port already in use is caught as `EADDRINUSE` and reported in one line with exit 1, which the `project-workspace` spec required until this change.
- The server (`src/web/server.js`) binds loopback only, refuses any Host header that is not a loopback name, and requires same-origin for state changes.
  It reads the store from the state directory and watches the store file, so a turn ingested by any session's Stop hook reaches whichever server is running.
  Nothing in it depends on the directory it was started from except the `--open` target and the "this project" line, and both are computed in the CLI.
- The state directory is `SIDESCREEN_STATE_DIR`, else `$XDG_STATE_HOME/sidescreen`, else `~/.local/state/sidescreen`.
  Every test that spawns the CLI sets `SIDESCREEN_STATE_DIR` to a temporary directory, so two servers with different stores on one machine is a real configuration, not a corner case.
- The shipped skill says to run `sidescreen serve --open` "in the background".
  Under Claude Code that is the Bash tool's background task, which the harness owns and ends with the session.
- Node's `child_process.spawn` with `detached: true` puts the child in a new process group and session on POSIX.
  Verified on this machine on 2026-09-17: a detached child's process group id was its own pid, not the parent's.
  With `unref()` the parent may exit while the child runs.
- The existing CLI tests already spawn `bin/sidescreen.js serve --port 0` as a child process and read its start-up lines, so process-based tests have a pattern to follow.

## Goals / Non-Goals

**Goals:**

- One mechanism answers "is a server running here": the address itself, through a health endpoint.
  Nothing else on disk records the server.
- `start`, `stop`, `status`, and the busy-port path of `serve` share one probe and one vocabulary, so every message an agent or user reads says the same thing the same way.
- The detached server is the same `serve` process a user could run by hand, with the same flags, so there is one server code path.
- Every lifecycle test is bounded in time and cleans up the process it started, whatever the outcome.

**Non-Goals:**

- Keeping the server alive across a crash or a reboot.
  That is supervision, which the proposal rules out.
- Reconfiguring a running server.
  The environment the first starter had is the environment the server keeps until it is stopped.
- A browser control for stopping the server.
  The CLI is the control surface in this change; the menu bar change may add another.

## Decisions

### The port is the only registry

The start command learns whether a server is running by asking the port, and the stop command learns the process id from the same answer.
No pid file, lock directory, or `server.json` is written.

Alternatives considered:

- A pid file in the state directory.
  It goes stale when the server is killed or the machine restarts, so every reader must also check that the pid is alive and is a sidescreen process, and the port still has to be probed to know the server answers.
  The probe alone gives every fact the pid file would, with no stale state to reconcile.
- A lock directory like the store's.
  Same staleness, and the store's lock has a timeout because of it; a server that runs for days cannot use a lock that expires in thirty seconds.

The cost is that a server that holds the port but no longer answers HTTP cannot be identified.
The commands report that case as "in use by something that is not answering as sidescreen" and suggest finding the process by port.

### A health endpoint identifies the server

`GET /api/health` answers `{ "name": "sidescreen", "version": <package version>, "pid": <process id>, "stateDir": <absolute path> }` with no caching.
It goes through the same Host header check as every other request and is a read, so it needs no origin check.

`stateDir` is in the answer so the start command can refuse to treat a server reading another store as "already running".
Without it, a session with `SIDESCREEN_STATE_DIR` set would be told the server is up, and its turns would never appear there.
The path is already visible to anyone on the machine who can reach loopback, and the landing page shows project directories, so it discloses nothing new.

### `start` launches `serve` as a detached child and waits for health

The sequence:

1. Refuse port 0 with an explanation.
2. Probe the health endpoint with a short timeout, on the order of two seconds.
   - Sidescreen with the same state directory: print "already running", the project address, and the version note when versions differ; open the browser when asked; exit 0.
   - Sidescreen with another state directory: name both directories; exit 1.
   - Any other answer, or a connection that is accepted but does not answer as sidescreen: "in use by something other than sidescreen", suggest `--port`; exit 1.
   - Connection refused: continue.
3. Open `<state dir>/server.log` for writing, truncating it, and spawn `process.execPath bin/sidescreen.js serve --port <n>` with `detached: true`, stdin ignored, stdout and stderr on the log file, the starter's environment and working directory, and `windowsHide: true`.
   Call `unref()` so the command can exit while the child runs.
4. Poll the health endpoint every 100 ms for up to five seconds, while also listening for the child's exit.
   - Health answers as sidescreen: print the address and the project address, open the browser when asked, exit 0.
   - The child exits first: probe once more.
     If a sidescreen server now answers, this command lost the race to another `start`, which is success; report it as running.
     Otherwise report the failure, name the log file, print its last lines, and exit 1.
   - Five seconds pass with neither: report the timeout and the log file, exit 1.
     The child is left running, because it may still be coming up and killing it would hide the cause.

Alternatives considered:

- Daemonizing inside one process.
  Node has no `fork()`; a second process is the only way to detach, so the child is simply `serve`.
- Shell wrappers such as `nohup` or `setsid`.
  Not portable, and `detached: true` already does what `setsid` does on POSIX.
- Returning as soon as the child is spawned.
  The agent would then print an address that may not answer for another second, and `--open` would race the server.
  Waiting for health makes the printed address true.

The bin path is the one `src/cli.js` already resolves for hook registration, and the node path is `process.execPath`, so the child runs on the same runtime as the command.

`serve` does two things before binding that make its failures land in the log rather than after the address has begun to answer: it creates the state directory, and it reads the store once, so a store file that cannot be parsed stops the server with its reason instead of failing every request.
The latter also gives the tests a child-only failure to inject: a corrupt `store.json` fails `serve` and not `start`, where a state directory that is a regular file would fail both, since `start` needs that directory for the log.

### The log file is truncated on each start

`<state dir>/server.log` receives the detached server's stdout and stderr and is truncated when a new server is started.
Appending forever would grow without bound, and rotation is machinery the log does not need: its purpose is to explain why the current server failed or what it did, and the previous server's log has served its purpose once a new one starts.
The foreground `serve` is unaffected and keeps writing to its own stderr.

### Exit codes say whether a server is usable, not whether this command started one

`start` and `serve` exit 0 whenever a sidescreen server reading this store answers at the address afterwards, whether this command started it, found it, or lost a race to it.
They exit 1 when no such server answers: a foreign occupant, a server on another store, a launch failure, or a timeout.

This is the change the proposal marks as breaking for `serve`.
It is what lets the skill say "an already-running report is success", which is the mechanism that stops an agent from retrying: the message is informative and the exit code is not an error.
`status` exits 0 when a server answers and 1 when none does, so a script can test it like `systemctl is-active`.

### `stop` sends SIGTERM to the pid the server reported

`stop` probes the address, and when a sidescreen server answers it sends SIGTERM to the process id from the health answer, then polls the address every 100 ms until the connection is refused, for up to five seconds.
`serve` already handles SIGTERM by closing the server cleanly.
No answer at all is "nothing was running", exit 0.
A foreign occupant is left alone, exit 1.
A server still answering after five seconds is reported with its pid, exit 1, and not force-killed: a dispatch may be mid-flight, and the user can decide.
A pid that is already gone when the signal is sent is treated as stopped.

Alternatives considered:

- A shutdown endpoint such as `POST /api/shutdown`.
  State changes require same-origin, so the CLI would have to forge an Origin header or the endpoint would have to be exempt, and either weakens a rule the server keeps everywhere else.
  A signal to a pid the server itself reported needs no exception.
- Also stopping a server on another store.
  Refused for the same reason `start` refuses to adopt it: the command's store and the server's are different things, and the user should say which one they mean by setting the same environment.

The pid is trusted because the server on the address reported it about itself; it is not read from a file that could be stale.

### `--open` is resolved by the command, from its own directory

The project address is `projectUrl(<server url>, process.cwd())`, computed in the CLI as today, so a `start --open` from project B opens B's page even when the server was started from project A.
The server stays ignorant of who started it.

### Two verbs: `serve` for the foreground, `start` for the background

The foreground server keeps its name, `serve`, and the detached lifecycle is `start`, `stop`, and `status`.

The split follows how Node tooling already uses the words.
`serve` means "run a server in my terminal until Ctrl-C" in `ng serve`, Vercel's `serve`, `gatsby serve`, and `ollama serve`, and no tool uses it to mean a background process.
`start` beside `stop` and `status` reads as lifecycle management, as in `pm2`, `forever`, and `systemctl`.
Caddy is the closest precedent for a server that offers both, with `run` for the foreground and `start` and `stop` for the background.
Ollama is the closest precedent for the shape this project is heading toward: a foreground `serve` in the terminal, and a menu bar app on macOS owning the background lifecycle.

Alternatives considered:

- Caddy's `run` instead of `serve`.
  Equivalent in meaning; `serve` was kept because it is the Node idiom and the name the project already has.
- One verb, `start --foreground`.
  Fewest verbs, but it puts the foreground mode behind a flag no Node tool uses, and `serve` costs nothing to keep since it is the process `start` launches.
- Foreground by default with `start --detach`.
  Inverts the priority: the common case, an agent starting the server from a session, would need a flag, and a forgotten flag ties the server to the session again.

The help text labels `serve` as the foreground command and `start` as the background one, so a reader does not have to infer the difference.

### The skill names one command and one rule

The "open the review surface" row becomes `sidescreen start --open`, described as returning at once and printing the address, with the sentence that a report of a server already running is success and the command is not to be run again in the session.
A row for `sidescreen stop` is added.
The skill's `allowed-tools` already covers every `sidescreen` subcommand.
Projects that ran `sidescreen init` before this change carry the old skill text until `sidescreen init` is run again; it overwrites sidescreen's own files and nothing else, and the README says to rerun it after upgrading.

### Tests spawn the real CLI on a free fixed port

The existing spawn pattern in `test/cli.test.js` is extended:

- A free port is found by listening on port 0, reading the port, and closing, and `start --port <n>` is run against it.
  The small window in which another process could take the port is accepted; the test retries once on a foreign-occupant report.
- Every test that starts a server registers `stop --port <n>` in `t.after`, and additionally kills the pid from the health answer if the address still answers, so a failed assertion never leaves a server behind.
- Survival is tested by running `start` through a wrapper shell spawned with `detached: true`, waiting for the wrapper to exit, sending SIGTERM to the wrapper's process group, and then asserting health still answers.
  If the server had been in the wrapper's group it would have died with it.
- The race is tested by running two `start` commands concurrently for one port and asserting both exit 0, one health answer, one pid.
- The foreign occupant is a plain `node:http` server on the port that answers 200 with a body that is not sidescreen's.
- The store mismatch is a `start` with one `SIDESCREEN_STATE_DIR` followed by a `start` with another on the same port.
- Every wait is bounded at five seconds, matching the commands' own bounds, so a hang fails fast.

## Risks / Trade-offs

- [Process-lifecycle tests are the flakiest kind] → every wait is bounded, cleanup runs regardless of outcome, and the only shared resource is a port chosen per test; the free-port helper retries once.
- [Windows is unverified] → `detached: true` with file stdio is documented to work there, but `process.kill(pid, 'SIGTERM')` terminates without running the close handler; store writes are atomic, so the store is safe, but in-flight dispatches are cut.
  Recorded as an open question rather than designed around, since no Windows machine is available and the existing test suite has never run there either.
- [The first starter's environment is the server's for its lifetime] → the one case that would lose data, a different store, is refused with both paths named.
  Other settings such as the sub-agent backend differ silently; the `status` line and the README say the running server keeps the environment it was started with.
- [A server that holds the port but does not answer cannot be identified or stopped by these commands] → the message says the address is held by something not answering as sidescreen and suggests finding the process by port.
- [A detached server outlives an uninstall or an upgrade] → the version note on `start` and `status` covers the upgrade; the README says to run `sidescreen stop` before uninstalling.
- [Truncating the log on each start loses the previous server's output] → accepted; the log explains the current server, and a user who wants history can copy the file first.
- [Two `start` commands both print success while only one started a server] → intended; the spec's race scenario asks for exactly this, and neither message claims to have started anything, only that a server is running.

## Migration Plan

- No store change; the store version stays at 3.
- `serve` keeps working in a terminal as before, with one difference: a port already held by sidescreen is reported as running with exit 0 rather than exit 1.
- Users rerun `sidescreen init` in each project to pick up the new skill text; the command reports the file as updated and touches nothing else.
- Rollback is reinstalling the previous version and running `sidescreen stop`, since a server from this version may still be running.

## Open Questions

- Whether `stop` on Windows should use a different mechanism than SIGTERM, such as a shutdown request the server accepts only from loopback with a token it printed at start.
  Deferrable: it changes no spec scenario on POSIX and can be decided when the suite first runs on Windows.
