import { STAGES as RING_STAGES, stageLabel } from './list.js';

export const STATION_SPACING = 2.1;
export const WALK_STEP_MS = 650;
export const WALK_MAX_MS = 2000;
export const CUT_FADE_MS = 160;
export const WIDE_ASPECT = 1.7;
export const KITCHEN_WIDTH = 16;
export const GUEST_SPOT = { x: -1.4, z: 5.3 };
export const RETURN_LABEL = 'Sent back to the kitchen';
export const DINER_TABLES = [{ x: -4.1, z: 4.4 }, { x: 2.8, z: 5.3 }, { x: 4.4, z: 3.9 }];
export const DINER_LOOPS = ['fork', 'sip', 'chat'];
export const MAX_DINERS = 6;
export const GENERIC_SEATS = 4;

export function dinerSeats(named) {
  return Math.min(MAX_DINERS, Math.max(GENERIC_SEATS, Math.trunc(Number(named) || 0)));
}

export const STATIONS = {
  goal: { label: 'Order', props: ['lectern', 'notepad', 'quill'], costume: 'philosopher', mood: 'bright' },
  maker: { label: 'Cook', props: ['stove', 'pan', 'flame', 'steam'], costume: 'chef', mood: 'bright' },
  verify: { label: 'Taste', props: ['bowl', 'spoon'], costume: 'chef', mood: 'bright' },
  review: { label: 'Critic', props: ['plate', 'magnifier'], costume: 'devil', mood: 'dim' },
  judge: { label: 'Head chef', props: ['plate', 'spoon', 'bell'], costume: 'chef', mood: 'bright' },
  deliver: { label: 'Serve', props: ['tray', 'cloche', 'plate'], costume: 'chef', mood: 'bright' }
};

export function stationConfig(stage) {
  return STATIONS[stage] || STATIONS.goal;
}

export function stationIndex(stage) {
  return Math.max(0, RING_STAGES.indexOf(stage));
}

export function stationX(stage) {
  return Number(((stationIndex(stage) - (RING_STAGES.length - 1) / 2) * STATION_SPACING).toFixed(3));
}

export function stationLayout() {
  return RING_STAGES.map((stage) => ({ stage, label: STATIONS[stage].label, agent: stageLabel(stage), x: stationX(stage) }));
}

export const STATUS_LIGHT = {
  done: { lamp: '--ok-fill', glow: 0.9, tone: 1, saturation: 1, spot: 0, pulse: 0 },
  now: { lamp: '--brand', glow: 1.3, tone: 1, saturation: 1, spot: 1, pulse: 0.35 },
  pending: { lamp: '--line-strong', glow: 0, tone: 0.78, saturation: 0.8, spot: 0, pulse: 0 },
  skipped: { lamp: '--faint', glow: 0, tone: 0.82, saturation: 0.08, spot: 0, pulse: 0 }
};

export function stationLighting(status) {
  return STATUS_LIGHT[status] || STATUS_LIGHT.pending;
}

export function lampGlow(status, seconds = 0, { reducedMotion = false } = {}) {
  const light = stationLighting(status);
  if (!light.pulse || reducedMotion) return light.glow;
  return Number((light.glow * (1 - light.pulse / 2 + (light.pulse / 2) * Math.sin(seconds * Math.PI * 1.25))).toFixed(4));
}

export function ticketTarget(model) {
  const stage = model && RING_STAGES.includes(model.botStage) ? model.botStage : 'goal';
  return { stage, x: stationX(stage) };
}

export function ticketLabel(model) {
  const iteration = Number(model && model.iteration) || 1;
  const max = Math.max(iteration, Number(model && model.maxIterations) || 1);
  return iteration > 1 ? `Iteration ${iteration} of ${max}` : 'Your order';
}

export function returnPath(model) {
  if (!model || (Number(model.iteration) || 1) <= 1) return null;
  return { from: 'judge', to: 'maker', fromX: stationX('judge'), toX: stationX('maker'), label: RETURN_LABEL };
}

export function walkPlan(fromX, toX, { reducedMotion = false } = {}) {
  const delta = toX - fromX;
  const steps = Math.round(Math.abs(delta) / STATION_SPACING);
  if (Math.abs(delta) < 1e-3) return { from: fromX, to: toX, steps: 0, hops: 0, ms: 0, fade: false };
  if (reducedMotion) return { from: fromX, to: toX, steps, hops: 0, ms: 0, fade: true };
  const stations = Math.max(1, steps);
  return { from: fromX, to: toX, steps: stations, hops: stations * 2, ms: Math.min(WALK_MAX_MS, stations * WALK_STEP_MS + 250), fade: false };
}

export function hopHeight(progress, hops) {
  if (!hops) return 0;
  return Math.abs(Math.sin(Math.PI * Math.min(1, Math.max(0, progress)) * hops));
}

export function screenPoint(ndc, width, height) {
  return {
    x: (ndc.x + 1) * width / 2,
    y: (1 - ndc.y) * height / 2,
    visible: ndc.z > -1 && ndc.z < 1
  };
}

const STAGE_FACE = {
  goal: 'focus',
  maker: 'stern',
  verify: 'focus',
  review: 'squint',
  judge: 'focus',
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

export function flameBurst(phase) {
  if (phase === null || phase === undefined) return 0;
  const t = (((phase - 0.42) % 1) + 1.5) % 1 - 0.5;
  const x = Math.max(0, 1 - Math.abs(t) / 0.22);
  return Number((x * x * (3 - 2 * x)).toFixed(4));
}

export function judgeOutcome(before, after) {
  if (!before || !after || before.judge !== 'now') return null;
  if (after.judge === 'done') return 'pass';
  if (after.judge !== 'now' && after.judge !== 'skipped') return 'iterate';
  return null;
}

export const CAMERA_POSES = {
  rest: { position: [0, 4.7, 11.4], target: [0, 1.25, 0.7], fov: 36 },
  station: { position: [0, 2.2, 4.0], target: [0, 0.95, -0.35], fov: 30 }
};

export const COMPACT_SPAN = 5.6;
export const COMPACT_FOV = 40;
export const COMPACT_LIFT = -0.55;
export const COMPACT_REACH = stationX('deliver') - STATION_SPACING / 2;
export const ZOOM_MARGIN = 0.3;
export const ZOOM_INSETS = { wide: { top: 0.06, bottom: 0.12 }, compact: { top: 0.24, bottom: 0.14 } };

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const unit = (vector) => {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
};
const along = (origin, direction, distance) => origin.map((value, index) => Number((value + direction[index] * distance).toFixed(4)));
const towardCamera = (pose) => unit(pose.position.map((value, index) => value - pose.target[index]));

export function compactFocus(x) {
  return Math.min(COMPACT_REACH, Math.max(-COMPACT_REACH, Number(x) || 0));
}

export function compactRest(aspect, focusX = 0) {
  const ratio = aspect > 0 ? aspect : 1;
  const halfWidth = Math.tan(toRadians(COMPACT_FOV / 2)) * ratio;
  const distance = COMPACT_SPAN / 2 / halfWidth;
  const rest = CAMERA_POSES.rest;
  const target = [compactFocus(focusX), rest.target[1] + COMPACT_LIFT, rest.target[2]];
  return { position: along(target, towardCamera(rest), distance), target, fov: COMPACT_FOV };
}

export function stationFrame(aspect, box, { compact = false, fov = CAMERA_POSES.station.fov } = {}) {
  const ratio = aspect > 0 ? aspect : 1;
  const insets = compact ? ZOOM_INSETS.compact : ZOOM_INSETS.wide;
  const band = 1 - insets.top - insets.bottom;
  const tan = Math.tan(toRadians(fov / 2));
  const halfHeight = ((box.top - box.bottom) / 2) * (1 + ZOOM_MARGIN) / band;
  const halfWidth = box.half * (1 + ZOOM_MARGIN);
  const distance = Math.max(halfHeight / tan, halfWidth / (tan * ratio));
  const frameHalf = distance * tan;
  const middle = (box.top + box.bottom) / 2 + (insets.top - insets.bottom) * frameHalf;
  const target = [box.x, Number(middle.toFixed(4)), box.z];
  return { position: along(target, towardCamera(CAMERA_POSES.station), distance), target, fov };
}

export function cameraPose(zoom, aspect, focusX = 0, { compact = false, restX = focusX, bot = null } = {}) {
  const t = Math.min(1, Math.max(0, zoom));
  const station = bot
    ? stationFrame(aspect, { ...bot, x: focusX }, { compact })
    : {
        position: [focusX + CAMERA_POSES.station.position[0], ...CAMERA_POSES.station.position.slice(1)],
        target: [focusX + CAMERA_POSES.station.target[0], ...CAMERA_POSES.station.target.slice(1)],
        fov: CAMERA_POSES.station.fov
      };
  const mix = (a, b) => a.map((value, index) => value + (b[index] - value) * t);
  if (compact) {
    const rest = compactRest(aspect, restX);
    return { position: mix(rest.position, station.position), target: mix(rest.target, station.target), fov: rest.fov + (station.fov - rest.fov) * t };
  }
  const target = mix(CAMERA_POSES.rest.target, station.target);
  let position = mix(CAMERA_POSES.rest.position, station.position);
  const fov = CAMERA_POSES.rest.fov + (station.fov - CAMERA_POSES.rest.fov) * t;
  if (aspect > 0 && aspect < WIDE_ASPECT) {
    const push = 1 + (WIDE_ASPECT / aspect - 1) * (1 - (bot ? 1 : 0.6) * t);
    position = position.map((value, index) => target[index] + (value - target[index]) * push);
  }
  return { position, target, fov };
}

export function clampBox(box, bounds, pad = 8) {
  const maxX = Math.max(pad, bounds.width - box.w - pad);
  const maxY = Math.max(pad, bounds.height - box.h - pad);
  return { ...box, x: Math.min(maxX, Math.max(pad, box.x)), y: Math.min(maxY, Math.max(pad, box.y)) };
}

function overlaps(a, b, gap) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

export function dodgeLabel(label, obstacle, bounds, { gap = 6, pad = 8 } = {}) {
  if (!obstacle || !obstacle.w || !overlaps(label, obstacle, gap)) return { ...label, hidden: false };
  const candidates = [
    { ...label, x: obstacle.x - gap - label.w },
    { ...label, y: obstacle.y - gap - label.h },
    { ...label, x: obstacle.x + obstacle.w + gap }
  ];
  const fits = (box) => box.x >= pad && box.y >= pad && box.x + box.w <= bounds.width - pad && box.y + box.h <= bounds.height - pad;
  const spot = candidates.find((box) => fits(box) && !overlaps(box, obstacle, gap - 1e-6));
  return spot ? { ...spot, hidden: false } : { ...label, hidden: true };
}

export function swapOffset(direction, progress) {
  const t = Math.min(1, Math.max(0, progress));
  if (!direction) return { outX: 0, inX: 0, outY: -1.2 * t, inY: 1.2 * (1 - t), outScale: 1 - 0.15 * t, inScale: 0.85 + 0.15 * t };
  return { outX: -direction * KITCHEN_WIDTH * t, inX: direction * KITCHEN_WIDTH * (1 - t), outY: 0, inY: 0, outScale: 1, inScale: 1 };
}

export function dinerLayout(count) {
  const seats = Math.min(MAX_DINERS, Math.max(0, Math.trunc(Number(count) || 0)));
  return Array.from({ length: seats }, (_, index) => {
    const table = DINER_TABLES[index % DINER_TABLES.length];
    const pair = Math.floor(index / DINER_TABLES.length);
    const shared = seats > DINER_TABLES.length + (index % DINER_TABLES.length);
    const side = shared ? (pair ? 0.42 : -0.42) : 0;
    return { index, table: index % DINER_TABLES.length, x: Number((table.x + side).toFixed(3)), z: Number((table.z - 0.62).toFixed(3)), loop: DINER_LOOPS[index % DINER_LOOPS.length], phase: Number(((index * 0.37) % 1).toFixed(2)) };
  });
}

export function dinerPose(loop, seconds, phase = 0, { reducedMotion = false } = {}) {
  if (reducedMotion) return { armR: -0.5, armL: -0.3, head: 0.12, tilt: 0, sway: 0 };
  const cycle = loop === 'chat' ? 2.4 : loop === 'sip' ? 3.6 : 2.8;
  const t = (((seconds / cycle) + phase) % 1 + 1) % 1;
  const lift = Math.max(0, Math.sin(t * Math.PI * 2));
  if (loop === 'fork') return { armR: -0.5 - lift * 1.5, armL: -0.3, head: 0.12 - lift * 0.18, tilt: 0, sway: 0 };
  if (loop === 'sip') return { armR: -0.5, armL: -0.3 - lift * 1.7, head: 0.1 - lift * 0.25, tilt: 0, sway: 0 };
  return { armR: -0.6 - lift * 0.4, armL: -0.3, head: Math.sin(t * Math.PI * 4) * 0.08, tilt: Math.sin(t * Math.PI * 2) * 0.14, sway: Math.sin(t * Math.PI * 2) * 0.04 };
}

export const GLANCE_PERIOD = 8.5;
export const GLANCE_SECONDS = 1.4;

export function dinerGlance(seconds, phase = 0) {
  const t = ((((seconds / GLANCE_PERIOD) + phase) % 1) + 1) % 1 * GLANCE_PERIOD;
  if (t >= GLANCE_SECONDS) return 0;
  const x = Math.min(1, t / (GLANCE_SECONDS * 0.2), (GLANCE_SECONDS - t) / (GLANCE_SECONDS * 0.2));
  return Number((x * x * (3 - 2 * x)).toFixed(4));
}

export const HOP_SQUASH = 0.12;
export const HOP_STRETCH = 0.1;

export function stride(lift, moving) {
  if (!moving) return { y: 1, xz: 1 };
  const clamped = Math.min(1, Math.max(0, lift));
  const y = 1 + clamped * HOP_STRETCH - Math.max(0, 1 - clamped * 3) * HOP_SQUASH;
  return { y: Number(y.toFixed(4)), xz: Number((1 / Math.sqrt(y)).toFixed(4)) };
}

export const MAX_CREW = 5;
export const BACK_LINE_OFFSETS = [-0.7, 0.7, 0, -0.35, 0.35];

export function crewSlots(crewStages) {
  const taken = new Map();
  return crewStages.slice(0, MAX_CREW).map((stage) => {
    const used = taken.get(stage) || 0;
    taken.set(stage, used + 1);
    return { stage, x: stationX(stage) + BACK_LINE_OFFSETS[used % BACK_LINE_OFFSETS.length] };
  });
}

export function stationCrowd(mainStage, crewStages) {
  const counts = {};
  [mainStage, ...crewStages].filter(Boolean).forEach((stage) => {
    counts[stage] = (counts[stage] || 0) + 1;
  });
  return counts;
}
