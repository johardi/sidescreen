/**
 * What the sidebar shows for one project: its sessions, each with its turns,
 * in one shape the page renders on the server and the client refetches.
 */

import { preview } from '../format.js';
import { sessionPath, turnPath } from '../store/projects.js';
import { sessionLabel, sessionsIn } from '../store/sessions.js';
import { turnsForSession } from '../store/turns.js';

/** @typedef {import('../types.js').State} State */
/** @typedef {import('../store/projects.js').Project} Project */

/**
 * @typedef {object} SidebarTurn
 * @property {string} promptId
 * @property {string} sessionId
 * @property {string} receivedAt
 * @property {string} preview First line of the message as plain text.
 * @property {number} threadCount
 * @property {string} href The turn's pinned address.
 */

/**
 * @typedef {object} SidebarSession
 * @property {string} sessionId
 * @property {string|null} title
 * @property {string} label The title, or the start time until there is one.
 * @property {string} startedAt
 * @property {string} lastTurnAt
 * @property {string|null} latestPromptId
 * @property {string} href The session's follow address.
 * @property {SidebarTurn[]} turns Newest first.
 */

/**
 * @typedef {object} Sidebar
 * @property {Project} project
 * @property {string|null} latestPromptId The project's newest turn across its sessions.
 * @property {SidebarSession[]} sessions Latest turn first.
 */

/**
 * @param {State} state
 * @param {Project} project
 * @returns {Sidebar}
 */
export function presentSidebar(state, project) {
  /** @type {Map<string, number>} */
  const threadCounts = new Map();
  for (const thread of Object.values(state.threads)) {
    threadCounts.set(thread.promptId, (threadCounts.get(thread.promptId) ?? 0) + 1);
  }
  const sessions = sessionsIn(state, project.cwd).map((session) => {
    const turns = turnsForSession(state, session.sessionId).map((turn) => ({
      promptId: turn.promptId,
      sessionId: turn.sessionId,
      receivedAt: turn.receivedAt,
      preview: preview(turn.message),
      threadCount: threadCounts.get(turn.promptId) ?? 0,
      href: turnPath(project.id, turn.sessionId, turn.promptId),
    }));
    return {
      sessionId: session.sessionId,
      title: session.title,
      label: sessionLabel(session),
      startedAt: session.startedAt,
      lastTurnAt: session.lastTurnAt,
      latestPromptId: turns[0]?.promptId ?? null,
      href: sessionPath(project.id, session.sessionId),
      turns,
    };
  });
  return { project, latestPromptId: sessions[0]?.latestPromptId ?? null, sessions };
}
