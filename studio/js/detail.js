import { escapeHtml, formatElapsed, stageLabel, waitingLabel } from './list.js';
import { renderMarkdown } from './markdown.js';
import { ringActivity, ringEyebrow, ringModel } from './ring2d.js';

export const GOAL_VIEWS = ['formatted', 'markdown'];
const GOAL_VIEW_LABELS = { formatted: 'Formatted', markdown: 'Markdown' };

const WAITING_TEXT = {
  freeze: 'The Goal draft is waiting for you to freeze it. You can also answer in the agent host; whichever comes first wins.',
  approval: 'Delivery is waiting for your approval in the agent host.',
  question: 'The agent asked you a question in the agent host.'
};

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function renderFreezeButton(summary, actor) {
  if (!summary || !summary.waiting || summary.waiting.kind !== 'freeze') return '';
  if (!actor) {
    return '<form class="freeze-form" data-action="freeze">'
      + '<label for="freeze-actor">Your name</label>'
      + '<input id="freeze-actor" name="actor" type="text" autocomplete="name" maxlength="80" required>'
      + '<button type="submit" class="primary" data-action="freeze">Freeze</button>'
      + '</form>';
  }
  return `<button type="button" class="primary" data-action="freeze">Freeze as ${escapeHtml(actor)}</button>`;
}

function startedText(elapsedMs) {
  const elapsed = formatElapsed(elapsedMs);
  return elapsed === 'just now' ? 'Started just now' : `Started ${elapsed} ago`;
}

export function renderRunHead(summary, { actor = null, projectName = '' } = {}) {
  if (!summary) return '';
  const title = summary.task || summary.runId;
  const wait = summary.waiting
    ? `<div class="stage-wait" data-kind="${escapeHtml(summary.waiting.kind)}"><span class="chip chip-waiting">${escapeHtml(waitingLabel(summary.waiting))}</span>`
      + `<span class="visually-hidden">${escapeHtml(WAITING_TEXT[summary.waiting.kind] || '')}</span>`
      + `${renderFreezeButton(summary, actor)}</div>`
    : '';
  return `<p class="eyebrow">${escapeHtml(ringEyebrow(summary, projectName))}</p>`
    + `<h2 class="run-task" title="${escapeHtml(title)}">${escapeHtml(title)}</h2>`
    + `<p class="run-meta">${escapeHtml(startedText(summary.elapsedMs))}</p>${wait}`;
}

function goalTab(view, selected) {
  return `<button type="button" role="tab" id="goal-tab-${view}" aria-controls="goal-panel-${view}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}" data-goal-view="${view}">${GOAL_VIEW_LABELS[view]}</button>`;
}

function goalSection(markdown, goalView) {
  if (!markdown) {
    return '<section class="detail-card goal" aria-labelledby="goal-title"><h3 id="goal-title">Goal</h3><p class="quiet-text">No Goal draft yet.</p></section>';
  }
  const view = GOAL_VIEWS.includes(goalView) ? goalView : 'formatted';
  const hidden = (name) => (name === view ? '' : ' hidden');
  return '<section class="detail-card goal" aria-labelledby="goal-title">'
    + '<div class="goal-head"><h3 id="goal-title">Goal</h3>'
    + `<div class="tabs" role="tablist" aria-label="Goal view">${GOAL_VIEWS.map((name) => goalTab(name, name === view)).join('')}</div></div>`
    + `<div role="tabpanel" id="goal-panel-formatted" aria-labelledby="goal-tab-formatted" class="goal-formatted" tabindex="0"${hidden('formatted')}>${renderMarkdown(markdown)}</div>`
    + `<div role="tabpanel" id="goal-panel-markdown" aria-labelledby="goal-tab-markdown" tabindex="0"${hidden('markdown')}><pre class="goal-text">${escapeHtml(markdown)}</pre></div>`
    + '</section>';
}

function findingsText(findings) {
  if (!findings) return 'No review yet';
  return `${plural(findings.total, 'finding')}, ${findings.blocking} blocking`;
}

function prText(pr) {
  if (!pr) return 'No branch yet';
  const link = pr.url && /^https?:\/\//i.test(pr.url)
    ? ` <a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener noreferrer">open</a>`
    : '';
  return `<code>${escapeHtml(pr.branch || 'unknown branch')}</code> · ${pr.merged ? 'merged' : 'not merged'}${link}`;
}

function listOrNone(items) {
  if (!items || !items.length) return '<p class="quiet-text">None</p>';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

export function renderDetail(detail, { goalView = 'formatted' } = {}) {
  if (!detail) return '';
  const facts = '<dl class="facts">'
    + `<div><dt>Findings</dt><dd>${escapeHtml(findingsText(detail.findings))}</dd></div>`
    + `<div><dt>Pull request</dt><dd>${prText(detail.pr)}</dd></div>`
    + `<div><dt>Receipt</dt><dd>${detail.receipt === 'written' ? 'Receipt written' : 'No receipt yet'}</dd></div>`
    + '</dl>';
  const extra = detail.extraNodes && detail.extraNodes.length
    ? `<section class="detail-card" aria-labelledby="extra-title"><h3 id="extra-title">Other steps</h3>${listOrNone(detail.extraNodes)}</section>`
    : '';
  return facts
    + goalSection(detail.goalMarkdown, goalView)
    + `<section class="detail-card" aria-labelledby="assumptions-title"><h3 id="assumptions-title">Unconfirmed assumptions</h3>${listOrNone(detail.unconfirmed)}</section>`
    + extra;
}

export function renderRoomCard(summary, { findings = null, projectName = '', actor = null } = {}) {
  if (!summary) return '';
  const model = ringModel(summary.ring, summary);
  const activity = ringActivity(summary, findings);
  const iteration = `Iteration ${Number(summary.iteration) || 1} of ${Number(summary.maxIterations) || 1}`;
  const facts = [stageLabel(model.botStage), summary.tier, iteration].filter(Boolean)
    .map((fact) => `<span class="chip">${escapeHtml(fact)}</span>`).join('');
  let wait = '';
  if (summary.waiting) {
    const action = summary.waiting.kind !== 'freeze'
      ? ''
      : actor
        ? `<button type="button" class="primary" data-action="freeze">Freeze as ${escapeHtml(actor)}</button>`
        : '<button type="button" class="primary" data-action="room-freeze-name">Freeze…</button>';
    wait = `<div class="stage-wait"><span class="chip chip-waiting">${escapeHtml(waitingLabel(summary.waiting))}</span>${action}</div>`;
  }
  return `<p class="eyebrow">${escapeHtml(projectName)}</p>`
    + `<h2 id="room-title" class="room-title">${escapeHtml(summary.task || summary.runId)}</h2>`
    + `<p class="room-activity"><strong>${escapeHtml(activity.title)}</strong> · ${escapeHtml(activity.note)}</p>`
    + `<div class="room-facts">${facts}</div>${wait}`;
}
