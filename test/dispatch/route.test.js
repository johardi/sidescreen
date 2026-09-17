/**
 * 3.1 to 3.4: the tag, the lineage, the routing rule, and the prompt sections
 * that carry a thread across a backend switch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBackendTag } from '../../src/dispatch/backends.js';
import { routeQuestion } from '../../src/dispatch/route.js';
import { createExchange, createThread, lineageOf } from '../../src/store/threads.js';
import { EARLIER_HEADING, SINCE_HEADING, buildFollowUpPrompt, buildPrompt, describeExchanges } from '../../src/dispatch/dispatch-prompt.js';
import { sampleTurn } from '../server-helpers.js';

// ---- 3.1: the tag ------------------------------------------------------------

test('3.1 a leading @claude or @codex, in any case, names the backend and leaves the question', () => {
  assert.deepEqual(parseBackendTag('@codex why the lock?'), { backend: 'codex', question: 'why the lock?' });
  assert.deepEqual(parseBackendTag('@claude   why the lock?'), { backend: 'claude', question: 'why the lock?' });
  assert.deepEqual(parseBackendTag('@Codex why?'), { backend: 'codex', question: 'why?' });
  assert.deepEqual(parseBackendTag('@CLAUDE why?'), { backend: 'claude', question: 'why?' });
  assert.deepEqual(parseBackendTag('@codex\nwhy?'), { backend: 'codex', question: 'why?' }, 'a newline after the tag counts as whitespace');
});

test('3.1 a tag anywhere in the question routes it, as long as it stands as a word of its own', () => {
  assert.deepEqual(parseBackendTag('does @codex agree with this?'), { backend: 'codex', question: 'does agree with this?' });
  assert.deepEqual(parseBackendTag('why the lock, @claude?'), { backend: 'claude', question: 'why the lock,?' }, 'a tag before punctuation goes with its leading space');
  assert.deepEqual(parseBackendTag('why? @claude'), { backend: 'claude', question: 'why?' }, 'a tag at the end');
  assert.deepEqual(parseBackendTag('ask @CODEX.'), { backend: 'codex', question: 'ask.' });
  assert.deepEqual(parseBackendTag('first line\n@codex second line'), { backend: 'codex', question: 'first line\nsecond line' }, 'a tag after a newline');
  assert.deepEqual(parseBackendTag('@claude and @codex, compare'), { backend: 'claude', question: 'and @codex, compare' }, 'the first tag decides; the second stays');
});

test('3.1 an address, a domain, an escaped tag, or an unknown name is ordinary question text, returned unchanged', () => {
  for (const text of ['email me@codex.com', 'see @codex.com for details', 'write \\@codex literally', '@gpt why?', '@codexx why?', 'why the lock?', 'a@claude', '']) {
    assert.deepEqual(parseBackendTag(text), { backend: null, question: text }, JSON.stringify(text));
  }
});

test('3.1 a tag with nothing after it names the backend and an empty question', () => {
  assert.deepEqual(parseBackendTag('@codex'), { backend: 'codex', question: '' });
  assert.deepEqual(parseBackendTag('@claude   '), { backend: 'claude', question: '' });
});

// ---- 3.2: the lineage ---------------------------------------------------------

/**
 * @param {string} id
 * @param {import('../../src/dispatch/backends.js').Backend} backend
 * @param {'answered'|'failed'} [status]
 */
function answered(id, backend, status = 'answered') {
  const exchange = createExchange(`q ${id}`, backend, new Date('2026-01-01T00:00:00.000Z'));
  exchange.id = id;
  exchange.status = status;
  if (status === 'answered') {
    exchange.answer = { text: `a ${id}`, source: 'code', sourceDetail: `${id}.js:1` };
    exchange.subAgentSessionId = `session-${id}`;
  } else {
    exchange.error = 'boom';
  }
  return exchange;
}

/** A root with three exchanges, a branch from its second, and a branch of that branch from its first. */
function tree() {
  const turn = sampleTurn();
  const anchor = { start: { path: [0], offset: 0 }, end: { path: [0], offset: 1 }, text: 'T' };
  const root = createThread({ turn, anchor, selectedText: 'T', question: 'q r1', backend: 'claude' });
  root.exchanges = [answered('r1', 'claude'), answered('r2', 'codex'), answered('r3', 'claude')];
  const branch = createThread({ turn, anchor, selectedText: 'T', question: 'q b1', backend: 'codex', parentThreadId: root.id, branchedFromExchangeId: 'r2' });
  branch.exchanges = [answered('b1', 'codex'), answered('b2', 'codex')];
  const nested = createThread({ turn, anchor, selectedText: 'T', question: 'q n1', backend: 'claude', parentThreadId: branch.id, branchedFromExchangeId: 'b1' });
  nested.exchanges = [answered('n1', 'claude')];
  const threads = { [root.id]: root, [branch.id]: branch, [nested.id]: nested };
  return { threads, root, branch, nested };
}

test('3.2 a follow-up lineage is the thread\'s own exchanges, prefixed by its ancestry cut at each branch point', () => {
  const { threads, root, branch, nested } = tree();
  assert.deepEqual(lineageOf(threads, root).map((exchange) => exchange.id), ['r1', 'r2', 'r3']);
  assert.deepEqual(lineageOf(threads, branch).map((exchange) => exchange.id), ['r1', 'r2', 'b1', 'b2'], 'the branch never sees r3');
  assert.deepEqual(lineageOf(threads, nested).map((exchange) => exchange.id), ['r1', 'r2', 'b1', 'n1'], 'nor b2, asked after its branch point');
});

test('3.2 a branch lineage is the parent\'s lineage cut at the branched-from exchange', () => {
  const { threads, root, branch } = tree();
  assert.deepEqual(lineageOf(threads, root, 'r1').map((exchange) => exchange.id), ['r1']);
  assert.deepEqual(lineageOf(threads, root, 'r2').map((exchange) => exchange.id), ['r1', 'r2']);
  assert.deepEqual(lineageOf(threads, branch, 'b1').map((exchange) => exchange.id), ['r1', 'r2', 'b1']);
  assert.deepEqual(lineageOf(threads, branch, 'nope').map((exchange) => exchange.id), ['r1', 'r2'], 'an unknown cut keeps the ancestry only');
});

// ---- 3.3: the routing rule -------------------------------------------------------

test('3.3 a first question goes to the tag, else the default, and starts a new session with nothing prior', () => {
  assert.deepEqual(routeQuestion({ question: 'why?', lineage: [], defaultBackend: 'claude' }), { backend: 'claude', question: 'why?', target: { mode: 'new' }, priorExchanges: [], gap: [] });
  assert.equal(routeQuestion({ question: 'why?', lineage: [], defaultBackend: 'codex' }).backend, 'codex');
  assert.deepEqual(routeQuestion({ question: '@codex why?', lineage: [], defaultBackend: 'claude' }), { backend: 'codex', question: 'why?', target: { mode: 'new' }, priorExchanges: [], gap: [] });
});

test('3.3 an untagged follow-up stays with the last answer\'s backend and forks its session with an empty gap', () => {
  const lineage = [answered('r1', 'claude'), answered('r2', 'codex')];
  const route = routeQuestion({ question: 'and then?', lineage, defaultBackend: 'claude' });
  assert.equal(route.backend, 'codex', 'sticky: the default does not pull it back to claude');
  assert.deepEqual(route.target, { mode: 'fork', sessionId: 'session-r2' });
  assert.deepEqual(route.gap, []);
  assert.deepEqual(route.priorExchanges, []);
});

test('3.3 a switch with no same-backend answer cold-starts with every answered exchange as text', () => {
  const lineage = [answered('r1', 'claude'), answered('r2', 'claude', 'failed'), answered('r3', 'claude')];
  const route = routeQuestion({ question: '@codex do you agree?', lineage, defaultBackend: 'claude' });
  assert.equal(route.backend, 'codex');
  assert.equal(route.question, 'do you agree?');
  assert.deepEqual(route.target, { mode: 'new' });
  assert.deepEqual(route.priorExchanges.map((exchange) => exchange.id), ['r1', 'r3'], 'the failed exchange has nothing to say');
  assert.deepEqual(route.gap, []);
});

test('3.3 switching back forks the earlier backend\'s newest session and carries the gap', () => {
  const lineage = [answered('r1', 'claude'), answered('r2', 'codex'), answered('r3', 'codex')];
  const route = routeQuestion({ question: '@claude and NFS?', lineage, defaultBackend: 'claude' });
  assert.equal(route.backend, 'claude');
  assert.deepEqual(route.target, { mode: 'fork', sessionId: 'session-r1' });
  assert.deepEqual(route.gap.map((exchange) => exchange.id), ['r2', 'r3']);
  assert.deepEqual(route.priorExchanges, []);
});

test('3.3 a tagged branch routes on the lineage cut at its branch point, so later exchanges never reach it', () => {
  const { threads, root } = tree();
  const route = routeQuestion({ question: '@codex sideways?', lineage: lineageOf(threads, root, 'r1'), defaultBackend: 'claude' });
  assert.deepEqual(route.target, { mode: 'new' }, 'no codex answer at or before r1');
  assert.deepEqual(route.priorExchanges.map((exchange) => exchange.id), ['r1']);
  const sticky = routeQuestion({ question: 'sideways?', lineage: lineageOf(threads, root, 'r2'), defaultBackend: 'claude' });
  assert.equal(sticky.backend, 'codex', 'an untagged branch takes the backend of the answer it branches from');
  assert.deepEqual(sticky.target, { mode: 'fork', sessionId: 'session-r2' });
  assert.deepEqual(sticky.gap, []);
});

test('3.3 after a failed first answer there is nothing to continue, so an untagged follow-up uses the default and starts fresh', () => {
  const route = routeQuestion({ question: 'again?', lineage: [answered('r1', 'codex', 'failed')], defaultBackend: 'claude' });
  assert.equal(route.backend, 'claude');
  assert.deepEqual(route.target, { mode: 'new' });
  assert.deepEqual(route.priorExchanges, []);
});

// ---- 3.4: the prompt sections ---------------------------------------------------

const base = { question: 'and then?', selectedText: 'quick', message: 'The quick brown fox.', cwd: '/proj', transcriptPath: null, conventions: '', promptId: 'p1' };

test('3.4 the cold-start prompt lists earlier exchanges only when there are some, as question and answer with source', () => {
  const without = buildPrompt(base);
  assert.ok(!without.includes(EARLIER_HEADING));
  const prior = [answered('r1', 'claude'), answered('r2', 'codex')];
  const withPrior = buildPrompt({ ...base, priorExchanges: prior });
  const heading = withPrior.indexOf(EARLIER_HEADING);
  const questionHeading = withPrior.indexOf('## The question');
  assert.ok(heading >= 0 && heading < questionHeading, 'earlier exchanges come before the new question');
  assert.ok(withPrior.includes('### Exchange 1, answered by claude'));
  assert.ok(withPrior.includes('### Exchange 2, answered by codex'));
  assert.ok(withPrior.includes('Question: q r1'));
  assert.ok(withPrior.includes('Answer (source `code`, r2.js:1):'));
  assert.ok(withPrior.includes('a r2'));
  assert.ok(withPrior.includes('question and answer text only'));
});

test('3.4 the follow-up prompt gains a "since your last answer" section naming the other backend only when there is a gap', () => {
  const without = buildFollowUpPrompt({ question: 'and NFS?', selectedText: 'quick', conventions: '' });
  assert.ok(!without.includes(SINCE_HEADING));
  const gap = [answered('r2', 'codex'), answered('r3', 'codex')];
  const withGap = buildFollowUpPrompt({ question: 'and NFS?', selectedText: 'quick', conventions: '', sinceLastAnswer: gap });
  assert.ok(withGap.includes(SINCE_HEADING));
  assert.ok(withGap.includes('answered by another sub-agent (codex)'));
  assert.ok(withGap.includes('### Exchange 1, answered by codex'));
  assert.ok(withGap.includes('a r3'));
  assert.ok(withGap.indexOf(SINCE_HEADING) < withGap.indexOf('## The question'));
  const mixed = buildFollowUpPrompt({ question: 'x', selectedText: 'q', conventions: '', sinceLastAnswer: [answered('r2', 'codex'), answered('r3', 'claude')] });
  assert.ok(mixed.includes('other sub-agents (codex and claude)'));
});

test('3.4 the stripped question is what reaches the prompt', () => {
  const route = routeQuestion({ question: '@codex   why the lock?', lineage: [], defaultBackend: 'claude' });
  const prompt = buildPrompt({ ...base, question: route.question });
  assert.ok(prompt.includes('## The question\n\nwhy the lock?\n'));
  assert.ok(!prompt.includes('@codex'));
  assert.equal(describeExchanges([]), '');
});
