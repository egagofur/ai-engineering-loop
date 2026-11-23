import { escapeHtml, stageLabel } from './list.js';

export const RING_STAGES = ['goal', 'maker', 'verify', 'review', 'judge', 'deliver'];
export const RING_STATUSES = ['done', 'now', 'pending', 'skipped'];

const STAGE_SPACING_DEGREES = 360 / RING_STAGES.length;
const VIEW_SIZE = 320;
const CENTER = VIEW_SIZE / 2;
const TRACK_RADIUS = 104;
const LABEL_RADIUS = 134;
const BOT_RADIUS = 82;

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
    botAngle: parked.angle,
    iteration: Number(iteration) || 1,
    maxIterations: Number(maxIterations) || 1
  };
}

export function pointOnRing(angleDegrees, radius) {
  const radians = (angleDegrees * Math.PI) / 180;
  return { x: CENTER + radius * Math.sin(radians), y: CENTER - radius * Math.cos(radians) };
}

function labelAnchor(angle) {
  if (angle === 0 || angle === 180) return 'middle';
  return angle < 180 ? 'start' : 'end';
}

function fixed(value) {
  return Number(value.toFixed(2));
}

function stageGroup({ stage, angle, status }) {
  const marker = pointOnRing(angle, TRACK_RADIUS);
  const label = pointOnRing(angle, LABEL_RADIUS);
  return `<g class="ring-stage" data-stage="${escapeHtml(stage)}" data-status="${status}">`
    + `<circle class="ring-marker" cx="${fixed(marker.x)}" cy="${fixed(marker.y)}" r="9"/>`
    + `<text class="ring-label" x="${fixed(label.x)}" y="${fixed(label.y)}" text-anchor="${labelAnchor(angle)}" dominant-baseline="middle">${escapeHtml(stageLabel(stage))}</text>`
    + '</g>';
}

export function renderRing2d(model) {
  const bot = pointOnRing(model.botAngle, BOT_RADIUS);
  const iteration = `iteration ${model.iteration} of ${model.maxIterations}`;
  return `<svg class="ring-2d" viewBox="0 0 ${VIEW_SIZE} ${VIEW_SIZE}" role="img" aria-label="Run loop, ${escapeHtml(iteration)}">`
    + `<circle class="ring-track" cx="${CENTER}" cy="${CENTER}" r="${TRACK_RADIUS}"/>`
    + model.stages.map(stageGroup).join('')
    + `<circle class="ring-bot" cx="${fixed(bot.x)}" cy="${fixed(bot.y)}" r="7"/>`
    + `<text class="ring-iteration" x="${CENTER}" y="${CENTER}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(iteration)}</text>`
    + '</svg>';
}

export function mountRing2d(el, model) {
  el.innerHTML = renderRing2d(model);
  return {
    update(next) {
      el.innerHTML = renderRing2d(next);
    },
    dispose() {
      el.innerHTML = '';
    }
  };
}
