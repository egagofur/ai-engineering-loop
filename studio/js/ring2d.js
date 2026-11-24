import { STAGES, stageLabel } from './list.js';

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

const KITCHEN_STAGE = {
  goal: 'Writing the order',
  maker: 'On the stove',
  verify: 'Tasting',
  review: 'The critic tastes',
  judge: "Head chef's call",
  deliver: 'Plating up'
};

const KITCHEN_WAITING = {
  freeze: 'Confirm your order',
  approval: 'Ready at the pass',
  question: 'The chef has a question'
};

const KITCHEN_FINISHED = {
  DELIVERED: 'Served',
  REPORTED: 'Order noted',
  CANCELLED: 'Order cancelled',
  ESCALATED: 'Sent to the manager'
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

export function kitchenActivity(summary, findings = null) {
  const { title, note } = ringActivity(summary, findings);
  const model = ringModel(summary && summary.ring, summary || {});
  const now = model.stages.find((item) => item.status === 'now');
  const waiting = summary && summary.waiting;
  let board;
  if (waiting && KITCHEN_WAITING[waiting.kind]) board = KITCHEN_WAITING[waiting.kind];
  else if (summary && KITCHEN_FINISHED[summary.state] && !now) board = KITCHEN_FINISHED[summary.state];
  else board = KITCHEN_STAGE[model.botStage] || title;
  return { board, title, note };
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
  return ['Order', projectName, summary && summary.tier, iteration].filter(Boolean).join(' · ');
}

export const STATUS_LABELS = STATUS_TEXT;

export const DINER_SUBTITLE = 'Eating while their workflow cooks';

export function dinerList(diners) {
  return (Array.isArray(diners) ? diners : []).slice(0, 6).filter((diner) => diner && diner.name);
}

export function ringMode({ webgl = false, threeFailed = false } = {}) {
  return webgl && !threeFailed ? '3d' : 'flat';
}
