/**
 * Markdown rendering for turn documents and answers.
 *
 * Raw HTML in the source is escaped rather than passed through, and links
 * with non-web schemes are rendered as plain text. The agent's output is
 * trusted enough to read, not enough to execute.
 */

import { Marked } from 'marked';

const SAFE_LINK_SCHEMES = /^(?:https?:|mailto:|#|\/|\.{1,2}\/|[^:]*$)/i;

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html(token) {
      const escaped = escapeHtml(token.text.replace(/\n+$/, ''));
      return token.block ? `<p>${escaped}</p>\n` : escaped;
    },
    link(token) {
      const inner = this.parser.parseInline(token.tokens);
      if (!SAFE_LINK_SCHEMES.test(token.href)) return inner;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<a href="${escapeHtml(token.href)}"${title} rel="noopener">${inner}</a>`;
    },
  },
});

/**
 * Render markdown to HTML.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function renderMarkdown(markdown) {
  return marked.parse(markdown, { async: false });
}

/**
 * Escape text for inclusion in HTML content or attribute values.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
