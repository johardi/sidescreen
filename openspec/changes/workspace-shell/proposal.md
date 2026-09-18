## Why

The workspace is a web page that scrolls as one long column: the header scrolls away, the carry-back zone sits below the document and is only reached by scrolling past the end of the turn, and the sidebar and thread column are sticky patches inside that scroll.
On the live store this shows at once: a 900px tall window holds a 1231px page, so the one control that reaches the terminal is off screen while the user reads.
A second screen should behave like a desktop application: a fixed frame the size of the window, with panes the user sizes, hides, and scrolls independently, so the document, the side questions, and the carry-back list are all in view at the same time.

## What Changes

- **The workspace becomes a fixed shell the size of the browser window.**
  The header, the sidebar, the document, the thread pane, and the carry-back zone are laid out inside the window with no page scrollbar.
  Only the sidebar, the document, and the thread pane scroll, each on its own.
  The header stays at the top and the carry-back zone stays at the bottom whatever the document and thread pane are scrolled to.
  The sidebar runs the full height of the shell, beside the carry-back zone rather than above it.
  The shell resizes with the window and applies at desktop widths; the narrow layout, where the panes stack and the page scrolls, is kept as it is.
- **The sidebar and the thread pane are resizable, and the sidebar can be hidden.**
  A drag handle on the sidebar's right edge and one on the thread pane's left edge set their widths.
  The document and the thread pane start at equal widths; the user's widths are remembered in the browser and restored on every page load, including the reloads that following performs.
  A toggle in the header hides the sidebar entirely and shows it again, the way the Claude desktop application does, and the hidden state is remembered the same way.
- **The header is reordered and slimmed.**
  From left to right: a back arrow that returns to the landing page, the application title "SideScreen", the sidebar toggle, the project's name centred, and the project's full path at the right edge.
  The turn's time leaves the header; it is already shown on the turn's sidebar row.
  The "All projects" link is replaced by the back arrow.
  The ingestion warning moves to a banner under the header, shown only when the hook is missing.
  Icons come from the Font Awesome Free set, vendored into the page as inline SVG because the content security policy allows no third-party origin.
- **"Latest" leaves the sidebar and its job moves to the header.**
  The scope tag beside the project's name still names what the page follows.
  When the page is pinned to a turn or following one session, the tag is the control that returns to following the project's newest turn.
  The sidebar keeps only sessions and turns, so every row of it is navigation.
- **Fixes along the way.**
  The page gets a favicon, so the browser stops logging a not-found error on every load.
  The carry-back title drops its all-caps treatment.
  The `.playwright-mcp/` directory the browser tooling writes screenshots into is ignored by git.

## Capabilities

### New Capabilities

None.
The workspace frame is what `project-workspace` already describes, and every change here is to how that frame is arranged and controlled.

### Modified Capabilities

- `project-workspace`: the requirement "Following the newest turn" changes where the return-to-following control lives, from a "Latest" entry in the sidebar to the scope tag in the header.
  The requirement "A workspace shows one project's sessions and turns" gains the header's order and content.
  New requirements cover the fixed shell, the independent scrolling of its panes, resizing the sidebar and the thread pane, hiding the sidebar, and remembering those choices across page loads.

## Impact

Affected code:

- `src/web/page.js`: the workspace shell markup, the header with its icon controls and scope tag, the warning banner, the drag handles, the inline SVG icon symbols, the favicon link, and the sidebar without "Latest".
- `src/web/public/app.css`: the shell grid, per-pane scrolling, the fixed carry-back zone, the header layout, the handles, the hidden sidebar, and the narrow-width fallback.
- A small blocking script served with the assets that applies the remembered widths and hidden state before first paint, so a followed reload does not flash the default layout.
- `src/web/public/workspace.js`: the drag, keyboard, and toggle behaviour of the handles and the sidebar, persistence in local storage, and the scope tag taking over from the sidebar's "Latest".
- `src/web/public/app.js`: the ask popover is positioned inside the scrolling document pane instead of the page, since the page no longer scrolls.
- `src/web/server.js`: the asset route serves SVG for the favicon.
- Tests: the browser tests that assert the thread column's width range, the wide and narrow layouts, and the "Latest" control change; new browser tests cover no page scroll, the fixed header and carry-back zone, resizing, hiding, and persistence across a reload.
- `README.md`: the navigation section, a short section on arranging the workspace, and the Font Awesome attribution under the license.
- `.gitignore`: the screenshot directory.

Unchanged surfaces:

- The store, the API, the event stream, ingestion, dispatch, and the carry-back mechanism.
- The address scheme and following: which address follows what, and when a page reloads or shows a notice, are as before.
- The landing page, apart from the title's casing and the favicon.

### Non-goals

- **A general re-skin.** Colours and typefaces stay; the design records a token system for what exists so later work builds on one vocabulary.
- **Web fonts.** The content security policy allows no third-party origin and bundling a face would add weight to the published package for a tool that runs beside a terminal.
  The platform's interface and monospace faces are the type system.
- **Resizing the carry-back zone.** It sizes to its content up to a cap and scrolls its list past that; a drag handle there is a follow-up if the cap proves wrong.
- **Per-project layout memory.** Widths and the hidden state are a preference of the browser, not of the project.
- **A narrow-screen shell.** Below the desktop breakpoint the panes stack and the page scrolls, as today.
- **Client-side routing.** Following still reloads the page; remembering the layout is what makes the reload invisible.
