## Why

`sidescreen serve` runs in the foreground and dies with the terminal or the Claude Code session that started it, so the shipped skill can only tell the agent to run it "in the background", which under Claude Code ties the server to that one session.
A second session that follows the same instruction gets "address in use" and a non-zero exit, which reads as a failure and invites another attempt.
The review surface should be started once by whichever session needs it first, outlive that session, and be shared by every other session that writes to the same store.

## What Changes

- **A detached start.**
  `sidescreen start` launches the server as its own process, detached from the calling shell and its process group, and returns as soon as the server answers.
  The server keeps running after the terminal closes and after the Claude Code session that started it ends.
  Its output goes to a log file in the state directory, since a detached process has no terminal.
- **One server per address, found through the address itself.**
  Before starting anything, the command asks the port whether a sidescreen server already answers there.
  When one does, the command reports the address and exits successfully without starting a second process, so an agent reading the result has no reason to try again.
  When two sessions start at the same instant, the port binding decides which process serves and both commands report the one server.
  When the port is held by something that is not sidescreen, or by a sidescreen server reading a different store, the command says so and exits non-zero.
- **The server identifies itself.**
  A health endpoint on the server names the product, its version, its process id, and the store it reads, which is what start, stop, and status consult.
- **A running server can be stopped and inspected.**
  `sidescreen stop` asks the server on the port to shut down cleanly and waits until the address is free.
  Stopping when nothing is running is not an error.
  `sidescreen status` prints one line saying whether a server answers, at which address, at which version, and under which process id.
- **Opening the project does not depend on who started the server.**
  `start --open` opens the current directory's project page whether this command started the server or found one already running.
- **A running server from an older install is called out.**
  When the running server's version differs from the version of the command, the report names both and says how to switch, so an upgrade is not silently ignored.
- **`serve` keeps the foreground.**
  It remains the process that `start` launches, still usable directly in a terminal.
  Its behaviour on a port already held by sidescreen changes to match `start`: it reports the address and exits successfully.
  **BREAKING** for scripts that relied on the non-zero exit in that case; the package is not yet published, so no installed copy is affected.
- **The shipped skill directs the agent to the detached start.**
  The skill's "open the review surface" instruction becomes `sidescreen start --open`, with the rule that an "already running" report is success and the command is not to be repeated in that session.
  The skill also names `sidescreen stop`.
- **The documentation describes a server that outlives the session.**
  The README quick start becomes install, `sidescreen init`, `sidescreen start --open`, and no longer asks the user to keep a terminal open.
  The commands table, the troubleshooting entry for a busy port, and the location of the log file are updated.

## Capabilities

### New Capabilities

- `server-lifecycle`: how the browser server is started detached, found again by other sessions through its address, identified through its health endpoint, stopped, and inspected, and how the shipped skill uses those commands.

### Modified Capabilities

- `project-workspace`: the requirement "A second server reports the address in use" is removed; `server-lifecycle` states the new behaviour, in which a sidescreen server already on the port is reported as running with a successful exit and only a foreign occupant is an error.
- `package-distribution`: the documented quick start's third step changes from `sidescreen serve --open` to `sidescreen start --open`.

`agent-output-review` is unchanged: turns still reach the server through the store file that every Stop hook writes and the server watches, so sharing one server across sessions needs nothing new there.

## Impact

Affected code:

- `src/cli.js`: the `start`, `stop`, and `status` commands, the changed busy-port path of `serve`, the log file, the usage text, and a shared health probe.
- `src/web/server.js`: the health endpoint.
- `skills/sidescreen/SKILL.md` and its installed copy under `.claude/skills/`: the start and stop instructions and the do-not-retry rule.
- `README.md`: quick start, commands table, troubleshooting, and where the log lives.
- Tests: the health endpoint, `start` finding a free port then finding itself, a start that loses the race, a foreign occupant, a store mismatch, `stop` and `status`, the server surviving its starter's process group, and the skill text.
- `openspec/specs/project-workspace/spec.md` and `openspec/specs/package-distribution/spec.md`: through the deltas in this change.

Unchanged surfaces:

- Hook registration, ingestion, carry-back, the store format, and every page and API the browser uses.
- The `serve` command's flags and its foreground behaviour on a free port.

### Non-goals

Deliberately out of scope, each for a stated reason.

- **A macOS menu bar icon.** It needs a native helper and is a separate change that builds on the health endpoint and the `start` and `stop` commands introduced here.
- **Starting the server from a Claude Code hook without being asked.** Starting a server the user did not ask for is a different behaviour with its own questions; the trigger stays the skill, on the user's request.
- **Supervision by launchd or systemd.** It pins the node path in a plist or unit, the fragility the README already warns about for hooks, and it splits the lifecycle by operating system.
  A detached process is enough for a server the user starts and stops.
- **A `restart` command.** `stop` followed by `start` is two commands and covers the upgrade case; a third verb can follow if the pair proves tiresome.
- **A pid file or registry beside the store.** The port is the only registry, and the health endpoint the only record, so there is no stale file to reconcile.
