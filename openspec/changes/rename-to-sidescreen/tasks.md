## 1. Package identity

- [x] 1.1 Rename `bin/annotatr.js` to `bin/sidescreen.js` with `git mv`, and change the `name` and `bin` entries in `package.json` to `sidescreen`; verify that `node bin/sidescreen.js --help` prints usage headed `sidescreen 0.1.0`
- [x] 1.2 Rename `skills/annotatr/` to `skills/sidescreen/` with `git mv`, and update the skill's `name`, `description`, `allowed-tools`, `metadata.author`, heading, and body to say `sidescreen`, including the quoted carry-back header and the commands table; verify that `grep -c annotatr skills/sidescreen/SKILL.md` prints 0
- [x] 1.3 Add `author`, `repository`, `homepage`, `bugs`, `keywords`, and `scripts.prepublishOnly` to `package.json` with the values in design.md; verify with `npm pkg get author repository homepage bugs keywords scripts.prepublishOnly` that each is present and points at `github.com/johardi/sidescreen`
- [x] 1.4 Add a `LICENSE` file at the repository root with the MIT text and "Copyright (c) 2026 Josef Hardi"; verify that `npm pack --dry-run` lists `LICENSE`
- [x] 1.5 Regenerate `package-lock.json` with `npm install` so its `name` fields read `sidescreen`; verify that `grep -c annotatr package-lock.json` prints 0 and `git diff --stat package-lock.json` shows only the name lines changed

## 2. Source rename

- [x] 2.1 Rename every environment variable to the `SIDESCREEN_` prefix in `src/store.js`, `src/dispatch.js`, `src/conventions.js`, and `src/cli.js`, and change the default state directory to `$XDG_STATE_HOME/sidescreen`; verify with the store and dispatch tests that `SIDESCREEN_STATE_DIR`, `SIDESCREEN_CODEX_BIN`, `SIDESCREEN_MODEL`, `SIDESCREEN_DISPATCH_TIMEOUT_MS`, and `SIDESCREEN_CONVENTIONS_FILES` are honoured and that `defaultStateDir` ends in `sidescreen`
- [x] 2.2 Update `src/cli.js`: the bin path, the usage text, every message prefix, and the listening and shutdown lines; verify with the CLI tests that `sidescreen: unknown command` and `sidescreen listening on` are emitted
- [x] 2.3 Update `src/setup-hooks.js`: rename `isAnnotatrHookCommand` to `isSidescreenHookCommand` and `findAnnotatrHook` to `findSidescreenHook`, match `sidescreen` and `sidescreen.js` in hook commands, and rename the message prefixes and doc comments; verify with the setup-hooks tests that `node /x/bin/sidescreen.js ingest`, `sidescreen ingest`, and `npx sidescreen ingest` are recognized, that `my-sidescreen-wrapper ingest` is not, and that a stale `sidescreen.js` path is updated in place
- [x] 2.4 Update `src/init.js`, `src/ingest.js`, and `src/carry-back.js`: message prefixes, doc comments, and the carry-back header constant to "Conclusions the user carried back from their sidescreen review of earlier output:"; verify with the carry-back tests that the emitted header matches
- [x] 2.5 Rename `AnnotatrServer` to `SidescreenServer` in `src/server.js` and its factory; verify that `npm run typecheck` passes with no reference to the old name
- [x] 2.6 Update `src/page.js` for the title, brand link, landing empty state, and ingestion warning text, and `src/public/anchor.js`, `src/public/app.js`, `src/public/app.css`, and `src/public/workspace.js` for the `data-sidescreen-mark` attribute and the `sidescreen:collapsed:` storage key; verify with the page, anchor, and browser tests that marks carry the new attribute and that the title reads `sidescreen`

## 3. Tests and fixtures

- [x] 3.1 Update `test/helpers.js`, `test/server-helpers.js`, and every test that names the bin, a temp directory prefix, an environment variable, or an output string, including the `SIDESCREEN_E2E_CLAUDE` opt-in in `test/e2e-claude-hook.test.js`; verify that `npm test` passes
- [x] 3.2 Add a test that reads `skills/sidescreen/SKILL.md` and asserts it quotes the exact `EMISSION_HEADER` constant from `src/carry-back.js`; verify that the test fails when either string is edited alone and passes as committed
- [x] 3.3 Rename the references in `test/fixtures/markdown/sample.md` and regenerate `sample.html` with `UPDATE_SNAPSHOTS=1 npm test`; verify that the render test passes without the flag and that neither fixture contains the old name

## 4. Documentation

- [x] 4.1 Rewrite `README.md` for the new name: the title, the quick start as `npm install -g sidescreen`, `sidescreen init`, `sidescreen serve --open`, the commands table, the skill section, the configuration table with `SIDESCREEN_*` names, a note that a hook points at the installed executable and that `init` must be re-run after a version manager changes it, a sentence discouraging `npx` for setup, and the Development section keeping the checkout-and-link path and `SIDESCREEN_E2E_CLAUDE`; verify by reading it end to end and with `grep -c annotatr README.md` printing 0

## 5. Verification

- [x] 5.1 Run `git grep -i annotatr -- ':!openspec'` and verify it returns nothing
- [x] 5.2 Run `npm run check` and verify lint, typecheck, and every test pass
- [x] 5.3 Run `npm pack --dry-run` and verify the tarball is named `sidescreen-0.1.0.tgz`, lists `bin/sidescreen.js`, `skills/sidescreen/SKILL.md`, `LICENSE`, `README.md`, and `src/**`, and lists nothing from `test/`, `openspec/`, `.claude/`, or `.agents/`
- [x] 5.4 Run `npm pack`, install the tarball globally with `npm install -g ./sidescreen-0.1.0.tgz`, and in a scratch directory run `sidescreen --version`, `sidescreen init --dry-run`, and `sidescreen --help`; verify the version is `0.1.0`, the dry run names a hook command under the global install path and the skill `sidescreen/SKILL.md`, then uninstall with `npm uninstall -g sidescreen` and delete the tarball
