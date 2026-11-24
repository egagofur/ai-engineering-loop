import { escapeHtml, formatElapsed, FINISHED_RUN_STATES, stageLabel, waitingLabel } from './list.js';

const OUTCOMES = {
  passed: 'Passed',
  done: 'Served',
  back: 'Sent back',
  cooking: 'Cooking',
  escalated: 'Escalated',
  cancelled: 'Cancelled'
};

const SUMMARY_ORDER = ['cooking', 'back', 'passed', 'done', 'escalated', 'cancelled'];

export function orderOutcome(run) {
  if (!run) return 'cooking';
  if (run.state === 'CANCELLED') return 'cancelled';
  if (run.state === 'ESCALATED' || run.verdict === 'ESCALATE') return 'escalated';
  if (run.verdict === 'PASS') return 'passed';
  if (run.state === 'REPORTED' || run.state === 'DELIVERED') return 'done';
  if (run.verdict === 'ITERATE') return 'back';
  return 'cooking';
}

export function orderSummary(runs) {
  const counts = {};
  for (const run of runs || []) {
    const outcome = orderOutcome(run);
    counts[outcome] = (counts[outcome] || 0) + 1;
  }
  return SUMMARY_ORDER.filter((outcome) => counts[outcome]).map((outcome) => `${counts[outcome]} ${OUTCOMES[outcome].toLowerCase()}`).join(' · ');
}

const STAMPS = {
  passed: 'Passed',
  done: 'Served',
  back: 'Sent back',
  cooking: 'Cooking',
  escalated: 'Escalated',
  cancelled: 'Void'
};

function orderRow(run, index, total) {
  const outcome = orderOutcome(run);
  const ago = formatElapsed(run.elapsedMs);
  const meta = [run.worktree ? 'worktree' : '', run.iteration > 1 ? `iteration ${run.iteration}` : '', ago === 'just now' ? ago : `${ago} ago`].filter(Boolean).join(' · ');
  return `<li class="order" data-outcome="${outcome}"${run.current ? ' aria-current="true"' : ''}>`
    + `<span class="order-no" aria-hidden="true">No. ${total - index}</span>`
    + `<span class="order-main"><b class="order-task">${escapeHtml(run.task || 'Untitled order')}</b>`
    + `<span class="order-meta">${run.current ? '<span class="order-now">On the pass now</span> · ' : ''}${escapeHtml(meta)}</span></span>`
    + `<span class="order-stamp" title="${OUTCOMES[outcome]}">${STAMPS[outcome]}</span></li>`;
}

function tally(list) {
  const counts = {};
  for (const run of list) counts[orderOutcome(run)] = (counts[orderOutcome(run)] || 0) + 1;
  return SUMMARY_ORDER.filter((outcome) => counts[outcome])
    .map((outcome) => `<li data-outcome="${outcome}"><span class="tally-count">${counts[outcome]}</span> ${OUTCOMES[outcome].toLowerCase()}</li>`).join('');
}

export function renderOrders(runs, { projectName = '', loading = false, error = null } = {}) {
  const list = Array.isArray(runs) ? runs : [];
  let right;
  if (loading) right = '<p class="order-empty">Leafing through the pages…</p>';
  else if (error) right = `<p class="order-empty">Could not read the order book: ${escapeHtml(error)}</p>`;
  else if (!list.length) right = '<p class="order-empty">No orders written yet.</p>';
  else right = `<ol class="orders" aria-label="Recent Runs, newest first">${list.map((run, index) => orderRow(run, index, list.length)).join('')}</ol>`;
  const summary = !loading && !error && list.length
    ? `<p class="visually-hidden">${escapeHtml(orderSummary(list))}</p><ul class="tally" aria-hidden="true">${tally(list)}</ul>`
    : '';
  return '<div class="book">'
    + '<section class="page page-left" aria-label="Cover page">'
    + '<p class="book-kicker">The kitchen\'s</p><p class="book-name">Order book</p>'
    + (projectName ? `<p class="book-project">${escapeHtml(projectName)}</p>` : '')
    + summary
    + '<p class="book-foot">Newest orders first</p>'
    + '</section>'
    + `<section class="page page-right" aria-label="Orders">${right}</section>`
    + '</div>';
}

export function crewLabel(run) {
  const doing = run && run.waiting ? waitingLabel(run.waiting) : stageLabel(run && run.stage) || 'Between stations';
  return `${(run && run.task) || 'Another order'} · ${doing}`;
}

export function crewRuns(projects, selectedId) {
  const project = (projects || []).find((item) => item.id === selectedId || (item.worktreeRuns || []).some((run) => run.worktreeId === selectedId));
  if (!project) return [];
  const runs = [
    project.run ? { id: project.id, run: project.run } : null,
    ...(project.worktreeRuns || []).filter((run) => run.worktreeId).map((run) => ({ id: run.worktreeId, run }))
  ].filter(Boolean);
  return runs.filter((entry) => entry.id !== selectedId && !FINISHED_RUN_STATES.has(entry.run.state));
}

export function withLiveOrders(history, crew) {
  const list = Array.isArray(history) ? history : [];
  const live = (crew || [])
    .filter(({ run }) => run && !list.some((entry) => entry.runId === run.runId))
    .map(({ run }) => ({ runId: run.runId, task: run.task, state: run.state, iteration: run.iteration || 1, verdict: null, current: false, worktree: Boolean(run.worktreeId), elapsedMs: run.elapsedMs || 0 }));
  return [...live, ...list];
}
