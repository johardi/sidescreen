import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES } from '../helpers.js';
import { escapeHtml, renderMarkdown } from '../../src/web/render-markdown.js';

const samplePath = join(FIXTURES, 'markdown', 'sample.md');
const snapshotPath = join(FIXTURES, 'markdown', 'sample.html');

test('rendered output matches the snapshot (set UPDATE_SNAPSHOTS=1 to rewrite)', async () => {
  const rendered = renderMarkdown(await readFile(samplePath, 'utf8'));
  if (process.env.UPDATE_SNAPSHOTS === '1') {
    await writeFile(snapshotPath, rendered, 'utf8');
  }
  const expected = await readFile(snapshotPath, 'utf8');
  assert.equal(rendered, expected);
});

test('code fences, lists, and inline code come out as their semantic elements', async () => {
  const rendered = renderMarkdown(await readFile(samplePath, 'utf8'));
  assert.match(rendered, /<pre><code class="language-js">await store\.update/);
  assert.match(rendered, /<pre><code>plain fence without a language\n<\/code><\/pre>/);
  assert.match(rendered, /<ul>\n<li><code>src\/store\.js<\/code>/);
  assert.match(rendered, /<ol>\n<li>Read the current state<\/li>/);
  assert.match(rendered, /Run <code>npm test<\/code> to verify\./);
});

test('raw HTML is escaped, never emitted as markup', () => {
  const rendered = renderMarkdown('Inline <script>alert(1)</script> here.\n\n<div onclick="x()">block</div>\n');
  assert.doesNotMatch(rendered, /<script>/);
  assert.doesNotMatch(rendered, /<div/);
  assert.match(rendered, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(rendered, /<p>&lt;div onclick=&quot;x\(\)&quot;&gt;block&lt;\/div&gt;<\/p>/);
});

test('links with non-web schemes are rendered as their text only', () => {
  const rendered = renderMarkdown('[safe](https://example.com) [bad](javascript:alert(1)) [data](data:text/html,hi) [rel](./a.md) [anchor](#x)');
  assert.match(rendered, /<a href="https:\/\/example\.com" rel="noopener">safe<\/a>/);
  assert.match(rendered, /<a href="\.\/a\.md" rel="noopener">rel<\/a>/);
  assert.match(rendered, /<a href="#x" rel="noopener">anchor<\/a>/);
  assert.doesNotMatch(rendered, /javascript:/);
  assert.doesNotMatch(rendered, /data:text/);
  assert.match(rendered, /\bbad\b/);
});

test('escapeHtml covers every character that matters in content and attributes', () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});
