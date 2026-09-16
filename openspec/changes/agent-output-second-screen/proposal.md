## Why

Agent output is trapped in the terminal, where it can only be read, not interrogated.
When a user wants to understand a claim in that output, the only way to ask is to type into the main session, which spends the main agent's context on questions that are not the task.
A browser surface that receives agent output, lets the user point at any part of it, and answers follow-up questions in a separate process keeps the main session's context clean while letting the user drill as deep as they need.

## What Changes

- A local server and browser GUI receive each completed agent turn and render it as an annotatable document.
- Output is ingested through a Claude Code `Stop` hook, using the `last_assistant_message` field. No CLI call is required from the agent, so ingestion cannot depend on the agent remembering to cooperate.
- The user selects any text range in a rendered message and attaches a question to it, creating an anchored thread.
- Annotatr dispatches each question to a sub-agent process under a read-only sandbox. The answer renders in the GUI and never reaches the main session.
- Threads support drilling and branching. Every question forks the sub-agent session of the answer it continues, so a follow-up carries the thread's context forward, a branch from any earlier answer sees only what came before it, and sibling branches cannot pollute each other.
- Every sub-agent answer declares its source (code, session transcript, OpenSpec document, or none). "No documented intent found" is a valid and expected answer.
- A carry-back list accumulates the user's conclusions during the session. Only that list is returned to the main session, through a `UserPromptSubmit` hook whose stdout Claude Code injects as context.

## Capabilities

### New Capabilities

- `agent-output-review`: receiving agent turn output in a browser surface, annotating ranges of it, dispatching read-only side questions to sub-agents, and returning only chosen conclusions to the main session.

### Modified Capabilities

None. This is the project's first change.

## Impact

New project, so there is no existing code to affect.
The change establishes the spine every later capability builds on: the hook ingestion path, the annotation model, the dispatch boundary, and the carry-back return path.

External surfaces it depends on:

- Claude Code hooks `Stop` and `UserPromptSubmit`. Harness-specific, and the only integration points. Other harnesses degrade to no ingestion rather than to broken ingestion.
- A sub-agent CLI capable of non-interactive execution with a read-only sandbox and session resume/fork. `codex exec` satisfies all four today.

### Non-goals

Deliberately out of scope, each for a stated reason.

- **Code review of a git ref.** The second purpose of the project and a separate change. Its research is recorded in `design.md` so the follow-up does not have to rediscover it.
- **Relay via long poll.** Rejected on the merits, not deferred. If the main agent performed the delegation, the question and answer would land in its context and the pollution this change exists to prevent would happen anyway.
- **Write-capable dispatch.** Side questions must never edit files. Write capability belongs to the code-review change, under a different sandbox policy.
- **Whiteboard, layout-warning inbox, hosted sharing, standalone export, image attachments, design playbooks, telemetry, and plugin packaging.** All present in Lavish, none of them serve reading agent output and asking about it.
