/**
 * Small formatting helpers shared by the pages and the API.
 */

/** @param {string} id */
export function shortId(id) {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/**
 * The last segment of a path, on either separator.
 *
 * @param {string} path
 */
export function baseName(path) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * A timestamp for people to read. Falls back to the raw text when it does not parse.
 *
 * @param {string} iso
 */
export function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The first line of a message as plain text, for turn lists.
 *
 * @param {string} markdown
 */
export function preview(markdown) {
  let line = '';
  let inFence = false;
  for (const raw of markdown.split('\n')) {
    const candidate = raw.trim();
    if (/^(```|~~~)/.test(candidate)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || candidate === '' || /^(---|\|)/.test(candidate)) continue;
    line = candidate;
    break;
  }
  const plain = line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1');
  return plain.length > 140 ? `${plain.slice(0, 137)}…` : plain;
}
