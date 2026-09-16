## 1. Store, sessions, and projects

- [x] 1.1 Add the `Session` type and the `sessions` record to the state, move the schema to version 2, and make normalization accept version 1 by deriving sessions from turns; verify with store tests that a version 1 fixture opens, sessions carry the right directory, transcript path, start and latest times, and every thread and carry-back entry is intact
- [x] 1.2 Write the version 1 file to a one-time backup beside the store on the first update after migration; verify with a store test that the backup exists with the original contents and is not rewritten on later updates
- [x] 1.3 Add the project id function (first 12 hex characters of SHA-256 of the exact directory) and the project derivation (distinct directories with id, name, full path, session count, latest turn); verify with unit tests that the id is stable, contains no path segment, and projects order by latest turn
- [x] 1.4 Add the session title reader that scans the last megabyte of a transcript for the last `ai-title` record and returns a string or null, never throwing; verify with unit tests for a title present, no title, a missing path, an unreadable file, and malformed lines
- [x] 1.5 Make recording a turn upsert its session, setting start and latest times and replacing the title only when the reader returns one; verify with tests that a first turn with no title labels by start time, a later turn with a title updates it, and a later turn without one keeps it
- [x] 1.6 Add turn removal that deletes the turn and every thread anchored in it, deletes the session when no turn remains, and leaves carry-back untouched; verify with tests for each of those outcomes

## 2. Server routes and API

- [x] 2.1 Add the project, session, and turn routes, render the landing page at `/`, redirect `/turns/<id>` to the pinned form and a mismatched project to the session's own project, and answer unknown ids with a not-found page linking to the landing page; verify with server tests for each route, redirect, and not-found case
- [x] 2.2 Add `GET /api/projects` and `GET /api/projects/<id>` returning the sidebar data (sessions with title, start time, and turns newest first, each with time, preview, and thread count, plus the newest prompt id per session and for the project); verify with server tests that two interleaved sessions come back as two entries with no shared turns
- [x] 2.3 Add `DELETE /api/turns/<id>` behind the same-origin check, broadcasting `turn-removed` with prompt, session, and project ids; verify with server tests for success, unknown turn, and a cross-origin request answered 403
- [x] 2.4 Check ingestion availability against the selected project's directory, and treat the server's own start directory as a known project with no turns; verify with server tests that a server started in a directory without hooks shows no warning for a project whose settings register the hook, and that its own directory resolves to an empty workspace
- [x] 2.5 Make `serve --open` open the current directory's project address, and catch the address-in-use error with a one-line message and a non-zero exit; verify with CLI tests for both

## 3. Pages and styles

- [x] 3.1 Render the landing page with the project list and the empty state; verify with page tests that entries show name, full path, session count, and latest time in order
- [x] 3.2 Render the workspace shell: topbar with project name, full path, and a control back to the landing page; sidebar with the "Latest" control, collapsible sessions showing title, start time, and count, and turns newest first with the active one marked; the document, thread pane, carry-back zone, and a container for the follow notice; verify with page tests that the active turn is marked and its session is expanded
- [x] 3.3 Style the three-column layout with a scrollable sidebar, the hover-and-focus reveal of the remove control, the armed confirmation, and the notice; verify in the browser test that the control is hidden until the row is hovered or focused

## 4. Client behaviour

- [x] 4.1 Re-render the sidebar from the project endpoint on every stream event, scroll the active turn into view, and keep collapse state per tab in session storage; verify with a browser test that a turn ingested while the page is open appears in the sidebar without a reload
- [x] 4.2 Implement following: read the scope from the inlined page data, compare the newest prompt id in scope on each event, reload the same address when the page is clean, and otherwise show the notice with the session title and a link; verify with browser tests for an idle project page, a page with the popover open, a pinned page, and a session page receiving a turn from another session
- [x] 4.3 Implement the two-step removal on turn rows: arm on first activation with the thread count, remove on second, disarm on Escape, pointer leaving, focus leaving, or a click elsewhere, and navigate to the follow address when the removed turn is on screen; verify with browser tests for two clicks, one click then Escape, one click then pointer leaving, the count text with three threads, and removal of the current turn
- [x] 4.4 Remove the index page script and the old index rendering once the landing page replaces them; verify that lint and typecheck pass with no dangling references

## 5. End-to-end verification and documentation

- [x] 5.1 Browser test: ingest turns from two sessions in one project and one in another project, open the first project, and assert two session entries with their own turns and no trace of the other project
- [x] 5.2 Browser test: open a version 1 store fixture with threads and carry-back, assert the workspace shows them, then remove a turn and assert its threads are gone while carry-back remains
- [x] 5.3 Update `README.md` for the landing page, the three address forms, following, and removal; verify by reading it against the spec's requirements
- [x] 5.4 Run `npm run check` and confirm lint, typecheck, and all tests pass
