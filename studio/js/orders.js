import { formatElapsed, FINISHED_RUN_STATES, stageLabel, waitingLabel } from './list.js';

export const OUTCOMES = {
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

export const STAMPS = {
  passed: 'Passed',
  done: 'Served',
  back: 'Sent back',
  cooking: 'Cooking',
  escalated: 'Escalated',
  cancelled: 'Void'
};

export function orderMeta(run) {
  const ago = formatElapsed(run.elapsedMs);
  return [run.worktree ? 'worktree' : '', run.iteration > 1 ? `iteration ${run.iteration}` : '', ago === 'just now' ? ago : `${ago} ago`].filter(Boolean).join(' · ');
}

export function orderTally(runs) {
  const counts = {};
  for (const run of runs || []) counts[orderOutcome(run)] = (counts[orderOutcome(run)] || 0) + 1;
  return SUMMARY_ORDER.filter((outcome) => counts[outcome]).map((outcome) => ({ outcome, count: counts[outcome], label: OUTCOMES[outcome].toLowerCase() }));
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
