# project-workspace Specification

## Purpose

Lets a user focus the browser on one project, see that project's coding-agent sessions and their turns in a sidebar, follow the newest turn as it arrives, and remove turns that are no longer needed, so that concurrent sessions and several projects never blur into one list.

## Requirements

### Requirement: A project is selected before anything else

The system SHALL present a landing page that lists every project that has delivered at least one turn, where a project is one distinct working directory reported by the harness.
Each entry SHALL show the directory's last path segment, its full path, its session count, and the time of its latest turn, and entries SHALL be ordered by latest turn, newest first.
The system SHALL NOT show sessions or turns until a project has been selected.

#### Scenario: Two projects have delivered turns

- **WHEN** turns exist from two different working directories and the user opens the landing page
- **THEN** both projects are listed, the one with the newer turn first
- **AND** selecting one opens a workspace that shows only that project

#### Scenario: No turn has been delivered yet

- **WHEN** no turn has ever been ingested and the user opens the landing page
- **THEN** the page states that no project has delivered a turn and how to make one appear
- **AND** no project is listed

#### Scenario: The server is started with the open-browser option inside a project

- **WHEN** the user starts the server with the open-browser option from a project directory
- **THEN** the browser opens that project's workspace directly, bypassing the landing page
- **AND** if the directory has not delivered a turn yet, the workspace shows an empty state and fills in when its first turn arrives

### Requirement: A workspace shows one project's sessions and turns

The workspace SHALL list, in a sidebar, only the sessions whose working directory is the selected project's, ordered by each session's latest turn, newest first.
Under each session the sidebar SHALL list all of that session's turns, newest first, each showing its time and a first-line preview of its text.
A session SHALL be collapsible, and a collapsed session SHALL show its turn count.
The session of the turn on screen SHALL be expanded, and that turn SHALL be marked active and scrolled into view.
The workspace SHALL show the project's name and full path and SHALL provide a control that returns to the landing page.

#### Scenario: Two sessions run concurrently in one project

- **WHEN** two sessions in the same project have each delivered several turns, interleaved in time
- **THEN** the sidebar lists two session entries, each with its own turns beneath it
- **AND** no turn appears under the other session

#### Scenario: A session belongs to another project

- **WHEN** a session's working directory differs from the selected project's
- **THEN** that session and its turns do not appear in the sidebar

#### Scenario: Collapsing a session

- **WHEN** the user collapses a session in the sidebar
- **THEN** its turns are hidden and its entry shows how many turns it holds

### Requirement: Sessions are labelled with the harness's own title

The system SHALL label a session with the title the harness recorded for that session in its transcript, and SHALL refresh the label each time a turn from that session is ingested, because a new session has no title until one or more turns have completed.
When no title is available the label SHALL be the session's start time.
Two sessions with the same title SHALL remain distinguishable, by showing their start times.
Reading the transcript for the title SHALL NOT fail ingestion when it cannot be done, and SHALL NOT be used to obtain the turn's text, which continues to come from the hook payload only.

#### Scenario: The transcript holds a title

- **WHEN** a turn is ingested and the session's transcript contains a title for the session
- **THEN** the sidebar shows that title for the session

#### Scenario: A fresh session has no title yet

- **WHEN** the first turn of a new session is ingested before the harness has titled the session
- **THEN** the sidebar labels the session with its start time
- **AND** when a later turn is ingested after the title exists, the label changes to the title

#### Scenario: The transcript cannot be read

- **WHEN** the hook payload names no transcript, or the transcript cannot be read
- **THEN** the turn is ingested and shown as usual
- **AND** the session keeps its start-time label

#### Scenario: Two sessions share a title

- **WHEN** two sessions in one project have the same title
- **THEN** both entries show the title and their start times, so the user can tell them apart

### Requirement: Every turn is addressable by project, session, and turn

The system SHALL serve a pinned turn at `/projects/<project-id>/sessions/<session-id>/turns/<prompt-id>`, a session's newest turn at `/projects/<project-id>/sessions/<session-id>`, and a project's newest turn across its sessions at `/projects/<project-id>`.
The project identifier SHALL be stable for a given working directory across restarts and SHALL NOT contain the directory path.
A turn's project SHALL be its session's project, whatever working directory the hook reported for that turn, because the hook's directory follows the agent's shell rather than the project.
The former turn address `/turns/<prompt-id>` SHALL redirect to the pinned form.
A pinned or session address whose session does not belong to the named project SHALL redirect to the same address under the session's actual project.
An address naming an unknown project, session, or turn SHALL answer not found with a link to the landing page.

#### Scenario: A link copied before this change

- **WHEN** the user opens `/turns/<prompt-id>` for an existing turn
- **THEN** the browser is redirected to that turn's pinned address, and the turn renders

#### Scenario: A session address

- **WHEN** the user opens the session address of a session with several turns
- **THEN** the session's newest turn is shown

#### Scenario: The project in the address is wrong

- **WHEN** the user opens a pinned address whose session belongs to a different project
- **THEN** the browser is redirected to the same turn under the session's own project

#### Scenario: An unknown turn

- **WHEN** the user opens a pinned address for a turn that does not exist
- **THEN** the page answers not found and links to the landing page

#### Scenario: The hook reports a different directory for a later turn

- **WHEN** a session's later turn arrives with a working directory other than the session's, such as a subdirectory the agent's shell had moved into
- **THEN** the turn is listed under its session in the sidebar
- **AND** opening it from the sidebar renders the turn at its session's project address, with no redirect to an unknown project

### Requirement: Following the newest turn

A page at a project or session address SHALL follow: when a new turn arrives within that scope, the page SHALL show the new turn without user action.
A page at a pinned address SHALL NOT change the turn it shows on its own.
Whenever the page would replace the turn on screen while the ask popover is open or any input on the page holds unsent text, the page SHALL keep the current turn and SHALL instead show a notice that names the session the new turn came from and offers to open it.
When a new turn arrives in the same project but outside the page's follow scope, or while the page is pinned, the page SHALL show the same notice.
The sidebar SHALL offer a "Latest" control that opens the project's follow address.

#### Scenario: Following a project while idle

- **WHEN** the user is at the project address with nothing selected and no text typed, and a turn arrives from any session in that project
- **THEN** the page shows the new turn and its sidebar entry becomes active

#### Scenario: Following while asking a question

- **WHEN** the user is at the project address with the ask popover open and a new turn arrives
- **THEN** the current turn stays on screen with the popover intact
- **AND** a notice names the new turn's session and opens it on request

#### Scenario: Pinned to an older turn

- **WHEN** the user is at a pinned address and a new turn arrives in the project
- **THEN** the page keeps the pinned turn and shows the notice

#### Scenario: Following one session while another delivers

- **WHEN** the user is at a session address and a turn arrives from a different session in the same project
- **THEN** the page keeps its turn and shows the notice
- **AND** a later turn from the followed session replaces the page's turn as usual

#### Scenario: Returning to following

- **WHEN** the user activates "Latest" from a pinned page
- **THEN** the page moves to the project address and shows the project's newest turn

### Requirement: A turn can be removed in two deliberate steps

The sidebar SHALL reveal a remove control at the right edge of a turn's row when the row is hovered or focused, and the control SHALL be reachable by keyboard.
The sidebar SHALL NOT offer the remove control on a session's newest turn, and the server SHALL refuse a request to remove that turn, so only past turns can be removed and a session never leaves the sidebar through removal.
The first activation SHALL replace the control with an inline confirmation that states how many threads will be removed with the turn, and SHALL NOT remove anything.
The second activation SHALL remove the turn and every thread anchored in it.
Pressing Escape, moving the pointer off the row, or activating anything else SHALL cancel the confirmation.
Carry-back entries SHALL NOT be removed with a turn.
When the removed turn is the one on screen, the page SHALL move to the project's follow address.
Removal SHALL be accepted only from the surface's own origin, like every other state change.

#### Scenario: Two clicks remove a turn

- **WHEN** the user hovers the row of a turn that is not its session's newest, activates the remove control, and activates the confirmation
- **THEN** the turn disappears from the sidebar and its address answers not found

#### Scenario: One click then cancel

- **WHEN** the user activates the remove control and then presses Escape or moves off the row
- **THEN** the confirmation disappears and the turn is unchanged

#### Scenario: A turn with threads

- **WHEN** the user activates the remove control on a past turn that has three threads
- **THEN** the confirmation states that three threads will be removed
- **AND** confirming removes the turn and the three threads

#### Scenario: Carry-back survives

- **WHEN** a turn is removed and its session has pending carry-back entries
- **THEN** the entries remain and are still emitted on the session's next prompt

#### Scenario: The last turn of a session

- **WHEN** the user hovers or focuses the row of a session's newest turn
- **THEN** no remove control appears
- **AND** a removal request for that turn sent directly to the server is refused and the turn remains

#### Scenario: A newer turn makes the previous one removable

- **WHEN** a session's newest turn gains a successor through ingestion
- **THEN** the previous turn's row offers the remove control without a page reload

#### Scenario: Removing the turn on screen

- **WHEN** the user removes the past turn currently shown
- **THEN** the page moves to the project's follow address

### Requirement: The ingestion warning is checked for the selected project

The workspace SHALL report that ingestion is unavailable when the settings that apply to the selected project's directory do not register the ingest hook, regardless of the directory the server was started in.

#### Scenario: Server started outside the project

- **WHEN** the server is started in a directory without hooks and the selected project's own settings register the ingest hook
- **THEN** the workspace shows no ingestion warning

#### Scenario: A project without hooks

- **WHEN** the selected project's directory has no ingest hook registered in any settings that apply to it
- **THEN** the workspace shows the ingestion warning for that project

### Requirement: An existing store is upgraded in place

The system SHALL open a store written before this change without loss, deriving each session from its turns, and SHALL label such sessions by start time until their next ingested turn supplies a title.

#### Scenario: Opening an older store

- **WHEN** the server starts against a store from before this change holding turns from several sessions
- **THEN** the landing page and workspace list those sessions and turns
- **AND** every thread and carry-back entry is intact

### Requirement: A second server reports the address in use

When the server is started on a port that is already in use, the command SHALL report the address and exit with a non-zero status, without a stack trace.

#### Scenario: Starting the server twice

- **WHEN** a server is already listening on the default port and the user starts another
- **THEN** the second command prints that the address is in use and exits non-zero
