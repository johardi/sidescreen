# annotatr

A second screen for coding-agent output.
Each finished Claude Code turn appears in your browser as a document.
Select any range of it and ask a question.
A separate, read-only sub-agent answers, and nothing about the question or the answer reaches your main session.

## Requirements

- Node 22 or newer.
- Claude Code, for the `Stop` hook that delivers turns.
- The `codex` CLI on your PATH, for answering questions.

## Quick start

```sh
npm install
npm link                      # puts `annotatr` on your PATH, optional
cd your-project
annotatr init                 # hooks in ./.claude/settings.json, skill in ./.claude/skills/annotatr/
annotatr serve --open         # http://127.0.0.1:7486/
```

Claude Code reads hooks when it starts, so restart any session already open in that project.
To register the hook for every project instead, run `annotatr setup hooks`, which edits `~/.claude/settings.json`.

Finish a turn in Claude Code.
It shows up in the browser on its own.
Select part of a sentence, type a question, press Enter.
The answer renders in the right-hand column with the source it was drawn from: `code`, `transcript`, `spec`, or `none`.
"No documented intent found" is a complete answer, not an error.

## Commands

| Command | What it does |
| --- | --- |
| `annotatr init [--dry-run]` | Set up the current directory: register the hooks in `./.claude/settings.json` and install annotatr's skills into `./.claude/skills/`. Idempotent. Files that are not annotatr's are never touched. |
| `annotatr setup hooks [--settings <path>] [--project] [--dry-run]` | Register annotatr's hooks idempotently. Reports, rather than edits, a settings file it cannot parse. |
| `annotatr ingest` | Read a `Stop` hook payload on stdin and store the turn. Run by the hook, not by hand. |
| `annotatr carry-back --emit` | Print the session's pending carry-back entries as plain text, then mark them sent. Run by the `UserPromptSubmit` hook, not by hand. |
| `annotatr serve [--port <n>] [--open]` | Start the browser surface on loopback. |

## The shipped skill

`annotatr init` installs one skill, `annotatr`, into the project.
It tells the main session how annotatr works alongside it: the final message of a turn is what the user reviews, side questions never reach the session, how to treat conclusions the user carries back, and which commands open or repair the surface.
The installed copy is annotatr's to maintain: a later `annotatr init` overwrites local edits to it and says so.

## Configuration

All configuration is by environment variable.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANNOTATR_STATE_DIR` | `$XDG_STATE_HOME/annotatr` | Where the store lives. |
| `ANNOTATR_CODEX_BIN` | `codex` | The sub-agent command. |
| `ANNOTATR_MODEL` | the sub-agent's own default | Model passed to the sub-agent. |
| `ANNOTATR_DISPATCH_TIMEOUT_MS` | `300000` | Time bound per question. A question that runs past it is reported as failed. |
| `ANNOTATR_CONVENTIONS_FILES` | `~/.claude/CLAUDE.md`, `./CLAUDE.md`, `./AGENTS.md` | Files forwarded into every sub-agent prompt, path-delimited, because the sub-agent does not read your agent instructions. |

## How it is put together

- **Ingestion** uses the `Stop` hook's `last_assistant_message`, never the transcript, which is written asynchronously and can lag the turn.
- **The store** is one JSON file, written under an in-process mutex and an on-disk lock, so two turns finishing at once cannot lose a write.
- **The server** binds to loopback and answers only to loopback hostnames in the `Host` header.
- **Anchors** record a range as a path to its container element plus a character offset, so they survive re-rendering.
- **Dispatch** always runs `codex exec` read-only with standard input closed. There is no parameter for widening the sandbox.

## Development

```sh
npm run check                 # lint, typecheck, tests
ANNOTATR_E2E_CLAUDE=1 npm test  # also runs the real `claude -p` hook test, which spends API credit
UPDATE_SNAPSHOTS=1 npm test   # rewrites the markdown rendering snapshot
```

Planning artifacts live under `openspec/`.
