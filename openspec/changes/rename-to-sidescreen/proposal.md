## Why

The tool is about to be published to the npm registry for the first time, and the name has to be settled before that happens, because a package renamed after publishing leaves a dead entry behind and breaks every install instruction already copied.
`annotatr` names only the annotate feature and reads as a dropped-vowel brand; `sidescreen` says what the tool is, a screen beside the terminal, and on 2026-09-16 it was free on npm, Homebrew, PyPI, and crates.io, with `github.com/johardi/sidescreen` unclaimed.
The same change makes the package publishable: today it has no license file, no author or repository metadata, and a README that assumes a git checkout.

## What Changes

- **The product is named `sidescreen`.** **BREAKING**
  The command, the package, the shipped skill, the environment variable prefix, the default state directory, the hook commands, the browser title and brand, the DOM attribute on marks, the tab storage key, the carry-back header text, and the class and function names that carry the old name all change together.
  Every tracked file that says `annotatr` says `sidescreen` afterwards, including the README and the tests and their fixtures.
  Existing hooks that run `annotatr`, an existing store under `$XDG_STATE_HOME/annotatr`, and installed copies of the `annotatr` skill are not recognized by the renamed tool.
- **The package is ready to publish as `sidescreen` 0.1.0 under MIT.**
  `package.json` gains `author`, `repository`, `homepage`, `bugs`, and `keywords`, a `LICENSE` file is added, and a `prepublishOnly` script runs lint, typecheck, and tests so a failing tree cannot be published.
  The name is unscoped, so no access setting is needed.
  The `files` allowlist already limits the tarball to `bin`, `skills`, and `src`; `README.md`, `LICENSE`, and `package.json` ship with it by npm's own rules.
- **The documented install path is a global npm install.**
  The README quick start becomes `npm install -g sidescreen` followed by `sidescreen init`, with the checkout-and-link path kept under Development.
  `npx` is not recommended, because the registered hook command embeds the absolute path of the installed `bin/sidescreen.js` and the npx cache can be evicted from under it.
- **No compatibility shims are added.**
  The renamed tool does not read the old state directory and does not treat an `annotatr` hook command as its own.
  The only existing install is the author's, and its migration is a short manual procedure recorded in `design.md`.
- **Existing OpenSpec specs and archived changes are left as written.**
  The live `agent-output-review` spec names the tool in two scenarios and the archived changes name it throughout.
  Both are records of the project as it was, and renaming them would rewrite history without changing behaviour.

## Capabilities

### New Capabilities

- `package-distribution`: how the tool is obtained and identified once published: installing it by name from the npm registry yields the `sidescreen` command, the installed copy carries everything `init` needs, the reported version is the package version, and the package declares its license and authorship.

### Modified Capabilities

None.
The `agent-output-review` spec names the tool in two scenarios, but no requirement changes, and the spec is left as written.

## Impact

Affected code and files:

- `package.json` and `package-lock.json`: the name, the `bin` entry, the publish metadata, and the `prepublishOnly` script.
- `bin/annotatr.js` becomes `bin/sidescreen.js`; `skills/annotatr/SKILL.md` becomes `skills/sidescreen/SKILL.md` with its name, description, allowed tools, author, and body renamed.
- `LICENSE`: new, MIT, copyright 2026 Josef Hardi.
- `src/cli.js`, `src/ingest.js`, `src/carry-back.js`, `src/init.js`, `src/setup-hooks.js`: usage text, message prefixes, the bin path, the hook command matcher and its name, and doc comments.
- `src/store.js`, `src/dispatch.js`, `src/conventions.js`: the `SIDESCREEN_*` environment variables and the `sidescreen` default state directory.
- `src/server.js`: the server class name.
- `src/page.js`, `src/public/anchor.js`, `src/public/app.js`, `src/public/app.css`, `src/public/workspace.js`: title, brand, empty-state and warning text, the `data-sidescreen-mark` attribute, and the `sidescreen:collapsed:` storage key.
- `test/**`: the bin path, temporary directory prefixes, environment variable names, output assertions, the opt-in `SIDESCREEN_E2E_CLAUDE` switch, and the markdown fixture pair, whose rendered snapshot is regenerated.
- `README.md`: the name throughout, the install path, and the configuration table.

Unchanged surfaces:

- Every behaviour: ingestion, anchoring, dispatch, threads, carry-back, sessions, projects, follow mode, and removal work exactly as before.
- The store format and schema version.
- The hook events and their payloads.
- The port, the routes, and the API.

### Non-goals

- **A scoped package.** The bare name is free, and a scope would put itself in every install command for no benefit.
- **Reading the old state directory or recognizing old hook commands.** One user is affected, once, and the shim would carry the old name in the code forever.
- **Renaming the checkout directory.** It is outside the repository; the author renames it when convenient and re-runs `sidescreen init` where the hook path changed.
- **A changelog.** None exists today and one would be generated by tooling, not written by hand.
- **Any change to what the tool does.** The rename is a pure relabelling, and publish preparation adds metadata only.
