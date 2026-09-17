## MODIFIED Requirements

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
