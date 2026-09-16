## Purpose

Lets a user read a coding agent's turn output in a browser, point at any part of it, and get follow-up questions answered by a separate read-only sub-agent, so that understanding the output never spends the main session's context.

## ADDED Requirements

### Requirement: Turn output is ingested without agent cooperation

The system SHALL receive a completed agent turn's final message through a harness hook rather than through a command the agent must invoke.
The system SHALL read the message text from the hook's `last_assistant_message` field and SHALL NOT parse the session transcript to obtain it, because the transcript is written asynchronously and can lag the current turn.

#### Scenario: A turn completes and appears in the browser

- **WHEN** the main agent finishes a turn and the `Stop` hook fires
- **THEN** the hook's `last_assistant_message` is rendered as a new annotatable document in the browser surface
- **AND** the agent is not required to have run any annotatr command

#### Scenario: The harness provides no hook

- **WHEN** the agent runs under a harness that does not support the required hook
- **THEN** no output is ingested and the surface reports that ingestion is unavailable
- **AND** the system SHALL NOT fall back to parsing the transcript for the current turn

### Requirement: Any range of rendered output can be annotated

The system SHALL let the user select an arbitrary text range within a rendered message, including a range that starts and ends mid-sentence, and attach a question to that range.
The annotation SHALL be treated as an anchor identifying what the user pointed at, and SHALL NOT be treated as the scope of any resulting work.

#### Scenario: Selecting a sub-sentence range

- **WHEN** the user selects part of a sentence in a rendered message and releases the cursor
- **THEN** an input for a question appears anchored to that selection
- **AND** submitting it creates a thread attached to that range

#### Scenario: Anchor is not scope

- **WHEN** a question anchored to one identifier asks about behavior spanning many files
- **THEN** the question is dispatched with the anchor as context and no computed edit region
- **AND** determining the affected scope is left to the answering sub-agent

### Requirement: Side questions are answered by an isolated read-only sub-agent

The system SHALL dispatch each question to a sub-agent process that it spawns itself, and SHALL NOT route questions through the main session.
That process SHALL run under a read-only sandbox policy and SHALL NOT be able to modify files.
The system SHALL close the sub-agent's standard input, because a sub-agent CLI given an open stdin pipe can block indefinitely waiting for end of input.

#### Scenario: A question is answered without touching the main session

- **WHEN** the user submits a question on an annotated range
- **THEN** annotatr spawns a sub-agent under a read-only sandbox with standard input closed
- **AND** the answer is rendered in the browser surface
- **AND** nothing about the question or the answer enters the main session's context

#### Scenario: A sub-agent attempts to write

- **WHEN** a sub-agent answering a side question attempts to modify a file
- **THEN** the sandbox refuses the write
- **AND** the refusal is reported in the thread rather than retried with wider permissions

### Requirement: Every answer declares its source

The system SHALL require each sub-agent answer to state where its evidence came from, from the set: the code, the main session transcript, a project specification document, or none.
An answer of "no documented intent found" SHALL be a valid and complete response.
The system SHALL NOT present an unsourced answer as authoritative, because a cited answer drawn from a stale document is more likely to be trusted than an obviously uncertain one.

#### Scenario: Intent is documented

- **WHEN** the user asks why an approach was chosen and the main session transcript records that decision
- **THEN** the answer is rendered with its source identified as the transcript, including which turn

#### Scenario: Intent is not recorded anywhere

- **WHEN** the user asks why an identifier was named as it was and no code comment, transcript turn, or specification explains it
- **THEN** the answer states that no documented intent was found
- **AND** the system SHALL NOT synthesize a plausible reason

### Requirement: Threads support drilling and branching

The system SHALL let the user ask a follow-up question within an existing thread, and SHALL preserve that thread's accumulated context when doing so.
The system SHALL let the user branch a new line of questioning from any answer, and a branch SHALL inherit its parent's context without affecting sibling branches.
Because side questions cannot modify files, the system MAY run branches concurrently.

#### Scenario: Drilling deeper in one thread

- **WHEN** the user asks a follow-up on an answer within a thread
- **THEN** the follow-up is answered with that thread's prior exchanges available as context

#### Scenario: Branching from an answer

- **WHEN** the user branches a new question from an answer that already has a follow-up
- **THEN** the branch is answered with context up to that answer only
- **AND** the existing follow-up's thread is unchanged

### Requirement: Only chosen conclusions return to the main session

The system SHALL maintain a carry-back list that the user adds to during a review, and SHALL return only that list to the main session.
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

### Requirement: A project is set up in one step

The system SHALL provide a single command that registers every hook it needs in the project's Claude Code settings and installs the skill it ships into the project's skills directory.
The command SHALL be idempotent, SHALL report each change it makes, and SHALL NOT modify files that are not its own.

#### Scenario: Setting up a project

- **WHEN** the user runs the setup command in a project directory
- **THEN** the `Stop` and `UserPromptSubmit` hooks are registered in that project's settings file
- **AND** the shipped skill is installed under that project's skills directory
- **AND** running the command again reports no changes

#### Scenario: A settings file that cannot be parsed

- **WHEN** the project's settings file exists but is not valid JSON
- **THEN** the command reports the problem and leaves the file untouched
- **AND** it does not install the skill, so a half-configured project is not left behind
