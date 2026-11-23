import { RING_STAGES } from './ring2d.js';

export const ROOM_SPACING = 360 / RING_STAGES.length;
export const TURN_STEP_MS = 1000;
export const TURN_MAX_MS = 2200;
export const CUT_FADE_MS = 160;
export const WIDE_ASPECT = 1.5;

export const ROOM_CONFIG = {
  goal: {
    name: "Philosopher's study",
    floor: 'marble',
    floorToken: '--room-marble',
    wallToken: '--room-goal-wall',
    mood: 'bright',
    props: ['column', 'desk', 'scroll', 'amphora', 'laurel'],
    tool: 'quill',
    costume: 'philosopher'
  },
  maker: {
    name: 'Workshop',
    floor: 'planks',
    floorToken: '--prop-wood',
    wallToken: '--room-maker-wall',
    mood: 'bright',
    props: ['workbench', 'pegboard', 'blocks', 'toolbox'],
    tool: 'hammer',
    costume: null
  },
  verify: {
    name: 'Lab',
    floor: 'tiles',
    floorToken: '--room-tile',
    wallToken: '--room-verify-wall',
    mood: 'bright',
    props: ['labBench', 'flasks', 'checkPanel', 'microscope'],
    tool: 'magnifier',
    costume: null
  },
  review: {
    name: "Devil's Advocate room",
    floor: 'stone',
    floorToken: '--room-stone',
    wallToken: '--room-review-wall',
    mood: 'dim',
    props: ['armchair', 'candle', 'bookshelf', 'rug'],
    tool: null,
    costume: 'devil'
  },
  judge: {
    name: 'Courtroom',
    floor: 'planks',
    floorToken: '--room-oak',
    wallToken: '--room-judge-wall',
    mood: 'bright',
    props: ['judgeBench', 'scales', 'gavelBlock', 'banner'],
    tool: 'gavel',
    costume: null
  },
  deliver: {
    name: 'Shipping dock',
    floor: 'concrete',
    floorToken: '--room-concrete',
    wallToken: '--room-deliver-wall',
    mood: 'bright',
    props: ['crates', 'pallet', 'door', 'stripe'],
    tool: 'package',
    costume: null
  }
};

export function roomConfig(stage) {
  return ROOM_CONFIG[stage] || ROOM_CONFIG.goal;
}

export const STATUS_LIGHT = {
  done: { plaque: '--ok-fill', glow: 0.9, tone: 1, saturation: 1, spot: 0 },
  now: { plaque: '--brand', glow: 1.3, tone: 1, saturation: 1, spot: 1 },
  pending: { plaque: '--line-strong', glow: 0, tone: 0.74, saturation: 0.8, spot: 0 },
  skipped: { plaque: '--faint', glow: 0, tone: 0.82, saturation: 0.08, spot: 0 }
};

export function roomLighting(status) {
  return STATUS_LIGHT[status] || STATUS_LIGHT.pending;
}

export function stageIndex(stage) {
  return Math.max(0, RING_STAGES.indexOf(stage));
}

export function roomAngle(stage) {
  return stageIndex(stage) * ROOM_SPACING;
}

export function shortestTurn(from, to) {
  const delta = (((to - from) % 360) + 360) % 360;
  return delta > 180 ? delta - 360 : delta;
}

export function turntableTarget(current, stage) {
  return current + shortestTurn(current, -roomAngle(stage));
}

export function turnPlan(current, stage, { reducedMotion = false } = {}) {
  const to = turntableTarget(current, stage);
  const delta = to - current;
  const steps = Math.round(Math.abs(delta) / ROOM_SPACING);
  if (!steps) return { from: current, to, delta: 0, steps: 0, ms: 0, fade: false };
  if (reducedMotion) return { from: current, to, delta, steps, ms: 0, fade: true };
  return { from: current, to, delta, steps, ms: Math.min(TURN_MAX_MS, steps * TURN_STEP_MS), fade: false };
}

export function facing(stage, turntable) {
  return shortestTurn(0, roomAngle(stage) + turntable);
}

export function labelVisibility(relative) {
  const away = Math.abs(relative);
  if (away <= ROOM_SPACING + 5) return { depth: away < ROOM_SPACING / 2 ? 'front' : 'side', readable: true, opacity: 1 };
  const fade = Math.min(1, (away - ROOM_SPACING - 5) / 50);
  return { depth: 'back', readable: false, opacity: Number((1 - fade * 0.8).toFixed(3)) };
}

export function screenPoint(ndc, width, height) {
  return {
    x: (ndc.x + 1) * width / 2,
    y: (1 - ndc.y) * height / 2,
    visible: ndc.z > -1 && ndc.z < 1
  };
}

export function hopHeight(progress, steps) {
  if (!steps) return 0;
  return Math.abs(Math.sin(Math.PI * Math.min(1, Math.max(0, progress)) * steps));
}

const STAGE_FACE = {
  goal: 'focus',
  maker: 'focus',
  verify: 'wide',
  review: 'squint',
  judge: 'stern',
  deliver: 'happy'
};

const WAIT_FACE = ['question', 'open', 'annoyed', 'angry'];

export function botFace(model, { reacting = false } = {}) {
  if (reacting) return 'happy';
  if (!model) return 'open';
  if (model.mode === 'waiting') return WAIT_FACE[Math.min(WAIT_FACE.length, Math.max(1, model.waitLevel || 1)) - 1];
  if (model.mode === 'settled') return 'happy';
  return STAGE_FACE[model.botStage] || 'open';
}

export const CAMERA_POSES = {
  rest: { position: [0, 3.7, 9.0], target: [0, -0.05, 0.3], fov: 30 },
  room: { position: [0, 1.5, 5.1], target: [0, 0.48, 1.35], fov: 26 }
};

export function cameraPose(zoom, aspect) {
  const t = Math.min(1, Math.max(0, zoom));
  const mix = (a, b) => a.map((value, index) => value + (b[index] - value) * t);
  const target = mix(CAMERA_POSES.rest.target, CAMERA_POSES.room.target);
  let position = mix(CAMERA_POSES.rest.position, CAMERA_POSES.room.position);
  const fov = CAMERA_POSES.rest.fov + (CAMERA_POSES.room.fov - CAMERA_POSES.rest.fov) * t;
  if (aspect > 0 && aspect < WIDE_ASPECT) {
    const push = 1 + (WIDE_ASPECT / aspect - 1) * (1 - 0.45 * t);
    position = position.map((value, index) => target[index] + (value - target[index]) * push);
  }
  return { position, target, fov };
}

export function swapOffset(direction, progress) {
  const t = Math.min(1, Math.max(0, progress));
  if (!direction) return { outX: 0, inX: 0, outY: -1.2 * t, inY: 1.2 * (1 - t), outScale: 1 - 0.15 * t, inScale: 0.85 + 0.15 * t };
  return { outX: -direction * 7 * t, inX: direction * 7 * (1 - t), outY: 0, inY: 0, outScale: 1, inScale: 1 };
}
