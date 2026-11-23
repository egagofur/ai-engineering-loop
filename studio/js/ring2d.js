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
    + `<i aria-hidden="true"></i>${escapeHtml(stageLabel(stage))}`
    + `<span class="visually-hidden">, ${STATUS_TEXT[status]}</span></li>`;
}

export function renderRingFace({ summary, findings = null }) {
  const model = ringModel(summary && summary.ring, summary || {});
  const activity = ringActivity(summary, findings);
  return '<div class="loop">'
    + `<ol class="stages" aria-label="Run stages">${model.stages.map(stageItem).join('')}</ol>`
    + `<div class="ring-centre" aria-live="polite"><b class="ring-activity">${escapeHtml(activity.title)}</b>`
    + `<span class="eyebrow ring-note">${escapeHtml(activity.note)}</span></div>`
    + '</div>';
}

export function renderRingBot(model, label) {
  return `<div class="ring-orbit" data-at="${escapeHtml(model.botStage)}"><button type="button" class="bot ring-bot" aria-label="${escapeHtml(label)}"></button></div>`;
}

export function renderRing(view) {
  const model = ringModel(view.summary && view.summary.ring, view.summary || {});
  return `<div class="ring-face">${renderRingFace(view)}</div>`
    + renderRingBot(model, botLabel(view.summary, view.findings))
    + '<div class="ring-gl" aria-hidden="true"></div>';
}

export function mountRing2d(el, view) {
  el.innerHTML = renderRing(view);
  const face = el.querySelector('.ring-face');
  const orbit = el.querySelector('.ring-orbit');
  const button = el.querySelector('.ring-bot');
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
      button.setAttribute('aria-label', botLabel(next.summary, next.findings));
    },
    dispose() {
      el.innerHTML = '';
    }
  };
}

export const RING_MARK_RADIUS = 1;
export const RING_FIT_RADIUS = 1.2;
export const BOT_WORLD_RADIUS = 0.12;
const NARROW_WIDTH = 520;

export function ringView(width) {
  const narrow = width < NARROW_WIDTH;
  return { tilt: narrow ? 50 : 62, roll: narrow ? -4 : -7, fov: 28, narrow };
}

export function tiltedPoint(angleDegrees, radius, { tilt, roll }) {
  const a = (angleDegrees * Math.PI) / 180;
  const t = (tilt * Math.PI) / 180;
  const r = (roll * Math.PI) / 180;
  const x = radius * Math.sin(a);
  const y0 = radius * Math.cos(a);
  const y = y0 * Math.cos(t);
  const z = -y0 * Math.sin(t);
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r), z };
}

export function cameraDistance({ fov, tilt }, aspect) {
  const half = Math.tan((fov * Math.PI) / 360);
  const byWidth = RING_FIT_RADIUS / (half * aspect);
  const byHeight = (RING_FIT_RADIUS * Math.cos((tilt * Math.PI) / 180) + BOT_WORLD_RADIUS * 3) / half;
  return Math.max(byWidth, byHeight) + RING_FIT_RADIUS * Math.sin((tilt * Math.PI) / 180);
}

export function projectPoint(point, { fov, distance }, width, height) {
  const f = 1 / Math.tan((fov * Math.PI) / 360);
  const aspect = width / height;
  const depth = distance - point.z;
  return {
    x: width / 2 + ((point.x * f) / aspect / depth) * (width / 2),
    y: height / 2 - ((point.y * f) / depth) * (height / 2),
    depth
  };
}

export const RING_BANDS = [
  [0.72, 0.84, 0.14, '--ring-inner'],
  [0.85, 0.95, 0.42, '--ring-band'],
  [0.975, 1.06, 0.3, '--ring-band'],
  [1.072, 1.12, 0.18, '--ring-outer'],
  [1.15, 1.156, 0.3, '--ring-outer']
];

export function ringMode({ webgl = false, threeFailed = false } = {}) {
  return webgl && !threeFailed ? '3d' : 'flat';
}

export function nudgeLabel(label, centre, direction = 'down') {
  if (!centre) return label;
  const overlaps = label.left < centre.right && label.left + label.width > centre.left
    && label.top < centre.bottom && label.top + label.height > centre.top;
  if (!overlaps) return label;
  const top = direction === 'up' ? centre.top - label.height - 2 : centre.bottom + 2;
  return { ...label, top };
}
