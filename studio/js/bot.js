import {
  AnimationClip,
  AnimationMixer,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LoopOnce,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  VectorKeyframeTrack
} from '../vendor/three.module.min.js';

import { RING_STAGES } from './ring2d.js';
import { botFace, stationConfig, stride } from './kitchen.js';
import { contactShadow, lathe, pleat, radialTexture } from './forms.js';

export const REACTION_SECONDS = 0.7;
export const BOT_RADIUS = 0.5;
export const BOT_HEIGHT = BOT_RADIUS * 2;
export const BLINK_SECONDS = 0.14;
export const EYE_SHAPES = ['open', 'focus', 'wide', 'squint', 'stern', 'happy', 'question', 'annoyed', 'angry'];
export const EYE_YAW = 0.3;
export const EYE_GAP = 0.27;
export const EYE_PITCH = 0.26;
const EYE_W = 0.026;
const EYE_H = 0.062;
const EYE_LIFT = 0.004;
const EYE_POINTS = 48;
const ARC_THICKNESS = 0.0085;
const HAT_BAND_Y = 0.47;
const PAN_FOOD_Y = 0.03;
const PAN_SCALE = 1.35;
const REST = {
  goal: [-0.42, 0.21, 0.7],
  maker: [-0.47, 0.3, 0.69],
  verify: [-0.2, 0.42, 0.66],
  review: [-0.12, 0.2, 0.8],
  judge: [0.06, 0.3, 0.7],
  deliver: [0, 0.24, 0.76]
};

const CROSSFADE_SECONDS = 0.45;
const EYE_KEYS = ['sx', 'sy', 'rz', 'dy', 'lid', 'slope'];
const GLANCE_EASE_SECONDS = 0.12;
const EYE_EASE_SECONDS = 0.07;
const TWEEN_SECONDS = 0.3;
const SETTLED = 0.0005;
const LEAF_COUNT = 18;
const HIDDEN = 0.001;

const number = (name, times, values) => new NumberKeyframeTrack(name, times, values);
const vector = (name, times, values) => new VectorKeyframeTrack(name, times, values);
const shown = (name, duration) => vector(`${name}.scale`, [0, duration], [1, 1, 1, 1, 1, 1]);

function breathe(duration, lift = 0.025) {
  const half = duration / 2;
  return [
    number('body.position[y]', [0, half, duration], [0, lift, 0]),
    vector('body.scale', [0, half, duration], [1, 1, 1, 1.012, 0.985, 1.012, 1, 1, 1])
  ];
}

function goalClip() {
  const duration = 2.4;
  const times = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, duration];
  const [x, y, z] = REST.goal;
  const scribble = times.flatMap((time, index) => [x + (index % 2 ? 0.025 : -0.02) + time * 0.012, y + (index % 2 ? 0.012 : 0), z]);
  return new AnimationClip('goal', duration, [
    shown('prop_goal', duration),
    ...breathe(duration),
    number('prop_goal.rotation[z]', times, [-0.35, -0.22, -0.4, -0.24, -0.36, -0.2, -0.38, -0.23, -0.35]),
    vector('prop_goal.position', times, [...scribble.slice(0, -3), x, y, z]),
    number('face.rotation[x]', [0, duration / 2, duration], [0.2, 0.26, 0.2]),
    number('face.rotation[y]', [0, duration / 2, duration], [-0.18, -0.12, -0.18])
  ]);
}

export const TOSS_SECONDS = 1.3;
export const TOSS_HEIGHT = 0.3;

function tossArc(start, end, samples = 8) {
  const times = [];
  const heights = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    times.push(Number((start + (end - start) * t).toFixed(4)));
    heights.push(Number((PAN_FOOD_Y + 4 * TOSS_HEIGHT * t * (1 - t)).toFixed(4)));
  }
  return { times, heights };
}

function makerClip() {
  const duration = TOSS_SECONDS;
  const [x, y, z] = REST.maker;
  const times = [0, 0.3, 0.45, 0.6, 0.95, 1.05, 1.15, duration];
  const arc = tossArc(0.42, 0.95);
  return new AnimationClip('maker', duration, [
    shown('prop_maker', duration),
    ...breathe(duration, 0.015),
    vector('prop_maker.position', times, [x, y, z, x, y - 0.02, z - 0.07, x, y + 0.07, z + 0.05, x, y + 0.02, z, x, y - 0.03, z, x + 0.03, y, z, x - 0.03, y, z, x, y, z]),
    number('prop_maker.rotation[x]', times, [0, 0.12, -0.38, -0.12, 0.06, 0, 0, 0]),
    number('pan_food.position[y]', [0, ...arc.times, 1.02, duration], [PAN_FOOD_Y, ...arc.heights, PAN_FOOD_Y + 0.008, PAN_FOOD_Y]),
    number('pan_food.rotation[x]', [0, 0.42, 0.95, duration], [0, 0, -Math.PI * 2, -Math.PI * 2]),
    number('face.rotation[x]', [0, 0.45, 0.7, 0.95, duration], [0.16, 0.08, 0.02, 0.18, 0.16]),
    number('face.rotation[y]', [0, duration], [-0.3, -0.3]),
    number('body.rotation[z]', [0, 0.45, 0.95, duration], [0.04, -0.02, 0.05, 0.04])
  ]);
}

function verifyClip() {
  const duration = 2.6;
  const [x, y, z] = REST.verify;
  const times = [0, 0.5, 0.8, 1.3, 1.8, 2.2, duration];
  return new AnimationClip('verify', duration, [
    shown('prop_verify', duration),
    ...breathe(duration),
    vector('prop_verify.position', times, [x, y, z, -0.28, 0.24, 0.74, -0.28, 0.2, 0.74, -0.02, 0.44, 0.6, -0.02, 0.44, 0.6, x, y, z, x, y, z]),
    number('face.rotation[x]', times, [0.1, 0.24, 0.26, 0.04, 0.04, 0.1, 0.1]),
    number('face.rotation[y]', [0, 1.8, 2.0, 2.2, duration], [-0.15, -0.15, 0.08, -0.12, -0.15])
  ]);
}

function reviewClip() {
  const duration = 3.2;
  const [x, y, z] = REST.review;
  return new AnimationClip('review', duration, [
    shown('prop_review', duration),
    ...breathe(duration, 0.015),
    vector('prop_review.position', [0, duration / 2, duration], [x - 0.07, y, z, x + 0.07, y + 0.02, z + 0.03, x - 0.07, y, z]),
    number('prop_review.rotation[z]', [0, duration / 2, duration], [0.15, -0.1, 0.15]),
    number('face.rotation[z]', [0, duration * 0.4, duration * 0.7, duration], [0.08, 0.14, 0.03, 0.08]),
    number('face.rotation[x]', [0, duration], [0.2, 0.2]),
    number('body.rotation[z]', [0, duration / 2, duration], [0.05, -0.04, 0.05])
  ]);
}

function judgeClip() {
  const duration = 3.4;
  const [x, y, z] = REST.judge;
  const times = [0, 0.6, 0.9, 1.1, 1.6, 2.0, 2.3, 2.55, 2.8, duration];
  return new AnimationClip('judge', duration, [
    shown('prop_judge', duration),
    ...breathe(duration, 0.015),
    number('body.rotation[x]', times, [0.04, 0.2, 0.22, 0.2, 0.1, 0.08, 0.08, 0.08, 0.06, 0.04]),
    vector('prop_judge.position', times, [x, y, z, 0.05, 0.16, 0.74, 0.05, 0.11, 0.76, 0.05, 0.14, 0.74, 0.12, 0.44, 0.58, 0.12, 0.44, 0.58, x, y, z, x, y, z, x, y, z, x, y, z]),
    number('face.rotation[x]', times, [0.12, 0.3, 0.32, 0.3, 0.05, 0.05, 0.28, 0.06, 0.24, 0.12]),
    vector('hop.scale', [0, 2.3, 2.38, 2.5, duration], [1, 1, 1, 1, 1, 1, 1.04, 0.95, 1.04, 1, 1, 1, 1, 1, 1])
  ]);
}

function deliverClip() {
  const duration = 1.2;
  return new AnimationClip('deliver', duration, [
    shown('prop_deliver', duration),
    number('body.position[y]', [0, duration / 4, duration / 2, (duration * 3) / 4, duration], [0, 0.06, 0, 0.06, 0]),
    number('body.rotation[z]', [0, duration / 4, (duration * 3) / 4, duration], [0, 0.06, -0.06, 0])
  ]);
}

function puff(name, start, duration) {
  const end = Math.min(duration, start + 0.6);
  return [
    number(`${name}.position[y]`, [0, start, end, duration], [1.05, 1.05, 1.5, 1.5]),
    vector(`${name}.scale`, [0, start, start + 0.1, end, duration], [HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN, 1, 1, 1, HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN])
  ];
}

function waitingClips() {
  const calm = 4;
  const tap = 1.2;
  const grumble = 1.8;
  const rant = 0.9;
  return [
    new AnimationClip('waiting-1', calm, [
      ...breathe(calm),
      number('face.rotation[y]', [0, calm * 0.3, calm * 0.55, calm * 0.85, calm], [0, 0.32, 0.32, -0.26, 0]),
      number('body.rotation[z]', [0, calm * 0.3, calm * 0.85, calm], [0, 0.06, -0.05, 0])
    ]),
    new AnimationClip('waiting-2', tap, [
      number('body.position[y]', [0, 0.15, 0.3, 0.6, 0.75, 0.9, tap], [0, 0.05, 0, 0, 0.05, 0, 0]),
      number('body.rotation[z]', [0, 0.3, 0.6, 0.9, tap], [0, 0.05, 0, -0.05, 0])
    ]),
    new AnimationClip('waiting-3', grumble, [
      ...breathe(grumble),
      number('face.rotation[y]', [0, 0.2, 0.4, 0.6, grumble], [0, 0.12, -0.12, 0.08, 0]),
      number('body.rotation[z]', [0, grumble / 2, grumble], [0.03, -0.03, 0.03])
    ]),
    new AnimationClip('waiting-4', rant, [
      number('body.position[y]', [0, rant * 0.25, rant * 0.5, rant * 0.75, rant], [0, 0.32, 0, 0.26, 0]),
      vector('body.scale', [0, rant * 0.45, rant * 0.5, rant * 0.6, rant], [1, 1, 1, 0.95, 1.06, 0.95, 1.1, 0.88, 1.1, 1, 1, 1, 1, 1, 1]),
      shown('steam', rant),
      ...puff('puff1', 0, rant),
      ...puff('puff2', 0.3, rant),
      ...puff('puff3', 0.55, rant)
    ])
  ];
}

function reactionClip() {
  const end = REACTION_SECONDS;
  return new AnimationClip('reaction', end, [
    number('hop.position[y]', [0, end * 0.12, end * 0.45, end * 0.8, end], [0, 0, 0.55, 0, 0]),
    number('hop.rotation[y]', [0, end * 0.12, end * 0.8, end], [0, 0, Math.PI * 2, Math.PI * 2]),
    vector('hop.scale', [0, end * 0.12, end * 0.24, end * 0.8, end * 0.9, end], [1, 1, 1, 1.1, 0.86, 1.1, 0.93, 1.1, 0.93, 1.12, 0.85, 1.12, 1, 1, 1, 1, 1, 1])
  ]);
}

export function buildClips() {
  return {
    stages: {
      goal: goalClip(),
      maker: makerClip(),
      verify: verifyClip(),
      review: reviewClip(),
      judge: judgeClip(),
      deliver: deliverClip()
    },
    waiting: waitingClips(),
    reaction: reactionClip()
  };
}

const POSES = {
  open: {},
  focus: { sx: 1.04, sy: 0.9, lid: 0.55, slope: 0.18 },
  wide: { sx: 1.12, sy: 1.15 },
  squint: { sx: 1.15, sy: 0.42, rz: 0.06, wink: 0.22 },
  stern: { sx: 1.06, sy: 0.86, lid: 0.36, slope: 0.22 },
  happy: { arcs: true },
  question: { sx: 1.05, sy: 1.1, lid: 0.5, slope: -0.55, mark: true },
  annoyed: { sx: 1.1, sy: 0.95, lid: -0.05, slope: 0.08, lift: -0.008 },
  angry: { sx: 1.1, sy: 0.88, lid: 0.02, slope: 1.1, lift: -0.004 }
};

export function eyePose(expression, openness = 1) {
  const pose = { sx: 1, sy: 1, rz: 0, lift: 0, lid: 1, slope: 0, wink: 0, ...(POSES[expression] || POSES.open) };
  const lids = Math.min(1, Math.max(0.06, openness));
  const eye = (side) => ({
    sx: pose.sx,
    sy: pose.sy * (1 + side * pose.wink) * lids,
    rz: side * pose.rz,
    dy: pose.lift,
    lid: pose.lid,
    slope: pose.slope
  });
  return { left: eye(-1), right: eye(1), arcs: Boolean(pose.arcs) && lids > 0.5, mark: Boolean(pose.mark) };
}

export function eyeOutline({ sx, sy, rz, dy, lid, slope }, side, count = EYE_POINTS) {
  const a = EYE_W * sx;
  const b = Math.max(EYE_H * sy, 0.003);
  const r = Math.min(a, b);
  const cut = (x) => b * lid + side * slope * x;
  const cos = Math.cos(rz);
  const sin = Math.sin(rz);
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const x = r * ux + Math.sign(ux) * (a - r);
    const y = Math.max(-b, Math.min(r * uy + Math.sign(uy) * (b - r), cut(x)));
    points.push([x * cos - y * sin, x * sin + y * cos + dy]);
  }
  return points;
}

export function nextBlink(random = Math.random) {
  return 2.6 + random() * 3.2;
}

function onSphere(target, offset, x, y, radius = BOT_RADIUS) {
  const length = Math.hypot(x, y, radius);
  const scale = (radius + EYE_LIFT * (radius / BOT_RADIUS)) / length;
  target[offset] = x * scale;
  target[offset + 1] = y * scale;
  target[offset + 2] = radius * scale;
}

function decalGeometry(count) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array((count + 1) * 3), 3));
  const index = [];
  for (let step = 0; step < count; step += 1) index.push(0, 1 + step, 1 + ((step + 1) % count));
  geometry.setIndex(index);
  return geometry;
}

function shapeEye(geometry, outline, radius = BOT_RADIUS) {
  const array = geometry.attributes.position.array;
  let cx = 0;
  let cy = 0;
  outline.forEach(([x, y]) => {
    cx += x / outline.length;
    cy += y / outline.length;
  });
  onSphere(array, 0, cx, cy, radius);
  outline.forEach(([x, y], index) => onSphere(array, (index + 1) * 3, x, y, radius));
  geometry.attributes.position.needsUpdate = true;
  geometry.computeBoundingSphere();
}

export function eyeDecal(side, radius = BOT_RADIUS) {
  const geometry = decalGeometry(EYE_POINTS);
  const ratio = radius / BOT_RADIUS;
  const shape = (openness = 1, expression = 'open') => {
    const pose = eyePose(expression, openness)[side < 0 ? 'left' : 'right'];
    shapeEye(geometry, eyeOutline(pose, side).map(([x, y]) => [x * ratio, y * ratio]), radius);
  };
  shape();
  return { geometry, shape };
}

export function blinkOpenness(sinceBlink) {
  if (sinceBlink < 0 || sinceBlink >= BLINK_SECONDS) return 1;
  return Math.abs(1 - (2 * sinceBlink) / BLINK_SECONDS);
}

function arcGeometry() {
  const steps = 18;
  const array = new Float32Array((steps + 1) * 2 * 3);
  const index = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = Math.PI * (0.12 + 0.76 * (step / steps));
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const x = EYE_W * 1.35 * nx;
    const y = EYE_H * 0.55 * ny - EYE_H * 0.2;
    onSphere(array, step * 6, x + nx * ARC_THICKNESS, y + ny * ARC_THICKNESS);
    onSphere(array, step * 6 + 3, x - nx * ARC_THICKNESS, y - ny * ARC_THICKNESS);
    if (step < steps) {
      const outer = step * 2;
      index.push(outer, outer + 2, outer + 1, outer + 1, outer + 2, outer + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(array, 3));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

function spoonParts(geometry, metal) {
  const handle = new Mesh(geometry(new CylinderGeometry(0.008, 0.011, 0.24, 12)), metal);
  handle.position.y = 0.15;
  const bowl = new Mesh(geometry(new SphereGeometry(1, 20, 12)), metal);
  bowl.scale.set(0.034, 0.05, 0.014);
  bowl.position.y = -0.005;
  return [handle, bowl];
}

function buildRig() {
  const geometries = [];
  const materials = [];
  const textures = [];
  const keep = (list) => (value) => {
    list.push(value);
    return value;
  };
  const geometry = keep(geometries);
  const material = keep(materials);
  const group = (name, children = [], position = [0, 0, 0]) => {
    const value = new Group();
    value.name = name;
    value.position.set(...position);
    children.forEach((child) => value.add(child));
    return value;
  };
  const mesh = (shape, surface, position = [0, 0, 0], rotation = [0, 0, 0], name = '') => {
    const value = new Mesh(shape, surface);
    value.position.set(...position);
    value.rotation.set(...rotation);
    value.name = name;
    value.castShadow = true;
    return value;
  };
  const hide = (object) => {
    object.scale.setScalar(HIDDEN);
    return object;
  };

  const shell = material(new MeshPhysicalMaterial({ roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, sheen: 0 }));
  const eyeSurface = material(new MeshBasicMaterial());
  const hat = material(new MeshPhysicalMaterial({ roughness: 0.88, sheen: 0.7, sheenRoughness: 0.55 }));
  const beret = material(new MeshPhysicalMaterial({ roughness: 0.8, sheen: 0.6, sheenRoughness: 0.5 }));
  const leaf = material(new MeshStandardMaterial({ roughness: 0.55 }));
  const metal = material(new MeshPhysicalMaterial({ roughness: 0.24, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.5 }));
  const iron = material(new MeshPhysicalMaterial({ roughness: 0.38, metalness: 0.7, clearcoat: 0.3 }));
  const brass = material(new MeshPhysicalMaterial({ roughness: 0.2, metalness: 1, clearcoat: 0.5 }));
  const wood = material(new MeshStandardMaterial({ roughness: 0.55 }));
  const feather = material(new MeshPhysicalMaterial({ roughness: 0.6, sheen: 0.5 }));
  const food = material(new MeshPhysicalMaterial({ roughness: 0.45, clearcoat: 0.4 }));
  const glass = material(new MeshPhysicalMaterial({ roughness: 0.02, transparent: true, opacity: 0.25, clearcoat: 1, depthWrite: false }));
  const steamMaterial = material(new MeshStandardMaterial({ roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }));

  const R = BOT_RADIUS;
  const sphere = mesh(geometry(new SphereGeometry(R, 64, 48)), shell, [0, 0, 0], [0, 0, 0], 'shell');

  const arcShape = geometry(arcGeometry());
  const eye = (side) => {
    const shape = geometry(decalGeometry(EYE_POINTS));
    shapeEye(shape, eyeOutline(eyePose('open').left, side));
    const pupil = mesh(shape, eyeSurface);
    pupil.castShadow = false;
    const arc = mesh(arcShape, eyeSurface);
    arc.castShadow = false;
    arc.visible = false;
    const pivot = group(side < 0 ? 'eyeL' : 'eyeR', [pupil, arc]);
    pivot.rotation.set(-EYE_PITCH, EYE_YAW + side * EYE_GAP / 2, 0);
    return { pivot, pupil, arc, shape, side };
  };
  const left = eye(-1);
  const right = eye(1);
  const markRing = mesh(geometry(new TorusGeometry(0.07, 0.02, 10, 28, Math.PI * 1.4)), eyeSurface, [0, 0.09, 0], [0, 0, -Math.PI * 0.4]);
  const markStem = mesh(geometry(new CapsuleGeometry(0.02, 0.05, 4, 10)), eyeSurface, [0, -0.02, 0]);
  const markDot = mesh(geometry(new SphereGeometry(0.024, 16, 12)), eyeSurface, [0, -0.11, 0]);
  const mark = hide(group('mark', [markRing, markStem, markDot], [0.42, R + 0.42, 0.12]));
  const gaze = group('gaze', [left.pivot, right.pivot]);
  const face = group('face', [gaze]);

  const hatBand = mesh(geometry(new CylinderGeometry(0.2, 0.2, 0.09, 56)), hat, [0, HAT_BAND_Y, 0]);
  const hatColumn = mesh(geometry(pleat(new CylinderGeometry(0.235, 0.2, 0.27, 56, 6, true), 12, 0.045)), hat, [0, HAT_BAND_Y + 0.17, 0]);
  const crown = pleat(new SphereGeometry(1, 56, 24), 8, 0.07);
  crown.scale(0.29, 0.15, 0.29);
  const hatCrown = mesh(geometry(crown), hat, [0, HAT_BAND_Y + 0.33, 0]);

  const wreath = new InstancedMesh(geometry(new SphereGeometry(1, 12, 8)), leaf, LEAF_COUNT);
  const dummy = new Object3D();
  for (let index = 0; index < LEAF_COUNT; index += 1) {
    const angle = Math.PI * 0.68 + (index / (LEAF_COUNT - 1)) * Math.PI * 1.64;
    dummy.position.set(Math.cos(angle) * 0.215, (index % 2 ? 0.012 : -0.012), -Math.sin(angle) * 0.215);
    dummy.rotation.set(0, angle + Math.PI / 2, (index % 2 ? 1 : -1) * 0.5);
    dummy.scale.set(0.06, 0.02, 0.032);
    dummy.updateMatrix();
    wreath.setMatrixAt(index, dummy.matrix);
  }
  wreath.castShadow = true;
  const laurel = hide(group('costume_philosopher_head', [wreath], [0, HAT_BAND_Y, 0]));
  const chef = group('costume_chef_head', [hatBand, hatColumn, hatCrown, laurel]);
  chef.rotation.set(-0.1, 0, 0.14);

  const beretBody = mesh(geometry(new SphereGeometry(1, 40, 20)), beret, [0.03, R * 0.86, 0]);
  beretBody.scale.set(0.3, 0.085, 0.3);
  const beretStem = mesh(geometry(new CylinderGeometry(0.008, 0.012, 0.04, 10)), beret, [0.03, R * 0.86 + 0.09, 0]);
  const beretHead = hide(group('costume_devil_hat', [beretBody, beretStem]));
  beretHead.rotation.set(-0.08, 0, 0.22);

  const monocleRing = mesh(geometry(new TorusGeometry(0.075, 0.012, 12, 40)), brass, [0, 0, 0]);
  const monocleGlass = mesh(geometry(new CylinderGeometry(0.068, 0.068, 0.004, 32)), glass, [0, 0, 0], [Math.PI / 2, 0, 0]);
  monocleGlass.castShadow = false;
  const monocle = group('monocle', [monocleRing, monocleGlass], [0, 0, R + 0.02]);
  const monoclePivot = hide(group('costume_devil_head', [monocle]));
  monoclePivot.rotation.set(-EYE_PITCH, EYE_YAW + EYE_GAP / 2, 0);

  const toolAt = (name, children, rotation = [0, 0, 0]) => {
    const value = group(name, children, REST[name.replace('prop_', '')]);
    value.rotation.set(...rotation);
    return hide(value);
  };
  const quill = toolAt('prop_goal', [
    mesh(geometry(new CylinderGeometry(0.006, 0.002, 0.26, 10)), metal, [0, -0.02, 0]),
    (() => {
      const plume = mesh(geometry(new SphereGeometry(1, 20, 12)), feather, [0, 0.08, 0]);
      plume.scale.set(0.04, 0.15, 0.012);
      return plume;
    })()
  ], [0.35, 0, -0.35]);
  const panFood = group('pan_food', [], [0, PAN_FOOD_Y, 0]);
  for (const [x, z, size] of [[-0.05, 0.03, 1], [0.06, -0.04, 0.8], [0.02, 0.07, 0.7], [-0.02, -0.07, 0.75]]) {
    const piece = mesh(geometry(new SphereGeometry(1, 14, 10)), food, [x, 0, z]);
    piece.scale.set(0.045 * size, 0.022 * size, 0.04 * size);
    panFood.add(piece);
  }
  const herb = mesh(geometry(new SphereGeometry(1, 10, 8)), leaf, [0.0, 0.015, 0.0], [0.3, 0.6, 0]);
  herb.scale.set(0.026, 0.007, 0.014);
  panFood.add(herb);
  const panBody = group('pan_body', [
    mesh(geometry(lathe([[0, 0], [0.17, 0], [0.19, 0.01], [0.205, 0.055], [0.192, 0.06], [0.176, 0.016], [0, 0.016]], 48)), iron, [0, 0, 0]),
    mesh(geometry(new CylinderGeometry(0.016, 0.02, 0.26, 12)), wood, [0.33, 0.06, 0], [0, 0, Math.PI / 2 + 0.2]),
    mesh(geometry(new CylinderGeometry(0.012, 0.012, 0.06, 10)), iron, [0.21, 0.045, 0], [0, 0, Math.PI / 2 + 0.2]),
    panFood
  ]);
  panBody.scale.setScalar(PAN_SCALE);
  const pan = toolAt('prop_maker', [panBody], [0, 0.55, 0]);
  const spoon = toolAt('prop_verify', spoonParts(geometry, metal), [-0.6, 0, -0.2]);
  const magnifier = toolAt('prop_review', [
    mesh(geometry(new CylinderGeometry(0.016, 0.02, 0.18, 12)), wood, [0, -0.19, 0]),
    mesh(geometry(new TorusGeometry(0.1, 0.016, 12, 40)), brass, [0, 0, 0]),
    (() => {
      const lens = mesh(geometry(new CylinderGeometry(0.092, 0.092, 0.006, 32)), glass, [0, 0, 0], [Math.PI / 2, 0, 0]);
      lens.castShadow = false;
      return lens;
    })()
  ], [0.75, 0, 0.15]);
  const taster = toolAt('prop_judge', spoonParts(geometry, metal), [-0.6, 0, 0.15]);
  const tray = toolAt('prop_deliver', [
    mesh(geometry(lathe([[0, 0], [0.25, 0], [0.265, 0.012], [0.26, 0.022], [0, 0.016]], 48)), metal, [0, 0, 0]),
    mesh(geometry(lathe([[0, 0.02], [0.17, 0.02], [0.175, 0.03], [0.165, 0.08], [0.13, 0.14], [0.07, 0.175], [0, 0.18]], 48)), metal, [0, 0, 0]),
    mesh(geometry(new SphereGeometry(0.022, 16, 12)), metal, [0, 0.195, 0])
  ], [0.12, 0, -0.04]);

  const puffShape = geometry(new SphereGeometry(0.1, 18, 12));
  const steam = hide(group('steam', [-0.32, 0.32, 0].map((x, index) => {
    const value = mesh(puffShape, steamMaterial, [x, 1.05, 0], [0, 0, 0], `puff${index + 1}`);
    value.castShadow = false;
    return hide(value);
  })));

  const head = group('head', [sphere, face, monoclePivot, chef, beretHead, mark], [0, R, 0]);
  const body = group('body', [head, quill, pan, spoon, magnifier, taster, tray, steam]);
  const hop = group('hop', [body]);
  const stride = group('stride', [hop]);
  const shadowTexture = radialTexture(1.7);
  textures.push(shadowTexture);
  const shadow = contactShadow(1.05, 1.05, { opacity: 0.42, texture: shadowTexture });
  shadow.position.y = 0.004;
  geometries.push(shadow.geometry);
  materials.push(shadow.material);
  const root = group('root', [shadow, stride]);

  return {
    root,
    stride,
    hop,
    body,
    face,
    gaze,
    eyes: { left, right },
    mark,
    shadow,
    costumes: { philosopher: [laurel], devil: [monoclePivot, beretHead], chef: [chef] },
    materials: { shell, eye: eyeSurface, hat, beret, leaf, metal, iron, brass, wood, feather, food, glass, steam: steamMaterial },
    geometries,
    allMaterials: materials,
    textures
  };
}

const PAINT = {
  hat: '--prop-paper',
  beret: '--bot-devil-trim',
  iron: '--kitchen-iron',
  food: '--kitchen-food',
  leaf: '--bot-leaf',
  metal: '--prop-metal',
  brass: '--room-brass',
  wood: '--prop-wood',
  feather: '--prop-paper',
  glass: '--prop-paper',
  steam: '--prop-paper'
};

function ease(current, target, seconds, constant) {
  const next = current + (target - current) * (1 - Math.exp(-seconds / constant));
  return Math.abs(next - target) < SETTLED ? target : next;
}

export function createBot({ reducedMotion = false, size = 1, read } = {}) {
  const rig = buildRig();
  rig.root.scale.setScalar(size);
  const clips = buildClips();
  const mixer = new AnimationMixer(rig.root);
  const stageActions = Object.fromEntries(RING_STAGES.map((stage) => [stage, mixer.clipAction(clips.stages[stage])]));
  const waitingActions = clips.waiting.map((clip) => mixer.clipAction(clip));
  const reaction = mixer.clipAction(clips.reaction);
  reaction.setLoop(LoopOnce, 1);
  const fading = new Set();
  const glance = { x: 0, y: 0, toX: 0, toY: 0 };
  const tones = { devil: 0, philosopher: 0, chef: 1, anger: 0 };
  const targets = { devil: 0, philosopher: 0, chef: 1, anger: 0 };
  const eyeNow = { left: { ...eyePose('open').left }, right: { ...eyePose('open').right } };
  const palette = {};
  let current = null;
  let lastKey = null;
  let model = null;
  let face = 'open';
  const clock = () => performance.now() / 1000;
  let happyUntil = 0;
  let blink = { at: clock() + nextBlink(), until: 0 };

  function onFinished(event) {
    if (event.action === reaction) reaction.stop();
  }
  mixer.addEventListener('finished', onFinished);

  function loopActionFor(next) {
    if (next.mode === 'working') return stageActions[next.botStage];
    if (next.mode === 'waiting') return waitingActions[Math.min(Math.max((next.waitLevel || 1) - 1, 0), waitingActions.length - 1)];
    return null;
  }

  function applyTones() {
    const { shell, eye } = rig.materials;
    if (!palette.shell) return;
    shell.color.copy(palette.shell).lerp(palette.devilShell, tones.devil);
    if (tones.anger > 0) shell.color.lerp(palette.danger, tones.anger * 0.35);
    shell.roughness = 0.32 + tones.devil * 0.2;
    eye.color.copy(palette.eye).lerp(palette.devilEye, tones.devil * 0.85);
    const show = (list, amount) => list.forEach((part) => part.scale.setScalar(Math.max(HIDDEN, amount)));
    show(rig.costumes.philosopher, tones.philosopher);
    show(rig.costumes.devil, tones.devil);
    show(rig.costumes.chef, tones.chef);
  }

  function staticPose(next) {
    RING_STAGES.forEach((stage) => {
      const prop = rig.root.getObjectByName(`prop_${stage}`);
      if (prop) prop.scale.setScalar(next.mode === 'working' && stage === next.botStage ? 1 : HIDDEN);
    });
  }

  function settleFades() {
    for (const action of fading) {
      if (action.getEffectiveWeight() === 0) {
        action.stop();
        fading.delete(action);
      }
    }
  }

  function stepTones(seconds) {
    let moving = false;
    for (const name of Object.keys(tones)) {
      const next = reducedMotion ? targets[name] : ease(tones[name], targets[name], seconds, TWEEN_SECONDS);
      if (next !== targets[name]) moving = true;
      tones[name] = next;
    }
    applyTones();
    return moving;
  }

  function openness(now) {
    if (now >= blink.until) return 1;
    const t = (blink.until - now) / BLINK_SECONDS;
    return Math.abs(t * 2 - 1);
  }

  function stepBlink(now) {
    if (reducedMotion) return false;
    if (now < blink.until) return true;
    if (blink.until && now >= blink.until) blink = { at: now + nextBlink(), until: 0 };
    if (now >= blink.at) {
      blink.until = now + BLINK_SECONDS;
      return true;
    }
    return false;
  }

  function stepEyes(seconds, now) {
    const expression = now < happyUntil ? 'happy' : face;
    const pose = eyePose(expression, openness(now));
    let moving = false;
    for (const side of ['left', 'right']) {
      const state = eyeNow[side];
      const want = pose[side];
      let changed = false;
      for (const key of EYE_KEYS) {
        const next = reducedMotion ? want[key] : ease(state[key], want[key], seconds, EYE_EASE_SECONDS);
        if (next !== want[key]) moving = true;
        if (next !== state[key]) changed = true;
        state[key] = next;
      }
      const eye = rig.eyes[side];
      if (changed) shapeEye(eye.shape, eyeOutline(state, eye.side));
      eye.arc.visible = pose.arcs;
      eye.pupil.visible = !pose.arcs;
    }
    rig.mark.scale.setScalar(pose.mark ? 1 : HIDDEN);
    return moving;
  }

  function paintBody(readToken) {
    for (const [name, token] of Object.entries(PAINT)) {
      const value = readToken(token);
      if (value && rig.materials[name]) rig.materials[name].color.setStyle(value);
    }
    rig.materials.steam.emissive.setStyle(readToken('--prop-paper'));
    rig.materials.steam.emissiveIntensity = 0.25;
    rig.shadow.material.color.setStyle(readToken('--shadow'));
    palette.shell = new Color().setStyle(readToken('--brand'));
    palette.eye = new Color().setStyle(readToken('--bot-visor'));
    palette.devilShell = new Color().setStyle(readToken('--bot-devil'));
    palette.devilEye = new Color().setStyle(readToken('--bot-devil-eye'));
    palette.danger = new Color().setStyle(readToken('--danger'));
    applyTones();
  }

  return {
    root: rig.root,
    hop: rig.hop,
    paint(readToken = read) {
      paintBody(readToken);
    },
    update(next) {
      model = next;
      const costume = stationConfig(next.botStage).costume;
      const working = next.mode !== 'waiting';
      targets.philosopher = costume === 'philosopher' ? 1 : 0;
      targets.devil = costume === 'devil' && working ? 1 : 0;
      targets.chef = 1 - targets.devil;
      targets.anger = next.mode === 'waiting' ? Math.max(0, ((next.waitLevel || 1) - 2) / 2) : 0;
      face = botFace(next);
      const key = `${next.mode}|${next.botStage}|${next.waitLevel || 1}`;
      if (key === lastKey) return;
      lastKey = key;
      if (reducedMotion) {
        staticPose(next);
        return;
      }
      const action = loopActionFor(next);
      if (action === current) return;
      if (action) {
        fading.delete(action);
        action.reset().setEffectiveWeight(1).play();
        if (current) current.crossFadeTo(action, CROSSFADE_SECONDS, false);
        else action.fadeIn(CROSSFADE_SECONDS);
      } else if (current) {
        current.fadeOut(CROSSFADE_SECONDS);
      }
      if (current) fading.add(current);
      current = action;
    },
    react() {
      if (reducedMotion) return false;
      reaction.reset().play();
      happyUntil = clock() + REACTION_SECONDS + 0.5;
      return true;
    },
    lookAt(x, y) {
      glance.toX = x;
      glance.toY = y;
    },
    stride(lift, moving) {
      const shape = stride(lift, moving && !reducedMotion);
      rig.stride.scale.set(shape.xz, shape.y, shape.xz);
    },
    step(seconds) {
      const now = clock();
      mixer.update(seconds);
      settleFades();
      glance.x = reducedMotion ? glance.toX : ease(glance.x, glance.toX, seconds, GLANCE_EASE_SECONDS);
      glance.y = reducedMotion ? glance.toY : ease(glance.y, glance.toY, seconds, GLANCE_EASE_SECONDS);
      rig.gaze.rotation.set(-glance.y * 0.3, glance.x * 0.5, 0);
      const lift = rig.hop.position.y + rig.body.position.y;
      rig.shadow.scale.setScalar(1 / (1 + lift * 1.2));
      rig.shadow.material.opacity = 0.42 / (1 + lift * 2.2);
      const toning = stepTones(seconds);
      const blinking = stepBlink(now);
      const eyes = stepEyes(seconds, now);
      const glancing = glance.x !== glance.toX || glance.y !== glance.toY;
      return Boolean(current || fading.size || reaction.isRunning() || glancing || toning || blinking || eyes || now < happyUntil);
    },
    cookPhase() {
      const action = stageActions.maker;
      if (reducedMotion || current !== action || !action.isRunning()) return null;
      return action.time / TOSS_SECONDS;
    },
    wakeIn() {
      return reducedMotion ? Infinity : Math.max(0, blink.at - clock());
    },
    height: BOT_HEIGHT * size,
    dispose() {
      mixer.removeEventListener('finished', onFinished);
      mixer.stopAllAction();
      mixer.uncacheRoot(rig.root);
      rig.root.removeFromParent();
      rig.geometries.forEach((value) => value.dispose());
      rig.allMaterials.forEach((value) => value.dispose());
      rig.textures.forEach((value) => value.dispose());
    }
  };
}
