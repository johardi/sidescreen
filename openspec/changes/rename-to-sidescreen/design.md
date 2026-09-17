## Context

See proposal.md for motivation.

- The name `annotatr` appears in roughly 290 places across 44 tracked files: the package manifest and lockfile, the bin script, the shipped skill, six environment variables, the default state directory, CLI usage and message prefixes, a hook command matcher, a server class, a DOM attribute on marks, a tab storage key, the carry-back header text, tests and fixtures, the README, and the OpenSpec specs and archived changes, which are left as they are.
- The repository layout is already the shape npm expects: `files` allowlists `bin`, `skills`, and `src`, there is no build step, and `npm pack --dry-run` today produces 36 files in a 55 kB tarball.
  What is missing is a `LICENSE` file, publish metadata, and a guard script.
- Hook commands embed the absolute path of `bin/annotatr.js` at the time `init` ran, so a moved or renamed executable leaves a hook that fails until `init` runs again.
  The hook matcher recognizes an existing entry by the word `annotatr` in its command, which is how re-running `init` updates a stale path in place.
- The author's machine holds the only install: a store at `~/.local/state/annotatr/store.json`, project hooks pointing at this checkout's `bin/annotatr.js`, and `.claude/skills/annotatr/` copies installed by `init`.
- The bare name `sidescreen` was free on npm, Homebrew, PyPI, and crates.io on 2026-09-16, and `github.com/johardi/sidescreen` did not exist.
  A Swift application named SideScreen with about a thousand GitHub stars exists in a different ecosystem.
- Node 22 is the declared minimum, and `npm test` drives a real browser through Playwright.

## Goals / Non-Goals

**Goals:**

- One name, one word, everywhere a user or a machine can see it: the command, the package, the skill, the variables, the paths, the UI, and the code.
- After the change, `git grep -i annotatr` outside `openspec/` returns nothing.
- `npm publish` from a clean checkout produces a package that installs globally and passes the `package-distribution` scenarios.
- The author's existing install is migrated by a short, written procedure.

**Non-Goals:**

- Detecting or repairing hooks whose executable path no longer exists.
  Worth doing, but it is a behaviour change to `init` and belongs in its own change.
- A `sidescreen up` or any server-lifecycle work, already deferred by the previous change.
- Reserving misspellings of the name on npm, or registering a domain.

## Decisions

### The package is the unscoped name `sidescreen`, and the command is the same word

Every install instruction is then the command name, and `npx sidescreen` resolves to this package.
Alternatives considered: `@johardi/sideway`, which was the first choice, is scoped because `sideway` is held by a dormant 2015 package; the scope would appear in every install command and `npx sideway` would run someone else's package.
Other free candidates, `sidelong`, `hookaside`, `hooknook`, were passed over on meaning; `sidescreen` is the README's own tagline in one word.

### The rename is a complete relabelling, driven by a map and verified by a search

Every occurrence follows one map, applied to prose, identifiers, paths, and tests alike:

| Surface | Before | After |
| --- | --- | --- |
| Command and executable | `annotatr`, `bin/annotatr.js` | `sidescreen`, `bin/sidescreen.js` |
| Environment variables | `ANNOTATR_STATE_DIR`, `ANNOTATR_CODEX_BIN`, `ANNOTATR_MODEL`, `ANNOTATR_DISPATCH_TIMEOUT_MS`, `ANNOTATR_CONVENTIONS_FILES`, `ANNOTATR_E2E_CLAUDE` | the same names with the `SIDESCREEN_` prefix |
| Default state directory | `$XDG_STATE_HOME/annotatr` | `$XDG_STATE_HOME/sidescreen` |
| Shipped skill | `skills/annotatr/SKILL.md`, name `annotatr`, `Bash(annotatr:*)`, author `annotatr` | `skills/sidescreen/SKILL.md`, name `sidescreen`, `Bash(sidescreen:*)`, author `sidescreen` |
| Carry-back header | "...from their annotatr review of earlier output:" | "...from their sidescreen review of earlier output:" |
| Browser | `<title>annotatr</title>`, brand text, `data-annotatr-mark`, `annotatr:collapsed:<id>` | `sidescreen`, `data-sidescreen-mark`, `sidescreen:collapsed:<id>` |
| Identifiers | `AnnotatrServer`, `isAnnotatrHookCommand`, `findAnnotatrHook` | `SidescreenServer`, `isSidescreenHookCommand`, `findSidescreenHook` |
| Messages | `annotatr: unknown command`, `annotatr listening on`, and every other prefix | the same text with `sidescreen` |
| Tests | bin path, `annotatr-` temp prefixes, output regexes, env names | renamed to match |

Everything under `openspec/` is excluded from the map and from the verification search: the live specs and the archived changes are records of the project as it was, and this change's own artifacts necessarily name both words.
The carry-back header is emitted from one constant in `src/carry-back.js` and quoted in the skill, and a test compares the skill's quoted header to that constant so the two cannot drift apart again.
The markdown fixture pair is renamed in the source `.md` and its `.html` snapshot is regenerated with `UPDATE_SNAPSHOTS=1` rather than edited by hand.
`package-lock.json` is regenerated by `npm install`, never edited.

### The hook matcher recognizes only the new name

`isSidescreenHookCommand` matches `sidescreen` and `sidescreen.js` exactly as its predecessor matched the old name.
Alternative considered: an alternation that also matches `annotatr`, so `sidescreen init` would update a stale `annotatr` hook in place instead of adding a second entry.
Rejected because it keeps the old word in the code and its tests indefinitely for a migration that happens once, on one machine.
The cost is one manual deletion per project, listed in the migration plan.

### The state directory moves, with no fallback read

`defaultStateDir` returns `$XDG_STATE_HOME/sidescreen`.
Alternative considered: fall back to the old directory when the new one is absent.
Rejected for the same reason as the matcher: it is permanent code for a one-time move that a single `mv` performs.
The store format and version are untouched, so the moved file opens as is.

### Publish metadata lives in the manifest, and the allowlist stays

`package.json` gains:

- `author`: `Josef Hardi <josef.hardi@gmail.com> (https://github.com/johardi)`
- `repository`: `git+https://github.com/johardi/sidescreen.git`
- `homepage`: `https://github.com/johardi/sidescreen#readme`
- `bugs`: `https://github.com/johardi/sidescreen/issues`
- `keywords`: terms a user would search for, such as `claude-code`, `coding-agent`, `annotation`, `review`, `second-screen`, `hooks`
- `scripts.prepublishOnly`: `npm run check`

The `files` allowlist is kept over an `.npmignore`, because an allowlist fails closed when a new directory is added.
`README.md`, `LICENSE`, and `package.json` are included by npm regardless of the allowlist.
No `publishConfig` is needed for an unscoped public package.
The version stays `0.1.0`, which the manifest already declares.

### The documented install is global, and the hook keeps an absolute executable path

The README quick start becomes `npm install -g sidescreen`, `sidescreen init`, `sidescreen serve --open`.
The hook command continues to embed the absolute path of the installed `bin/sidescreen.js`.
Alternative considered: register `sidescreen ingest` and rely on PATH.
Rejected for now because Claude Code runs hooks in a shell whose PATH does not always include a version manager's global bin directory, and a hook that silently finds no command is worse than one whose path can be seen and fixed.
`npx` is discouraged in the README for the reason given in the spec: its cache is evictable, so the hook path dies without warning.

### Source and tests are grouped by module

The import graph separates into four domains with no cycles, so each becomes a directory:

```
src/
  cli.js  version.js  types.js  format.js     entry point and cross-cutting helpers
  hooks/      hook-payload  ingest  session-title  setup-hooks  init
  store/      store  mutex  sessions  turns  threads  projects  carry-back
  dispatch/   dispatch  dispatch-prompt  conventions  answer-schema.json
  web/        server  page  sidebar  render-markdown  public/
test/
  cli.test.js  helpers.js  server-helpers.js  browser-helpers.js  fixtures/
  hooks/  store/  dispatch/  web/  e2e/
```

Dependencies point one way: `web` uses `store` and `hooks`, `hooks` uses `store`, `dispatch` stands alone, and `store` uses only the root helpers.
`format.js` stays at the root because both `store` and `web` need it, and moving it into either would point a dependency the wrong way.
`carry-back.js` lives in `store` because its entries are a store record; its CLI command belongs to a hook and could split out later.
The browser code stays under `web/public/` and is still served from the directory beside `server.js`, so `PUBLIC_DIR` does not change.
Alternative considered: leaving `src/` flat.
At 32 files the flat listing no longer shows which files belong together, and every new file would face the same question.
Files are moved with `git mv` and imports are rewritten mechanically from one mapping, so the diff is renames plus import lines and nothing else.

## Risks / Trade-offs

- [The author's projects keep `annotatr` hooks that fail on every turn once the bin is renamed] → The migration plan re-runs `init` and deletes the old entries per project, and Claude Code reports a failing hook in the session, so a missed project shows itself on the first turn.
- [A global install under a Node version manager puts the executable under a versioned directory, so switching Node versions breaks the hook] → Documented in the README beside the install step: re-run `sidescreen init` after switching.
  Detecting a dead hook path automatically is recorded as a follow-up.
- [A user sets up with `npx` despite the advice] → The README states the consequence.
  The existing "no Stop hook registered" warning does not cover a registered hook with a dead path; that gap is part of the same follow-up.
- [An occurrence of the old name survives the rename] → A `git grep -i annotatr -- ':!openspec'` gate in the tasks must return nothing before the change is complete.
- [The publish guard runs the browser tests, which need Playwright's browsers installed] → Publishing happens from the author's machine, where they are installed; `npm run check` already has that requirement today.
- [Search results for "sidescreen" lead with an unrelated Swift application] → Accepted.
  The npm page, the README, and the GitHub repository carry the name in this ecosystem, and the two tools cannot be confused once found.

## Migration Plan

Author's machine, once, after the implementation passes `npm run check`:

1. Create the empty GitHub repository `johardi/sidescreen`, add it as `origin`, and push `main`, so the manifest's repository, homepage, and bugs links resolve.
2. Wait for any Claude Code session to be idle, then move the store: `mv ~/.local/state/annotatr ~/.local/state/sidescreen`.
3. In every project that ran `annotatr init`, run `sidescreen init`, then remove the `annotatr` entries from `.claude/settings.json` and delete `.claude/skills/annotatr/`.
   Find them with a search for `annotatr.js` across the projects' `.claude/settings.json` files.
4. Restart the Claude Code sessions open in those projects, because hooks are read at startup.
5. Publish: `npm login`, then `npm publish`, which runs the check first, then `git tag v0.1.0` and push the tag.
6. Install the published package globally and re-run `sidescreen init` in the same projects, so the hooks point at the installed executable instead of the checkout.
   Renaming the checkout directory can happen at this step or later, since nothing points at it afterwards.

Rollback: `npm unpublish sidescreen@0.1.0` is allowed within 72 hours of publishing; after that, publish a corrected `0.1.1`.
The rename itself is one commit and reverts cleanly, and step 2 reverses with the same `mv`.

## Open Questions

- Whether to reserve `side-screen` and `sidescreen-cli` on npm as pointers to the real package.
  Both were free on 2026-09-16.
  Deferrable: it changes nothing in this change.
- Whether to register `sidescreen.app`, the one common domain that was unclaimed.
  Deferrable for the same reason.
