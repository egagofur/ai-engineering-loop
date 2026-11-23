import { escapeHtml, stageLabel } from './list.js';

export const RING_STAGES = ['goal', 'maker', 'verify', 'review', 'judge', 'deliver'];
export const RING_STATUSES = ['done', 'now', 'pending', 'skipped'];
export const BOT_ORBIT = 0.74;

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

export function ringModel(ring, { iteration = 1, maxIterations = 1 } = {}) {
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
  return {
    stages,
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

export function ringEyebrow(summary, projectName = '') {
  const iteration = `iteration ${Number(summary && summary.iteration) || 1}/${Number(summary && summary.maxIterations) || 1}`;
  return [projectName, summary && summary.tier, iteration].filter(Boolean).join(' · ');
}

function stageItem({ stage, angle, status }) {
  return `<li class="stage ${status}" data-stage="${escapeHtml(stage)}" data-status="${status}" data-angle="${angle}">`
    + `<i aria-hidden="true"></i>${escapeHtml(stageLabel(stage))}`
    + `<span class="visually-hidden">, ${STATUS_TEXT[status]}</span></li>`;
}

export function renderRingFace({ summary, findings = null, projectName = '' }) {
  const model = ringModel(summary && summary.ring, summary || {});
  const activity = ringActivity(summary, findings);
  return `<p class="eyebrow ring-eyebrow">${escapeHtml(ringEyebrow(summary, projectName))}</p>`
    + '<div class="loop">'
    + `<ol class="stages" aria-label="Run stages">${model.stages.map(stageItem).join('')}</ol>`
    + `<div class="ring-centre" aria-live="polite"><b class="ring-activity">${escapeHtml(activity.title)}</b>`
    + `<span class="eyebrow ring-note">${escapeHtml(activity.note)}</span></div>`
    + '</div>';
}

export function renderRingBot(model) {
  return `<div class="ring-orbit" data-at="${escapeHtml(model.botStage)}" aria-hidden="true"><span class="bot ring-bot"></span></div>`;
}

export function renderRing(view) {
  const model = ringModel(view.summary && view.summary.ring, view.summary || {});
  return `<div class="ring-face">${renderRingFace(view)}</div>`
    + renderRingBot(model)
    + '<div class="ring-gl" aria-hidden="true"></div>';
}

export function mountRing2d(el, view) {
  el.innerHTML = renderRing(view);
  const face = el.querySelector('.ring-face');
  const orbit = el.querySelector('.ring-orbit');
  let faceHtml = renderRingFace(view);
  return {
    gl: el.querySelector('.ring-gl'),
    update(next) {
      const html = renderRingFace(next);
      if (html !== faceHtml) {
        face.innerHTML = html;
        faceHtml = html;
      }
      orbit.dataset.at = ringModel(next.summary && next.summary.ring, next.summary || {}).botStage;
    },
    dispose() {
      el.innerHTML = '';
    }
  };
}
