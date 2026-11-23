import { FINISHED_RUN_STATES, sortProjects } from './list.js';

export const WAIT_LEVEL_SECONDS = [30, 120, 300];

export const WAIT_COPY = {
  freeze: [
    ['?'],
    ['…', 'Hello?'],
    ['Freeze me already!', 'Hmph.', 'Still here…'],
    ['Freeze me already!', "I've been waiting ages!", 'Any day now!', 'Hello?!']
  ],
  approval: [
    ['?'],
    ['…', 'Hello?'],
    ['Approve the delivery, please!', 'Hmph.', 'Still here…'],
    ['Approve the delivery, please!', "I've been waiting ages!", 'Ship it already!', 'Hello?!']
  ],
  question: [
    ['?'],
    ['…', 'Hello?'],
    ['I asked you something!', 'Hmph.', 'Still here…'],
    ['Answer me, please!', "I've been waiting ages!", 'Any day now!', 'Hello?!']
  ]
};

export function waitSeconds(waiting, now = Date.now()) {
  const since = Date.parse(waiting && waiting.since);
  return Number.isFinite(since) ? Math.max(0, (now - since) / 1000) : 0;
}

export function waitLevel(seconds) {
  return 1 + WAIT_LEVEL_SECONDS.filter((limit) => seconds >= limit).length;
}

export function waitBubble(kind, seconds, turn = 0, { reducedMotion = false } = {}) {
  const level = waitLevel(seconds);
  const lines = (WAIT_COPY[kind] || WAIT_COPY.question)[level - 1];
  const rotates = !reducedMotion && lines.length > 1 && level >= 3;
  const index = rotates ? Math.abs(Math.trunc(turn)) % lines.length : 0;
  return { level, text: lines[index], rotates };
}

export const EASE_OUT = [0.23, 1, 0.32, 1];
export const ZOOM_MS = 750;
export const ROOM_SWITCH_MS = 600;

export function cubicBezier(x1, y1, x2, y2) {
  const sample = (a, b, t) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  const slope = (a, b, t) => 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let index = 0; index < 8; index += 1) {
      const error = sample(x1, x2, t) - x;
      if (Math.abs(error) < 1e-6) break;
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    t = Math.min(1, Math.max(0, t));
    return sample(y1, y2, t);
  };
}

export function roomTargets(projects) {
  return sortProjects(projects).flatMap((project) => [
    ...(project.run && !FINISHED_RUN_STATES.has(project.run.state) ? [project.id] : []),
    ...(project.worktreeRuns || []).filter((run) => run.worktreeId && !FINISHED_RUN_STATES.has(run.state)).map((run) => run.worktreeId)
  ]);
}

export function stepTarget(targets, currentId, direction) {
  if (!targets.length) return null;
  const index = targets.indexOf(currentId);
  if (index === -1) return targets[0];
  return targets[(index + direction + targets.length) % targets.length];
}
