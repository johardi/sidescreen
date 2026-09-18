## MODIFIED Requirements

### Requirement: A workspace shows one project's sessions and turns

The workspace SHALL list, in a sidebar, only the sessions whose working directory is the selected project's, ordered by each session's latest turn, newest first.
Under each session the sidebar SHALL list all of that session's turns, newest first, each showing its time and a first-line preview of its text.
A session SHALL be collapsible, and a collapsed session SHALL show its turn count.
The session of the turn on screen SHALL be expanded, and that turn SHALL be marked active and scrolled into view.
The sidebar SHALL hold only sessions and their turns.
The workspace SHALL have a header that reads, from left to right: a control that returns to the landing page, the application title "SideScreen", the control that hides and shows the sidebar, the project's name centred with the tag that names what the page follows, and the project's full path at the right edge.
The header SHALL NOT show the turn's time, which the turn's sidebar row already carries.
A warning that ingestion is unavailable SHALL appear in its own band under the header and only when it applies.

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

#### Scenario: The header of a workspace

- **WHEN** the user opens any workspace address
- **THEN** the header shows, in order, the control back to the landing page, "SideScreen", the sidebar toggle, the centred project name with its scope tag, and the full path at the right
- **AND** the header shows no time

#### Scenario: Returning to the landing page

- **WHEN** the user activates the header's back control
- **THEN** the landing page opens

### Requirement: Following the newest turn

A page at a project or session address SHALL follow: when a new turn arrives within that scope, the page SHALL show the new turn without user action.
A page at a pinned address SHALL NOT change the turn it shows on its own.
Whenever the page would replace the turn on screen while the ask popover is open or any input on the page holds unsent text, the page SHALL keep the current turn and SHALL instead show a notice that names the session the new turn came from and offers to open it.
When a new turn arrives in the same project but outside the page's follow scope, or while the page is pinned, the page SHALL show the same notice.
The header SHALL show a scope tag that names what the page follows: the project, one session, or a pinned turn.
When the page is not following the project, the scope tag SHALL be the control that opens the project's follow address, and the sidebar SHALL NOT offer a separate control for it.

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

- **WHEN** the user activates the scope tag from a pinned page or a session page
- **THEN** the page moves to the project address and shows the project's newest turn
- **AND** the scope tag now names the project and is no longer a control

## ADDED Requirements

### Requirement: The workspace fills the window and never scrolls as a whole

At desktop widths the workspace SHALL fit the browser window exactly, with no scrollbar on the page itself, and SHALL fit again whenever the window is resized.
The header SHALL stay at the top and the carry-back zone at the bottom, both fully visible whatever the sidebar, the document, or the thread pane is scrolled to.
The sidebar SHALL run the full height below the header, beside the carry-back zone rather than above it.
The sidebar, the document, and the thread pane SHALL each scroll on their own.
The carry-back zone SHALL grow with its entries up to a cap, past which its list scrolls inside the zone while its title and form stay visible.
At narrow widths the panes SHALL stack and the page SHALL scroll as one, with no horizontal scrolling, as before.

#### Scenario: Reading a long turn

- **WHEN** the document is taller than the window and the user scrolls it to its end
- **THEN** the header and the carry-back zone have not moved, the page shows no scrollbar of its own, and the sidebar and thread pane are where they were

#### Scenario: A long thread

- **WHEN** the thread pane's content is taller than the window
- **THEN** the thread pane scrolls on its own and the document does not move

#### Scenario: Resizing the window

- **WHEN** the user resizes the window at desktop width
- **THEN** the shell fits the new size, every pane remains visible, and the page shows no scrollbar

#### Scenario: Many carry-back entries

- **WHEN** the carry-back list grows past the zone's cap
- **THEN** the list scrolls inside the zone and the form for a new entry stays visible

#### Scenario: A narrow window

- **WHEN** the window is narrower than the desktop breakpoint
- **THEN** the panes stack, the page scrolls as one, and nothing scrolls horizontally

### Requirement: The sidebar and the thread pane are resizable

The workspace SHALL provide a handle on the sidebar's right edge and a handle on the thread pane's left edge that set that pane's width when dragged, and each handle SHALL be operable from the keyboard.
Until the user sets a width, the document and the thread pane SHALL be equal in width.
Each pane SHALL have a minimum width, so that no pane can be dragged out of view, and a width larger than the window allows SHALL be clamped to what fits.
Activating a handle twice in quick succession SHALL restore that pane's default width.

#### Scenario: Widening the thread pane

- **WHEN** the user drags the thread pane's handle leftwards
- **THEN** the thread pane widens by that distance, the document narrows by the same distance, and the sidebar is unchanged

#### Scenario: Equal widths by default

- **WHEN** the user opens a workspace in a browser that has no remembered layout
- **THEN** the document and the thread pane are the same width

#### Scenario: Dragging past the minimum

- **WHEN** the user drags a handle beyond the pane's minimum width
- **THEN** the pane stops at its minimum and the other panes stay visible

#### Scenario: Resizing from the keyboard

- **WHEN** the user focuses a handle and presses the arrow keys
- **THEN** the pane's width changes in steps in the direction pressed

#### Scenario: Restoring the default width

- **WHEN** the user activates a handle twice in quick succession
- **THEN** that pane returns to its default width

### Requirement: The sidebar can be hidden

The header SHALL provide a toggle that hides the sidebar and shows it again, and the toggle SHALL say which of the two it will do.
When the sidebar is hidden the document and the thread pane SHALL take the freed width, and the header SHALL keep its order with the toggle in the same place.
Following and live updates SHALL continue while the sidebar is hidden.

#### Scenario: Hiding the sidebar

- **WHEN** the user activates the toggle while the sidebar is shown
- **THEN** the sidebar disappears, the document and thread pane widen into its space, and the toggle now offers to show the sidebar

#### Scenario: Showing the sidebar again

- **WHEN** the user activates the toggle while the sidebar is hidden
- **THEN** the sidebar returns at the width it had, with the turn on screen marked active

#### Scenario: A turn arrives while the sidebar is hidden

- **WHEN** the page follows the project with the sidebar hidden and a new turn arrives
- **THEN** the page shows the new turn and the sidebar stays hidden

### Requirement: Layout choices are remembered

The browser SHALL remember the sidebar's width, the thread pane's width, and whether the sidebar is hidden, and SHALL restore them on every later load of any workspace in that browser, including the reloads that following performs, before the page is first shown.
The remembered layout SHALL be per browser, not per project or per tab.
When the browser cannot store the layout, the workspace SHALL use the defaults and resizing SHALL still work for the life of the page.

#### Scenario: A followed reload keeps the layout

- **WHEN** the user has widened the thread pane and hidden the sidebar, and a new turn arrives on a following page
- **THEN** the new turn appears with the same thread pane width and the sidebar still hidden, with no visible change to the frame

#### Scenario: Another project, same browser

- **WHEN** the user opens a different project's workspace in the same browser
- **THEN** it opens with the same widths and the same hidden or shown sidebar

#### Scenario: Storage is unavailable

- **WHEN** the browser refuses to store the layout
- **THEN** the workspace opens with the default layout and the handles and toggle still work until the page is left
