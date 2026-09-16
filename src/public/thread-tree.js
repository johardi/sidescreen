/**
 * Thread families: a root thread and the branches that descend from it.
 * Pure functions over plain objects, shared by the server and the browser.
 *
 * @typedef {object} ThreadNode
 * @property {string} id
 * @property {string|null} parentThreadId
 * @property {string} createdAt
 */

/**
 * The root of a thread's family.
 *
 * @template {ThreadNode} T
 * @param {T[]} threads
 * @param {T} thread
 * @returns {T}
 */
export function rootOf(threads, thread) {
  const byId = new Map(threads.map((candidate) => [candidate.id, candidate]));
  const seen = new Set();
  let current = thread;
  while (current.parentThreadId !== null && !seen.has(current.id)) {
    const parent = byId.get(current.parentThreadId);
    if (parent === undefined) break;
    seen.add(current.id);
    current = parent;
  }
  return current;
}

/**
 * Every thread in the same family, root first, then branches oldest first.
 *
 * @template {ThreadNode} T
 * @param {T[]} threads
 * @param {T} thread
 * @returns {T[]}
 */
export function familyOf(threads, thread) {
  const root = rootOf(threads, thread);
  return threads
    .filter((candidate) => rootOf(threads, candidate).id === root.id)
    .sort((a, b) => (a.id === root.id ? -1 : b.id === root.id ? 1 : a.createdAt.localeCompare(b.createdAt)));
}

/**
 * Threads that are not branches of another, oldest first.
 *
 * @template {ThreadNode} T
 * @param {T[]} threads
 * @returns {T[]}
 */
export function rootThreads(threads) {
  const ids = new Set(threads.map((thread) => thread.id));
  return threads
    .filter((thread) => thread.parentThreadId === null || !ids.has(thread.parentThreadId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
