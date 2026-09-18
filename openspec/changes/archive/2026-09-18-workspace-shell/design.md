## Context

See `proposal.md` for motivation and the `project-workspace` delta spec for the behaviour this design has to produce.

What exists, and what constrains the approach:

- The workspace is one CSS grid on a page that scrolls: sidebar, document pane, and thread pane in three columns, the carry-back zone in a second row under the last two, and a wrapping flex header above it all.
  The sidebar and thread pane are sticky with a viewport-high cap, which is what makes them look fixed while the page underneath scrolls.
  Measured on the live store in a 1440 by 900 window: the page is 1231px tall, the sidebar's content is 2862px tall, and the carry-back zone begins at 1051px, below the fold.
- Following reloads the page.
  When a new turn arrives in scope and the page is clean, the client calls `location.reload()`, so any layout state that lives only in the DOM is lost on every turn.
  Session collapse state already survives this in session storage.
- The content security policy is `default-src 'self'` with `img-src 'self' data:`.
  No inline script runs, no third-party stylesheet, script, or font loads, and the asset route serves only `.js` and `.css` from the public directory.
  Every page logs a not-found error for `/favicon.ico`.
- The ask popover is absolutely positioned against the page and placed with `window.scrollX` and `window.scrollY`.
  Once the page stops scrolling those are always zero, and a popover left in place while the document pane scrolls under it points at nothing.
- Browser tests run at 1200 by 800 and 400 by 800.
  The narrow test pins the stacked layout with no horizontal scroll; a wide test asserts the thread column is between 280 and 400 pixels.
- The macOS menu bar item uses the system symbol "window on rectangle" for the running state.
- The runtime dependency list is one package, `marked`, and the published package is `bin`, `menubar`, `skills`, and `src`.

## Goals / Non-Goals

**Goals:**

- The frame is fixed and only the panes scroll, at desktop width, with nothing added to the page's dependencies or origins.
- A followed reload is invisible: the layout the user set is on screen at first paint.
- Every new control is reachable and operable from the keyboard with a visible focus state.
- The narrow layout and every existing behaviour of following, removal, threads, and carry-back are untouched.

**Non-Goals:**

- Re-punctuating the sidebar's session rows or otherwise restyling content inside the panes.
- Keyboard shortcuts for the toggle and handles beyond focus and arrow keys.
- Animating the sidebar's hide and show.

## Decisions

### The shell is a grid sized to the viewport, and only three cells scroll

The body becomes a grid of three rows, header, optional warning band, and workspace, with a height of one dynamic viewport unit and hidden overflow, so the page can never scroll.
The workspace is a grid of five columns and two rows:

```
+------------+--+---------------------------+--+---------------------------+
| sidebar    |h1| document pane             |h2| thread pane               |
| rows 1..2  |  | row 1                     |  | row 1                     |
|            |  |                           |  |                           |
|            |  +---------------------------+--+---------------------------+
|            |  | carry-back zone, row 2, columns 3..5                     |
+------------+--+----------------------------------------------------------+
```

Column tracks are `var(--sidebar-column) var(--handle-column) minmax(300px, 1fr) 6px var(--thread-column)`.
Row tracks are `minmax(0, 1fr) auto`.
The sidebar and its handle span both rows, which is what lets the sidebar run beside the carry-back zone.
The sidebar, document pane, and thread pane get `min-height: 0` and `overflow-y: auto`; nothing else scrolls.
The carry-back zone caps at 40% of the viewport height and its list, not the zone, scrolls past that, so the title and form always show.

On the empty workspace, which has no thread pane and no carry-back zone, the same grid runs with three columns.

Below 760px the existing rules stay: one column, panes stacked, the body free to scroll, the sidebar capped at 40% of the viewport, handles hidden.
The breakpoint is unchanged because the narrow browser test already pins it.

Alternatives considered:

- Keeping the page scrolling and making the carry-back zone `position: fixed`.
  It would cover the end of the document and the thread pane, and the sidebar would still scroll with the page.
- Flexbox nesting instead of a grid.
  A grid expresses the sidebar spanning two rows and the carry-back zone spanning three columns without wrapper elements.

### Widths are custom properties; the thread pane is a fraction until the user sets it

The boot script and the client write two custom properties on the root element.
`--sidebar-column` is a pixel width, default 260px, or 0px when the sidebar is hidden.
`--thread-column` is `minmax(260px, 1fr)` until the user drags or keys the handle, which yields the equal split the proposal asks for, and a pixel width afterwards.
The document column is always `minmax(300px, 1fr)`, so it takes whatever the other two leave.

Limits: sidebar 180px to 480px, thread pane at least 260px, document at least 300px.
The minimums add up to 752px with both handles, so they still fit one pixel above the 760px breakpoint where the shell takes over from the stacked layout.
When the window is narrower than the stored widths allow, the client clamps the thread pane, then the sidebar, on load and on every resize.
Clamped values are not written back; the user's choice is kept for a larger window.

Alternative considered: storing the thread pane as a ratio of the workspace.
It keeps the split stable across window sizes, but a pane the user set to a comfortable reading width should keep that width, not a proportion of it.

### Handles are separators with pointer capture and arrow keys

Each handle is a focusable element with `role="separator"`, `aria-orientation="vertical"`, and a label naming the pane it sizes.
On pointer down it captures the pointer, records the pane's current pixel width, and on each move sets the property to the start width plus the pointer's travel, clamped.
During a drag the body gets `cursor: col-resize` and `user-select: none`, so the drag never selects document text.
Arrow keys move 16px per press, Home and End go to the minimum and the maximum, and a double activation restores the default.
The handle is a 6px track drawing a 1px rule in `--line`; on hover, focus, and while dragging it draws the accent instead, which is the only feedback it needs.

The thread pane's handle switches the pane from the fractional default to a pixel width on the first pointer down or key press, using the width the pane has at that moment, so the pane does not jump when the drag begins.

### Layout state lives in local storage and is applied by a blocking script before first paint

The state is one JSON record under `sidescreen:layout`: a version, the sidebar width, the thread width or null for the equal split, and the hidden flag.
Local storage rather than session storage because following reloads the page and a layout is a preference of the browser, not of the tab; the session collapse state stays in session storage as it is.

A small classic script, served with the other assets and loaded from the head without `defer` or `async`, reads the record and sets the two properties and a `data-sidebar-hidden` attribute on the root element.
A blocking head script runs before the body is laid out, so the first frame already has the user's layout and a followed reload shows no jump.
It is same-origin, so the policy allows it, and it is the only script that runs before the body exists.
Every storage access is in a try block; a failure leaves the defaults and the client keeps the state in memory for the life of the page.

Alternatives considered:

- An inline script in the head.
  Blocked by the policy without `'unsafe-inline'` or a per-response nonce, and a nonce buys nothing over a same-origin file here.
- Applying the state from the existing module script.
  Modules are deferred, so the default layout paints first and jumps on every followed reload.
- Hiding the body until the module runs.
  Trades a jump for a blank frame on every turn.

### Hiding the sidebar collapses its column and keeps the toggle where it is

Hiding sets `data-sidebar-hidden` on the root, which hides the sidebar and its handle, and zeroes the sidebar's column and its handle's column.
The sidebar's markup stays in the page and keeps refreshing on events, so following, the notice, and removal-from-elsewhere all work unchanged while it is hidden, and showing it again is one attribute.
The toggle is a button in the header after the title, with `aria-pressed` reflecting the hidden state and a label that reads "Hide sidebar" or "Show sidebar".
It keeps one position whether the sidebar is shown or hidden, which is what makes it findable without looking.

### The header is a three-column grid so the project name is truly centred

Columns `1fr auto 1fr`: the left group at the start, the project name and scope tag in the middle, the path at the end.
Equal outer tracks centre the middle cell on the window, not between two groups of unequal width.
The path is monospace, ellipsised at its end with the full path in its tooltip, because the project name beside it already shows the last segment.
The scope tag is a link to the project's follow address when the page is pinned or following one session, with a title that says it returns to following the newest turn; on a project page it is plain text.
The landing page uses the same header with the title only, since there is nothing to go back to and no sidebar.

### Icons are Font Awesome Free paths vendored as inline SVG symbols

The page opens with a hidden `<svg>` holding one `<symbol>` per icon, copied from the Font Awesome Free solid set: `arrow-left` for the back control and `table-columns` for the sidebar toggle.
Each control renders `<svg aria-hidden="true"><use href="#..."></use></svg>` and carries its label on the link or button itself.
The favicon is `window-restore` from the same set, served as `favicon.svg` from the public directory, which echoes the menu bar item's window-on-rectangle glyph.
The asset route gains `.svg` with `image/svg+xml`.

Font Awesome Free icons are CC BY 4.0: the sprite and the favicon keep Font Awesome's license comment, and the README's license section names the attribution.

Alternatives considered:

- Font Awesome from its CDN, as the site suggests.
  Blocked by the policy, and a network fetch for a local tool.
- The `@fortawesome/fontawesome-free` package as a dependency, served from the asset route.
  Several megabytes of fonts and stylesheets in the published package for three icons.
- Unicode glyphs.
  Render differently per platform and cannot be styled as one set.

### The ask popover moves into the document pane

The popover element is appended inside the document pane, which becomes the positioning context, and its coordinates are the selection's rectangle relative to the pane plus the pane's scroll offsets.
It scrolls with the text it belongs to and stays clipped to the pane, which is right: a question about a passage sits beside that passage.
In the narrow layout the pane does not scroll and its offsets are zero, so the same arithmetic holds.

Alternative considered: `position: fixed` with the popover dismissed on scroll.
Dismissing would drop a typed question when the user scrolls to check the text above.

### Design tokens, recorded so the frame and later work share one vocabulary

The change adds no colour and no typeface; it names what exists and fixes two treatments that read as defaults.

Colour, light then dark:

- Paper `#ffffff` / `#14161a`: the document, the only white surface at desktop width.
- Chrome `#f6f7f9` / `#1c1f25`: header, sidebar, thread pane, carry-back zone.
- Ink `#1c1f24` / `#e6e8ec`, and muted ink `#5b6270` / `#9aa3b2` for meta.
- Rule `#e2e5ea` / `#2a2f38`: only where two scroll regions meet, and the handles at rest.
- Signal `#2456d6` / `#7ea2ff`, with its soft tint `#e6ecfb` / `#1d2a4d`: the active turn, the scope tag, a handle in hand, focus rings, primary buttons, and the carry-back zone's top edge.
- Mark `#fff1a8` / `#ffd44d`: selection highlights, unchanged.

Type: the platform's interface face and its monospace face, since the policy forbids web fonts and bundling one would weigh down the package.
Scale: 12px meta, 13px chrome and code, 15px on 1.55 for the document at a 76ch measure, 18px for the landing title.
Two weights, regular and semibold.
Sentence case everywhere; the carry-back title loses its capitals and letter-spacing.

Layout: everything left-aligned except the project name, which is centred because it is the window's title.
Chrome surfaces are muted so the document is the one bright field, and 1px rules mark only boundaries the user can scroll across.

Principle: a quiet frame around a loud page.
The one weighted element is the carry-back zone, given a 2px signal edge along its top, because it is the only part of the surface that reaches the terminal.
No motion except what answers the hand: dragging a handle; hiding the sidebar is instant.

Reviewed against the generic defaults: the all-caps letter-spaced section title was the one present tell and goes; no card kit, no gradients, no display face, no decorative numbering are introduced.

## Risks / Trade-offs

- **A followed reload flashes the default layout.** → The blocking head script applies the stored layout before the body is laid out; a browser test reloads with a stored layout and asserts the widths in the first frame.
- **Storage is unavailable or cleared.** → Defaults apply, the client keeps state in memory, and every access is guarded, as the collapse state already is.
- **A stored width no longer fits the window.** → Clamped on load and on resize without writing back.
- **A drag test is flaky in the browser harness.** → Drags use pointer moves in steps and assert the width delta within a pixel, as the existing selection drag does.
- **The popover is clipped at the pane's edge.** → It is clamped horizontally inside the pane, and a selection at the bottom edge places it within the pane's scrollable extent, where scrolling reveals it.
- **The Font Awesome attribution is missed.** → The license comment lives inside the sprite and the favicon, and the README names it; both are checked by a test that the page source carries the comment.
- **The sidebar's scroll-into-view now scrolls the sidebar only.** → That is the intended behaviour; the page has nothing to scroll.

## Migration Plan

Nothing on disk changes: the store, the hooks, and the addresses are as before.
The only new state is a local storage record, absent until the user resizes or hides something, and harmless if left behind.
Rollback is reverting the code.

## Open Questions

- The minimum and default widths are first guesses; adjusting them changes only constants.
- Whether hiding the sidebar deserves a keyboard shortcut.
  Additive, and the toggle is reachable by tab today.
