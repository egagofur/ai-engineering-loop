import {
  AnimationClip,
  AnimationMixer,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LoopOnce,
  Mesh,
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
import { contactShadow, lathe, radialTexture, roundedBox } from './forms.js';

export const REACTION_SECONDS = 0.7;
export const BOT_RADIUS = 0.5;
export const BOT_HEIGHT = BOT_RADIUS * 2;
export const BLINK_SECONDS = 0.14;
export const EYE_SHAPES = ['open', 'focus', 'wide', 'squint', 'stern', 'happy', 'question', 'annoyed', 'angry'];
export const EYE_YAW = 0.3;
export const EYE_GAP = 0.27;
export const EYE_PITCH = 0.26;
const EYE_DEPTH = 0.3;

const CROSSFADE_SECONDS = 0.45;
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
  return new AnimationClip('goal', duration, [
    shown('prop_goal', duration),
    ...breathe(duration),
    number('prop_goal.rotation[z]', times, [-0.5, -0.3, -0.55, -0.32, -0.5, -0.28, -0.52, -0.3, -0.5]),
    number('face.rotation[x]', [0, duration / 2, duration], [0.16, 0.22, 0.16])
  ]);
}

function swingClip(stage, duration) {
  const raise = duration * 0.42;
  const strike = duration * 0.58;
  return new AnimationClip(stage, duration, [
    shown(`prop_${stage}`, duration),
    ...breathe(duration),
    number(`prop_${stage}.rotation[z]`, [0, raise, strike, strike + 0.08, duration], [0, 1.1, -0.35, -0.2, 0]),
    vector('hop.scale', [0, strike, strike + 0.06, strike + 0.18, duration], [1, 1, 1, 1, 1, 1, 1.06, 0.92, 1.06, 1, 1, 1, 1, 1, 1]),
    number('face.rotation[x]', [0, raise, strike, duration], [0.05, -0.06, 0.12, 0.05])
  ]);
}

function verifyClip() {
  const duration = 2.6;
  return new AnimationClip('verify', duration, [
    shown('prop_verify', duration),
    ...breathe(duration),
    number('prop_verify.position[y]', [0, duration * 0.35, duration * 0.6, duration], [0.34, 0.6, 0.6, 0.34]),
    number('face.rotation[y]', [0, duration * 0.6, duration * 0.8, duration], [0, 0, 0.22, 0])
  ]);
}

function reviewClip() {
  const duration = 3.2;
  return new AnimationClip('review', duration, [
    shown('prop_review', duration),
    ...breathe(duration, 0.015),
    number('prop_review.rotation[z]', [0, duration / 2, duration], [0.15, -0.1, 0.15]),
    number('face.rotation[z]', [0, duration * 0.4, duration * 0.7, duration], [0.08, 0.14, 0.03, 0.08]),
    number('body.rotation[z]', [0, duration / 2, duration], [0.05, -0.04, 0.05])
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
      maker: swingClip('maker', 1.1),
      verify: verifyClip(),
      review: reviewClip(),
      judge: swingClip('judge', 1.6),
      deliver: deliverClip()
    },
    waiting: waitingClips(),
    reaction: reactionClip()
  };
}

const POSES = {
  open: { sy: 1, sx: 1, tilt: 0, lift: 0 },
  focus: { sy: 0.78, sx: 1, tilt: 0, lift: -0.01 },
  wide: { sy: 1.18, sx: 1.12, tilt: 0, lift: 0.01 },
  squint: { sy: 0.32, sx: 1.15, tilt: 0.12, lift: -0.01 },
  stern: { sy: 0.7, sx: 1.05, tilt: 0.22, lift: 0 },
  happy: { sy: 1, sx: 1, tilt: 0, lift: 0, arcs: true },
  question: { sy: 1.2, sx: 1.12, tilt: 0, lift: 0.01, mark: true },
  annoyed: { sy: 0.45, sx: 1.1, tilt: 0.05, lift: -0.02 },
  angry: { sy: 0.62, sx: 1.08, tilt: 0.42, lift: -0.01 }
};

export function eyePose(expression, openness = 1) {
  const pose = POSES[expression] || POSES.open;
  const lid = Math.min(1, Math.max(0.06, openness));
  const eye = (side) => ({ sx: pose.sx, sy: pose.sy * lid, rz: side * pose.tilt, dy: pose.lift });
  return { left: eye(-1), right: eye(1), arcs: Boolean(pose.arcs) && lid > 0.5, mark: Boolean(pose.mark) };
}

export function nextBlink(random = Math.random) {
  return 2.6 + random() * 3.2;
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
  const eyeSurface = material(new MeshPhysicalMaterial({ roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, emissiveIntensity: 0 }));
  const hat = material(new MeshPhysicalMaterial({ roughness: 0.75, sheen: 0.6, sheenRoughness: 0.6 }));
  const leaf = material(new MeshStandardMaterial({ roughness: 0.55 }));
  const metal = material(new MeshPhysicalMaterial({ roughness: 0.22, metalness: 1, clearcoat: 0.4 }));
  const brass = material(new MeshPhysicalMaterial({ roughness: 0.25, metalness: 1, clearcoat: 0.5 }));
  const wood = material(new MeshStandardMaterial({ roughness: 0.55 }));
  const feather = material(new MeshPhysicalMaterial({ roughness: 0.6, sheen: 0.5 }));
  const glass = material(new MeshPhysicalMaterial({ roughness: 0.02, transparent: true, opacity: 0.25, clearcoat: 1, depthWrite: false }));
  const steamMaterial = material(new MeshStandardMaterial({ roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }));

  const R = BOT_RADIUS;
  const sphere = mesh(geometry(new SphereGeometry(R, 64, 48)), shell, [0, 0, 0], [0, 0, 0], 'shell');

  const eyeShape = geometry(new CapsuleGeometry(0.05, 0.13, 6, 18));
  const arcShape = geometry(new TorusGeometry(0.06, 0.019, 10, 24, Math.PI));
  const eye = (side) => {
    const pupil = mesh(eyeShape, eyeSurface, [0, 0, R * 0.975]);
    pupil.scale.z = EYE_DEPTH;
    pupil.castShadow = false;
    const arc = mesh(arcShape, eyeSurface, [0, -0.02, R * 0.99]);
    arc.castShadow = false;
    hide(arc);
    const pivot = group(side < 0 ? 'eyeL' : 'eyeR', [pupil, arc]);
    pivot.rotation.set(-EYE_PITCH, EYE_YAW + side * EYE_GAP / 2, 0);
    return { pivot, pupil, arc };
  };
  const left = eye(-1);
  const right = eye(1);
  const markRing = mesh(geometry(new TorusGeometry(0.07, 0.02, 10, 28, Math.PI * 1.4)), eyeSurface, [0, 0.09, 0], [0, 0, -Math.PI * 0.4]);
  const markStem = mesh(geometry(new CapsuleGeometry(0.02, 0.05, 4, 10)), eyeSurface, [0, -0.02, 0]);
  const markDot = mesh(geometry(new SphereGeometry(0.024, 16, 12)), eyeSurface, [0, -0.11, 0]);
  const mark = hide(group('mark', [markRing, markStem, markDot], [0.34, R + 0.28, 0.12]));
  const gaze = group('gaze', [left.pivot, right.pivot]);
  const face = group('face', [gaze]);

  const hatBand = mesh(geometry(new CylinderGeometry(0.17, 0.19, 0.09, 40)), hat, [0, 0, 0]);
  const hatPuff = mesh(geometry(lathe([[0, 0], [0.17, 0], [0.22, 0.035], [0.25, 0.1], [0.24, 0.17], [0.19, 0.215], [0.1, 0.235], [0, 0.24]], 40)), hat, [0, 0.035, 0]);
  const chef = hide(group('costume_chef_head', [hatBand, hatPuff], [-0.05, R * 0.8, -0.04]));
  chef.rotation.set(-0.08, 0, 0.12);

  const wreath = new InstancedMesh(geometry(new SphereGeometry(1, 12, 8)), leaf, LEAF_COUNT);
  const dummy = new Object3D();
  for (let index = 0; index < LEAF_COUNT; index += 1) {
    const angle = Math.PI * 0.68 + (index / (LEAF_COUNT - 1)) * Math.PI * 1.64;
    dummy.position.set(Math.cos(angle) * 0.36, 0, -Math.sin(angle) * 0.36);
    dummy.rotation.set(0, angle + Math.PI / 2, (index % 2 ? 1 : -1) * 0.55);
    dummy.scale.set(0.085, 0.026, 0.045);
    dummy.updateMatrix();
    wreath.setMatrixAt(index, dummy.matrix);
  }
  wreath.castShadow = true;
  const laurel = hide(group('costume_philosopher_head', [wreath], [0, R * 0.68, 0]));
  laurel.rotation.set(-0.12, 0, 0.06);

  const monocleRing = mesh(geometry(new TorusGeometry(0.075, 0.012, 12, 40)), brass, [0, 0, 0]);
  const monocleGlass = mesh(geometry(new CylinderGeometry(0.068, 0.068, 0.004, 32)), glass, [0, 0, 0], [Math.PI / 2, 0, 0]);
  monocleGlass.castShadow = false;
  const monocle = group('monocle', [monocleRing, monocleGlass], [0, 0, R + 0.02]);
  const monoclePivot = hide(group('costume_devil_head', [monocle]));
  monoclePivot.rotation.set(-EYE_PITCH, EYE_YAW + EYE_GAP / 2, 0);

  const toolAt = (name, children, position, rotation = [0, 0, 0]) => {
    const value = group(name, children, position);
    value.rotation.set(...rotation);
    return hide(value);
  };
  const quill = toolAt('prop_goal', [
    mesh(geometry(new CylinderGeometry(0.006, 0.01, 0.26, 10)), metal, [0, -0.02, 0]),
    (() => {
      const plume = mesh(geometry(new SphereGeometry(1, 20, 12)), feather, [0, 0.08, 0]);
      plume.scale.set(0.04, 0.15, 0.012);
      return plume;
    })()
  ], [0.6, 0.4, 0.12], [0.2, 0, -0.5]);
  const spatula = toolAt('prop_maker', [
    mesh(geometry(new CylinderGeometry(0.016, 0.02, 0.24, 12)), wood, [0, -0.08, 0]),
    mesh(geometry(roundedBox(0.13, 0.16, 0.014, 0.006)), metal, [0, 0.11, 0])
  ], [0.62, 0.42, 0.1]);
  const spoon = toolAt('prop_verify', [
    mesh(geometry(new CylinderGeometry(0.01, 0.012, 0.24, 10)), metal, [0, -0.06, 0]),
    (() => {
      const bowl = mesh(geometry(new SphereGeometry(1, 20, 12)), metal, [0, 0.1, 0.01]);
      bowl.scale.set(0.045, 0.06, 0.02);
      return bowl;
    })()
  ], [0.6, 0.34, 0.16], [0.3, 0, -0.35]);
  const magnifier = toolAt('prop_review', [
    mesh(geometry(new CylinderGeometry(0.016, 0.02, 0.18, 12)), wood, [0, -0.17, 0]),
    mesh(geometry(new TorusGeometry(0.1, 0.016, 12, 40)), brass, [0, 0, 0]),
    (() => {
      const lens = mesh(geometry(new CylinderGeometry(0.092, 0.092, 0.006, 32)), glass, [0, 0, 0], [Math.PI / 2, 0, 0]);
      lens.castShadow = false;
      return lens;
    })()
  ], [0.58, 0.46, 0.26], [0.1, -0.4, 0.15]);
  const gavel = toolAt('prop_judge', [
    mesh(geometry(new CylinderGeometry(0.014, 0.016, 0.26, 12)), wood, [0, -0.04, 0]),
    mesh(geometry(new CylinderGeometry(0.045, 0.045, 0.16, 24)), wood, [0, 0.1, 0], [0, 0, Math.PI / 2]),
    mesh(geometry(new CylinderGeometry(0.048, 0.048, 0.02, 24)), brass, [-0.07, 0.1, 0], [0, 0, Math.PI / 2]),
    mesh(geometry(new CylinderGeometry(0.048, 0.048, 0.02, 24)), brass, [0.07, 0.1, 0], [0, 0, Math.PI / 2])
  ], [0.6, 0.48, 0.1]);
  const tray = toolAt('prop_deliver', [
    mesh(geometry(new CylinderGeometry(0.26, 0.24, 0.02, 40)), metal, [0, 0, 0]),
    mesh(geometry(lathe([[0, 0.17], [0.06, 0.165], [0.13, 0.13], [0.18, 0.07], [0.2, 0.012], [0, 0.012]], 40)), metal, [0, 0, 0]),
    mesh(geometry(new SphereGeometry(0.025, 14, 10)), metal, [0, 0.19, 0])
  ], [0, R * 2 + 0.06, 0]);
  tray.rotation.set(0.04, 0, -0.05);

  const puffShape = geometry(new SphereGeometry(0.1, 18, 12));
  const steam = hide(group('steam', [-0.32, 0.32, 0].map((x, index) => {
    const value = mesh(puffShape, steamMaterial, [x, 1.05, 0], [0, 0, 0], `puff${index + 1}`);
    value.castShadow = false;
    return hide(value);
  })));

  const head = group('head', [sphere, face, monoclePivot, chef, laurel, mark], [0, R, 0]);
  const body = group('body', [head, quill, spatula, spoon, magnifier, gavel, tray, steam]);
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
    costumes: { philosopher: [laurel], devil: [monoclePivot], chef: [chef] },
    materials: { shell, eye: eyeSurface, hat, leaf, metal, brass, wood, feather, glass, steam: steamMaterial },
    geometries,
    allMaterials: materials,
    textures
  };
}

const PAINT = {
  hat: '--prop-paper',
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
  const tones = { devil: 0, philosopher: 0, chef: 0, anger: 0 };
  const targets = { devil: 0, philosopher: 0, chef: 0, anger: 0 };
  const eyeNow = { left: { sx: 1, sy: 1, rz: 0, dy: 0 }, right: { sx: 1, sy: 1, rz: 0, dy: 0 } };
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
    eye.color.copy(palette.eye).lerp(palette.devilEye, tones.devil * 0.75);
    eye.emissive.copy(palette.devilEye);
    eye.emissiveIntensity = tones.devil * 0.35;
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
      const now = eyeNow[side];
      const want = pose[side];
      for (const key of ['sx', 'sy', 'rz', 'dy']) {
        const next = reducedMotion ? want[key] : ease(now[key], want[key], seconds, EYE_EASE_SECONDS);
        if (next !== want[key]) moving = true;
        now[key] = next;
      }
      const eye = rig.eyes[side];
      eye.pupil.scale.set(now.sx, now.sy, EYE_DEPTH);
      eye.pupil.rotation.z = now.rz;
      eye.pupil.position.y = now.dy;
      const arcs = pose.arcs ? 1 : HIDDEN;
      eye.arc.scale.setScalar(arcs);
      if (pose.arcs) eye.pupil.scale.setScalar(HIDDEN);
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
      targets.chef = costume === 'chef' ? 1 : 0;
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
