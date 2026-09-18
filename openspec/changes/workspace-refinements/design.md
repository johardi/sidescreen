## Context

See `proposal.md` for motivation and the two delta specs for the behaviour this design has to produce.
It builds on `workspace-shell`, which must archive first.

What exists after `workspace-shell`, and what constrains the approach:

- The workspace is a fixed shell: a flex column of header, optional warning band, and a five-column grid whose tracks come from `--sidebar-column`, `--handle-column`, and `--thread-column` on the root element.
  The carry-back zone is the grid's second row under the document and thread columns.
  The document pane is `position: relative` and scrolls; the ask popover lives inside it.
- Layout state is one record in local storage, `sidescreen:layout`, applied by `layout-boot.js` before first paint and owned by `layout.js` afterwards.
  The sidebar toggle is a button in the header with `aria-pressed`.
- Colours are custom properties on `:root`, redefined once under `@media (prefers-color-scheme: dark)`.
  There is no way to choose a scheme.
- The sidebar is a list of `<details>` elements: a summary with the title and a meta line (start time, count, a Follow link), then turn rows of two lines, time and preview, each with a hover-revealed remove button and an arming state.
  The client re-renders the sidebar from `/api/projects/<id>` on every event and re-arms an in-progress confirmation across the swap.
- Turn removal is `DELETE /api/turns/<id>` behind the same-origin check; the store's `removeTurn` deletes the turn and its threads, refreshes or drops the session, and leaves carry-back alone.
  There is no session removal.
- Carry-back entries are added with `POST /api/sessions/<id>/carry-back` and removed with `DELETE .../carry-back/<entry>`; `carry-back-updated` events refresh the list.
  An entry has `text`, `threadId`, `addedAt`, and `emittedAt`; the emit marks entries sent and the page lists pending ones only.
- The thread pane renders the chips, the thread header, branch tabs, the exchanges, and a follow-up form with a button, all in one scrolling column.
  Enter already submits the follow-up and branch forms; the buttons are a second way.
- Icons are Font Awesome Free paths in an inline sprite; the version is exported by `src/version.js`.

## Goals / Non-Goals

**Goals:**

- Every new surface reads as the same instrument: the tree, the composer, the footer, and the thread pane share the shell's tokens, its one accent, and its rule of quiet chrome around a loud page.
- No new dependency, no new origin, no inline script.
- Everything remembered is remembered by the one existing record and applied by the one existing boot script.
- The store's invariants hold: carry-back is owed to the terminal and survives every removal; ingestion recreates what was removed.

**Non-Goals:**

- Touching dispatch, anchors, or the emitted text.
- Animating the composer or the tree; state changes are instant.

## Decisions

### The composer floats in the document pane's corner, in three states

The carry-back zone leaves the grid.
It becomes an `<aside>` beside the document pane inside a non-scrolling cell that occupies the pane's grid track, `position: absolute` in that cell, 16px from its bottom and right edges.
The cell is what anchors it: an element absolutely positioned inside the scrolling pane itself would travel with the content, which the first cut of this change did.
The grid loses its second row; the sidebar no longer needs to span two rows.

Three states, keyed on a `data-composer` attribute on the root element, which the stylesheet reads:

- **minimized**: the header bar alone, 320px wide in the corner: the title, the pending count, and an expand control.
- **open**: the pane's width less the 16px insets, up to 50% of the pane's height: the header, the entries, the text box.
- **maximized**: the same width, and 75% of the pane's height, taller but never the whole pane.

The second review asked for the open composer to match the document's width and for maximizing to add height only, which is what these sizes do.

The header bar is the control: clicking it opens a minimized composer, and it carries a minimize button and a maximize or restore button, in the manner of a mail client's compose window.
The state is a field in the layout record, `composer`, applied by the boot script as `data-composer` on the root so the first frame is right; the default is minimized.
The action under an answer fills the text box with the answer's plain text, opens the composer if it is minimized, and focuses the box.

Entries edit in place.
An entry's text is a button; activating it swaps in a text area with the text, Enter saves through `PATCH /api/sessions/<id>/carry-back/<entry>`, Escape restores, and leaving the field saves when the text changed.
A remove control sits at each entry's right, revealed on hover and focus, one activation, as today.
The text box at the foot adds on Enter and breaks a line on Shift+Enter; the button goes, and the placeholder says "Enter adds it".
The text box grows with its content up to the composer's room; past that it scrolls.
The entries list scrolls inside the composer when it outgrows the space above the text box.

The document pane gets 88px of bottom padding so the last line of a turn clears the minimized bar.
Below the desktop breakpoint the composer is `position: static` after the document and the padding returns to normal.

Alternatives considered:

- The window's bottom right corner, as in a mail client.
  It would cover the thread pane's follow-up field, which this change pins to that exact spot.
- The thread pane's foot.
  Two composers stacked at one edge compete for the same few hundred pixels.
- A modal.
  It blocks the reading it exists to serve.

### Editing an entry is one route and one store function

`editEntry(state, sessionId, entryId, text)` replaces a pending entry's text and says whether it did, or why not: the entry was missing, or already emitted.
The route answers 404 for a missing entry, 409 for an emitted one, 400 for empty text, and broadcasts `carry-back-updated` like the other two.
The emit reads the store at prompt time, so an edit made a second before the prompt is what travels.

### The tree keeps the `<details>` element and changes only what is drawn

Collapsing stays native: keyboard, per-tab memory, and the active session's forced expansion all keep working.
The summary becomes a row of icon, label, count, and menu button:

```
+--[icon]--Label of the session----------------------[12]--[...]--+
|  |                                                              |
|  o  First line of the newest turn, cut with an ellipsis     (2) |
|  o  First line of the next turn                                 |
|  o  First line of the oldest turn                               |
+-----------------------------------------------------------------+
```

The icon is Font Awesome's `comments`; a closed row draws `chevron-right` instead, and an open row draws `chevron-down` while hovered, which is the affordance the reference shows.
The count shows on a closed row and hides on an open one.
The menu button, `ellipsis-vertical`, shows on hover, on focus within the row, and while its menu is open.

Turn rows are one line: a hollow bullet drawn with a border, the preview, and the thread count.
The bullet fills for the active turn.
The turns list has a 1px left border in `--line`, aligned under the icon's centre, which is the guide.
The time moves into the link's tooltip and a visually hidden `<time>` for assistive technology.
The meta line goes: following moves into the menu, the count into the row, and the start time appears inline, muted, only when another session of the project has the same label, which is what keeps two same-titled sessions apart.

The menu is a small `role="menu"` popover the client renders on demand next to the button, positioned fixed from the button's rectangle so the sidebar's overflow does not clip it.
It holds "Follow this session", checked when the page follows that session, and "Remove session…".
Escape, a click elsewhere, a scroll of the sidebar, or choosing an item closes it.

### Session removal reuses the turn's two-step control and the turn's store shape

`removeSession(state, sessionId)` beside `removeTurn` deletes the session, its turns, and every thread anchored in them, returns the counts, and never touches `carryBack`.
`DELETE /api/sessions/<id>` runs it behind the same-origin check, answers 404 for an unknown session, broadcasts `session-removed` with the session id, project id, and counts, and returns `next`: the project's follow address while the project has a session left, else `/`.

On the client, choosing "Remove session…" arms the session row the way a turn row arms: a `data-armed` attribute, the menu button replaced by a confirmation reading "Remove session, 5 turns and 3 threads?", counts taken from the sidebar data the page already holds.
The same cancels apply: Escape, the pointer leaving the row, focus leaving the row, a click anywhere else.
The second activation sends the request and, when the response says the turn on screen went with it, navigates to `next`; otherwise the sidebar refreshes.
The sidebar's refresh listens for `session-removed` alongside `turn-removed`.

Ingestion recreates a removed session on its next turn, exactly as it does for a removed turn, so no tombstone is kept.

### The thread pane is a column with a scrolling middle

The pane becomes `display: flex; flex-direction: column`.
A top block holds the chips, the thread header, the branch tabs, and the lineage line, `flex: none`.
The exchanges list is `flex: 1 1 auto; min-height: 0; overflow-y: auto`.
The follow-up form is `flex: none` with a top rule.
On render, when the exchange count grew since the last render or another thread was chosen, the list scrolls so the newest exchange's question sits at its top, which reads better than landing at the end of a long answer; otherwise its scroll position is kept, since the pending-answer poll re-renders every few seconds, and whatever was typed in a field is handed back to the new field with the caret where it was.

The follow-up form is the text area alone; Enter submits, Shift+Enter breaks a line, and the placeholder says "Enter sends".
The branch form is the same, with Escape closing it, and the "Ask on a branch" and "Cancel" buttons go with the follow-up button.

Under an answered exchange the actions row is `justify-content: flex-start` and holds two icon buttons in the shell's `.icon-button` style: `reply` labelled "Carry back this answer" and `code-branch` labelled "Branch from here", the label on `title` and `aria-label`.
The existing class names stay so the tests that click them still find them.

### The footer is the sidebar's last row, and the hidden sidebar is a rail

The sidebar becomes a flex column: a scrolling region for the sessions and a footer, `flex: none`, with a top rule.
The footer holds the toggle, the scheme switch, a spacer, and the version in the small monospace face.
The toggle keeps its id and its `aria-pressed`, so what the tests and the layout module know about it holds.
Its glyph is a panel-left frame drawn in the sprite, a rounded rectangle with a divider and a short line in the narrower left pane, since Font Awesome Free has no such icon; it is the one symbol in the sprite that is not theirs.

Hidden means `--sidebar-column: 40px` instead of 0, the handle's column at 0, the scrolling region hidden, the version hidden, and the footer laid out as a column with the two buttons at its foot.
The toggle and the switch therefore never move: the corner the user reached for is the corner they find.
The header drops its toggle and returns to the four items the user first asked for.

Alternative considered: hiding the sidebar entirely and putting the toggle back in the header.
That is what `workspace-shell` did, and the footer was the user's correction of it.

### One colour-scheme choice, three values, applied with `color-scheme` and `light-dark()`

Every colour token is defined once as `light-dark(<light>, <dark>)`, and the root declares `color-scheme: light dark`.
Choosing a scheme sets `data-theme="light"` or `data-theme="dark"` on the root, whose rules set `color-scheme` to that one value; no choice means the attribute is absent and the system decides, live, as it changes.
Because `color-scheme` also drives form controls and native scrollbars, the text areas and the thin scrollbars follow the scheme without extra rules.

The choice is a `theme` field in the layout record, applied by the boot script before first paint.
The landing page and the error page load the same boot script, so the choice made in a workspace holds on every page of the surface.
The switch cycles system, light, dark; its icon is `circle-half-stroke`, `sun`, or `moon`, and its label names the state in effect and what a click does next.

Alternatives considered:

- Duplicating the dark token block under `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`.
  Works everywhere but keeps two copies of the palette that will drift.
- Resolving the scheme in script and setting the resolved value on the root.
  Needs a listener for the system's changes and leaves the page unstyled for dark if the script fails; `light-dark()` does both in CSS.

`light-dark()` has been in every major browser since mid-2024, and this is a tool run beside a current terminal.
A first plain declaration of each token stands as the fallback for anything older, which then renders light.

### Scrollbars are thin, trackless, and shown by hover

Every scrolling region sets `scrollbar-width: thin` and `scrollbar-color: transparent transparent`, and on hover `scrollbar-color: var(--scroll-thumb) transparent`, where the thumb is a translucent ink in either scheme.
The WebKit pseudo-elements get the same treatment for browsers that still use them.
Showing the thumb only while the pointer is over the region is what "hidden when not used" means in CSS today; a scroll-triggered reveal without hover would need script to toggle a class on scroll, and the hover rule covers the moment a user reaches for the bar.

### Margins

The document pane's side padding grows from 16px to 64px, and its article narrows from a 76ch to a 66ch centred column, so on a wide pane the text sits well clear of either edge.
The thread pane's top block and exchanges share a centred 72ch column with at least 60px at each side, applied as padding on each part so the rule between them still runs the pane's full width; the follow-up field sits on the same column but may come within 20px of the pane's edges, so the box reads wider than the text above it, and the empty state's one line is centred in the pane.
The second review set the widths from a screenshot at 1871px wide, where the document's text measured 66 characters and the thread's 72, each about 80px from its pane's edges; later reviews tuned the thread's minimum margin to 60px and the field's to 20px by hand.

### Tokens added

- `--scroll-thumb`: `light-dark(rgba(28, 31, 36, 0.28), rgba(230, 232, 236, 0.28))`.
- `--rail-width`: 40px.
- `--shadow-float`: the popover's shadow, now shared with the composer, the one floating surface pair on the page.
- The composer keeps the 2px signal edge on its header bar, so the one weighted element of the shell stays the one that reaches the terminal.
- `--serif`: a text serif the platform ships, `Charter, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, Cambria, "Noto Serif", "DejaVu Serif", serif`, never Times, for the two regions where an agent wrote: the document and the answer bodies, both at 16px on 1.6.
  Everything the user writes or the interface says stays in the interface face, so the reader tells the agent's voice from their own and from the chrome at a glance.
  Code inside either region stays monospace.

### The default split favours the document

Read on a wide screen, the equal split left the document cramped beside a thread pane with room to spare, so the grid's document track is `minmax(300px, 1.4fr)` against the thread pane's `minmax(260px, 1fr)`: seven parts to five until the user drags a handle, and again when a double activation restores the default.
The layout module still writes the thread pane's fractional track; only the document's weight changed, in the stylesheet.

### The sent note is a moment, not a tally

The composer's "sent to the terminal" note used to count every entry ever emitted, so it grew for the life of the session and said nothing about what had just happened.
It now names the latest batch, the entries that share the newest emit timestamp, and shows for 30 seconds after that emit, then clears itself on a timer.
The count comes from the store, so a reload within the window still shows it; nothing new is persisted.

Reviewed against the shell's principle of quiet chrome: the meta line, four text buttons, and a fixed strip leave the page; one floating card and a row of icons arrive.

## Risks / Trade-offs

- **The composer covers the document's lower right.** → 88px of bottom padding keeps the last line readable; the default state is the bar; the document column is centred at 76ch so on wide panes the composer sits in the margin.
- **A menu popover is clipped by the sidebar's overflow.** → Positioned fixed from the button's rectangle and closed on the sidebar's scroll.
- **The exchanges list re-renders while the user is reading an earlier answer.** → Scroll position is kept unless an exchange was added.
- **An edit races the emit.** → The route refuses to edit an emitted entry with 409 and the client refreshes the list from the response.
- **A session is removed while its terminal is mid-turn.** → Its next turn recreates it, by the same rule turns follow, and its carry-back is untouched.
- **`light-dark()` unsupported.** → The plain first declaration renders light; nothing breaks.
- **The rail's 40px changes every width calculation.** → The layout module's fitting already treats the sidebar column as a variable; hidden becomes 40px in one place.
- **Tests that clicked the removed buttons.** → They press Enter instead, which is the behaviour under test.

## Migration Plan

Nothing on disk changes.
The layout record gains `composer` and `theme`; an older record is read with defaults for both.
`workspace-shell` archives before this change, since this delta modifies four of its requirements.
Rollback is reverting the code.

## Open Questions

- The composer's three sizes are first guesses, adjustable as constants.
- Whether the rail should also show the pending carry-back count as a badge.
  Additive; the composer bar already shows it.
