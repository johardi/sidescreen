## 1. The hook's output

- [x] 1.1 Add `formatSystemMessage` and `formatHookOutput` to the carry-back store, keep `formatEmission` as the context block, and make `emitCarryBack` write the JSON object, still nothing when nothing is pending; verify with store tests that the object carries the unchanged block under `hookSpecificOutput.additionalContext` and the count and lines under `systemMessage`, that an empty list prints nothing, and that the second emit prints nothing
- [x] 1.2 Update the CLI, browser, and end-to-end tests that read the hook's stdout to parse the object and compare both fields, keeping the leak checks on the raw output; verify that `node --test` passes for `test/hooks/carry-back-cli.test.js`, `test/store/carry-back.test.js`, and `test/web/browser.test.js`

## 2. Documentation and check

- [x] 2.1 Add one sentence to `README.md` and one to `skills/sidescreen/SKILL.md` saying the terminal shows the lines that crossed; verify by reading them against the delta spec
- [x] 2.2 Run `npm run check` and confirm lint, typecheck, and every test pass
