## MODIFIED Requirements

### Requirement: Only chosen conclusions return to the main session

The system SHALL maintain a carry-back list that the user adds to during a review, and SHALL return only that list to the main session.
A pending entry SHALL be editable and removable until it has been returned, and what is returned SHALL be the entry's text as it stood when the next prompt was sent.
The system SHALL NOT return thread contents, questions, or sub-agent answers to the main session.
The return SHALL happen through a harness hook that injects the list as context on the user's next prompt, so the user does not have to copy anything by hand.

#### Scenario: Conclusions reach the next prompt

- **WHEN** the user has added entries to the carry-back list and then types a prompt in the terminal
- **THEN** the `UserPromptSubmit` hook supplies those entries as context for that prompt
- **AND** the threads that produced them are not included

#### Scenario: Nothing was marked to carry back

- **WHEN** the user asks questions but adds nothing to the carry-back list
- **THEN** the next prompt receives no injected context
- **AND** the main session's context is unchanged by the entire review

#### Scenario: An entry is corrected before it is sent

- **WHEN** the user edits the text of a pending entry and then types a prompt in the terminal
- **THEN** the hook supplies the edited text, and the earlier wording is not sent

#### Scenario: A sent entry is final

- **WHEN** an entry has already been returned to the main session
- **THEN** it is no longer offered for editing, and a request to edit it is refused
