import { formatElapsed, stageLabel, waitingLabel } from './list.js';
import { ringModel } from './ring2d.js';

export const GOAL_VIEWS = ['formatted', 'markdown'];
export const GOAL_VIEW_LABELS = { formatted: 'Formatted', markdown: 'Markdown' };

const KITCHEN_ASK = {
  freeze: 'Confirm the order?',
  approval: 'Bring it out?',
  question: 'Chef asks you'
};

const WAITING_TEXT = {
  freeze: 'The Goal draft is waiting for you to freeze it. You can also answer in the agent host; whichever comes first wins.',
  approval: 'Delivery is waiting for your approval in the agent host.',
  question: 'The agent asked you a question in the agent host.'
};

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export const SKETCH_LABEL = 'Look at the order sketch';
export const SKETCH_VIEWS = { state: 'State', storyboard: 'Storyboard', lanes: 'Lanes' };
export const REVISE_HINT = 'To change the Goal, answer Revise in your agent host.';

export function sketchCounts(counts) {
  if (!counts) return '';
  const part = (n, one, many) => `${Number(n) || 0} ${Number(n) === 1 ? one : many}`;
  return [part(counts.undecided, 'undecided', 'undecided'), part(counts.hotspots, 'hotspot', 'hotspots'), part(counts.sideEffects, 'side effect', 'side effects')].join(', ');
}

export function sketchOptions(detail) {
  return detail && Array.isArray(detail.diagramOptions) ? detail.diagramOptions.filter((option) => SKETCH_VIEWS[option.view]) : [];
}

export function recommendedView(detail) {
  const options = sketchOptions(detail);
  const pick = options.find((option) => option.recommended) || options[0];
  return pick ? pick.view : null;
}

export function sketchFrameTitle(view) {
  return `${SKETCH_VIEWS[view]} sketch of the Goal`;
}

export function waitsForFreeze(summary) {
  return Boolean(summary && summary.waiting && summary.waiting.kind === 'freeze');
}

export function waitAsk(waiting) {
  return waiting ? KITCHEN_ASK[waiting.kind] || waitingLabel(waiting) : '';
}

export function waitText(waiting) {
  return waiting ? WAITING_TEXT[waiting.kind] || '' : '';
}

export function startedText(elapsedMs) {
  const elapsed = formatElapsed(elapsedMs);
  return elapsed === 'just now' ? 'Ordered just now' : `Ordered ${elapsed} ago`;
}

export function findingsText(findings) {
  if (!findings) return 'No review yet';
  return `${plural(findings.total, 'finding')}, ${findings.blocking} blocking`;
}

export function safeLink(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

export function roomFacts(summary) {
  const model = ringModel(summary && summary.ring, summary || {});
  const iteration = `Iteration ${Number(summary && summary.iteration) || 1} of ${Number(summary && summary.maxIterations) || 1}`;
  return [stageLabel(model.botStage), summary && summary.tier, iteration].filter(Boolean);
}
