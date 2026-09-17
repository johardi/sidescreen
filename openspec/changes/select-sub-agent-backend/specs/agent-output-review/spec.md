## MODIFIED Requirements

### Requirement: Turn output is ingested without agent cooperation

The system SHALL receive a completed agent turn's final message through a harness hook rather than through a command the agent must invoke.
The system SHALL read the message text from the hook's `last_assistant_message` field and SHALL NOT take the rendered document from the session transcript, because the transcript is written asynchronously and can lag the current turn.
Labels read from the transcript at ingest, such as the session's title and the model that produced the turn, SHALL be optional: when the transcript has not named them yet, the turn is ingested without them and nothing else changes.

#### Scenario: A turn completes and appears in the browser

- **WHEN** the main agent finishes a turn and the `Stop` hook fires
- **THEN** the hook's `last_assistant_message` is rendered as a new annotatable document in the browser surface
- **AND** the agent is not required to have run any sidescreen command

#### Scenario: The harness provides no hook

- **WHEN** the agent runs under a harness that does not support the required hook
- **THEN** no output is ingested and the surface reports that ingestion is unavailable
- **AND** the system SHALL NOT fall back to parsing the transcript for the current turn

#### Scenario: The transcript names the model that produced the turn

- **WHEN** a turn is ingested and the transcript already holds a message from the main agent naming its model
- **THEN** that model is recorded with the turn

#### Scenario: The transcript lags the turn

- **WHEN** a turn is ingested before the transcript holds any message from the main agent
- **THEN** the turn is ingested with no recorded model
- **AND** the turn's text, session, and project are exactly as they would be with one

### Requirement: Side questions are answered by an isolated read-only sub-agent

The system SHALL dispatch each question to a sub-agent process that it spawns itself, and SHALL NOT route questions through the main session.
That process SHALL run under the read-only enforcement its backend provides, SHALL NOT be able to modify files or run shell commands, and the system SHALL offer no way to widen that enforcement.
When the sub-agent runs on the same harness as the main session, the system SHALL keep that harness's hooks from firing inside the sub-agent, so a side question is never ingested as a turn and pending conclusions are never injected into a sub-agent's prompt.
The system SHALL close the sub-agent's standard input, because a sub-agent CLI given an open stdin pipe can block indefinitely waiting for end of input.

#### Scenario: A question is answered without touching the main session

- **WHEN** the user submits a question on an annotated range
- **THEN** sidescreen spawns a sub-agent under its backend's read-only enforcement with standard input closed
- **AND** the answer is rendered in the browser surface
- **AND** nothing about the question or the answer enters the main session's context

#### Scenario: A sub-agent attempts to write

- **WHEN** a sub-agent answering a side question attempts to modify a file
- **THEN** the backend's read-only enforcement refuses the write
- **AND** the refusal is reported in the thread rather than retried with wider permissions

#### Scenario: A sub-agent runs on the main session's harness inside a project with sidescreen's hooks

- **WHEN** a question is answered by a sub-agent on the same harness as the main session, in a project whose settings register sidescreen's hooks
- **THEN** no new turn appears in the browser surface from the sub-agent's answer
- **AND** no pending carry-back conclusion is injected into the sub-agent's prompt
- **AND** the conclusions remain pending for the main session's next prompt

### Requirement: Every answer declares its source

The system SHALL require each sub-agent answer to state where its evidence came from, from the set: the code, the main session transcript, a project specification document, or none.
An answer of "no documented intent found" SHALL be a valid and complete response.
The system SHALL NOT present an unsourced answer as authoritative, because a cited answer drawn from a stale document is more likely to be trusted than an obviously uncertain one.
Each answer SHALL also show which backend produced it and, when known, on which model, quietly enough not to compete with the source, so a second opinion can be told from the first.

#### Scenario: Intent is documented

- **WHEN** the user asks why an approach was chosen and the main session transcript records that decision
- **THEN** the answer is rendered with its source identified as the transcript, including which turn

#### Scenario: Intent is not recorded anywhere

- **WHEN** the user asks why an identifier was named as it was and no code comment, transcript turn, or specification explains it
- **THEN** the answer states that no documented intent was found
- **AND** the system SHALL NOT synthesize a plausible reason

#### Scenario: Two backends answered in one thread

- **WHEN** a thread holds an answer from each backend
- **THEN** each answer is labelled with the backend that produced it
- **AND** the label on the answer from the parent's harness names the model it ran on

## ADDED Requirements

### Requirement: The default sub-agent is the parent's harness on the parent's model

A thread's first question, when it carries no backend tag, SHALL be answered by the same harness that produced the reviewed turn, running the model recorded for that turn.
When no model was recorded for the turn, the harness's own default model SHALL apply.
A configuration setting SHALL let the user replace this default with a specific backend for every untagged first question.
Answering untagged questions SHALL NOT require any CLI other than the harness that produced the turn.

#### Scenario: The reviewed turn's model is known

- **WHEN** the user asks an untagged first question on a turn whose recorded model is a specific model of the main harness
- **THEN** the sub-agent runs on that harness's CLI pinned to that model
- **AND** the answer is labelled with that model

#### Scenario: The reviewed turn's model is unknown

- **WHEN** the user asks an untagged first question on a turn with no recorded model
- **THEN** the sub-agent runs on that harness's CLI with the CLI's default model

#### Scenario: The default is configured to the other backend

- **WHEN** the configuration names the other backend as the default and the user asks an untagged first question
- **THEN** the sub-agent runs on that backend
- **AND** a tag on a later question still overrides the configured default

#### Scenario: Only the main harness is installed

- **WHEN** the other backend's CLI is not installed and the user asks an untagged first question
- **THEN** the question is answered
- **AND** the surface never mentions the missing CLI

### Requirement: A tag in the question selects the sub-agent backend

A question that contains `@claude` or `@codex` as a word of its own, in any letter case and at any position, SHALL be answered by that backend; when it contains more than one, the first SHALL decide.
The tag SHALL be removed from the text the sub-agent receives, and the question SHALL be stored and shown as the user typed it.
An `@` that is part of a larger token, such as an address like `me@codex.com` or a domain like `@codex.com`, an escaped `\@codex`, or a tag that names no known backend, SHALL be treated as ordinary question text.
A follow-up or a branch that carries no tag SHALL run on the backend of the answer it continues.
When a question's backend differs from that of the answer it continues, the system SHALL still give the new backend the thread's earlier exchanges, as question and answer text, up to the answer being continued and no further.
When the selected backend's CLI cannot be started, the exchange SHALL fail with a message naming that backend and how to configure it, and the system SHALL NOT answer with the other backend instead.

#### Scenario: A leading tag routes the first question

- **WHEN** the user asks a first question that begins with `@codex`
- **THEN** the Codex backend answers it
- **AND** the stored question still begins with `@codex` while the sub-agent's prompt does not

#### Scenario: A tag in the middle of the question routes it too

- **WHEN** the user asks "does @codex agree with this?" as a follow-up in a thread whose last answer came from the parent's harness
- **THEN** Codex answers it
- **AND** the stored question is shown as typed while the sub-agent receives "does agree with this?"

#### Scenario: An address or an escaped tag is just text

- **WHEN** the user asks "mail me@codex.com and \@codex about @codex.com" as a follow-up in a thread whose last answer came from the parent's harness
- **THEN** the parent's harness answers it
- **AND** the question reaches the sub-agent unchanged

#### Scenario: An untagged follow-up stays with the backend that answered last

- **WHEN** a thread's latest answer came from Codex and the user asks an untagged follow-up
- **THEN** Codex answers the follow-up with the thread's context preserved

#### Scenario: A tagged follow-up switches backend without losing the thread

- **WHEN** a thread's answers so far came from the parent's harness and the user asks a follow-up tagged `@codex`
- **THEN** Codex answers with every earlier question and answer of the thread available as context
- **AND** a later untagged follow-up is answered by Codex

#### Scenario: Switching back reuses the earlier backend's own context

- **WHEN** a thread's first answer came from the parent's harness, its second from Codex, and the user asks a follow-up tagged `@claude`
- **THEN** the parent's harness answers with its own first exchange as conversation context
- **AND** the Codex exchange since then is available to it as question and answer text

#### Scenario: A tagged branch sees only what came before its branch point

- **WHEN** the user branches from a thread's second answer with a question tagged for the other backend, and the thread has a third answer
- **THEN** the branch is answered with the first two exchanges as context
- **AND** the third exchange is not available to it

#### Scenario: The tagged backend is not available

- **WHEN** the user tags a question for a backend whose CLI cannot be started
- **THEN** the exchange is marked failed with a message that names the backend and the setting that locates its CLI
- **AND** no other backend is asked

### Requirement: Both backends answer from the same prompt

Whatever backend answers, the sub-agent SHALL receive the same rules, the same forwarded conventions, the same reviewed output and selected range, the same thread context, and the same question, composed into one prompt that differs between backends in nothing but the tag removed from its start.
The system SHALL NOT give either backend instructions or context through a channel the other backend lacks, such as a system prompt flag, an agent definition, or a configuration file it alone reads.
Everything that differs between backends SHALL be confined to how the CLI is started, how it is kept read-only, and how its output is read, so that answers from the two backends can be compared on equal footing.

#### Scenario: The same question asked of each backend

- **WHEN** the same first question is asked on the same range once tagged `@claude` and once tagged `@codex`
- **THEN** the two sub-agents receive identical prompt text
- **AND** each is started with only its own read-only, output, model, and session arguments

#### Scenario: A backend-only channel is not used for context

- **WHEN** a sub-agent is started on either backend
- **THEN** its command line carries no system prompt, agent definition, or instruction file argument
- **AND** the rules and conventions it follows are present inside the prompt argument itself

### Requirement: A cold-started sub-agent receives the reviewed turn's own transcript slice

When a question starts a new sub-agent session, the system SHALL locate the reviewed turn in the main session's transcript and supply that turn's slice to the sub-agent as a readable file: the user prompt that started the turn, the main agent's reasoning where the transcript records it, its tool calls with their results trimmed to a bounded size, and its final message.
The slice SHALL be produced when the question is asked, not when the turn is ingested, because the transcript can still be incomplete at ingest.
The full transcript SHALL remain available to the sub-agent for evidence from earlier turns.
When the turn cannot be located, the prompt SHALL say so and SHALL describe how the turn can be found in the full transcript.
The slice is evidence for the sub-agent and SHALL NOT replace the hook's message as the document rendered in the browser.

#### Scenario: The turn is found in the transcript

- **WHEN** the user asks a first question and the transcript holds the reviewed turn
- **THEN** the sub-agent's prompt names a file holding that turn's slice beside the path of the full transcript
- **AND** an answer drawn from the slice declares the transcript as its source

#### Scenario: The transcript does not hold the turn yet

- **WHEN** the user asks a first question while the transcript lags or is missing
- **THEN** the question is still dispatched
- **AND** the prompt states that the turn was not located and how to find it

#### Scenario: A tool result in the turn is very large

- **WHEN** the reviewed turn contains a tool result longer than the bounded size
- **THEN** the slice keeps the beginning of that result and notes how much was left out
