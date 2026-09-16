## Why

Every completed turn lands in one flat, newest-first list, so a user running two Claude Code sessions in the same project cannot tell which turn belongs to which conversation, and a user with several projects sees them all mixed together.
The live store already shows the problem: 31 turns across 4 sessions, two of which ran concurrently for hours and interleave on the index page.
A browser page that focuses on one project, lists that project's sessions and turns in a sidebar, and follows the newest turn as it arrives turns the surface into a real second screen instead of a list to search.

## What Changes

- **A landing page at `/` lists projects.**
  A project is a distinct working directory reported by the `Stop` hook, shown with its last path segment, full path, session count, and last activity.
  The user selects a project before anything else.
  `annotatr serve --open` knows its own directory, so it opens that project directly and skips the landing page.
- **One page focuses on one project.**
  The left sidebar lists only that project's sessions, ordered by last activity, and under each session all of its turns, newest first, each with its time and first-line preview.
  Sessions are collapsible and show their turn count when collapsed; the active session is expanded and its active turn is scrolled into view.
  A switch in the topbar returns to the landing page.
- **One sidebar entry per session id, labelled by the harness's own title.**
  A session is a conversation, not a process: `/clear` starts a new one inside a running `claude`, and `claude --resume` continues an old one in a new process.
  The title comes from the `ai-title` record in the transcript the hook already supplies, refreshed on every ingest because a fresh session has none until a turn or two have completed.
  An untitled session falls back to its start time.
- **The URL says what the page follows.**
  `/projects/<project-id>` shows the project's newest turn from any session and follows it.
  `/projects/<project-id>/sessions/<session-id>` shows and follows that session's newest turn.
  `/projects/<project-id>/sessions/<session-id>/turns/<prompt-id>` pins one turn and follows nothing.
  Clicking a turn in the sidebar pins it; a "Latest" entry at the top of the sidebar returns to following.
  The existing `/turns/<prompt-id>` redirects to the pinned form, so links already copied keep working.
- **Following reloads in place, and never over the user's hands.**
  When a followed page learns of a new turn over the existing event stream, it reloads the same URL and shows that turn.
  If the ask popover is open or any input holds text, or if the page is pinned, it shows a banner naming the session the turn came from and offering to view it instead.
- **A turn can be removed from the sidebar in two clicks.**
  Hovering or focusing a turn row reveals a remove button at its right edge.
  The first click turns the button into an inline confirmation that names what goes with the turn, such as "Remove turn and 3 threads?"; the second click removes it.
  Moving away, pressing Escape, or clicking elsewhere cancels.
  Removing a turn also removes its threads, because they are anchored in text that no longer exists in the surface.
  Carry-back entries survive, because they are the user's conclusions and are still owed to the terminal.
  A session whose last turn is removed leaves the sidebar.
  Removing the turn on screen navigates to the project's follow URL.
- **The ingestion warning is checked for the selected project.**
  Today the "no Stop hook registered" warning checks the directory the server was started in.
  With a project selected it checks that project's settings file, so the warning is right for the project on screen.
- **The store gains a `sessions` record** holding each session's title, working directory, transcript path, and first and last turn times.
  Projects are derived from the sessions' working directories, keyed by a short stable hash of the path so the path itself never appears in a URL.
  The store version moves to 2, and an existing version 1 store is migrated in place from its turns on first read.

## Capabilities

### New Capabilities

- `project-workspace`: the project-focused browser workspace: selecting a project on a landing page, listing its sessions and turns in a sidebar labelled from the harness's own session title, addressing turns by project, session, and turn id with follow mode encoded in the URL depth, and removing turns with an inline two-click confirmation.

The name is broader than navigation because turn removal belongs to the same surface and the same sidebar rows.

### Modified Capabilities

None.
The requirements of `agent-output-review` cover how a turn is ingested, annotated, answered, and carried back, and none of that changes.
Its rule that the turn's text is never read from the transcript still holds: the title is a label, not the document, and a lagging title is harmless where a lagging document is not.

## Impact

Affected code:

- `src/store.js` and `src/types.js`: the `sessions` record, version 2, the migration from version 1, and removal of a turn with its threads.
- `src/turns.js` and `src/ingest.js`: recording a turn also upserts its session and refreshes the title from the transcript.
- `src/server.js`: the project, session, and turn routes, the redirects, `/api/projects` and `/api/projects/<id>` for the landing page and sidebar, a latest-turn lookup for follow mode, and `DELETE /api/turns/<id>` behind the existing same-origin check.
- `src/setup-hooks.js`: the registration check takes a project directory instead of assuming the server's.
- `src/cli.js`: `serve --open` opens the current project's URL, and a second manual `serve` on a port already in use reports it in one friendly line instead of failing with a stack trace.
- `src/page.js`, `src/public/app.js`, `src/public/app.css`: the landing page and the workspace shell with sidebar, follow banner, and remove affordance replace the index page; `src/public/index.js` goes away.
- Tests for store migration and turn removal, routing and redirects, follow-mode reload and deferral, page rendering, and a browser test that two concurrent sessions in one project are listed apart and that removal takes two clicks.
- `README.md`: the landing page, URL forms, follow mode, and removal.

Unchanged surfaces:

- Hook registration.
  No new hook is added, so `annotatr init` and `annotatr setup hooks` are untouched.
- The thread, dispatch, and carry-back APIs, and the anchor model.
  A page still renders exactly one document, so anchors resolve as they do today.
- The carry-back zone, which is already keyed by session and stays where it is.

### Non-goals

Deliberately out of scope, each for a stated reason.

- **Registering `SessionStart`.** Deferred to a server-lifecycle follow-up, not dropped.
  That change gives `annotatr init` a third hook that runs an idempotent `annotatr up` when a session starts, so the server is detached, current, and ready before the first turn finishes without the agent or the user doing anything.
  The same hook lets a session appear in the sidebar the moment it joins, before its first completed turn.
  It modifies the setup requirement of `agent-output-review`, which is why it is not folded in here.
  The sketch is recorded in this change's `design.md` so the follow-up does not have to rediscover it.
- **Client-side routing.** Navigation between turns is a full page load, and following is a reload of the same URL. The shell is light, and a router would be a new moving part for a smoother transition only.
- **Stacking a session's turns as one scrolling conversation.** Several annotatable documents on one page changes how anchors are scoped. The sidebar gives the same navigation without touching the anchor model.
- **Removing a whole session or a whole project from the browser.** Removing a session is removing its turns one by one today. A session-level control is the same mechanism on a different row and can follow once the need is felt.
- **Undo or soft delete.** The confirmation names what is lost, and the turn's text still exists in the transcript on disk. Threads are the only thing that goes for good, and the confirmation says how many.
- **Renaming sessions or projects from the browser.** The harness title is good enough to start.
- **Grouping by git repository root.** Exact working directory matches how Claude Code files its own transcripts and needs no git call.
- **Showing the user's prompt beside each turn.** The `Stop` hook does not carry it, and reading it from the transcript for the current turn is exactly the lag the ingestion rule exists to avoid.
