import { escapeHtml, formatElapsed, stageLabel, waitingLabel } from './list.js';

const STATUS_LABELS = { done: 'done', now: 'in progress', pending: 'not started', skipped: 'skipped' };

const WAITING_TEXT = {
  freeze: 'The Goal draft is waiting for you to freeze it. You can also answer in the agent host; whichever comes first wins.',
  approval: 'Delivery is waiting for your approval in the agent host.',
  question: 'The agent asked you a question in the agent host.'
};

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function renderStageRail(ring) {
  const items = (ring || []).map(({ stage, status }) => {
    const safeStatus = Object.hasOwn(STATUS_LABELS, status) ? status : 'pending';
    return `<li data-stage="${escapeHtml(stage)}" data-status="${safeStatus}">`
      + `<span class="stage-name">${escapeHtml(stageLabel(stage))}</span>`
      + `<span class="stage-status">${STATUS_LABELS[safeStatus]}</span></li>`;
  }).join('');
  return `<ol class="stage-rail" aria-label="Run stages">${items}</ol>`;
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

export function renderRunHead(summary, { projectName = '', actor = null } = {}) {
  if (!summary) return '';
  const iteration = `iteration ${Number(summary.iteration) || 1} of ${Number(summary.maxIterations) || 1}`;
  const meta = [projectName, summary.tier, iteration, formatElapsed(summary.elapsedMs)].filter(Boolean).map(escapeHtml).join(' · ');
  const waiting = summary.waiting
    ? `<div class="waiting" data-kind="${escapeHtml(summary.waiting.kind)}"><p><strong>${escapeHtml(waitingLabel(summary.waiting))}</strong> ${escapeHtml(WAITING_TEXT[summary.waiting.kind] || '')}</p>`
      + `${renderFreezeButton(summary, actor)}</div>`
    : '';
  const now = summary.stage ? `<p class="activity">Now: <strong>${escapeHtml(stageLabel(summary.stage))}</strong></p>` : '';
  return `<p class="run-meta">${meta}</p><h2 class="run-task">${escapeHtml(summary.task || summary.runId)}</h2>${now}${waiting}`;
}

function goalSection(markdown) {
  const body = markdown
    ? `<pre class="goal-text">${escapeHtml(markdown)}</pre>`
    : '<p class="quiet-text">No Goal draft yet.</p>';
  return `<section class="detail-card goal" aria-labelledby="goal-title"><h3 id="goal-title">Goal</h3>${body}</section>`;
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

export function renderDetail(detail) {
  if (!detail) return '';
  const facts = '<dl class="facts">'
    + `<div><dt>Findings</dt><dd>${escapeHtml(findingsText(detail.findings))}</dd></div>`
    + `<div><dt>Pull request</dt><dd>${prText(detail.pr)}</dd></div>`
    + `<div><dt>Receipt</dt><dd>${detail.receipt === 'written' ? 'Receipt written' : 'No receipt yet'}</dd></div>`
    + '</dl>';
  const extra = detail.extraNodes && detail.extraNodes.length
    ? `<section class="detail-card" aria-labelledby="extra-title"><h3 id="extra-title">Other steps</h3>${listOrNone(detail.extraNodes)}</section>`
    : '';
  return renderStageRail(detail.summary && detail.summary.ring)
    + facts
    + goalSection(detail.goalMarkdown)
    + `<section class="detail-card" aria-labelledby="assumptions-title"><h3 id="assumptions-title">Unconfirmed assumptions</h3>${listOrNone(detail.unconfirmed)}</section>`
    + extra;
}
