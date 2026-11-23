import { STAGES, escapeHtml, stageLabel } from './list.js';
import { returnPath, stationConfig, ticketLabel } from './kitchen.js';
import { guestPrompt } from './mood.js';

export const RING_STAGES = STAGES;
export const RING_STATUSES = ['done', 'now', 'pending', 'skipped'];

const STAGE_SPACING_DEGREES = 360 / RING_STAGES.length;

const STATUS_TEXT = { done: 'done', now: 'in progress', pending: 'not started', skipped: 'skipped' };

const STAGE_ACTIVITY = {
  goal: 'Goal Contract',
  maker: 'Maker',
  verify: 'Verification',
  review: "Devil's Advocate",
  judge: 'Judge',
  deliver: 'Delivery'
};

const WAITING_ACTIVITY = {
  freeze: 'Waiting for Freeze',
  approval: 'Waiting for approval',
  question: 'Agent asks you'
};

const FINISHED_ACTIVITY = {
  DELIVERED: 'Delivered',
  REPORTED: 'Reported',
  CANCELLED: 'Cancelled',
  ESCALATED: 'Escalated'
};

export function ringModel(ring, { iteration = 1, maxIterations = 1, waiting = null } = {}) {
  const statusByStage = new Map((Array.isArray(ring) ? ring : []).map((item) => [item && item.stage, item && item.status]));
  const stages = RING_STAGES.map((stage, index) => {
    const status = statusByStage.get(stage);
    return {
      stage,
      angle: index * STAGE_SPACING_DEGREES,
      status: RING_STATUSES.includes(status) ? status : 'pending'
    };
  });
  const now = stages.find((item) => item.status === 'now');
  const lastDone = stages.filter((item) => item.status === 'done').at(-1);
  const parked = now || lastDone || stages[0];
  let mode = now ? 'working' : 'settled';
  if (waiting) mode = 'waiting';
  return {
    stages,
    mode,
    waitingKind: waiting ? waiting.kind || null : null,
    botStage: parked.stage,
    botAngle: parked.angle,
    iteration: Number(iteration) || 1,
    maxIterations: Number(maxIterations) || 1
  };
}

export function stagePosition(angleDegrees, radius = 1) {
  const radians = (angleDegrees * Math.PI) / 180;
  const round = (value) => Number(value.toFixed(1));
  return { left: round(50 + 50 * radius * Math.sin(radians)), top: round(50 - 50 * radius * Math.cos(radians)) };
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function ringActivity(summary, findings = null) {
  const model = ringModel(summary && summary.ring, summary || {});
  const now = model.stages.find((item) => item.status === 'now');
  const waiting = summary && summary.waiting;
  const finished = summary && FINISHED_ACTIVITY[summary.state];
  const parked = model.stages.find((item) => item.stage === model.botStage);
  let title;
  if (waiting && WAITING_ACTIVITY[waiting.kind]) title = WAITING_ACTIVITY[waiting.kind];
  else if (finished && !now) title = finished;
  else title = STAGE_ACTIVITY[model.botStage] || stageLabel(model.botStage);
  let note;
  if (findings && Number.isFinite(findings.total)) note = `${plural(findings.total, 'finding')} · ${Number(findings.blocking) || 0} blocking`;
  else if (waiting) note = 'waiting for you';
  else if (finished && !now) note = 'done';
  else note = STATUS_TEXT[(now || parked).status];
  return { title, note };
}

const STAGE_VERBS = {
  goal: 'planning',
  maker: 'building',
  verify: 'checking',
  review: 'reviewing',
  judge: 'judging',
  deliver: 'delivering'
};

export function botLabel(summary, findings = null) {
  const model = ringModel(summary && summary.ring, summary || {});
  const { title, note } = ringActivity(summary, findings);
  if (model.mode === 'waiting') return `Bot is waiting for you: ${title}`;
  if (model.mode === 'settled') return `Bot is done: ${title}`;
  return `Bot is ${STAGE_VERBS[model.botStage]}: ${title}, ${note}`;
}

export function ringEyebrow(summary, projectName = '') {
  const iteration = `iteration ${Number(summary && summary.iteration) || 1} of ${Number(summary && summary.maxIterations) || 1}`;
  return [projectName, summary && summary.tier, iteration].filter(Boolean).join(' · ');
}

function stageItem({ stage, angle, status }) {
  return `<li class="stage ${status}" data-stage="${escapeHtml(stage)}" data-status="${status}" data-angle="${angle}">`
    + `<i aria-hidden="true"></i><b class="stage-station">${escapeHtml(stationConfig(stage).label)}</b> <span class="stage-agent">${escapeHtml(stageLabel(stage))}</span>`
    + `<span class="visually-hidden">, ${STATUS_TEXT[status]}</span></li>`;
}

function guestActions(summary, actor) {
  if (!summary.waiting || summary.waiting.kind !== 'freeze') return '';
  const freeze = actor
    ? `<button type="button" class="primary" data-action="freeze">Freeze as ${escapeHtml(actor)}</button>`
    : '<button type="button" class="primary" data-action="guest-freeze-name">Freeze…</button>';
  return `<div class="guest-actions">${freeze}</div>`;
}

export function renderGuest({ summary, actor = null }) {
  const prompt = guestPrompt(summary && summary.waiting);
  const ask = prompt
    ? `<p class="guest-ask"><b>${escapeHtml(prompt.ask)}</b> <span class="guest-note">${escapeHtml(prompt.note)}</span></p>${guestActions(summary, actor)}`
    : '';
  return `<div class="guest" data-asking="${prompt ? 'true' : 'false'}"><p class="eyebrow guest-name">You, the guest</p>${ask}</div>`;
}

export const DINER_SUBTITLE = 'Eating while their workflow cooks';

export function renderDiners(diners) {
  const list = (Array.isArray(diners) ? diners : []).slice(0, 6).filter((diner) => diner && diner.name);
  if (!list.length) return '';
  const item = (diner, index) => `<li><button type="button" class="diner-tag" data-diner="${index}">`
    + `<span class="diner-dot" aria-hidden="true"></span><span class="diner-card"><b class="diner-name">${escapeHtml(diner.name)}</b>`
    + (diner.note ? `<span class="diner-note">${escapeHtml(diner.note)}</span>` : '')
    + `<span class="diner-sub">${DINER_SUBTITLE}</span></span></button></li>`;
  return `<ul class="diners" aria-label="Diners">${list.map(item).join('')}</ul>`;
}

export function renderRingFace({ summary, findings = null, actor = null, diners = [] }) {
  const model = ringModel(summary && summary.ring, summary || {});
  const activity = ringActivity(summary, findings);
  const back = returnPath(model);
  return '<div class="loop">'
    + `<ol class="stages" aria-label="Kitchen stations">${model.stages.map(stageItem).join('')}</ol>`
    + `<div class="ring-centre" aria-live="polite"><b class="ring-activity">${escapeHtml(activity.title)}</b>`
    + `<span class="eyebrow ring-note">${escapeHtml(activity.note)}</span></div>`
    + `<p class="kitchen-ticket" data-back="${back ? 'true' : 'false'}">${escapeHtml(ticketLabel(model))}</p>`
    + (back ? `<p class="kitchen-return">${escapeHtml(back.label)}: ${escapeHtml(stationConfig(back.from).label)} → ${escapeHtml(stationConfig(back.to).label)}</p>` : '')
    + '</div>'
    + renderGuest({ summary: summary || {}, actor })
    + renderDiners(diners);
}

export function renderRingBot(model, label) {
  return `<div class="ring-orbit" data-at="${escapeHtml(model.botStage)}"><button type="button" class="bot ring-bot" aria-label="${escapeHtml(label)}"></button><p class="bot-bubble" aria-hidden="true" hidden></p></div>`;
}

export function renderRing(view) {
  const model = ringModel(view.summary && view.summary.ring, view.summary || {});
  return `<div class="ring-face">${renderRingFace(view)}</div>`
    + renderRingBot(model, botLabel(view.summary, view.findings))
    + '<div class="ring-gl" aria-hidden="true"></div>'
    + '<p class="visually-hidden bot-mood" aria-live="polite"></p>';
}

export function mountRing2d(el, view) {
  el.innerHTML = renderRing(view);
  const face = el.querySelector('.ring-face');
  const orbit = el.querySelector('.ring-orbit');
  const button = el.querySelector('.ring-bot');
  let faceHtml = renderRingFace(view);
  return {
    gl: el.querySelector('.ring-gl'),
    bubble: el.querySelector('.bot-bubble'),
    mood: el.querySelector('.bot-mood'),
    update(next) {
      const html = renderRingFace(next);
      if (html !== faceHtml) {
        face.innerHTML = html;
        faceHtml = html;
      }
      orbit.dataset.at = ringModel(next.summary && next.summary.ring, next.summary || {}).botStage;
      button.setAttribute('aria-label', botLabel(next.summary, next.findings));
    },
    dispose() {
      el.innerHTML = '';
    }
  };
}

export function ringMode({ webgl = false, threeFailed = false } = {}) {
  return webgl && !threeFailed ? '3d' : 'flat';
}
