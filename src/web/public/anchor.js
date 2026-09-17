/**
 * Range anchors: a serializable description of a text range within a rendered document.
 *
 * A boundary is a path of element-child indices from the document root to a
 * container element, plus a character offset into that container's text. It
 * is not an offset into the whole document, so an edit far away does not move
 * it, and it survives a re-render of the same markdown.
 *
 * The <mark> wrappers sidescreen adds are "transparent": their children count
 * as their parent's, so anchors computed on a marked-up document equal those
 * computed on the clean one.
 *
 * This module runs in the browser and in Node with a DOM implementation.
 *
 * @typedef {object} Boundary
 * @property {number[]} path Element-child indices from the document root to the container.
 * @property {number} offset Character offset within the container's text.
 *
 * @typedef {object} Anchor
 * @property {Boundary} start
 * @property {Boundary} end
 * @property {string} text The anchored text at capture time.
 */

export const MARK_ATTRIBUTE = 'data-sidescreen-mark';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const SHOW_TEXT = 4;

export class AnchorError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'AnchorError';
  }
}

/**
 * Whether a node is one of sidescreen's own wrappers, to be looked through.
 *
 * @param {Node} node
 * @returns {boolean}
 */
export function isTransparent(node) {
  return node.nodeType === ELEMENT_NODE && /** @type {Element} */ (node).hasAttribute(MARK_ATTRIBUTE);
}

/**
 * Describe a live range as an anchor.
 *
 * @param {Range} range
 * @param {Element} root
 * @returns {Anchor}
 */
export function describeRange(range, root) {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    throw new AnchorError('Range is not inside the document root');
  }
  return {
    start: describeBoundary(range.startContainer, range.startOffset, root),
    end: describeBoundary(range.endContainer, range.endOffset, root),
    text: range.toString(),
  };
}

/**
 * Describe one range boundary.
 *
 * @param {Node} node
 * @param {number} offset
 * @param {Element} root
 * @returns {Boundary}
 */
export function describeBoundary(node, offset, root) {
  const container = containerOf(node, root);
  const measure = ownerDocument(root).createRange();
  measure.setStart(container, 0);
  measure.setEnd(node, offset);
  return { path: pathTo(container, root), offset: measure.toString().length };
}

/**
 * Turn an anchor back into a live range on the current document.
 *
 * @param {Anchor} anchor
 * @param {Element} root
 * @returns {Range}
 * @throws {AnchorError} When the document no longer has the anchored structure.
 */
export function resolveAnchor(anchor, root) {
  const start = resolveBoundary(anchor.start, root, 'start');
  const end = resolveBoundary(anchor.end, root, 'end');
  const range = ownerDocument(root).createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/**
 * Locate a boundary as a text node and offset.
 *
 * At a seam between two text nodes, a start boundary prefers the later node
 * and an end boundary the earlier one, so the range hugs its text.
 *
 * @param {Boundary} boundary
 * @param {Element} root
 * @param {'start'|'end'} side
 * @returns {{ node: Node, offset: number }}
 */
export function resolveBoundary(boundary, root, side) {
  const container = elementAtPath(boundary.path, root);
  const walker = ownerDocument(root).createTreeWalker(container, SHOW_TEXT);
  let consumed = 0;
  /** @type {Text|null} */
  let last = null;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = /** @type {Text} */ (node);
    const length = text.data.length;
    const inside = boundary.offset < consumed + length;
    const atEnd = boundary.offset === consumed + length;
    if (inside || (atEnd && side === 'end')) {
      return { node: text, offset: boundary.offset - consumed };
    }
    consumed += length;
    last = text;
  }
  if (boundary.offset === consumed) {
    return last === null ? { node: container, offset: 0 } : { node: last, offset: last.data.length };
  }
  throw new AnchorError(`Offset ${boundary.offset} is past the end of the container's text (${consumed})`);
}

/**
 * Follow a path of logical child indices from the root.
 *
 * @param {number[]} path
 * @param {Element} root
 * @returns {Element}
 */
export function elementAtPath(path, root) {
  let current = root;
  for (const index of path) {
    const next = logicalChildren(current)[index];
    if (next === undefined) throw new AnchorError(`No element at path ${path.join('/')}`);
    current = next;
  }
  return current;
}

/**
 * Element children, looking through transparent wrappers.
 *
 * @param {Element} element
 * @returns {Element[]}
 */
export function logicalChildren(element) {
  /** @type {Element[]} */
  const out = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType !== ELEMENT_NODE) continue;
    const childElement = /** @type {Element} */ (child);
    if (isTransparent(childElement)) out.push(...logicalChildren(childElement));
    else out.push(childElement);
  }
  return out;
}

/**
 * Nearest non-transparent element containing the node, or the root.
 *
 * @param {Node} node
 * @param {Element} root
 * @returns {Element}
 */
function containerOf(node, root) {
  /** @type {Node|null} */
  let current = node.nodeType === ELEMENT_NODE ? node : node.parentNode;
  while (current !== null && current !== root && (current.nodeType !== ELEMENT_NODE || isTransparent(current))) {
    current = current.parentNode;
  }
  if (current === null) throw new AnchorError('Node is not inside the document root');
  return /** @type {Element} */ (current);
}

/**
 * @param {Element} element
 * @param {Element} root
 * @returns {Element}
 */
function logicalParent(element, root) {
  /** @type {Node|null} */
  let parent = element.parentNode;
  while (parent !== null && parent !== root && isTransparent(parent)) parent = parent.parentNode;
  if (parent === null || parent.nodeType !== ELEMENT_NODE) throw new AnchorError('Element is not inside the document root');
  return /** @type {Element} */ (parent);
}

/**
 * @param {Element} element
 * @param {Element} root
 * @returns {number[]}
 */
function pathTo(element, root) {
  /** @type {number[]} */
  const path = [];
  let current = element;
  while (current !== root) {
    const parent = logicalParent(current, root);
    const index = logicalChildren(parent).indexOf(current);
    if (index < 0) throw new AnchorError('Element is not a logical child of its parent');
    path.unshift(index);
    current = parent;
  }
  return path;
}

/**
 * @param {Node} node
 * @returns {Document}
 */
function ownerDocument(node) {
  const doc = node.nodeType === 9 ? /** @type {Document} */ (/** @type {unknown} */ (node)) : node.ownerDocument;
  if (doc === null) throw new AnchorError('Node has no document');
  return doc;
}

export { TEXT_NODE };
