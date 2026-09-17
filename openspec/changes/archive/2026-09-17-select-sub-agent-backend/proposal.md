## Why

Every side question is answered by the Codex CLI, whatever produced the turn being reviewed.
A user whose turns come from Claude Code has to install and sign in to a second CLI before the first question works, and the reviewer runs on a different model than the one it reviews.
Defaulting the sub-agent to the parent's own harness and model removes that dependency, and a one-word tag on the question keeps the other CLI available for a second opinion.

## What Changes

- **The default sub-agent is the parent's harness on the parent's model.**
  A question with no tag runs on the Claude Code CLI, pinned to the model that produced the reviewed turn.
  The model is read from the tail of the transcript at ingest, the way the session title already is, and stored on the turn.
  When no model is found, the CLI's own default applies.
- **A tag picks the backend for one question.**
  `@claude` or `@codex` anywhere in the question, as a word of its own, selects that CLI.
  The tag is removed from the prompt the sub-agent receives and kept in the question as the user typed it.
  An address such as `me@codex.com`, a domain such as `@codex.com`, and an escaped `\@codex` are ordinary text.
- **Continuation is sticky.**
  A follow-up or a branch without a tag runs on the backend of the answer it continues.
  Only a thread's first untagged question uses the default.
- **Switching backends mid-thread keeps the thread's context.**
  A question forks the newest answer in its lineage that was produced by the same backend, and the exchanges since that answer travel in the prompt.
  When the lineage has no answer from that backend, the question cold-starts with every earlier exchange in the prompt.
  For a branch, the lineage ends at the answer being branched from.
- **Read-only enforcement is per backend, with no path to widen it.**
  Codex keeps its read-only sandbox.
  The Claude Code sub-agent runs restricted, with only the file-reading tools, every permission prompt denied, and user and project settings ignored, so sidescreen's own hooks never fire inside a sub-agent.
  The transcript's directory is granted read access explicitly.
- **Both backends answer from one prompt.**
  The rules, the forwarded conventions, the reviewed output, the thread context, and the question travel inside the prompt for both CLIs, and nothing reaches one backend through a channel the other lacks, such as a system prompt flag.
  What differs is confined to starting the CLI, keeping it read-only, and reading its output, so a second opinion is comparable with the first.
- **A cold start receives the reviewed turn's own slice of the transcript.**
  Sidescreen locates the turn in the transcript and writes its user prompt, tool calls with trimmed results, thinking, and final message to a readable file in the state directory, then names that file beside the full transcript path.
  When the turn cannot be located, the prompt says so and explains how to find it.
- **The answer shows which backend produced it.**
  A muted line above the answer reads "Claude answered:" or "CODEX answered:", with the model in its tooltip.
  The pending line names the backend being asked, and the follow-up placeholder mentions the tags.
- **Claude Code sub-agent sessions carry a recognizable name**, `sidescreen: <question>`, so they can be told apart in the harness's own session picker.
- **Configuration is per backend.**
  `SIDESCREEN_SUBAGENT` chooses the default (`parent`, `claude`, or `codex`), and `SIDESCREEN_CLAUDE_BIN`, `SIDESCREEN_CODEX_BIN`, `SIDESCREEN_CLAUDE_MODEL`, and `SIDESCREEN_CODEX_MODEL` configure each CLI.
  **BREAKING**: `SIDESCREEN_MODEL` is removed, because with two backends it no longer names one thing.
  The package is not yet published, so no installed copy is affected.
- **The documentation describes who is reviewed and who answers separately.**
  The README and the package description speak of coding agent responses and a read-only sub-agent.
  Claude Code remains the supported harness, and the Codex CLI becomes an optional requirement needed only for `@codex`.
- **A session's newest turn cannot be removed from the browser.**
  The remove control appears only on past turns, and the server refuses to remove a session's newest turn.
  A session therefore never disappears from the sidebar through removal and never has its record recreated by its next turn.
- **Past turns open again when the agent's shell had moved.**
  The `Stop` hook's working directory follows the agent's shell, so a turn finished while the shell sat in a subdirectory is stored under that subdirectory while its session keeps the project root.
  Today the turn page redirects to a project derived from the turn's own directory, which no session has, and answers "Project not found".
  A turn's project becomes its session's: ingest records the session's directory on the turn, the store upgrade repairs existing turns, and every address is derived from the session.
  The sub-agent then also runs in the project root rather than wherever the shell was.
- **The `agent-output-review` spec drops the project's old name.**
  Two scenarios still say "annotatr"; they say "sidescreen" after this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-output-review`: the sub-agent requirement changes from "a read-only sandbox" to per-backend read-only enforcement, and states that the default backend is the parent's harness on the parent's model.
  A new requirement covers choosing a backend with a tag, sticky continuation, and keeping the thread's context across a switch.
  A new requirement states that both backends receive the same prompt and that nothing reaches one backend through a channel the other lacks.
  A new requirement gives a cold-started sub-agent the reviewed turn's own transcript slice.
  The answer-source requirement gains the visible backend.
  The two scenarios that still name "annotatr" are corrected.

- `project-workspace`: the turn-removal requirement changes so that only past turns can be removed; the scenario in which removing a session's only turn makes the session leave the sidebar is replaced by a refusal.
  The addressing requirement states that a turn's project is its session's regardless of the directory the hook reported, with the scenario that was missing.

`package-distribution` is unchanged: its quick start is still a global install, `sidescreen init`, and `sidescreen serve`, and it says nothing about which CLI answers questions.

## Impact

Affected code:

- `src/dispatch/dispatch.js`: splits into a backend-neutral dispatcher and two adapters, one for `codex exec` and one for `claude -p`, each owning its command line, its read-only arguments, and its result parsing.
  A sub-agent session id is stored with its backend, since a session can only be forked by the CLI that created it.
- `src/dispatch/dispatch-prompt.js`: the cold-start prompt gains the turn slice and the earlier exchanges; the follow-up prompt gains the exchanges since the forked answer.
- A new module that locates the reviewed turn in the transcript and writes its slice.
- `src/hooks/session-title.js` or a sibling: reading the turn's model from the transcript tail at ingest.
- `src/types.js`, `src/store/turns.js`, `src/store/threads.js`: `model` on a turn, `backend` on an exchange, backend-aware session ids, and a turn's directory taken from its session.
- `src/web/server.js`: parsing the tag, resolving the backend and the fork target for a new thread, a follow-up, and a branch, refusing to remove a session's newest turn, and deriving every turn address from the session.
- `src/web/public/app.js`, `src/web/public/app.css`: the backend chip, the pending line, the placeholder, and no remove control on a session's newest turn.
- `src/cli.js`: the environment section of the help text and the `serve` start-up line.
- Tests: adapter command construction, a stub for `claude -p` beside the existing Codex stub, tag parsing, sticky and switching continuation, turn-slice extraction, and a browser test that the chip shows the backend.
- `README.md` and `package.json`: wording, requirements, configuration table, keywords.
- `openspec/specs/agent-output-review/spec.md` and `openspec/specs/project-workspace/spec.md`: through the deltas in this change.

Unchanged surfaces:

- Hook registration, ingestion of the turn's text, and carry-back.
- The anchor model and the thread pane layout.
- The Codex command line, apart from moving behind the adapter.

### Non-goals

Deliberately out of scope, each for a stated reason.

- **Forking the parent Claude Code session for the first question.** Rejected in favor of the cold start, for cost, precision, and reviewer independence.
  The reasoning is recorded in `design.md` so it is not rediscovered.
- **Tags that name a model rather than a backend**, such as `@opus` or `@gpt-5`.
  The model is configured per backend; a per-question model can follow once a need is felt.
- **Operating-system sandboxing for the Claude Code sub-agent.** Its read-only guarantee comes from the harness's tool restrictions, which the probe showed refusing writes and shell access.
  An OS sandbox is a separate investigation.
- **Removing sub-agent session files from the harness's session directory.** That couples sidescreen to an internal layout the first design refused to depend on.
  Naming the sessions is enough to tell them apart.
- **Ingesting turns from a harness other than Claude Code.** The hooks are Claude Code's; this change is about who answers, not who is reviewed.
- **A settings page for the default backend.** The environment variable serves until the browser has any settings at all.
