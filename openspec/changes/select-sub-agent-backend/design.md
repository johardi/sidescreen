## Context

See `proposal.md` for motivation and the `agent-output-review` delta for the behaviour this design has to produce.

What exists, and what constrains the approach:

- `src/dispatch/dispatch.js` is shaped around one CLI.
  It builds `codex exec`, `codex exec resume`, and `codex exec fork` command lines, parses Codex's JSONL events for `thread.started` and the final `agent_message`, and pins the read-only sandbox in two places so that no caller can widen it.
- Every answered exchange stores the sub-agent session id whose last message is that answer, and a follow-up or a branch forks that session.
  A session is never resumed, so an answer's session is immutable and a branch from an older answer is exact.
  This is the mechanism that has to survive a second backend.
- The cold-start prompt already accepts `priorExchanges`, "for cold starts only", and nothing passes it.
- The `Stop` hook payload carries no model.
  `src/hooks/session-title.js` reads the last megabyte of the transcript for the session title at ingest and returns null for any failure at all.
- The transcript has no turn marker.
  Assistant records carry `uuid`, `parentUuid`, `requestId`, `timestamp`, and `message.model`; user records carry `uuid` and `parentUuid`, and tool results arrive as user records.
  One reviewed transcript on this machine is 916 KB.
- The project's own `.claude/settings.json` registers sidescreen's `Stop` and `UserPromptSubmit` hooks.
  Any Claude Code process started in that directory with settings loaded would fire them.

Facts probed on this machine before writing this design, with Claude Code 2.1.274 and Codex CLI 0.154.0:

- `claude -p --output-format json --json-schema <schema>` returns one JSON object with `session_id`, `result`, `structured_output`, `is_error`, and `permission_denials`.
- `claude -p --resume <id> --fork-session` answers from the forked conversation's context and returns a new `session_id`, so the fork-per-answer model maps one to one.
- `claude -p --restricted --tools Read,Grep,Glob --permission-prompts none --add-dir <dir>` read a file under that directory, had no tool that could create a file, had no shell tool, and fired neither the `Stop` nor the `UserPromptSubmit` hook registered in the working directory's project settings.
- `--bare` also skips hooks but authenticates only through an API key; with the user's login it answered "Not logged in".
- Every headless run, forked or not, wrote a session file into `~/.claude/projects/<project>/`, the same directory that holds the user's own sessions for that project, and a fork copied the whole history into its new file.
- Each assistant record in a transcript names its model, `"model":"claude-fable-5-1"` in the sampled session.
- `claude -p --name "<text>"` writes `custom-title` and `agent-name` records carrying the text into the session file, so a named headless session is labelled in the harness's session picker.
- Across this project's transcripts, half of all tool results are under 1,600 characters, nine in ten under 14,000, and the largest is 22,000; the heaviest turn held 20 tool results totalling 129,000 characters.

## Goals / Non-Goals

**Goals:**

- One dispatcher, two adapters.
  Everything above the adapter, the prompt, the thread model, the fork rule, the server, knows a backend only by name.
- The read-only guarantee stays structural for both backends: there is no parameter through which a caller can widen it.
- The fork rule is one rule for follow-ups and branches, for same-backend and cross-backend continuation.
- An existing store keeps working, and every old thread continues on the backend that created its sessions.

**Non-Goals:**

- Forking the parent Claude Code session.
  Rejected below, with the reasoning recorded once.
- Streaming the sub-agent's progress.
  Both CLIs are run to completion as today.
- A shared session format across backends.
  A session id is only meaningful to the CLI that minted it.

## Decisions

### Two adapters behind one interface

A backend adapter owns three things: building the command line for a new session and for a fork, parsing the CLI's output into a session id, a final text, and error messages, and the fixed arguments that make it read-only.
The dispatcher composes the prompt, runs the command with stdin closed and a time bound, and interprets the final text as a sourced answer, exactly as today.

The Codex adapter is the existing code moved, unchanged in behaviour.
The Claude adapter builds `claude -p --restricted --tools Read,Grep,Glob --permission-prompts none --output-format json --json-schema <schema text> --add-dir <transcript directory>`, adds `--model <model>` when one is known, `--name` for a recognizable session, and `--resume <id> --fork-session` for a continuation, then the prompt as the final argument.
It runs in the turn's working directory.
It reads `structured_output` first and falls back to `result`, treats `is_error` as failure with `result` as the message, and reports `permission_denials` in the error text when the answer is missing, since a denied tool is the likeliest reason for an empty answer.

The read-only guarantee for Claude rests on four flags together: `--restricted` removes the shell and code-running tools and ignores user and project settings, `--tools` allows only the three reading tools, `--strict-mcp-config` loads no MCP server, and `--permission-prompts none` denies anything that would have asked.
The MCP flag was added after the real-CLI probe: `--tools` governs the built-in set only, and without it the sub-agent still saw the user's MCP servers, whose tools can write elsewhere.
The adapter exposes no parameter for any of them.

Alternatives considered:

- One adapter with a table of flags per backend.
  The two CLIs differ in subcommand structure, output format, and how they express read-only, so a table would grow conditionals in every row.
- Codex only, with the Claude model behind Codex's custom provider configuration.
  Routes Claude through another vendor's CLI and its account, and gives up Claude Code's own session forking.

### The Claude sub-agent is kept out of sidescreen's own hooks two ways

`--restricted` ignores user, project, and local settings, and the probe showed the project's hooks silent under it.
The adapter also sets `SIDESCREEN_SUBAGENT=1` in the child's environment, and `sidescreen ingest` and `sidescreen carry-back --emit` exit successfully and do nothing when they see it.
The flag carries the guarantee; the marker catches a settings source the flag does not cover, such as managed settings, and costs one line in each hook command.

### A backend travels with every session id

An exchange gains a `backend` field, `claude` or `codex`, recorded when the question is routed and kept beside `subAgentSessionId`.
The thread-level convenience copy of the session id is dropped; the latest answered exchange is the source of truth and is one lookup away.
The store moves to version 3.
On first read of a version 2 store, every turn gets `model: null` and every exchange with a session id gets `backend: 'codex'`, because Codex minted every session that exists today.
The one-time backup written for the version 1 migration is written again for this one.

Alternative considered: keeping version 2 and defaulting a missing `backend` on every read.
Rejected because every consumer would carry the default, and the version number exists to say what a record is guaranteed to hold.

### The tag is parsed on the server, once, when the question arrives

The three routes that accept a question, new thread, follow-up, and branch, pass the text through one function that finds the first `@claude` or `@codex` standing as a word of its own, compared case-insensitively, and returns that backend and the question with the token removed.
A word of its own means preceded by the start of the text or whitespace, and followed by the end, whitespace, or a punctuation mark that does not run on into more text.
So `does @codex agree?` and `@codex.` carry a tag, while `me@codex.com`, `@codex.com`, and the escaped `\@codex` do not.
The stored `question` is the user's text verbatim.
The prompt receives the stripped text.
The backend is stored on the exchange before dispatch, so the pending state can already name it.

A token that is not a known tag is not a tag.
Rejecting it would make `@gpt why?` an error for a user who guessed, and treating it as text is what every other `@` in a question already gets.
When a question carries two tags, the first decides and the second stays in the text.

Alternative considered: a backend selector in the ask popover.
The tag is one word the user can type without leaving the question, works the same in all three inputs, and leaves the popover as small as it is.
A selector can follow if tags prove hard to discover; the placeholder text names them.

### One fork rule: the newest same-backend answer in the lineage, plus the gap

For a follow-up, the lineage is the thread's exchanges in order.
For a branch, the lineage is the parent thread's exchanges up to and including the branched-from exchange, preceded by the parent's own lineage when the parent is itself a branch.
A question's backend is the tag if present, otherwise the backend of the last answered exchange in its lineage, otherwise the configured default.

The fork target is the newest answered exchange in the lineage whose backend matches.
When one exists, the question forks that exchange's session and the prompt carries the lineage's exchanges after it, headed "Since your last answer" and naming the backend that produced them.
When none exists, the question starts a new session with the cold-start prompt and the whole lineage under "Earlier in this thread".
Both sections render each exchange as its question, then its answer text with its declared source and detail.

A same-backend follow-up is this rule with an empty gap, which is today's fork exactly.
A branch is this rule with the lineage cut at the branch point, which is today's branch exactly.

Alternatives considered:

- Always cold-start after a backend switch.
  Simpler, but a thread that alternates backends pays the full turn text on every question and the earlier backend forgets its own evidence trail.
- Cold-start on every question and rely on the prompt for context.
  Rejected in the first design for the same reasons, and a second backend does not change them.

### The parent session is not forked

The first question on a thread could resume the main session under `--fork-session` and ask from inside its context.
It is not done, for reasons recorded here so they are not rediscovered:

- Cost.
  Every first question would pay the main session's whole context as input, often well over a hundred thousand tokens, unless its prompt cache is still warm.
  The cold start pays the turn text and the slice.
- Precision.
  A fork takes the session as it is now, so turns after the reviewed one leak in, and if the main session has compacted, the reviewed turn may already be a summary.
- Stance.
  The reviewer would be a continuation of the agent it reviews, inclined to defend its reasoning, and the source declaration would lose its force.
- Symmetry.
  Codex cannot fork a Claude session, so the two backends would answer from different footings.
- Robustness.
  The cold start is needed anyway for a missing or lagging transcript, so the fork would be a second permanent path.

The one thing the fork would buy, first-hand knowledge of why the turn went as it did, is bought instead by the turn slice below.

### The turn's model is a label read at ingest

At ingest, the same tail of the transcript that yields the title is scanned for the last `assistant` record, and its `message.model` is stored on the turn as `model`, or null.
This is a label in the sense the ingestion requirement already allows: its absence changes nothing, and a stale value costs one question on a slightly different model.
Ingest is the right moment because the tail is already in memory and because the model that produced the turn is what the tail shows then; at question time the session may have moved to another model.

Alternative considered: no pinning, relying on the CLI's default model being the one the user runs.
Usually true, and it is the fallback, but a user who switched models mid-session would be reviewed by the wrong one without noticing.

### The turn slice is extracted at question time into the state directory

When a question starts a new session, the dispatcher asks a transcript module for the reviewed turn's slice.
The module reads the transcript, finds the latest `assistant` record whose text content equals the turn's stored message after whitespace normalization, and walks `parentUuid` back to the nearest `user` record that is a real prompt rather than a tool result.
The records between, inclusive, are the turn.
It writes them as a readable Markdown file, `<state dir>/turn-slices/<prompt id>.md`, with the user prompt, each reasoning block where present, each tool call with its input and the first 4,000 characters of its result with the omitted length noted, and the final message.
Four thousand characters keeps the median result whole, keeps about half of all result text observed, and bounds the heaviest observed turn near 80,000 characters of results.
A cut result is not lost to the sub-agent: the slice shows the tool's input, so it can read the same file or run the same search itself.
The prompt lists that file as part of the `transcript` source, beside the full transcript path, and the cold-start rules say to start there.

When the record is not found, because the transcript lags or is gone, the module returns null and the prompt says the turn was not located and how to find it: search for the final message's opening words, then follow `parentUuid`.

Extraction happens at question time because the transcript is complete by then and the ingestion rule forbids depending on it at ingest.
The file is rewritten on each cold start rather than cached, since a cold start is rare in a thread and the transcript may have been completed since the last one.

Alternatives considered:

- Inline the slice in the prompt.
  Tool results are unbounded, and the turn text is already windowed to keep the prompt bounded.
- Hand over a line range in the raw JSONL.
  Saves the sub-agent the search but leaves it parsing JSON records with nested content arrays.

### Configuration names the backend, not the model, and the default is a role

`SIDESCREEN_SUBAGENT` takes `parent`, `claude`, or `codex`, defaulting to `parent`.
Today `parent` resolves to `claude`, because the hooks are Claude Code's; the value exists so the setting keeps meaning if a turn ever arrives from another harness.
`SIDESCREEN_CLAUDE_BIN` and `SIDESCREEN_CODEX_BIN` locate the CLIs, `SIDESCREEN_CLAUDE_MODEL` and `SIDESCREEN_CODEX_MODEL` pin a model for each.
For Claude, an explicit model setting wins over the turn's recorded model, since the user set it on purpose.
`SIDESCREEN_MODEL` goes away.
The `serve` start-up line prints the default backend and both CLIs.

### The backend is shown, quietly

A muted line above the answer body reads "Claude answered:" or "CODEX answered:", the display names the user reads them by, with the model in its `title`.
It sits before the answer so the reader knows who is speaking before reading, and stays small and muted so it does not compete with the source badge in the footer.
While an answer is pending the line reads "Asking Claude…" or "Asking CODEX…", and the follow-up placeholder reads "Ask a follow-up… (@claude or @codex to switch)".

Alternative considered: a chip at the footer's right end beside the source badge.
Rejected on review, because who answered is read before the answer, and the footer is read after.

### A session's newest turn is not removable

Removing a session's only turn deletes the session record, and the session's next turn recreates it with a reset start time.
Rather than special-case that, removal is limited to past turns: the server answers a removal request for a session's newest turn with a conflict status and the sidebar shows no control on that row.
The newest turn is the one the user is most likely reading, so nothing of value is lost, and the moment a newer turn arrives the previous one becomes removable through the sidebar's existing live re-render.

Alternative considered: keeping removal of the last turn and preserving the session record without turns.
Rejected because a session with no turns has nothing to show in the sidebar and would need an empty state of its own.

### A turn's directory is its session's

The live store held 6 turns out of 91 whose directory differed from their session's, 5 of them from one session whose shell had moved into `openspec/changes/select-sub-agent-backend`, and 1 from a session whose directory was renamed under it.
Requesting one of them as the sidebar links it, under the session's project, redirected to a canonical address built from the turn's own directory, and that project id matched no session, so the page was "Project not found".
The addressing requirement already says the project is the session's; the code derived it from the turn.

The fix restores one invariant rather than adding lookups: a turn's `cwd` is its session's.
Ingest writes the session's directory onto a turn whose session already exists, the version 3 normalization rewrites existing turns the same way, and the server derives the canonical turn address, the legacy redirect, the removal link, and the project page's newest turn from that directory.
Every consumer of the turn's directory wants the project root: the sub-agent is started there, and under `--restricted` its file tools are confined to it, so a subdirectory would have hidden most of the project from a Claude sub-agent; the conventions loader looks for the project's instruction files there.
The hook's raw directory has no consumer, so nothing is lost by not keeping it.

Alternatives considered:

- Keep the hook's directory on the turn and look the session up at each site.
  Four sites today and every future one would have to remember, and the sub-agent would still start in the wrong place.
- Derive the project from the transcript path, which encodes the original directory.
  The first design declared that encoding an internal detail of the harness, and this design keeps that.

Limitation: a session whose very first turn arrives from a subdirectory is filed under that subdirectory, since the session's directory is set by its first turn.
The shell rarely moves before the first turn ends, and the case is left alone.

### Tests use a second stub CLI

`test/fixtures/stub-claude.js` speaks the `claude -p` result format: one JSON object with `session_id`, `structured_output`, and `is_error`, honouring `--resume <id> --fork-session` by minting `fork-of-<id>-<pid>` as the existing Codex stub does, and recording its arguments and prompt to files for assertions.
It waits for end of input and fails when stdin stays open, the same trap the Codex stub sets.
A real-CLI test runs only under `SIDESCREEN_E2E_CLAUDE=1`, like the existing hook test, and asserts the restricted run reports no writes and no shell.

## Risks / Trade-offs

- [Harness-level read-only is weaker than an operating-system sandbox] → Four independent flags, none reachable from callers; the real-CLI probe showed no writing tool, no shell, and no MCP tool present; the README's privacy section says which guarantee each backend gives.
- [A future Claude Code release changes what `--restricted` or `--tools` means] → The opt-in real-CLI test asserts the restricted run's `permission_denials` and the absence of writes; the adapter pins nothing else about the CLI.
- [The transcript lags at question time and the slice is missing] → The prompt says so and gives the search recipe; the answer can still cite the full transcript or say nothing was found.
- [The final message occurs more than once in a transcript] → The latest match is taken; a repeated turn is reviewed against its latest occurrence, which is the one the hook delivered.
- [The recorded model id is one the CLI refuses] → The exchange fails with the CLI's message, and `SIDESCREEN_CLAUDE_MODEL` overrides the recorded model.
- [Sub-agent sessions crowd the harness's session picker] → Sessions are named `sidescreen: <question>`; the README says they exist and that they can be ignored.
- [The gap section carries answers as text only, so the second backend cannot check the first backend's evidence trail] → Each answer still declares its own source; disagreement between backends is the point of asking twice.
- [Conventions reach the Claude sub-agent twice, forwarded in the prompt and possibly through the harness's own instruction discovery] → Duplication is harmless, and forwarding stays because Codex has no discovery of its own.

## Migration Plan

1. Store: version 3 normalization on first read, with the backup, as described above.
   Rollback is the backup file.
2. Configuration: `SIDESCREEN_MODEL` is removed and the README's table lists the new variables.
   The package is unpublished, so no installed copy carries the old name.
3. Hooks: the registered hook commands are unchanged; the `SIDESCREEN_SUBAGENT` marker is honoured by the commands themselves, so no re-registration is needed.
