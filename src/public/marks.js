/**
 * Inline marks: <mark> wrappers around the text of an anchored range.
 *
 * Wrapping splits text nodes but never changes the document's text, and
 * every wrapper carries the transparency attribute so anchors ignore it.
 */

import { MARK_ATTRIBUTE, TEXT_NODE } from './anchor.js';

const SHOW_TEXT = 4;

/**
 * Wrap each text segment of `range` in a <mark> with the given attributes.
 *
 * @param {Range} range
 * @param {Record<string, string>} attributes
 * @returns {HTMLElement[]} The marks created, in document order.
 */
export function wrapRange(range, attributes) {
  const doc = range.startContainer.ownerDocument;
  if (doc === null) return [];
  /** @type {HTMLElement[]} */
  const marks = [];
  for (const { node, start, end } of textSegments(range)) {
    let target = node;
    if (end < node.data.length) node.splitText(end);
    if (start > 0) target = node.splitText(start);
    const mark = doc.createElement('mark');
    mark.setAttribute(MARK_ATTRIBUTE, '');
    for (const [name, value] of Object.entries(attributes)) mark.setAttribute(name, value);
    target.parentNode?.insertBefore(mark, target);
    mark.appendChild(target);
    marks.push(mark);
  }
  return marks;
}

/**
 * Remove every mark under root and merge the text back together.
 *
 * @param {Element} root
 */
export function clearMarks(root) {
  for (const mark of Array.from(root.querySelectorAll(`mark[${MARK_ATTRIBUTE}]`))) {
    const parent = mark.parentNode;
    if (parent === null) continue;
    while (mark.firstChild !== null) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
  root.normalize();
}

/**
 * The text-node segments a range covers, skipping whitespace-only runs
 * between blocks so highlights do not bleed into the gaps.
 *
 * @param {Range} range
 * @returns {{ node: Text, start: number, end: number }[]}
 */
function textSegments(range) {
  const common = range.commonAncestorContainer;
  if (common.nodeType === TEXT_NODE) {
    const node = /** @type {Text} */ (common);
    return range.startOffset < range.endOffset ? [{ node, start: range.startOffset, end: range.endOffset }] : [];
  }
  const doc = common.ownerDocument;
  if (doc === null) return [];
  /** @type {{ node: Text, start: number, end: number }[]} */
  const segments = [];
  const walker = doc.createTreeWalker(common, SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const text = /** @type {Text} */ (node);
    const start = text === range.startContainer ? range.startOffset : 0;
    const end = text === range.endContainer ? range.endOffset : text.data.length;
    if (start >= end) continue;
    if (text.data.slice(start, end).trim() === '') continue;
    segments.push({ node: text, start, end });
  }
  return segments;
}
