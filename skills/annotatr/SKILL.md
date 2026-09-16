---
name: annotatr
description: Work alongside annotatr, the second-screen reader that receives each finished turn through the Stop hook. Use when the user mentions annotatr, asks to open or troubleshoot the review surface, asks why a turn did not appear in it, or when a prompt carries conclusions the user brought back from a review.
allowed-tools: Bash(annotatr:*)
metadata:
  author: annotatr
---

# annotatr

The user reads each finished turn in the browser as well as in the terminal.
A `Stop` hook stores the turn's final assistant message, and annotatr renders it as a document.
The user can select any range of it and ask a question.
A separate, read-only sub-agent answers those questions.
None of that reaches this session: you never see the questions or the answers, and you are not expected to.

## What this changes about how you write

The final assistant message of a turn is the document the user reviews.
Earlier messages in the same turn are not captured.
Make the final message stand on its own, with the decisions and their reasons in it.

## Conclusions carried back from a review

While reviewing, the user can mark conclusions to carry back to this session.
A `UserPromptSubmit` hook injects them as context ahead of the user's next prompt.
The block is one header line, "Conclusions the user carried back from their annotatr review of earlier output:", followed by one line per entry, each starting with "- ", oldest first.
Each entry is a decision the user already made while reading your earlier output, in their own words.
Act on it without re-deriving it, and do not ask what it refers to unless it is genuinely ambiguous.
An entry is injected once and never repeated, so treat it as part of the prompt it arrived with.
When nothing was carried back, nothing is injected.

## What not to do

- Do not run `annotatr ingest` or `annotatr carry-back --emit` yourself. The hooks run them.
- Do not read or edit annotatr's store under `$XDG_STATE_HOME/annotatr`, or under `ANNOTATR_STATE_DIR` when it is set. It holds the user's private review threads.
- Do not try to answer or guess at the user's side questions. They go to the sub-agent by design.

## Commands the user may ask for

| Ask | Command |
| --- | --- |
| Open the review surface | `annotatr serve --open`, run in the background. It serves http://127.0.0.1:7486/ until stopped and opens this project's page. If it reports the port is already in use, a server is already running: open http://127.0.0.1:7486/ instead. |
| Turns are not appearing | `annotatr init` re-registers the hook in `./.claude/settings.json`. Claude Code reads hooks at startup, so restart it afterwards. |
| Check whether the hook is registered | `annotatr setup hooks --project --dry-run` prints `Stop: unchanged` when it is. |
