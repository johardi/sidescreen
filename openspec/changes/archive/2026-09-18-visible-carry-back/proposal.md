## Why

A conclusion carried back reaches the model and leaves no trace the user can see: the harness adds a hook's plain-text output to the model's context and shows it nowhere, not in the conversation and not in the transcript viewer.
The user who just pressed Enter on a conclusion in the browser looks at the terminal and cannot tell whether it crossed, which undoes the confidence the carry-back list exists to give.
The hooks reference offers the remedy: a hook may answer in JSON, carrying context for the model in one field and a message shown to the user in another.

## What Changes

- **The carry-back hook prints JSON instead of plain text.**
  The object carries the same block as today under `hookSpecificOutput.additionalContext`, for the model, and a `systemMessage` the harness shows in the terminal: a line naming how many conclusions crossed, then the lines themselves.
  When nothing is pending the hook still prints nothing, since an empty message would be noise on every prompt.
  Inside a sub-agent it still prints nothing and marks nothing.
- **The shipped skill's description of the block stays true**, because the context text is unchanged; it gains one sentence about the terminal showing the same lines.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-output-review`: the requirement "Only chosen conclusions return to the main session" gains that the hook shows the user what it returned, and prints nothing when nothing is pending.

This change builds on `workspace-refinements`, which last modified the same requirement, so it archives after it.

## Impact

Affected code:

- `src/store/carry-back.js`: the hook's output becomes a JSON object with the context block and the system message; the plain block formatter stays for the context.
- Tests in `test/store/carry-back.test.js`, `test/hooks/carry-back-cli.test.js`, and `test/web/browser.test.js` that read the hook's stdout parse the object instead of comparing plain text.
- `README.md` and `skills/sidescreen/SKILL.md`: one sentence each on the terminal showing what crossed.

Unchanged surfaces:

- Hook registration, the browser, the API, and the store's shape.
- What reaches the model: the same header and lines, in the same order.

### Non-goals

- Showing sent entries in the browser again. The terminal is where the user looked for the trace.
- Truncating long lists in the terminal message. Every line crossed, so every line shows.
