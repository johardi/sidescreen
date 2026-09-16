import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyOf, rootOf, rootThreads } from '../src/public/thread-tree.js';

const root = { id: 'root', parentThreadId: null, createdAt: '2026-01-01T00:00:00Z' };
const branch1 = { id: 'b1', parentThreadId: 'root', createdAt: '2026-01-01T00:01:00Z' };
const branch2 = { id: 'b2', parentThreadId: 'root', createdAt: '2026-01-01T00:02:00Z' };
const nested = { id: 'b1a', parentThreadId: 'b1', createdAt: '2026-01-01T00:03:00Z' };
const other = { id: 'other', parentThreadId: null, createdAt: '2026-01-01T00:00:30Z' };
const orphan = { id: 'orphan', parentThreadId: 'gone', createdAt: '2026-01-01T00:04:00Z' };
const all = [nested, branch2, other, root, branch1, orphan];

test('rootOf follows parents to the top and stops at a missing parent', () => {
  assert.equal(rootOf(all, nested).id, 'root');
  assert.equal(rootOf(all, branch2).id, 'root');
  assert.equal(rootOf(all, root).id, 'root');
  assert.equal(rootOf(all, orphan).id, 'orphan');
});

test('familyOf lists the root first, then branches oldest first, across depth', () => {
  assert.deepEqual(familyOf(all, nested).map((t) => t.id), ['root', 'b1', 'b2', 'b1a']);
  assert.deepEqual(familyOf(all, other).map((t) => t.id), ['other']);
});

test('rootThreads returns threads with no living parent, oldest first', () => {
  assert.deepEqual(rootThreads(all).map((t) => t.id), ['root', 'other', 'orphan']);
});
