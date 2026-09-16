## Context

See `proposal.md` for motivation and the `project-workspace` spec for the behaviour this design has to produce.

What exists, and what constrains the approach:

- The store is one JSON file with `turns` keyed by prompt id, `threads` keyed by thread id, and `carryBack` keyed by session id, at schema version 1.
  There is no session or project record; a session exists only as the `sessionId` field on its turns.
  Every write is a read-modify-write under an in-process mutex and an on-disk directory lock, because each `Stop` hook runs its own `annotatr ingest` process.
- The server renders two HTML shells, an index and a turn page, each with the page's data inlined as JSON and one module script.
  Live updates come over one event stream: a file watcher on the store emits `store-changed`, and the API emits `thread-created`, `thread-updated`, and `carry-back-updated`.
  There is no client-side router, and the turn page renders exactly one document, which is what the anchor model relies on.
- The ingestion warning checks the user settings, the project settings, and the project's local settings for the directory the server was started in.
- The `Stop` hook payload carries `session_id`, `prompt_id`, `cwd`, and `transcript_path`, and `annotatr ingest` reads only the payload.

Facts probed on this machine before writing this design:

- The transcript contains records of type `ai-title` shaped `{ "type": "ai-title", "aiTitle": "...", "sessionId": "..." }`.
  They recur throughout a session, 66 times in one 15-turn session and 23 in another, and every record in a session carried the same title.
  A session that had just started had none, so a title can be absent at the first ingest and present later.
- `/clear` mints a new session id inside the same `claude` process: one session's last record and the next session's first record were 20 seconds apart, and the new session's first message was the `/clear` output.
  `claude --resume` continues an existing id in a new process.
  A session is therefore a conversation, and its `cwd` is fixed for its lifetime.
- Both `prompt_id` and `session_id` are UUIDs, so a turn address is unambiguous without its session, and the nesting exists for context rather than resolution.
- The live store holds 31 turns across 4 sessions in one directory, two of which overlapped for hours.

## Goals / Non-Goals

**Goals:**

- One document per page, so the anchor model and the thread pane are untouched.
- No client-side router; following is a reload of the same address.
- The store stays one file, and ingestion never fails because of anything this change adds to it.
- Every new state change goes through the same same-origin check as the existing ones.

**Non-Goals:**

- A `projects` record. Projects are derived from sessions until there is something to store about them, such as a user-chosen name.
- Unread tracking across browsers. The follow notice covers the live case; a persistent unread marker is a separate feature.
- Soft delete or undo, per the proposal.

## Decisions

### A project id is a short hash of the exact working directory

The id is the first 12 hexadecimal characters of the SHA-256 of the directory path as the hook reported it.
It is stable across restarts, carries no path, and can be computed from either side: the server computes it from its own start directory for `serve --open`, and resolves an id from a URL by hashing the directories of the sessions it knows.

Alternatives considered:

- Percent-encoding the path into the URL. Reversible without lookup, but long, ugly, and it publishes the user's directory layout in every link.
- Claude Code's own project slug, the directory with separators replaced by dashes. Lossy, since a dash in a directory name collides with a separator, and the first design already declared that encoding an internal detail of the harness.
- A random id stored in a `projects` record. Requires the record this design otherwise avoids, and a lookup the hash does not need.

Forty-eight bits is far beyond what a handful of directories can collide in.

### Sessions are materialized; projects are derived

A `sessions` record is added, keyed by session id, holding the working directory, transcript path, title, when the session's first turn arrived, and when its latest one did.
It is materialized because the title needs a home, the sidebar orders by latest turn, and carry-back is already keyed the same way.

Projects are computed from the sessions on each read: distinct directories, each with its id, name, session count, and latest turn time.
Nothing is stored about a project, so there is nothing to migrate when one is renamed on disk.

Turn counts and the "no turns left" condition come from the turns, not from counters on the session.
When a turn is removed and no turn remains for its session, the session record is removed too, which is how it leaves the sidebar.
Its carry-back entries live in a separate map and are not touched.

### The title is read at ingest time, from the tail of the transcript

When a turn is ingested, the transcript named in the payload is opened and its last megabyte is scanned for the last `ai-title` record.
A title found replaces the stored one; none found leaves the stored one alone.
Any failure, including a missing path, an unreadable file, or malformed lines, leaves the title alone and never fails the ingest.

Why the tail: transcripts reach many megabytes, title records recur throughout, and a title already seen is kept, so the last megabyte is enough in practice and bounds the time added to every turn's `Stop` hook.
Why at ingest rather than at render: the store stays self-contained, the server never touches transcripts, and the read happens once per turn instead of once per page.

The reader lives in its own module that returns a string or null and has no access to the message.
The ingest module still takes the turn's text from the payload alone, so the first spec's rule holds structurally, not by convention.

Alternative considered: reading the title when the sidebar renders.
Rejected because it repeats the file read on every page and event, and because it moves filesystem access into request handling for a value that changes rarely.

### The URL depth is the follow scope, and following is a same-address reload

The project address renders the project's newest turn, the session address renders that session's newest turn, and the turn address renders that turn.
Each page carries its scope in the inlined data.

On every event from the stream, a following page fetches the project's sidebar data, which includes the newest prompt id for the project and for each session.
If the newest id in scope differs from the turn on screen and the page is clean, the page reloads its own address, and the server renders the new turn at the same URL.
"Clean" means the ask popover is hidden, no branch form is open, and no textarea holds text.
Otherwise, and always on a pinned page or for a turn outside the scope, the page shows a notice with the session's title and a link to the new turn's address.

The store watcher fires on every write, including a thread answer the same page just received, so the comparison of prompt ids is what prevents needless reloads, not the event type.

Alternatives considered:

- A client-side router that swaps the document in place. Smoother, but a new moving part and a second rendering path for the same shell.
- Always a notice, never a reload. Safe, but it is a list to click through rather than a second screen.

### The sidebar is rendered on the server for first paint and re-rendered on the client from one endpoint

One endpoint returns the selected project's sessions, each with its title, start time, and turns newest first, each turn with its time, first-line preview, and thread count.
The shell renders the sidebar from the same data so the page is complete before any script runs.
The client re-renders the sidebar from the endpoint on every event, so a new turn appears in the sidebar at once even when the page is pinned, and the notice can name its session.

The thread count on each turn is what the removal confirmation shows, so removal needs no extra request before confirming.

Collapse state is kept per browser tab, in session storage, so navigating between turns of a project keeps the sidebar as the user left it while a new tab starts fresh.

### Removal is a two-state control on the row, and one same-origin request

Each turn row holds a remove control that is visually hidden until the row is hovered or has focus within it.
The control is a real button with an accessible label, so keyboard users reach it by tabbing through the row.

The first activation arms the row: the control is replaced by a confirmation button reading "Remove turn and N threads?" or "Remove turn?" when N is zero.
The second activation sends `DELETE` for the turn.
Escape, the pointer leaving the row, focus leaving the row, or a click anywhere else disarms it.
No timer is involved; the pointer leaving the row is the natural cancel.

The server removes the turn and every thread whose prompt id matches, removes the session when no turn remains, and broadcasts a `turn-removed` event with the prompt id, session id, and project id.
If the removed turn is the one on screen, the client navigates to the project's follow address.

A dispatch already in flight for a removed thread finishes harmlessly: the answer step re-reads the store, finds no thread, and records nothing, which the existing code already does for a missing thread.

If the harness delivers the same prompt id again after removal, which `stop_hook_active` makes possible, the turn reappears.
The hook is the source of truth for what was said, and a tombstone to suppress it would be a second source of truth.

Alternatives considered:

- A modal dialog. Slower, moves the pointer, and offers no more safety than naming the thread count in place.
- A single click with an undo toast. Fewer clicks, but it introduces a soft-deleted state and a timer, both excluded by the proposal.

### The ingestion warning and the open-browser option both use the selected project's directory

The registration check already takes a directory; the workspace passes the selected project's directory instead of the server's.
The landing page can reuse it per project later without a new mechanism.

For `serve --open`, the server treats its own start directory as a known project even before any turn has arrived from it.
That is what lets the workspace open directly to an empty project and fill in on the first turn, and it needs no path in the URL.

### The port-in-use failure gets a message

The listen step rejects with `EADDRINUSE` today and the command exits with a stack trace.
The command catches that one error, prints that the address is in use, suggests that another annotatr may be running at that address or that `--port` chooses another, and exits non-zero.

## Risks / Trade-offs

- **The harness changes or drops the title record.** → The label falls back to the start time and nothing else depends on the title. The reader ignores lines it does not recognise.
- **A reload while the user is reading, not typing.** The clean check cannot see attention. → Only follow addresses reload, the pinned address never does, and one click on a turn pins it. The notice is the fallback whenever the page is not clean.
- **The store watcher fires for the page's own writes.** → The client compares the newest prompt id in scope with the one on screen before doing anything.
- **Reading the transcript adds latency to every `Stop` hook.** → The read is bounded to the last megabyte and happens once per turn. A failure of any kind leaves the title unchanged and the ingest succeeds.
- **Old code opening a version 2 store.** → It fails with the existing "unsupported version" error rather than misreading. The migration writes a one-time backup of the version 1 file beside the store, so rolling back the code is restoring that file.
- **The sidebar grows without bound.** → Sessions collapse to one line with a count, the active turn scrolls into view, and removal is now available. Curation beyond that is a follow-up.
- **Two directories hash to the same id.** → Not a realistic risk at 48 bits for a personal tool, and the derived project list would show both directories under one entry rather than lose either.

## Migration Plan

1. On the first read of a version 1 store, sessions are derived in memory from the turns: directory and transcript path from any of the session's turns, start time from the earliest turn, latest time from the newest, title null.
2. On the first update after that, the store is written at version 2, and the version 1 file is copied once to a backup beside it.
3. Old turn addresses redirect, so copied links keep working.
4. Hook registration is unchanged, so no Claude Code session needs restarting.
5. Rollback: check out the previous code and restore the backup file. Nothing outside the state directory changes.

## Recorded for the server-lifecycle follow-up

Findings and decisions from this exploration that the next change needs, so it does not have to rediscover them.

- **The goal is seamless: open Claude Code and the server is ready, with nothing for the user or the agent to do.**
  A skill cannot do this, because skills load when the model judges them relevant or the user invokes one, never at startup.
  The two things that run at startup are hooks and MCP servers.
- **Use a `SessionStart` hook that runs an idempotent `annotatr up`.**
  `annotatr init` registers it as a third hook, which modifies the setup requirement of `agent-output-review` and is why it is a separate change.
  `/clear` fires `SessionStart` again, so `up` must cost one probe when the server is already running.
- **MCP was considered and rejected.**
  An MCP server is a child of the Claude Code process, so it dies with the session and two concurrent sessions would spawn two servers fighting for one port.
  It exposes a tool surface to the model, against the first design's rule that annotatr dispatches and never relays through the main session, and the tool schemas sit in every session's context.
  Disabling it leaves ingestion on and the server off, a half-on state that disabling hooks does not produce.
- **`annotatr up [--open]`:** probe `GET /api/health` on the configured port.
  Answers as annotatr at the same version: print the URL and exit 0.
  Answers as annotatr at another version: stop it and start fresh, so a detached server never runs stale code after the user edits annotatr.
  Answers as something else: report that the port is used by another program.
  Nothing listening: spawn `annotatr serve` detached in its own process session with stdio redirected to a log file in the state directory, write a pidfile there, wait until the health probe answers, print the URL.
  With `--open`, open the browser at the current project's address whether or not a server was just started, so "open annotatr" always produces a tab.
- **`annotatr down`** stops the detached server from the pidfile, falling back to the health probe when the pidfile is stale.
- **`/api/health`** returns the version and the state directory, so a mismatch in either is detectable.
- **The skill keeps two jobs:** run `annotatr up --open` when the user asks to open the surface, and troubleshoot when a turn does not appear.
  A browser tab from an earlier day reconnects its event stream on its own when the server comes back.
- **The same hook can create the session record early**, since the `SessionStart` payload carries `session_id`, `cwd`, and `transcript_path`, so a session appears in the sidebar the moment it joins, titled by start time until its first turn brings a title.
- **`SessionStart` also fires for `claude -p` runs**, so a script would start a detached server.
  Idempotent and harmless, but an opt-out is worth having, either an environment variable or a check of the payload's `source` field.
- **The repo's headless hook test** generates its settings from the same registration code, with a real `claude -p` run.
  Once `SessionStart` is registered there, that test must either exclude it or point the state directory and port somewhere disposable, or every test run leaves a detached server behind.

## Open Questions

- Whether `/rename` in Claude Code writes a distinct title record, and if so whether it should take precedence over `ai-title`.
  Deferrable: it changes which record the title reader prefers, not the store, the pages, or the tasks.
- Whether the landing page should show the ingestion marker per project.
  Deferrable: additive, and the check already takes a directory.
- The size of the tail window for the title read.
  Deferrable: a tuning value, resolvable against real transcripts.
