import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderMarkdown } from '../src/render-markdown.js';
import { AnchorError, describeRange, resolveAnchor } from '../src/public/anchor.js';
import { clearMarks, wrapRange } from '../src/public/marks.js';

const MARKDOWN = `# Title

The quick brown fox jumps over the lazy dog. Use \`store.update()\` to write **safely** here.

- first item with \`code\`
- second item

\`\`\`js
const x = 1;
\`\`\`

Last paragraph.
`;

/** A fresh document with the rendered markdown in an article. */
function setup() {
  const dom = new JSDOM('<!doctype html><html><body><article id="document"></article></body></html>');
  const document = dom.window.document;
  const root = /** @type {HTMLElement} */ (document.getElementById('document'));
  const html = renderMarkdown(MARKDOWN);
  root.innerHTML = html;
  const rerender = () => {
    root.innerHTML = html;
  };
  return { document, root, rerender };
}

/**
 * Text nodes under root in document order.
 *
 * @param {Document} document
 * @param {Element} root
 */
function textNodes(document, root) {
  /** @type {Text[]} */
  const out = [];
  const walker = document.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) out.push(/** @type {Text} */ (node));
  return out;
}

/**
 * Find the text node containing `needle` and return a range over it.
 *
 * @param {Document} document
 * @param {Element} root
 * @param {string} needle
 */
function rangeOver(document, root, needle) {
  for (const node of textNodes(document, root)) {
    const index = node.data.indexOf(needle);
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + needle.length);
    return range;
  }
  throw new Error(`no text node contains ${JSON.stringify(needle)}`);
}

test('a mid-sentence range is reconstructed from its anchor after a re-render', () => {
  const { document, root, rerender } = setup();
  const range = rangeOver(document, root, 'ick brown fo');
  const anchor = describeRange(range, root);

  assert.deepEqual(anchor.start.path, [1], 'the paragraph is the second logical child of the article');
  assert.deepEqual(anchor.end.path, [1]);
  assert.equal(anchor.start.offset, 'The qu'.length);
  assert.equal(anchor.end.offset, 'The quick brown fo'.length);
  assert.equal(anchor.text, 'ick brown fo');

  rerender();
  const resolved = resolveAnchor(anchor, root);
  assert.equal(resolved.toString(), 'ick brown fo');
  assert.notEqual(resolved.startContainer, range.startContainer, 'the re-render produced new nodes');
});

test('a range that starts inside inline code and ends in plain text round-trips', () => {
  const { document, root, rerender } = setup();
  const codeStart = rangeOver(document, root, 'update()');
  const plainEnd = rangeOver(document, root, ' to write ');
  const range = document.createRange();
  range.setStart(codeStart.startContainer, codeStart.startOffset);
  range.setEnd(plainEnd.startContainer, plainEnd.startOffset + ' to wr'.length);
  assert.equal(range.toString(), 'update() to wr');

  const anchor = describeRange(range, root);
  assert.deepEqual(anchor.start.path, [1, 0], 'start container is the <code> inside the paragraph');
  assert.equal(anchor.start.offset, 'store.'.length);
  assert.deepEqual(anchor.end.path, [1], 'end container is the paragraph');

  rerender();
  assert.equal(resolveAnchor(anchor, root).toString(), 'update() to wr');
});

test('a range spanning a paragraph and a list item round-trips', () => {
  const { document, root, rerender } = setup();
  const start = rangeOver(document, root, 'here.');
  const end = rangeOver(document, root, 'first item');
  const range = document.createRange();
  range.setStart(start.startContainer, start.startOffset);
  range.setEnd(end.startContainer, end.startOffset + 'first'.length);
  const expected = range.toString();
  const anchor = describeRange(range, root);
  assert.deepEqual(anchor.start.path, [1]);
  assert.deepEqual(anchor.end.path, [2, 0], 'the first <li> of the <ul>');
  assert.match(anchor.text, /^here\.\s+first$/);

  rerender();
  assert.equal(resolveAnchor(anchor, root).toString(), expected);
});

test('every boundary pair over the document round-trips through a re-render', () => {
  const { document, root, rerender } = setup();
  const nodes = textNodes(document, root);
  /** @type {{ anchor: import('../src/public/anchor.js').Anchor, text: string }[]} */
  const cases = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i; j < nodes.length; j += 1) {
      const startNode = nodes[i];
      const endNode = nodes[j];
      const startOffset = Math.floor(startNode.data.length / 3);
      const endOffset = i === j ? Math.max(startOffset + 1, endNode.data.length - 1) : Math.ceil(endNode.data.length / 2);
      if (endOffset > endNode.data.length) continue;
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      if (range.collapsed) continue;
      cases.push({ anchor: describeRange(range, root), text: range.toString() });
    }
  }
  assert.ok(cases.length > 20, `expected many cases, got ${cases.length}`);
  rerender();
  for (const { anchor, text } of cases) {
    assert.equal(resolveAnchor(anchor, root).toString(), text, JSON.stringify(anchor));
  }
});

test('marks are transparent: anchors ignore wrappers that already exist', () => {
  const { document, root } = setup();
  const cleanAnchor = describeRange(rangeOver(document, root, 'brown fox jumps'), root);

  // Wrap an overlapping earlier range, splitting the paragraph's text nodes.
  const marks = wrapRange(rangeOver(document, root, 'quick brown'), { 'data-thread-id': 't1' });
  assert.equal(marks.length, 1);
  assert.equal(root.querySelectorAll('mark[data-annotatr-mark]').length, 1);

  // Describing the same text on the marked-up document yields the same anchor.
  const start = rangeOver(document, root, 'brown');
  const end = rangeOver(document, root, ' fox jumps');
  const range = document.createRange();
  range.setStart(start.startContainer, start.startOffset);
  range.setEnd(end.startContainer, end.startOffset + ' fox jumps'.length);
  assert.equal(range.toString(), 'brown fox jumps');
  assert.deepEqual(describeRange(range, root), cleanAnchor);

  // Resolving on the marked-up document also lands on the same text.
  assert.equal(resolveAnchor(cleanAnchor, root).toString(), 'brown fox jumps');
});

test('wrapRange marks each text segment across elements and clearMarks restores the document', () => {
  const { document, root } = setup();
  const before = root.innerHTML;
  const start = rangeOver(document, root, 'Use ');
  const end = rangeOver(document, root, ' to write ');
  const range = document.createRange();
  range.setStart(start.startContainer, start.startOffset + 'Us'.length);
  range.setEnd(end.startContainer, end.startOffset + ' to'.length);

  const marks = wrapRange(range, { 'data-thread-id': 't1', 'data-index': '1' });
  assert.equal(marks.length, 3, 'plain text, the <code> contents, plain text');
  assert.deepEqual(
    marks.map((mark) => mark.textContent),
    ['e ', 'store.update()', ' to'],
  );
  assert.ok(marks.every((mark) => mark.getAttribute('data-thread-id') === 't1'));
  assert.equal(root.textContent, before.replace(/<[^>]+>/g, '').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&'), 'text is unchanged');

  clearMarks(root);
  assert.equal(root.innerHTML, before);
});

test('wrapping a range across blocks skips the whitespace between them', () => {
  const { document, root } = setup();
  const start = rangeOver(document, root, 'here.');
  const end = rangeOver(document, root, 'first item');
  const range = document.createRange();
  range.setStart(start.startContainer, start.startOffset);
  range.setEnd(end.startContainer, end.startOffset + 'first'.length);
  const marks = wrapRange(range, { 'data-thread-id': 't2' });
  assert.deepEqual(marks.map((mark) => mark.textContent), ['here.', 'first']);
});

test('an anchor into structure that no longer exists fails loudly', () => {
  const { root } = setup();
  assert.throws(() => resolveAnchor({ start: { path: [42], offset: 0 }, end: { path: [42], offset: 1 }, text: 'x' }, root), AnchorError);
  assert.throws(() => resolveAnchor({ start: { path: [1], offset: 0 }, end: { path: [1], offset: 10_000 }, text: 'x' }, root), AnchorError);
});

test('a range outside the root is rejected', () => {
  const { document, root } = setup();
  const range = document.createRange();
  range.selectNodeContents(document.body);
  assert.throws(() => describeRange(range, root), AnchorError);
});
