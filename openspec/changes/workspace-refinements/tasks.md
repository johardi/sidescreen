## 1. Store and API

- [x] 1.1 Add `editEntry` to the carry-back store (replaces a pending entry's text, false for a missing or emitted entry) and `PATCH /api/sessions/<id>/carry-back/<entry>` answering 400 for empty text, 404 for a missing entry, 409 for an emitted one, and broadcasting `carry-back-updated`; verify with store tests for the pending and emitted cases and server tests for each status, including that an emit after an edit prints the edited text only
- [x] 1.2 Add `removeSession` beside `removeTurn` (deletes the session, its turns, and every thread anchored in them, returns the counts, leaves carry-back alone) and `DELETE /api/sessions/<id>` behind the same-origin check, answering 404 for an unknown session, broadcasting `session-removed` with session id, project id, and counts, and returning `next` as the project's follow address while the project has a session left, else `/`; verify with store tests for each outcome and server tests for success, unknown session, a cross-origin request answered 403, both `next` values, and a turn ingested afterwards recreating the session

## 2. Tokens, colour scheme, scrollbars, margins

- [x] 2.1 Define every colour token once with `light-dark()`, declare `color-scheme: light dark` on the root with `data-theme` rules narrowing it, add the `--scroll-thumb`, `--rail-width`, and `--shadow-float` tokens, and have the boot script and the layout module apply the record's `theme` field as `data-theme`; verify with browser tests that a seeded dark theme renders the dark background with the client module blocked, that no choice follows the emulated system scheme and changes with it, and that the light fallback declarations precede each `light-dark()` value in the stylesheet
- [x] 2.2 Style every scrolling region with `scrollbar-width: thin` and a transparent thumb that takes `--scroll-thumb` on hover, plus the WebKit equivalents, and widen the document pane's side padding to 40px and the thread pane's to 24px; verify with a browser test on the computed scrollbar and padding values and that the 400px layout test still passes

## 3. Sidebar: tree, footer, rail, menu

- [x] 3.1 Extend the sidebar data with a per-session flag for a label shared with another session of the project, and pass the version into the workspace page; verify with unit tests on the presenter for shared and unique labels
- [x] 3.2 Render the tree: a summary row of icon or chevron, label, optional inline start time, count shown only when collapsed, and a menu button; one-line turn rows with a hollow bullet, the preview, the thread count, the time in the link's tooltip and a visually hidden time element; a guide line under the icon's centre; drop the meta line and the Follow link; verify with browser tests that an expanded session shows the icon and three one-line rows under a guide, that a collapsed one shows a chevron and its count, that same-titled sessions show start times inline, and that the active turn's bullet is filled
- [x] 3.3 Move the toggle into a sidebar footer with the colour-scheme switch and the version, make the hidden sidebar a 40px rail that keeps both controls at its foot, drop the toggle from the header, and update the layout module's fitting and the boot script for the rail width; verify with browser tests that the header holds four items in order, that the footer holds toggle, switch, and version, that hiding leaves a 40px rail with a working toggle, that a followed reload keeps the rail, and that the shell tests' width arithmetic holds with the rail
- [x] 3.4 Implement the colour-scheme switch: cycles system, light, dark, swaps its icon and label, writes `theme` to the record; verify with browser tests that each click changes the rendered background and label, that the choice survives a reload, and that the switch works on the rail
- [x] 3.5 Implement the session menu and session removal: a fixed-positioned menu with "Follow this session" (checked when followed) and "Remove session…", closing on Escape, outside click, item choice, or sidebar scroll; arming the row with a confirmation naming the turn and thread counts, the same cancels as turns, the request on the second activation, and navigation to `next` when the turn on screen went with it; the sidebar refresh listening for `session-removed`; verify with browser tests for two activations removing a five-turn session with three threads, one activation then Escape, one then pointer leaving, carry-back surviving, the page moving to the project address when its session goes, and to the landing page when the project's only session goes

## 4. Thread pane

- [x] 4.1 Lay the thread pane out as a column: a fixed top block of chips, header, tabs, and lineage; the exchanges scrolling in the middle; the follow-up form fixed at the foot with a top rule; scroll the exchanges to the end when an exchange was added and keep the position otherwise; verify with browser tests that a long thread keeps the chips and the field in view while the exchanges scroll, that a sent follow-up scrolls into view, and that a poll re-render leaves the scroll position alone
- [x] 4.2 Remove the follow-up and branch buttons: Enter sends, Shift+Enter breaks a line, Escape closes the branch field, and the placeholders say so; verify with browser tests for each key and update the existing tests that clicked the buttons or asserted the old placeholder
- [x] 4.3 Replace the two text actions under an answer with left-aligned icon buttons carrying `title` and `aria-label`, keeping the existing class names; verify with a browser test that both controls sit at the answer's left edge with the expected labels and that the existing tests that click them still pass

## 5. The carry-back composer

- [x] 5.1 Render the composer as an aside inside the document pane with three states on a `data-state` attribute, the header bar with title, pending count, minimize and maximize or restore controls, and clicking the bar opening it; apply the record's `composer` field from the boot script as `data-composer` on the root and write it on every change; add 88px of bottom padding to the document pane and make the composer static below the desktop breakpoint; verify with browser tests that the default is a bar with the count, that open and maximized have the designed sizes within the pane, that the state survives a reload from the first frame, that the page still has no scrollbar and the document's last line clears the bar, and that at 400px the composer follows the document
- [x] 5.2 Implement entries and the text box in the composer: entries scroll inside it, an entry's text edits in place with Enter saving through the new route, Escape restoring, and blur saving a change, a remove icon control on hover and focus, and a text box that grows with its content, adds on Enter, and breaks a line on Shift+Enter, with no button; verify with browser tests for edit, cancel, blur, remove, and add, and update the existing carry-back tests that clicked the add button
- [x] 5.3 Make the carry-back action under an answer fill the text box with the answer's plain text, open the composer when minimized, and focus the box; verify with a browser test from a minimized composer

## 6. Documentation and review

- [x] 6.1 Update `README.md`: the tree and its menu, removing a session, the composer and editing entries, the colour-scheme switch and the footer, Enter to send; verify by reading it against both delta specs
- [x] 6.2 Review on screen at 1440 by 900 and 1200 by 800, light and dark, with the composer in each state, the sidebar shown and as a rail, a menu open, and a long thread; fix what is off and keep the screenshots under `.playwright-mcp/`
- [x] 6.3 Run `npm run check` and confirm lint, typecheck, and every test pass

## 7. Second review

- [x] 7.1 Widen the reading margins: the document pane's side padding to 64px with the article narrowed to a centred 66ch column, and the thread pane's top block, exchanges, and field on a centred 72ch column with at least 40px at each side; verify with the browser test on computed padding at 1200 wide and a check at 1871 wide that both columns sit about 80px from their pane's edges
- [x] 7.2 Reword: the composer's text box placeholder to "Enter a conclusion in your own words…", its hint to "Send these lines back to the terminal, as context on your next prompt. Once sent, they leave this list.", the follow-up field's placeholder to "Ask a follow-up…", and the ask popover's to "Ask about this…"; verify with the browser tests that assert each placeholder
- [x] 7.3 Replace the sidebar toggle's icon with a panel-left glyph drawn in the sprite (a rounded frame with a divider and a short line in the narrower left pane), ours rather than Font Awesome's; verify with a browser test that the toggle references the new symbol
- [x] 7.4 Load the layout boot script on the landing page and the error page too, so the chosen colour scheme applies there; verify with a browser test that a remembered dark scheme renders the landing page dark and a server test that both pages carry the script
- [x] 7.5 Size the composer to the document pane: open and maximized span the pane's width with 16px insets, open up to 50% of the pane's height, maximized a fixed 75%, the minimized bar unchanged in the corner; verify with the browser tests on the composer's boxes in each state
- [x] 7.6 Remove the Cancel and Ask buttons from the ask popover, leaving Escape and Enter; verify with a browser test that the popover has no buttons, Escape closes it, and Enter still asks
- [x] 7.7 Review on screen at 1440 by 900 and 1871 by 868, then run `npm run check` and confirm lint, typecheck, and every test pass

## 8. Third review

- [x] 8.1 Make the composer's sent note name the latest batch only, entries that share one emit timestamp, and show it for 30 seconds after that emit, then clear it; verify with a browser test that two emits show the second batch's count rather than the total, that a reload within the window still shows it, and that a batch backdated past the window shows nothing
- [x] 8.2 Set a platform serif face on the document and on the answer bodies only, sized 16px on 1.6 and 15px on 1.6, with code inside them still monospace; verify with a browser test that those two regions render in the serif stack and that the question, the follow-up field, the ask popover, the carry-back text box, the answer's source line, and the anchor numbers keep the interface face
- [x] 8.3 Run `npm run check` and confirm lint, typecheck, and every test pass

## 9. The default split

- [x] 9.1 Weight the document's grid track at 1.2fr against the thread pane's 1fr so the default split is six to five, add the MODIFIED resizable requirement with its default-split scenario, and update the tests that expected equal widths; verify with the browser tests that a fresh workspace and a double-activated thread handle both show the document a fifth wider, and run `npm run check`
