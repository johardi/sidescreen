## Context

See `proposal.md` for motivation and the `agent-output-review` delta for the behaviour.

What exists, and what the harness does with it:

- `sidescreen carry-back --emit` runs as the `UserPromptSubmit` hook, prints the pending entries as one header line and one `- ` line per entry, then marks exactly those entries emitted.
  It prints nothing when nothing is pending, and nothing inside a sub-agent sidescreen started.
- The hooks reference says that for `UserPromptSubmit` the harness adds plain-text stdout to the model's context and displays it nowhere.
  It also says a hook may print JSON: `hookSpecificOutput.additionalContext` is added to the context, and `systemMessage`, "optional warning message shown to the user", is displayed in the terminal.
  The harness tells the two apart by the output's shape: text that starts with `{` and ends with `}`, ignoring surrounding whitespace, is parsed as JSON.
- The shipped skill describes the context block to the model: one header line, then one line per entry, oldest first.
- Probed in this session: an entry added at 14:35:09 was marked emitted at 14:35:15 and reached the model as context, while the terminal and its transcript viewer showed nothing.

## Goals / Non-Goals

**Goals:**

- The model receives exactly the block it receives today.
- The user sees, at the prompt where it happens, how many conclusions crossed and which.
- An idle prompt stays silent.

**Non-Goals:**

- Changing what is stored, when entries are marked emitted, or the sub-agent rule.

## Decisions

### The hook prints one JSON object carrying the block twice

```
{
  "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": "<the block as today>" },
  "systemMessage": "SideScreen carried back 2 conclusions:\n- first\n- second"
}
```

The context field holds the unchanged block, so the skill's description of it stays true and the model's side of the exchange is untouched.
The system message names the count, then repeats the lines, each on its own line with internal line breaks flattened to spaces as the block already does.
The object is printed on one line followed by a newline, which satisfies the harness's shape rule.

Alternatives considered:

- Printing to stderr as well.
  The harness shows a hook's stderr only when it exits non-zero; on success it goes to the debug log.
- A shorter system message with the count alone.
  The user's question was what crossed, not whether something did.

### Nothing pending still means no output

An object with an empty message would show a line on every prompt of every session with the hook installed.
The existing early return stands: no pending entry, no stdout, exit 0.

### The plain formatter stays, the writer changes

`formatEmission` keeps producing the block; a new `formatHookOutput` wraps it with the message, and `emitCarryBack` writes that.
Tests that read the hook's stdout parse the object and compare the two fields, so the assertions about leaks and ordering keep their meaning.

## Risks / Trade-offs

- **The harness changes how it displays `systemMessage`.** → The context field is independent of it; at worst the trace disappears again and the return still works.
- **A conclusion containing `}` at its end.** → JSON encoding escapes nothing here, but the object always ends with `}` by construction, so the shape rule holds whatever the text.
- **Long lists in the terminal.** → Accepted; every line shown is one the user chose to send.

## Migration Plan

Nothing on disk changes.
A sidescreen updated mid-session prints the object on the next prompt; the registered hook command is the same.
Rollback is reverting the code.
