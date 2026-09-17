# sidescreen

A second screen for coding-agent output.
Each finished Claude Code turn appears in your browser as a document, filed under its session and its project.
Select any range of it and ask a question.
A separate, read-only sub-agent answers, and nothing about the question or the answer reaches your main session.

## Requirements

- Node 22 or newer.
- Claude Code, for the `Stop` hook that delivers turns.
- The `codex` CLI on your PATH, for answering questions.

## Quick start

```sh
npm install
npm link                      # puts `sidescreen` on your PATH, optional
cd your-project
sidescreen init                 # hooks in ./.claude/settings.json, skill in ./.claude/skills/sidescreen/
sidescreen serve --open         # opens this project's page on http://127.0.0.1:7486/
```

Claude Code reads hooks when it starts, so restart any session already open in that project.
To register the hook for every project instead, run `sidescreen setup hooks`, which edits `~/.claude/settings.json`.

Finish a turn in Claude Code.
It shows up in the browser on its own.
Select part of a sentence, type a question, press Enter.
The answer renders in the right-hand column with the source it was drawn from: `code`, `transcript`, `spec`, or `none`.
"No documented intent found" is a complete answer, not an error.

## Projects, sessions, and turns

One server serves every project.
The hook writes each turn into one store under your home directory, and the server only watches that store, so it does not matter where you start it or whether it was running when the turn finished.

The page at `/` lists the projects that have delivered a turn, one per working directory.
Pick one and the page focuses on it: the left sidebar lists that project's Claude Code sessions, newest activity first, and under each session all of its turns.
A session is one conversation, so `/clear` starts a new entry and `claude --resume` continues an old one.
Sessions carry the title Claude Code gives them, read from the transcript, and are labelled by their start time until that title exists.
Collapse a session to one line with its turn count; the tab remembers which ones you collapsed.

The address says what the page follows:

| Address | Shows | When a new turn arrives |
| --- | --- | --- |
| `/projects/<project>` | The project's newest turn, from any session. | Shows it. |
| `/projects/<project>/sessions/<session>` | That session's newest turn. | Shows it if it is in this session, otherwise offers it. |
| `/projects/<project>/sessions/<session>/turns/<turn>` | That turn, pinned. | Offers it. |

"Shows it" means the page reloads in place, unless the ask popover is open or you have typed into any box.
Then, and whenever a turn is offered, a notice at the top names the session it came from and links to it, so nothing you are in the middle of is lost.
Clicking a turn in the sidebar pins it.
"Latest" at the top of the sidebar returns to following the project, and "Follow" beside a session follows that session.
The older `/turns/<turn>` address redirects to the pinned form, so links you already copied keep working.

To remove a turn, hover its row and click the × that appears at its right edge.
The button turns into a confirmation that says what goes with it, such as "Remove turn and 3 threads?".
Click it again to remove the turn and its threads.
Escape, moving off the row, or clicking anywhere else cancels.
Carry-back entries are never removed with a turn, because they are still owed to the terminal, and a session whose last turn is removed leaves the sidebar.
The turn's text is still in the Claude Code transcript on disk; only sidescreen's copy and its threads go.

## Commands

| Command | What it does |
| --- | --- |
| `sidescreen init [--dry-run]` | Set up the current directory: register the hooks in `./.claude/settings.json` and install sidescreen's skills into `./.claude/skills/`. Idempotent. Files that are not sidescreen's are never touched. |
| `sidescreen setup hooks [--settings <path>] [--project] [--dry-run]` | Register sidescreen's hooks idempotently. Reports, rather than edits, a settings file it cannot parse. |
| `sidescreen ingest` | Read a `Stop` hook payload on stdin and store the turn. Run by the hook, not by hand. |
| `sidescreen carry-back --emit` | Print the session's pending carry-back entries as plain text, then mark them sent. Run by the `UserPromptSubmit` hook, not by hand. |
| `sidescreen serve [--port <n>] [--open]` | Start the browser surface on loopback. `--open` opens the current directory's project page. A second `serve` on a busy port says so and exits. |

## The shipped skill

`sidescreen init` installs one skill, `sidescreen`, into the project.
It tells the main session how sidescreen works alongside it: the final message of a turn is what the user reviews, side questions never reach the session, how to treat conclusions the user carries back, and which commands open or repair the surface.
The installed copy is sidescreen's to maintain: a later `sidescreen init` overwrites local edits to it and says so.

## Configuration

All configuration is by environment variable.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SIDESCREEN_STATE_DIR` | `$XDG_STATE_HOME/sidescreen` | Where the store lives. |
| `SIDESCREEN_CODEX_BIN` | `codex` | The sub-agent command. |
| `SIDESCREEN_MODEL` | the sub-agent's own default | Model passed to the sub-agent. |
| `SIDESCREEN_DISPATCH_TIMEOUT_MS` | `300000` | Time bound per question. A question that runs past it is reported as failed. |
| `SIDESCREEN_CONVENTIONS_FILES` | `~/.claude/CLAUDE.md`, `./CLAUDE.md`, `./AGENTS.md` | Files forwarded into every sub-agent prompt, path-delimited, because the sub-agent does not read your agent instructions. |

## How it is put together

- **Ingestion** uses the `Stop` hook's `last_assistant_message`, never the transcript, which is written asynchronously and can lag the turn.
- **The store** is one JSON file, written under an in-process mutex and an on-disk lock, so two turns finishing at once cannot lose a write.
  It holds turns, sessions, threads, and carry-back entries.
  Projects are not stored: they are derived from the sessions' working directories, and a project's id in the URL is a short hash of that directory, so the path itself never appears in a link.
  A store from before sessions existed is read as is and copied to `store.v1.bak` once before the first write in the new format.
- **Session titles** come from the `ai-title` records Claude Code writes into the transcript.
  Only the last megabyte is read, once per ingested turn, by a reader that never sees a message.
  Any failure leaves the title as it was and never fails the ingest.
- **The server** binds to loopback and answers only to loopback hostnames in the `Host` header.
- **Anchors** record a range as a path to its container element plus a character offset, so they survive re-rendering.
- **Dispatch** always runs `codex exec` read-only with standard input closed. There is no parameter for widening the sandbox.

## Development

```sh
npm run check                 # lint, typecheck, tests
SIDESCREEN_E2E_CLAUDE=1 npm test  # also runs the real `claude -p` hook test, which spends API credit
UPDATE_SNAPSHOTS=1 npm test   # rewrites the markdown rendering snapshot
```

Planning artifacts live under `openspec/`.
