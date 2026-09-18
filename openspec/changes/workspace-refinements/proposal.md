## Why

The fixed shell from `workspace-shell` is in place, and a first review of it on screen found nine things that get in the way of using it for hours: the carry-back zone is a fixed strip that cannot hold a long conclusion, the session list carries three lines of chrome per session, a whole session cannot be removed, the thread pane scrolls its own composer away, two text buttons repeat under every answer, scrollbars are heavy, the panes have no breathing room, and there is no way to choose a colour scheme.
This change is the second pass: the same frame, with its parts shaped for reading, asking, and carrying back all day.

## What Changes

- **The carry-back zone becomes a floating composer**, in the manner of a mail client's compose window, anchored to the bottom right corner of the document pane.
  Minimized it is a bar naming the list and its pending count.
  Open it lists the pending entries above a text box; maximized it grows to most of the pane for a long conclusion.
  An entry is edited in place with one click and saved with Enter, and removed with one click.
  Enter adds a new entry, Shift+Enter breaks a line, and the button goes, the same rule the follow-up field gets below.
  The carry-back action on an answer opens the composer with the answer drafted in.
  The panel's state is remembered like the pane widths.
  It sits in the document pane's corner rather than the window's because the thread pane's bottom edge now belongs to the follow-up field.
- **The session list becomes a tree.**
  A session row is an icon and the title; collapsed, the icon gives way to a chevron and the row shows its turn count.
  Turns are one-line bullets under a vertical guide, the preview only, with the time in a tooltip.
  A menu at the row's right edge holds Follow and Remove session.
  Two sessions with the same title show their start times inline, as before.
- **A whole session can be removed**, with its turns and their threads, in the same two deliberate steps a turn takes: the menu item arms an inline confirmation that states the turn and thread counts, and the second activation removes.
  Carry-back entries survive, since the terminal session may still be running.
  A turn's own newest-turn rule stays; removing the session is how everything goes at once.
  When the session on screen is removed, the page moves to the project's follow address, or to the landing page if the project has no session left.
- **The thread pane pins its composer.**
  Thread chips, the anchored passage, and the branch tabs stay at the top, the exchanges scroll in the middle, and the follow-up field is fixed at the bottom.
  The follow-up field loses its button: Enter sends, Shift+Enter breaks a line, and the placeholder says so.
  The branch field follows the same rule, with Escape to cancel.
- **The two actions under an answer become icons**, left-aligned: carry back and branch from here, each with a tooltip and an accessible label.
- **A footer at the bottom of the sidebar** holds the hide-sidebar control, a colour-scheme switch, and the version.
  The switch cycles system, light, and dark; the choice is remembered and applied before first paint.
  The header loses its toggle and reads back arrow, title, centred name with scope tag, and path.
  When the sidebar is hidden it collapses to a narrow rail that keeps the two controls in the same corner, so showing it again is one click in the place the user left it.
- **Scrollbars are thin and quiet**: no track, a slim thumb that shows only while the pointer is over the pane or the pane is scrolling.
- **The document and thread panes get wider side margins.**

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-workspace`: the sidebar's look and its footer, hiding to a rail, the carry-back composer replacing the bottom zone in the shell requirement, the colour scheme and the composer's state joining the remembered choices, the thread pane's pinned field with Enter to send and icon actions, and session removal alongside turn removal, whose "a session never leaves the sidebar through removal" sentence now applies to turn removal only.
- `agent-output-review`: the carry-back requirement gains editing of a pending entry.

This change builds on `workspace-shell`, whose requirements it modifies, so `workspace-shell` archives first.

## Impact

Affected code:

- `src/store/turns.js` or `src/store/sessions.js`: removing a session with its turns and threads.
- `src/web/server.js`: `DELETE /api/sessions/<id>` behind the same-origin check with a `session-removed` event, and `PATCH /api/sessions/<id>/carry-back/<entry>` to edit an entry's text.
- `src/store/carry-back.js`: editing an entry.
- `src/web/page.js` and `src/web/sidebar.js`: the tree markup, the session menu, the footer with the version, the header without its toggle, the composer's markup, the extra icons in the sprite.
- `src/web/public/app.css`: the tree, the footer and rail, the composer's three states, the thread pane's column layout, icon actions, scrollbars, margins, and the colour-scheme tokens keyed on a root attribute as well as the system preference.
- `src/web/public/layout-boot.js` and `layout.js`: the theme and the composer state join the remembered record; the toggle moves to the footer.
- `src/web/public/workspace.js`: the session menu, arming and confirming session removal, leaving when the session on screen goes.
- `src/web/public/app.js`: the composer's states and editing, the pinned thread layout with scroll-to-newest, the icon actions, the buttonless follow-up and branch fields.
- Tests: browser tests for each behaviour above, server tests for the two routes, store tests for session removal and entry editing; existing tests that click the follow-up button or the carry-back add button change.
- `README.md`: the sidebar, the composer, the theme switch, and Enter to send.

Unchanged surfaces:

- Ingestion, dispatch, addressing, and following.
- What is emitted to the terminal: still only the pending entries' text.

### Non-goals

- **Reordering carry-back entries.** They are emitted oldest first, as added.
- **Renaming sessions or projects.** The harness title stands.
- **Undo for session removal.** The confirmation names what goes; the transcript on disk keeps the text.
- **Keyboard shortcuts** for the composer, the theme, or the sidebar.
- **A third theme.** System, light, dark.
