## 1. Housekeeping and icons

- [x] 1.1 Add `.playwright-mcp/` to `.gitignore`; verify that `git status` no longer lists the directory
- [x] 1.2 Vendor the Font Awesome Free solid `arrow-left` and `table-columns` paths as an inline SVG sprite at the top of the workspace and landing pages, keeping Font Awesome's license comment, and add `favicon.svg` (`window-restore`, same comment) to the public directory; extend the asset route with `.svg` as `image/svg+xml` and link the favicon from every page, the error page included; verify with server tests that `/assets/favicon.svg` answers with the SVG type and that the page source carries the license comment, and with the browser tests that no console error is logged on load
- [x] 1.3 Add the Font Awesome attribution to the README's license section; verify by reading it against the Font Awesome Free license terms

## 2. Header and scope tag

- [x] 2.1 Re-render the header: a three-column grid with the back link (icon, labelled "All projects"), the "SideScreen" title link, and the sidebar toggle at the start, the project name and scope tag centred, and the path at the end, ellipsised with the full path as its tooltip; drop the turn time and the text link; move the ingestion warning into its own band under the header; give the landing page the same header with the title only; verify with page tests on the rendered order and the absence of a time element, and with a browser test that the project name's centre is within 1px of the window's centre at 1200 and 1440 wide and that the path does not wrap
- [x] 2.2 Make the scope tag a link to the project's follow address when the scope is a session or a pinned turn, with a title saying it returns to following, and plain text on a project page; remove the "Latest" entry from the sidebar renderer and its handling from the client; verify with browser tests that activating the tag from a pinned page and from a session page moves to the project address showing the newest turn, that the tag on a project page is not a link, and that the sidebar has no "Latest"
- [x] 2.3 Style the header controls: icon size and colour, `:focus-visible` rings in the signal colour, the toggle's pressed state; verify in the browser that tabbing reaches back, title, toggle, and tag in order with a visible ring on each

## 3. The fixed shell

- [x] 3.1 Lay out the shell: the body as a grid of header, optional warning band, and workspace at one dynamic viewport height with hidden overflow; the workspace as five columns and two rows per the design, the sidebar spanning both rows, the carry-back zone in the second row across the last three columns, per-pane `overflow-y: auto` with `min-height: 0`, the three-column variant for the empty workspace, and the narrow breakpoint keeping the stacked, page-scrolling layout with handles hidden; verify with a browser test on a long turn with a long thread that the document's scroll height equals the viewport height, that the header's and carry-back zone's bounding boxes are unchanged after scrolling the document pane and the thread pane to their ends, and that the existing 400px test still passes
- [x] 3.2 Restyle the carry-back zone: sentence-case title, a 2px signal edge along its top, a cap of 40% of the viewport with the list scrolling inside it; verify with a browser test that adds enough entries to exceed the cap and asserts the form is still visible and the list scrolls
- [x] 3.3 Move the ask popover inside the document pane and position it from the selection's rectangle relative to the pane plus the pane's scroll offsets, clamped to the pane's width; verify that the existing selection tests pass and with a new test that scrolls the document pane before selecting and asserts the popover sits directly below the selection

## 4. Resizing and hiding

- [x] 4.1 Add the two handles as focusable separators with labels, and the drag behaviour: pointer capture, the pane's width at pointer down plus travel, clamping to the design's limits, `col-resize` and no text selection during the drag, and the thread pane's switch from the fractional default to pixels on first use; verify with browser tests that dragging each handle 120px changes that pane by 120px and its neighbour by the opposite amount while the third pane is unchanged, that a drag past the minimum stops at it, and that the document and thread pane are equal before any drag
- [x] 4.2 Add keyboard resizing: arrow keys in 16px steps, Home and End to the limits, and a double activation restoring the default; verify with browser tests for each
- [x] 4.3 Implement the sidebar toggle: flips the hidden attribute on the root, swaps its label between "Hide sidebar" and "Show sidebar" with `aria-pressed`, collapses the sidebar column to nothing while the sidebar keeps refreshing on events; verify with browser tests that hiding widens the document and thread pane by the sidebar's width, that showing restores it with the active turn marked, and that a turn arriving while hidden shows the new turn with the sidebar still hidden
- [x] 4.4 Clamp on window resize: shrink the thread pane, then the sidebar, to what fits, without writing the clamped values back; verify with a browser test that sets wide panes at 1440, resizes to 900 and asserts every pane visible with no page scroll, then resizes back and asserts the set widths return

## 5. Remembering the layout

- [x] 5.1 Add the blocking layout script to the public directory and load it from the head before the stylesheet: it reads the `sidescreen:layout` record, sets the two column properties and the hidden attribute on the root, and swallows every storage failure; verify with a browser test that installs an init script recording the sidebar's and thread pane's widths at the first animation frame, stores a layout, reloads, and asserts the recorded widths match the stored ones
- [x] 5.2 Write the record after every drag, key press, and toggle, and apply the same clamping on load; verify with browser tests that widths and the hidden state survive a reload and apply on another project's workspace in the same context, and that with storage made to throw the defaults apply and a drag still resizes for the life of the page

## 6. Existing tests, documentation, and review

- [x] 6.1 Update the existing tests: the wide-screen test asserts equal document and thread widths instead of the 280 to 400 range, and the workspace tests use the scope tag in place of the "Latest" control; verify that `npm test` passes
- [x] 6.2 Update `README.md`: the navigation section describes the scope tag in the header, and a new section explains resizing panes, hiding the sidebar, and that the browser remembers both; verify by reading it against the delta spec's requirements
- [x] 6.3 Review the result on screen at 1440 by 900 and 1200 by 800 in light and dark schemes against the design's tokens: header order, centred name, handles at rest and in hand, the carry-back edge, the focus rings; fix what is off and verify with screenshots saved under `.playwright-mcp/`
- [x] 6.4 Run `npm run check` and confirm lint, typecheck, and every test pass
