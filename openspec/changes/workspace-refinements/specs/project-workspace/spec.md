## MODIFIED Requirements

### Requirement: A workspace shows one project's sessions and turns

The workspace SHALL list, in a sidebar, only the sessions whose working directory is the selected project's, ordered by each session's latest turn, newest first.
Under each session the sidebar SHALL list all of that session's turns, newest first, each on one line showing a first-line preview of its text, with the turn's time reachable from the row rather than printed beside it.
A session row SHALL show an icon and the session's label, and its turns SHALL hang from a vertical guide beneath it.
A session SHALL be collapsible; a collapsed session SHALL show a chevron in place of the icon and SHALL show its turn count.
Each session row SHALL offer a menu holding the controls that act on the session: following it, and removing it.
The session of the turn on screen SHALL be expanded, and that turn SHALL be marked active and scrolled into view.
The sidebar SHALL hold sessions and their turns, and beneath them a footer with the control that hides the sidebar, the colour-scheme switch, and the application's version.
The workspace SHALL have a header that reads, from left to right: a control that returns to the landing page, the application title "SideScreen", the project's name centred with the tag that names what the page follows, and the project's full path at the right edge.
The header SHALL NOT show the turn's time, which the turn's sidebar row already carries.
A warning that ingestion is unavailable SHALL appear in its own band under the header and only when it applies.

#### Scenario: Two sessions run concurrently in one project

- **WHEN** two sessions in the same project have each delivered several turns, interleaved in time
- **THEN** the sidebar lists two session entries, each with its own turns beneath it
- **AND** no turn appears under the other session

#### Scenario: A session belongs to another project

- **WHEN** a session's working directory differs from the selected project's
- **THEN** that session and its turns do not appear in the sidebar

#### Scenario: The tree of one session

- **WHEN** a session with three turns is expanded
- **THEN** its row shows an icon and its label, and three one-line rows hang from a guide beneath it, each showing that turn's preview
- **AND** each row reveals its turn's time without a second line of text

#### Scenario: Collapsing a session

- **WHEN** the user collapses a session in the sidebar
- **THEN** its turns are hidden, its icon gives way to a chevron, and its entry shows how many turns it holds

#### Scenario: The session menu

- **WHEN** the user opens the menu on a session row
- **THEN** it offers to follow the session and to remove it

#### Scenario: The header of a workspace

- **WHEN** the user opens any workspace address
- **THEN** the header shows, in order, the control back to the landing page, "SideScreen", the centred project name with its scope tag, and the full path at the right
- **AND** the header shows no time and no sidebar toggle

#### Scenario: The sidebar's footer

- **WHEN** the user opens any workspace address
- **THEN** the foot of the sidebar shows the control that hides it, the colour-scheme switch, and the version

#### Scenario: Returning to the landing page

- **WHEN** the user activates the header's back control
- **THEN** the landing page opens

### Requirement: The workspace fills the window and never scrolls as a whole

At desktop widths the workspace SHALL fit the browser window exactly, with no scrollbar on the page itself, and SHALL fit again whenever the window is resized.
The header SHALL stay at the top, fully visible whatever the sidebar, the document, or the thread pane is scrolled to.
The sidebar SHALL run the full height below the header.
The sidebar, the document, and the thread pane's exchanges SHALL each scroll on their own.
The carry-back list SHALL be a floating composer anchored to the bottom of the document pane, in one of three states: minimized to a bar in the pane's corner that names the list and its pending count; open, spanning the pane's width with its entries above a text box; or maximized, the same width and most of the pane's height but never all of it, for a long conclusion.
The composer SHALL stay in place whatever the document is scrolled to, its entries SHALL scroll inside it when they outgrow it, and its text box SHALL stay visible while it is open.
The end of the document SHALL remain readable above the minimized bar.
At narrow widths the panes SHALL stack, the page SHALL scroll as one with no horizontal scrolling, and the composer SHALL follow the document instead of floating.

#### Scenario: Reading a long turn

- **WHEN** the document is taller than the window and the user scrolls it to its end
- **THEN** the header and the composer have not moved, the page shows no scrollbar of its own, and the sidebar and thread pane are where they were
- **AND** the document's last line is visible above the composer

#### Scenario: A long thread

- **WHEN** the thread pane's exchanges are taller than their room
- **THEN** the exchanges scroll on their own and the document does not move

#### Scenario: Resizing the window

- **WHEN** the user resizes the window at desktop width
- **THEN** the shell fits the new size, every pane remains visible, and the page shows no scrollbar

#### Scenario: Minimizing and maximizing the composer

- **WHEN** the user minimizes the composer
- **THEN** only a bar remains, naming the list and how many entries are pending
- **AND** opening it spans the document pane's width, maximizing adds height without reaching the pane's full height, and restoring returns it to its open size

#### Scenario: A long conclusion

- **WHEN** the user types a conclusion of many lines in the maximized composer
- **THEN** the text box grows with the text inside the composer and nothing else on the page moves

#### Scenario: Many carry-back entries

- **WHEN** the pending entries outgrow the open composer
- **THEN** the entries scroll inside it and the text box stays visible

#### Scenario: A narrow window

- **WHEN** the window is narrower than the desktop breakpoint
- **THEN** the panes stack, the page scrolls as one, nothing scrolls horizontally, and the composer sits after the document

### Requirement: The sidebar can be hidden

The sidebar's footer SHALL provide a toggle that hides the sidebar and shows it again, and the toggle SHALL say which of the two it will do.
When the sidebar is hidden it SHALL collapse to a narrow rail that keeps the toggle and the colour-scheme switch in the same corner, and the document and the thread pane SHALL take the freed width.
Following and live updates SHALL continue while the sidebar is hidden.

#### Scenario: Hiding the sidebar

- **WHEN** the user activates the toggle while the sidebar is shown
- **THEN** the sessions disappear, a narrow rail remains at the left with the toggle now offering to show the sidebar, and the document and thread pane widen into the space

#### Scenario: Showing the sidebar again

- **WHEN** the user activates the toggle on the rail
- **THEN** the sidebar returns at the width it had, with the turn on screen marked active

#### Scenario: A turn arrives while the sidebar is hidden

- **WHEN** the page follows the project with the sidebar hidden and a new turn arrives
- **THEN** the page shows the new turn and the sidebar stays a rail

### Requirement: Layout choices are remembered

The browser SHALL remember the sidebar's width, the thread pane's width, whether the sidebar is hidden, the composer's state, and the chosen colour scheme, and SHALL restore them on every later load of any workspace in that browser, including the reloads that following performs, before the page is first shown.
The remembered layout SHALL be per browser, not per project or per tab.
When the browser cannot store the layout, the workspace SHALL use the defaults and every control SHALL still work for the life of the page.

#### Scenario: A followed reload keeps the layout

- **WHEN** the user has widened the thread pane and hidden the sidebar, and a new turn arrives on a following page
- **THEN** the new turn appears with the same thread pane width and the sidebar still a rail, with no visible change to the frame

#### Scenario: The composer and the scheme come back

- **WHEN** the user has maximized the composer and chosen the dark scheme, and reloads
- **THEN** the page is dark from its first frame and the composer is maximized

#### Scenario: Another project, same browser

- **WHEN** the user opens a different project's workspace in the same browser
- **THEN** it opens with the same widths, the same hidden or shown sidebar, the same composer state, and the same scheme

#### Scenario: Storage is unavailable

- **WHEN** the browser refuses to store the layout
- **THEN** the workspace opens with the default layout and the handles, the toggle, the composer, and the switch still work until the page is left

### Requirement: A turn can be removed in two deliberate steps

The sidebar SHALL reveal a remove control at the right edge of a turn's row when the row is hovered or focused, and the control SHALL be reachable by keyboard.
The sidebar SHALL NOT offer the remove control on a session's newest turn, and the server SHALL refuse a request to remove that turn, so only past turns can be removed one at a time and a session never leaves the sidebar through the removal of its turns.
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

## ADDED Requirements

### Requirement: A session can be removed with everything in it

The session menu SHALL offer to remove the session, and the first activation SHALL arm an inline confirmation on the session's row that states how many turns and how many threads will be removed, and SHALL NOT remove anything.
The second activation SHALL remove the session, all of its turns, and every thread anchored in them, and the session SHALL leave the sidebar.
Pressing Escape, moving the pointer off the row, or activating anything else SHALL cancel the confirmation.
Carry-back entries SHALL NOT be removed with a session, because the terminal session may still be running and is still owed them.
When the removed session holds the turn on screen, the page SHALL move to the project's follow address, or to the landing page when the project has no session left.
A removed session SHALL reappear when a later turn of it is ingested.
Removal SHALL be accepted only from the surface's own origin, like every other state change.

#### Scenario: Two activations remove a session

- **WHEN** the user chooses to remove a session of five turns with three threads between them, and activates the confirmation that reads five turns and three threads
- **THEN** the session, its turns, and its threads are gone, and every one of its addresses answers not found

#### Scenario: One activation then cancel

- **WHEN** the user chooses to remove a session and then presses Escape or moves off the row
- **THEN** the confirmation disappears and nothing is removed

#### Scenario: Carry-back survives a session

- **WHEN** a session with pending carry-back entries is removed
- **THEN** the entries remain and are still emitted on that session's next prompt

#### Scenario: Removing the session on screen

- **WHEN** the user removes the session whose turn is on screen while the project has another session
- **THEN** the page moves to the project's follow address

#### Scenario: Removing the project's only session

- **WHEN** the user removes the only session of the project on screen
- **THEN** the page moves to the landing page, where the project is no longer listed

#### Scenario: The session delivers again

- **WHEN** a turn of a removed session is ingested later
- **THEN** the session reappears in the sidebar with that turn

### Requirement: The colour scheme can be chosen

The sidebar's footer SHALL provide a switch that cycles the colour scheme through following the system, light, and dark, and the switch SHALL say which is in effect.
The chosen scheme SHALL apply to every page of the surface, the landing page included.
When no choice has been made the workspace SHALL follow the system's scheme, and SHALL follow it as it changes.

#### Scenario: Choosing dark on a light system

- **WHEN** the system prefers light and the user switches to dark
- **THEN** the workspace renders in its dark palette at once

#### Scenario: Following the system by default

- **WHEN** no scheme has been chosen and the system prefers dark
- **THEN** the workspace renders dark, and renders light when the system preference changes to light

#### Scenario: The switch on the rail

- **WHEN** the sidebar is hidden
- **THEN** the switch is still on the rail and still cycles the scheme

#### Scenario: The landing page follows the choice

- **WHEN** the user has chosen the dark scheme in a workspace and opens the landing page
- **THEN** the landing page renders in the dark palette from its first frame

### Requirement: The thread pane keeps its field in reach

The thread pane SHALL keep the thread's chips, its anchored passage, and its branch tabs at the top and the follow-up field at the bottom, with the exchanges scrolling between them.
When an exchange is added the exchanges SHALL scroll to show it.
The follow-up field SHALL send on Enter and break a line on Shift+Enter, without a separate button, and SHALL say so.
The field for a new branch SHALL follow the same rule, and Escape SHALL cancel it.
Under each answered exchange the actions to carry the answer back and to branch from it SHALL be compact icon controls at the left, each with a tooltip and an accessible name.

#### Scenario: A long thread keeps its field

- **WHEN** a thread's exchanges are taller than the thread pane
- **THEN** the chips and the anchored passage stay at the top, the follow-up field stays at the bottom, and the exchanges scroll between them

#### Scenario: Sending a follow-up

- **WHEN** the user types a follow-up and presses Enter
- **THEN** the follow-up is sent, and the new exchange scrolls into view
- **AND** Shift+Enter had only added a line

#### Scenario: Branching without a button

- **WHEN** the user chooses to branch from an answer, types a question, and presses Enter
- **THEN** the branch is created
- **AND** pressing Escape in the field instead would have closed it with nothing sent

#### Scenario: The actions under an answer

- **WHEN** an exchange has been answered
- **THEN** two icon controls sit at the left under it, one to carry the answer back and one to branch from it, each naming itself in a tooltip
