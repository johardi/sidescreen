## Context

See `proposal.md` for motivation.

This is the project's first change, so there is no existing architecture to fit into.
The relevant constraints come from outside: what the agent harness exposes, and what a sub-agent CLI can be made to do reliably.

Both were probed before this design was written, and the findings below are evidence rather than assumption.

Harness surface, from the Claude Code hooks reference and a direct probe of a live `Stop` hook:

- `Stop` fires when an agent turn completes and carries `last_assistant_message`.
  Verified by probe rather than taken from documentation: a one-word turn produced `last_assistant_message: "banana"` alongside `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort`, `hook_event_name`, `stop_hook_active`, `background_tasks`, and `session_crons`.
- `prompt_id` identifies the turn, which makes it the stable root for threads anchored in that turn's output. It survives a re-render of the document and does not depend on message position.
- `cwd` identifies which project the turn belongs to, which the surface needs as soon as it is used against more than one repository.
- `stop_hook_active` guards re-entrancy, because a `Stop` hook is able to prevent stopping and would otherwise re-fire against its own output.
- Hooks fire in print mode (`claude -p`), and `--settings` loads an extra settings file for a single run, so the integration can be tested headlessly without touching real configuration.
- The reference explicitly warns that the transcript file is written asynchronously and may lag the in-memory conversation, and directs hooks needing the current turn's final text to use `last_assistant_message` instead of reading the transcript.
- `UserPromptSubmit` is one of the events whose plain-text stdout Claude Code injects as context the model can see and act on.
- `SubagentStop` also carries `last_assistant_message`.
- Session transcripts are on disk as JSONL, and the `Stop` hook supplies `transcript_path` directly. The surface does not derive that path from `session_id`, and must not, since the project-slug encoding is an internal detail of the harness.

Sub-agent surface, from probing `codex exec` on a real machine:

- It runs non-interactively, accepts `-s read-only` or `-s workspace-write`, `-C <dir>` for a working root, and `-m <model>` to pin a model.
- It has `resume` and `fork` subcommands for continuing and branching a prior session.
- Given a prompt as an argument but an open pipe on standard input, it blocks indefinitely with no output and no error. Observed: seven minutes, process alive, nothing produced. Closing stdin fixed it immediately.
- It does not inherit the user's global agent instructions. A delegated rewrite produced text violating a documented house style rule, because the rule lived in a file the sub-agent never reads.

## Goals / Non-Goals

**Goals:**

- Ingestion that cannot be skipped by an uncooperative or forgetful agent.
- A dispatch boundary where the read-only guarantee is structural, not advisory.
- A question chain that gets cheaper and sharper as the user drills, rather than restarting cold.
- A review whose net effect on the main session is a short list the user chose, and nothing else.

**Non-Goals:**

- Reconstructing the main session's reasoning. The design sources intent from records that exist; it does not attempt to infer intent that was never written down.
- Cross-harness parity. The hook integration is harness-specific by nature, and a harness without the hooks degrades to no ingestion rather than to partial ingestion.

## Decisions

### Ingest through `Stop`, never by parsing the transcript

The harness reference states the transcript lags the in-memory conversation and names `last_assistant_message` as the field to use for the current turn.
Reading the transcript instead would produce an empty or stale document for exactly the turn the user just finished reading, which is the only turn they want to annotate.

The transcript still has a role, but a different one: as an evidence source for answering questions about earlier turns, where the lag does not matter.

Alternative considered: an agent-invoked CLI, as Lavish does with `lavish-axi <file>`.
Rejected because it makes ingestion depend on the agent choosing to cooperate on every turn.
The hook path needs no cooperation at all.

### Annotatr dispatches; it never relays

The whole purpose is to keep the main session's context clean.
If the main agent performed the delegation, the question and the answer would pass through its context, and the pollution would happen regardless of who ultimately answered.
So the dispatching process must be annotatr itself.

This also makes the read-only guarantee real.
Under relay, the sandbox policy would be the relaying agent's discretion.
Under dispatch, annotatr constructs the command and owns the flag.

Alternative considered: relay via a long poll, Lavish's model.
Rejected on the merits.
A probe of the relay path showed the relaying agent's own tooling instructing it to "apply the requested changes" at the same moment the user's annotation asked it not to, and the relaying agent's first instinct was to do the work itself.
A delegation that degrades silently into "the main agent did it anyway" cannot be fixed with better wording.

A third option, a hybrid that relays by default and dispatches only on an explicit model choice, was considered and deferred.
It requires both code paths, and the relay path is the one this change exists to avoid.

### Three recipients, three policies

```
                    +----------------------------+
                    |       annotatr GUI         |
                    +----------------------------+
                     ^         |            |
      push output    |         | side Q     | code fix
      (one-way)      |         v            v  (deferred)
              +----------+  +---------+  +-----------+
              |   main   |  |  sub-   |  |  model of |
              | session  |  | agent   |  |  choice   |
              | idle in  |  | READ    |  |  WRITE    |
              | terminal |  | ONLY    |  |  CAPABLE  |
              +----------+  +---------+  +-----------+
                     ^
                     |  carry-back list only, via UserPromptSubmit
                     +---------------------------------------------
```

The main session is never a recipient of questions and never waits.
It pushes output and returns control to the user, which is what makes "go back to the terminal and continue" work without a poll, a presence state, or a reconnect timer.

The write-capable recipient is drawn here for completeness and is out of scope for this change.

### Every question forks the answer it continues

A thread's first question starts a fresh sub-agent session.
Every later question, follow-up or branch alike, uses `codex exec fork` on the session of the answer it continues, and the new answer keeps the new session id.
A session is never resumed, so once an answer exists its session is immutable.

This is what makes branching exact.
A branch from an earlier answer forks that answer's session and sees only what came before it, even when the thread has since moved on.
Follow-up and branch are the same operation; they differ only in whether the new exchange is appended to the thread or opens a sibling thread.
Because no session is ever mutated after it answers, follow-ups and branches are safe to run concurrently without locks.

Probed on the real CLI: a fork with a prompt answered in five seconds and recalled the parent's question and answer exactly, and a fork without a prompt returned a new session id in one second without a model call.
Cold-starting every question would make drilling useless by the third question, and would pay full context cost every time.

Alternative considered: `codex exec resume` for follow-ups, with `fork` only for branches.
Rejected because a resume grows one session per thread, so once a follow-up exists there is no session state that ends at the earlier answer, and a branch from that answer would see the follow-up too.
A variant that snapshots the session with a prompt-less fork before every resume was also considered.
It restores exact branching but needs two code paths and two processes per follow-up, and a failed snapshot silently loses a branch point.

### The UI is three zones, not a graph

```
+----------------------------------+--------------------------+
|  AGENT OUTPUT  (the document)    |  THREAD (one at a time)  |
|                                  |                          |
|  ...text with anchored    [2]    |  question                |
|  threads marked inline... [1]    |  answer + cited source    |
|                                  |  [+ follow up] [+ branch] |
+----------------------------------+--------------------------+
|  CARRY BACK  (n)                                            |
|  * conclusions the user chose                               |
|                                     [ Send to terminal ]    |
+-------------------------------------------------------------+
```

The document holds anchors.
The thread column shows one conversation at a time, with sibling branches as tabs.
The carry-back zone is the only thing that reaches the main session.

A canvas or node-graph view was considered and rejected.
A long chain with many branches makes navigation itself the task, which competes with the reading the surface exists to support.
Tabs bound the visible complexity to one thread plus its siblings.

The carry-back zone is load-bearing rather than cosmetic.
After a dozen questions across several branches, asking the user to re-read every answer to decide what mattered defeats the purpose.
Conclusions accumulate during the review, while the reason for each one is still fresh.

### Answers are sourced, and "nothing found" is an answer

Evidence sources, in order of preference:

1. **The session transcript.** The actual decision as it was made. On disk at the `transcript_path` the `Stop` hook supplies.
2. **The code.** Authoritative for what happens, silent on why.
3. **Project specification documents,** including OpenSpec artifacts when the project has them. Authored intent rather than reconstructed intent, and free to read.

Compaction was considered as a mechanism and rejected as the primary one.
It costs a model call, it is lossy, and the raw source it would compress is already available on disk.
Compaction is a strategy for fitting a large span into a small budget, not a strategy for obtaining evidence, and one side question rarely needs a span that will not fit.

OpenSpec integration is worth having and is the narrowest of the three sources.
A specification answers what a capability is for; it almost never records why an identifier was named as it was.

Mandatory citation exists because of a specific failure mode.
A specification document can describe intent the code no longer implements.
An answer drawn from a stale document arrives with a citation attached, which makes it *more* likely to be believed than an obviously uncertain answer, not less.
Requiring the source to be named is what lets the user weigh it.

## Risks / Trade-offs

- **A sub-agent confabulates intent it cannot know.** A fresh reader can explain what code does but not why a live conversation chose it. → Mandatory source declaration, with "no documented intent found" as a first-class answer rather than a failure.

- **A stale specification is cited as current intent.** → The citation names the source and its location, so a specification-sourced answer is visibly weaker evidence than a transcript-sourced one.

- **A sub-agent CLI hangs on an open stdin pipe.** Observed for seven minutes with no output and no error, which is indistinguishable from slowness. → Annotatr closes stdin on every dispatch, and treats an answer that does not arrive within a bounded window as a failure to report rather than a wait to extend.

- **The sub-agent does not inherit the user's global agent instructions.** Observed: a delegated rewrite violated a documented house style rule. → Annotatr forwards the relevant conventions into every dispatch prompt, once, in one place. This is a reason to prefer dispatch, since under relay the forwarding would be the relaying agent's discretion.

- **Drilling is expensive.** A probe measured roughly 34,000 tokens for a single trivial delegated edit. A dozen-question tree is not free. → Forking the answer being continued carries the chain's context forward instead of restarting cold, and the surface shows what is running so cost is visible rather than discovered later.

- **Hook integration ties ingestion to one harness.** → Ingestion degrades to unavailable, with that stated in the surface, rather than silently producing an empty or stale document.

## Recorded for the code-review follow-up

Findings from this exploration that the second purpose will need, so it does not have to rediscover them.

- `@pierre/diffs` renders its `<pre>` of code lines into the shadow root of a `<diffs-container>` custom element. A generic DOM annotator outside that boundary cannot see a selection inside it, and a document-rooted CSS selector cannot address a node within it. This is the whole reason a Lavish-style annotator can only ever select an entire code block.
- The way in is the library's own selection API: `enableLineSelection` with `onLineSelected`, which yields `{ start, side, end, endSide }` where side is `deletions` or `additions`. Token-level events additionally give `lineCharStart` and `lineCharEnd` for sub-line precision.
- Every rendered row carries `data-line`, `data-alt-line`, `data-line-type`, and `data-line-index`, which is a fallback if the callback API proves insufficient.
- Hunk expansion exists, so a diff view can expand outward to full file context. This matters because annotating unchanged code is a stated need: a documentation block or a method name to rename may sit entirely outside the diff.
- Write-capable dispatch needs one delegate per submitted batch rather than one per annotation. Fanning out in parallel would let two processes edit the same file concurrently.

## Open Questions

- Which sub-agent CLIs to support beyond the one probed, and how a model choice in the surface maps onto each one's configuration. Deferrable: it changes command construction, not the architecture.
- Whether a thread's transcript should persist across browser sessions or expire when the review ends. Deferrable: it changes storage, not the dispatch or return paths.
- How much of the annotated document to include in a dispatch prompt when the anchor is a short range inside a long message. Deferrable: a tuning question, resolvable against real usage.
