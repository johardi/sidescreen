## 1. Project setup

- [x] 1.1 Create `package.json` with `"type": "module"`, Node 22+ engine constraint, and no runtime dependencies yet; verify `node --version` satisfies the constraint and `node -e "import('./package.json', {with:{type:'json'}})"` resolves
- [x] 1.2 Add `node:test` scripts (`test`, `lint`, `typecheck` with `tsc --noEmit` in checkJs mode) and one passing placeholder test; verify `npm test` exits 0
- [x] 1.3 Create `src/` and `test/` layout with a `bin/annotatr.js` entry that imports `src/cli.js` and prints its version; verify `node bin/annotatr.js --version` prints the `package.json` version

## 2. Hook ingestion (spec: turn output ingested without agent cooperation)

- [x] 2.1 Implement `parseStopHookPayload(json)` that extracts `last_assistant_message`, `session_id`, `prompt_id`, `cwd`, and `transcript_path`, and rejects a payload missing `last_assistant_message`; verify unit tests cover the observed payload shape and each missing-field case
- [x] 2.2 Implement `annotatr ingest`, which reads a hook payload from stdin and stores one turn document keyed by `prompt_id`; verify piping the captured probe payload into it creates a retrievable turn
- [x] 2.3 Implement the store as a single JSON file under a state directory overridable by `ANNOTATR_STATE_DIR`, serialized through one async mutex so concurrent ingests cannot lose a write; verify a test firing two concurrent ingests retains both turns
- [x] 2.4 Implement `annotatr setup hooks` to register the `Stop` hook idempotently, reporting rather than throwing when a settings file cannot be parsed; verify running it twice produces one hook entry and leaves unrelated settings untouched
- [x] 2.5 Add an end-to-end test that runs `claude -p` with a generated `--settings` file pointing at the real ingest command; verify the turn's text lands in the store without touching user configuration

## 3. Browser surface and annotation (spec: any range of rendered output can be annotated)

- [x] 3.1 Implement a local HTTP server bound to loopback that serves one page per turn document, with a Host-header allowlist rejecting requests for hostnames it does not answer to; verify tests cover an allowed host, a missing Host, and a foreign Host
- [x] 3.2 Render the turn's `last_assistant_message` as the document, with markdown formatting and no injected styling beyond the shell; verify a snapshot test of the rendered output for a message containing code fences, lists, and inline code
- [x] 3.3 Implement text-range selection capture in the page: on selection release, record the range as a start and end boundary anchored to a container path, not a character offset into the whole document; verify unit tests reconstruct a mid-sentence range from its anchors after a re-render
- [x] 3.4 Show a question input anchored to the live selection, and on submit create a thread carrying the range, the selected text, and the question; verify a browser-level test selects part of a sentence and produces a thread with the expected range
- [x] 3.5 Mark anchored threads inline in the document and render the active thread in a side column; verify the layout holds at 400px width with no horizontal page scroll

## 4. Dispatch and sourced answers (spec: isolated read-only sub-agent, every answer declares its source)

- [x] 4.1 Implement `dispatchQuestion()` building a `codex exec` invocation with `-s read-only`, `-C <cwd from the hook>`, and standard input redirected from `/dev/null`; verify a unit test asserts stdin is closed and the sandbox flag is present, since an open stdin pipe hangs the child indefinitely
- [x] 4.2 Bound every dispatch with a timeout that reports a failed answer rather than waiting longer; verify a test using a stub command that never exits reports failure within the bound
- [x] 4.3 Forward the user's relevant conventions into every dispatch prompt from one place, because the sub-agent does not read the user's global agent instructions; verify a test asserts the forwarded block appears in the constructed prompt
- [x] 4.4 Require the answer to declare a source from the set code, transcript, spec, or none, and render the declared source beside the answer; verify tests cover each source value and an answer that declares none
- [x] 4.5 Make "no documented intent found" a rendered first-class answer rather than an error state; verify a test asserts it renders as an answer and does not mark the thread failed
- [x] 4.6 Add an end-to-end test that ingests a turn, annotates a range, dispatches against a stub sub-agent command, and renders the sourced answer; verify the whole loop passes headlessly

**First usable slice ends here.** Stop and use it before continuing. Groups 5 and 6 are refinements that only make sense once drilling has been felt in practice.

## 5. Threads and branching (spec: threads support drilling and branching)

- [ ] 5.1 Persist each answered exchange's sub-agent session id, since every answer keeps its own immutable session; verify a test asserts the id is recorded per exchange and survives a store reload
- [ ] 5.2 Implement a follow-up as `codex exec fork` of the session of the answer it continues, appended to the same thread; verify a test asserts the fork subcommand and that session id are used rather than a cold invocation, and that the continued answer's session id is unchanged afterwards
- [ ] 5.3 Implement a branch as the same fork into a new thread, allowed from any answered exchange including one that already has a follow-up; verify a test asserts the branch forks that exchange's session id rather than the thread's latest, that the two threads hold different session ids, and that answering one does not mutate the other
- [ ] 5.4 Allow concurrent follow-up and branch dispatches, safe because read-only answers cannot write and answered sessions are never mutated; verify a test fires two branches at once and both answers land on their own threads
- [ ] 5.5 Render sibling branches as tabs within the thread column, never as a graph; verify the tab strip stays usable with five siblings at 400px width

## 6. Carry-back return path (spec: only chosen conclusions return to the main session)

- [ ] 6.1 Implement a carry-back list the user adds entries to during a review, stored per session; verify entries survive a page reload
- [ ] 6.2 Implement `annotatr carry-back --emit` printing only the pending entries as plain text, and nothing when the list is empty; verify tests cover a populated list and an empty one
- [ ] 6.3 Register a `UserPromptSubmit` hook through `annotatr setup hooks` that runs that command, so its stdout is injected as context on the next prompt; verify running setup twice produces one entry per event
- [ ] 6.4 Clear emitted entries after a successful emit so a conclusion is not injected into every later prompt; verify a test asserts the second emit prints nothing
- [ ] 6.5 Add an end-to-end test asserting that thread contents never appear in the emitted output, only carry-back entries; verify the test fails if a question or answer leaks

## 7. Verification across the whole change

- [x] 7.1 Add a test asserting no dispatch path can be constructed with a write-capable sandbox flag, since side questions must never edit files; verify the test fails if the flag is made configurable
- [x] 7.2 Add a test asserting the ingest path never reads `transcript_path` to obtain the current turn's text; verify it fails if transcript parsing is reintroduced
- [ ] 7.3 Run the full `check` pipeline (build if present, lint, typecheck, tests) and confirm it passes from a clean checkout
