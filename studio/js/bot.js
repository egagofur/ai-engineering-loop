import {
  AnimationClip,
  AnimationMixer,
  CanvasTexture,
  CapsuleGeometry,
  CatmullRomCurve3,
  ClampToEdgeWrapping,
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
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  VectorKeyframeTrack
} from '../vendor/three.module.min.js';

import { RING_STAGES } from './ring2d.js';
import { botFace, stationConfig } from './kitchen.js';
import { contactShadow, lathe, radialTexture, roundedBox } from './forms.js';

export const REACTION_SECONDS = 0.7;
export const BOT_HEIGHT = 1.8;

const CROSSFADE_SECONDS = 0.45;
const GLANCE_EASE_SECONDS = 0.14;
const TWEEN_SECONDS = 0.35;
const SETTLED = 0.0005;
const BLINK_SECONDS = 0.14;
const EYE_CANVAS = [256, 128];
const EYE_ZOOM = 1.32;

const number = (name, times, values) => new NumberKeyframeTrack(name, times, values);
const vector = (name, times, values) => new VectorKeyframeTrack(name, times, values);
const shown = (name, duration) => vector(`${name}.scale`, [0, duration], [1, 1, 1, 1, 1, 1]);
const hold = (name, duration, value) => number(name, [0, duration], [value, value]);

function breathe(duration, lift = 0.03) {
  const half = duration / 2;
  return [
    number('body.position[y]', [0, half, duration], [0, lift, 0]),
    vector('body.scale', [0, half, duration], [1, 1, 1, 1.015, 0.985, 1.015, 1, 1, 1])
  ];
}

function cycle(duration, count, values) {
  const times = [];
  const out = [];
  for (let index = 0; index <= count; index += 1) {
    times.push(Number(((duration * index) / count).toFixed(4)));
    out.push(values[index % values.length]);
  }
  out[out.length - 1] = values[0];
  return [times, out];
}

function goalClip() {
  const duration = 2.4;
  const [strokeTimes, strokeValues] = cycle(duration, 12, [-1.05, -0.9]);
  const [sideTimes, sideValues] = cycle(duration, 6, [0.25, 0.05, -0.1]);
  return new AnimationClip('goal', duration, [
    shown('prop_goal', duration),
    ...breathe(duration, 0.02),
    number('armR.rotation[x]', strokeTimes, strokeValues),
    number('armR.rotation[z]', sideTimes, sideValues),
    hold('armL.rotation[x]', duration, -1.0),
    hold('armL.rotation[z]', duration, 0.35),
    number('head.rotation[x]', [0, duration / 2, duration], [0.28, 0.34, 0.28]),
    number('head.rotation[z]', [0, duration / 2, duration], [0.05, -0.05, 0.05])
  ]);
}

function swingClip(stage, duration, rest) {
  const raise = duration * 0.45;
  const strike = duration * 0.58;
  return new AnimationClip(stage, duration, [
    shown(`prop_${stage}`, duration),
    ...breathe(duration, 0.02),
    number('armR.rotation[x]', [0, raise, strike, strike + 0.08, duration], [rest, -2.5, -0.55, -0.7, rest]),
    number('body.rotation[x]', [0, raise, strike, duration], [0, -0.06, 0.1, 0]),
    vector('hop.scale', [0, strike, strike + 0.06, strike + 0.18, duration], [1, 1, 1, 1, 1, 1, 1.05, 0.93, 1.05, 1, 1, 1, 1, 1, 1]),
    hold('armL.rotation[z]', duration, 0.35),
    number('head.rotation[x]', [0, raise, strike, duration], [0.1, -0.05, 0.22, 0.1])
  ]);
}

function verifyClip() {
  const duration = 2.6;
  return new AnimationClip('verify', duration, [
    shown('prop_verify', duration),
    ...breathe(duration, 0.02),
    number('armR.rotation[x]', [0, duration * 0.35, duration * 0.55, duration * 0.8, duration], [-0.9, -2.15, -2.15, -0.9, -0.9]),
    number('armR.rotation[z]', [0, duration * 0.35, duration], [0.2, -0.35, 0.2]),
    number('neck.rotation[y]', [0, duration * 0.6, duration * 0.8, duration], [0, 0, 0.25, 0]),
    number('head.rotation[x]', [0, duration * 0.35, duration * 0.6, duration], [0.3, -0.12, -0.05, 0.3]),
    hold('armL.rotation[z]', duration, 0.3)
  ]);
}

function reviewClip() {
  const duration = 3.2;
  return new AnimationClip('review', duration, [
    shown('prop_review', duration),
    ...breathe(duration, 0.015),
    number('armR.rotation[x]', [0, duration / 2, duration], [-1.25, -1.05, -1.25]),
    number('armR.rotation[z]', [0, duration / 2, duration], [-0.25, -0.45, -0.25]),
    hold('armL.rotation[x]', duration, -0.3),
    hold('armL.rotation[z]', duration, 0.55),
    number('head.rotation[x]', [0, duration / 2, duration], [0.32, 0.26, 0.32]),
    number('head.rotation[z]', [0, duration * 0.4, duration * 0.7, duration], [0.12, 0.18, 0.05, 0.12]),
    number('body.rotation[z]', [0, duration / 2, duration], [0.04, -0.03, 0.04])
  ]);
}

function deliverClip() {
  const duration = 1.2;
  return new AnimationClip('deliver', duration, [
    shown('prop_deliver', duration),
    number('body.position[y]', [0, duration / 4, duration / 2, (duration * 3) / 4, duration], [0, 0.07, 0, 0.07, 0]),
    number('body.rotation[z]', [0, duration / 4, (duration * 3) / 4, duration], [0, 0.07, -0.07, 0]),
    hold('armR.rotation[x]', duration, -1.15),
    hold('armL.rotation[x]', duration, -1.15),
    hold('armR.rotation[z]', duration, -0.12),
    hold('armL.rotation[z]', duration, 0.12)
  ]);
}

function puff(name, start, duration) {
  const end = Math.min(duration, start + 0.6);
  return [
    number(`${name}.position[y]`, [0, start, end, duration], [1.75, 1.75, 2.35, 2.35]),
    vector(`${name}.scale`, [0, start, start + 0.1, end, duration], [0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 1, 1, 1, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001])
  ];
}

function waitingClips() {
  const calm = 4;
  const tap = 1.2;
  const grumble = 1.8;
  const rant = 0.9;
  return [
    new AnimationClip('waiting-1', calm, [
      ...breathe(calm, 0.02),
      number('neck.rotation[y]', [0, calm * 0.3, calm * 0.55, calm * 0.85, calm], [0, 0.4, 0.4, -0.3, 0]),
      number('head.rotation[z]', [0, calm * 0.3, calm * 0.85, calm], [0, 0.1, -0.08, 0])
    ]),
    new AnimationClip('waiting-2', tap, [
      number('body.position[y]', [0, 0.15, 0.3, 0.6, 0.75, 0.9, tap], [0, 0.06, 0, 0, 0.06, 0, 0]),
      number('body.rotation[z]', [0, 0.3, 0.6, 0.9, tap], [0, 0.05, 0, -0.05, 0]),
      hold('armR.rotation[z]', tap, 0.7),
      hold('armL.rotation[z]', tap, -0.7),
      hold('armR.rotation[x]', tap, -0.2),
      hold('armL.rotation[x]', tap, -0.2)
    ]),
    new AnimationClip('waiting-3', grumble, [
      ...breathe(grumble, 0.02),
      hold('armR.rotation[x]', grumble, -1.35),
      hold('armL.rotation[x]', grumble, -1.35),
      hold('armR.rotation[z]', grumble, -0.95),
      hold('armL.rotation[z]', grumble, 0.95),
      number('neck.rotation[y]', [0, 0.2, 0.4, 0.6, grumble], [0, 0.12, -0.12, 0.08, 0]),
      number('body.rotation[z]', [0, grumble / 2, grumble], [0.03, -0.03, 0.03])
    ]),
    new AnimationClip('waiting-4', rant, [
      number('body.position[y]', [0, rant * 0.25, rant * 0.5, rant * 0.75, rant], [0, 0.4, 0, 0.32, 0]),
      vector('body.scale', [0, rant * 0.45, rant * 0.5, rant * 0.6, rant], [1, 1, 1, 0.95, 1.06, 0.95, 1.1, 0.88, 1.1, 1, 1, 1, 1, 1, 1]),
      number('armR.rotation[x]', [0, rant / 2, rant], [-2.6, -2.0, -2.6]),
      number('armL.rotation[x]', [0, rant / 2, rant], [-2.0, -2.6, -2.0]),
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
    number('hop.position[y]', [0, end * 0.12, end * 0.45, end * 0.8, end], [0, 0, 0.95, 0, 0]),
    number('hop.rotation[y]', [0, end * 0.12, end * 0.8, end], [0, 0, Math.PI * 2, Math.PI * 2]),
    vector('hop.scale', [0, end * 0.12, end * 0.24, end * 0.8, end * 0.9, end], [1, 1, 1, 1.1, 0.88, 1.1, 0.94, 1.08, 0.94, 1.12, 0.86, 1.12, 1, 1, 1, 1, 1, 1])
  ]);
}

export function buildClips() {
  return {
    stages: {
      goal: goalClip(),
      maker: swingClip('maker', 1.1, -0.5),
      verify: verifyClip(),
      review: reviewClip(),
      judge: swingClip('judge', 1.6, -0.4),
      deliver: deliverClip()
    },
    waiting: waitingClips(),
    reaction: reactionClip()
  };
}

function pill(ctx, x, y, width, height) {
  const r = Math.min(width, height) / 2;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y - height / 2, width, height, r);
  ctx.fill();
}

function clipped(ctx, polygon, draw) {
  ctx.save();
  ctx.beginPath();
  polygon.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
  draw();
  ctx.restore();
}

export const EYE_SHAPES = ['open', 'focus', 'wide', 'squint', 'stern', 'happy', 'question', 'annoyed', 'angry'];

export function drawEyes(ctx, expression, openness, font) {
  const [width, height] = EYE_CANVAS;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(EYE_ZOOM, 0, 0, EYE_ZOOM, (width / 2) * (1 - EYE_ZOOM), (height / 2) * (1 - EYE_ZOOM));
  const eyes = [[92, 64, -1], [164, 64, 1]];
  const lid = Math.max(0.1, openness);
  const shape = (x, y, w, h) => pill(ctx, x, y, w, Math.max(8, h * lid));
  if (expression === 'happy' && openness > 0.5) {
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    eyes.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y + 14, 20, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    });
    return;
  }
  if (expression === 'question' && openness > 0.5) {
    shape(eyes[0][0], 64, 32, 50);
    ctx.font = `700 78px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', eyes[1][0], 68);
    return;
  }
  eyes.forEach(([x, y, side]) => {
    if (expression === 'wide') return shape(x, y, 38, 60);
    if (expression === 'focus') return shape(x, y + 10, 32, 36);
    if (expression === 'squint') {
      ctx.save();
      ctx.translate(x, y + 4);
      ctx.rotate(side * -0.14);
      pill(ctx, 0, 0, 40, Math.max(8, 13 * lid));
      ctx.restore();
      return undefined;
    }
    if (expression === 'stern' || expression === 'annoyed' || expression === 'angry') {
      const slant = expression === 'angry' ? 26 : expression === 'stern' ? 12 : 6;
      const top = expression === 'annoyed' ? y - 2 : y - 22;
      const inner = top + slant;
      const outer = top - (expression === 'annoyed' ? 0 : 4);
      const polygon = side < 0
        ? [[x - 40, outer], [x + 40, inner], [x + 40, y + 60], [x - 40, y + 60]]
        : [[x - 40, inner], [x + 40, outer], [x + 40, y + 60], [x - 40, y + 60]];
      clipped(ctx, polygon, () => shape(x, y, 34, expression === 'angry' ? 46 : 52));
      return undefined;
    }
    return shape(x, y, 32, 50);
  });
}

function eyeSurface(geometry, radii, lift) {
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const inside = 1 - (x / radii[0]) ** 2 - (y / radii[1]) ** 2;
    position.setZ(index, radii[2] * Math.sqrt(Math.max(0.02, inside)) + lift);
  }
  geometry.computeVertexNormals();
  return geometry;
}

const LEAF_COUNT = 22;

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

  const shell = material(new MeshPhysicalMaterial({ roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0 }));
  const trim = material(new MeshPhysicalMaterial({ roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
  const visor = material(new MeshPhysicalMaterial({ roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 }));
  const glow = material(new MeshStandardMaterial({ roughness: 0.4, emissiveIntensity: 0.9 }));
  const cloth = material(new MeshPhysicalMaterial({ roughness: 0.85, sheen: 0.7, sheenRoughness: 0.5 }));
  const leaf = material(new MeshStandardMaterial({ roughness: 0.55 }));
  const horn = material(new MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 }));
  const wood = material(new MeshStandardMaterial({ roughness: 0.6 }));
  const metal = material(new MeshStandardMaterial({ roughness: 0.25, metalness: 1 }));
  const paper = material(new MeshStandardMaterial({ roughness: 0.8 }));
  const card = material(new MeshStandardMaterial({ roughness: 0.75 }));
  const glass = material(new MeshPhysicalMaterial({ roughness: 0.02, transparent: true, opacity: 0.28, clearcoat: 1, depthWrite: false }));
  const ink = material(new MeshStandardMaterial({ roughness: 0.5 }));
  const hat = material(new MeshPhysicalMaterial({ roughness: 0.7, sheen: 0.6, sheenRoughness: 0.6 }));
  const steamMaterial = material(new MeshStandardMaterial({ roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }));

  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = EYE_CANVAS;
  const eyeTexture = new CanvasTexture(canvas);
  eyeTexture.wrapS = ClampToEdgeWrapping;
  eyeTexture.wrapT = ClampToEdgeWrapping;
  eyeTexture.colorSpace = SRGBColorSpace;
  textures.push(eyeTexture);
  const eyeMaterial = material(new MeshBasicMaterial({ transparent: true, alphaMap: eyeTexture, depthWrite: false, toneMapped: false }));

  const torso = mesh(geometry(lathe([[0, 0], [0.2, 0.01], [0.34, 0.08], [0.42, 0.26], [0.43, 0.44], [0.39, 0.66], [0.3, 0.84], [0.16, 0.92], [0, 0.94]], 48)), shell);
  const base = mesh(geometry(lathe([[0, -0.04], [0.2, -0.04], [0.26, 0.0], [0.27, 0.05], [0.22, 0.09], [0, 0.09]], 40)), trim, [0, -0.02, 0]);
  const chest = mesh(geometry(new CapsuleGeometry(0.035, 0.07, 4, 12)), glow, [0, 0.52, 0.415], [0, 0, Math.PI / 2]);
  chest.castShadow = false;

  const headRadii = [0.52, 0.42, 0.47];
  const headShape = geometry(new SphereGeometry(1, 48, 32));
  const headShell = mesh(headShape, shell);
  headShell.scale.set(...headRadii);
  const visorShape = geometry(new SphereGeometry(1, 48, 24, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.24, Math.PI * 0.5));
  const visorMesh = mesh(visorShape, visor);
  visorMesh.scale.set(headRadii[0] * 1.012, headRadii[1] * 1.012, headRadii[2] * 1.012);
  visorMesh.castShadow = false;
  const eyePlane = mesh(geometry(eyeSurface(new PlaneGeometry(0.58, 0.29, 24, 12), [headRadii[0] * 1.012, headRadii[1] * 1.012, headRadii[2] * 1.012], 0.006)), eyeMaterial, [0, 0.0, 0], [0, 0, 0], 'eyes');
  eyePlane.castShadow = false;
  eyePlane.renderOrder = 2;
  const earShape = geometry(new CylinderGeometry(0.11, 0.11, 0.08, 32));
  const ears = [-1, 1].map((side) => mesh(earShape, trim, [side * 0.5, 0, 0], [0, 0, Math.PI / 2]));
  const stalk = mesh(geometry(new CylinderGeometry(0.014, 0.018, 0.22, 12)), trim, [0, 0.11, 0]);
  const tip = mesh(geometry(new SphereGeometry(0.05, 24, 16)), glow, [0, 0.25, 0]);
  const antenna = group('antenna', [stalk, tip], [0.08, 0.38, -0.05]);
  antenna.rotation.z = -0.18;

  const wreath = new InstancedMesh(geometry(new SphereGeometry(1, 12, 8)), leaf, LEAF_COUNT);
  const dummy = new Object3D();
  for (let index = 0; index < LEAF_COUNT; index += 1) {
    const angle = Math.PI * 0.62 + (index / (LEAF_COUNT - 1)) * Math.PI * 1.76;
    dummy.position.set(Math.cos(angle) * 0.47, 0.27, -Math.sin(angle) * 0.43);
    dummy.rotation.set(0, angle + Math.PI / 2, (index % 2 ? 1 : -1) * 0.55);
    dummy.scale.set(0.12, 0.035, 0.06);
    dummy.updateMatrix();
    wreath.setMatrixAt(index, dummy.matrix);
  }
  wreath.castShadow = true;
  const philosopherHead = group('costume_philosopher_head', [wreath]);

  const hornShape = geometry(lathe([[0.06, 0], [0.055, 0.05], [0.04, 0.12], [0.02, 0.19], [0.003, 0.24], [0, 0.24]], 20));
  const horns = [-1, 1].map((side) => mesh(hornShape, horn, [side * 0.24, 0.32, 0.05], [0.15, 0, -side * 0.5]));
  const devilHead = group('costume_devil_head', horns);

  const hatBand = mesh(geometry(new CylinderGeometry(0.36, 0.38, 0.14, 40)), hat, [0, 0.36, -0.02]);
  const hatPuff = mesh(geometry(lathe([[0, 0], [0.34, 0], [0.42, 0.05], [0.47, 0.14], [0.46, 0.24], [0.38, 0.3], [0.2, 0.33], [0, 0.335]], 40)), hat, [0, 0.42, -0.02]);
  const chefHead = group('costume_chef_head', [hatBand, hatPuff]);
  chefHead.userData.size = 0.82;
  const head = group('head', [headShell, visorMesh, eyePlane, ...ears, antenna, philosopherHead, devilHead, chefHead]);
  const neck = group('neck', [head], [0, 1.16, 0]);

  const drape = mesh(geometry(lathe([[0.445, 0.12], [0.455, 0.28], [0.445, 0.46], [0.4, 0.62], [0.37, 0.66]], 48)), cloth);
  const sashCurve = new CatmullRomCurve3([new Vector3(-0.33, 0.78, 0.1), new Vector3(-0.05, 0.7, 0.42), new Vector3(0.3, 0.45, 0.33), new Vector3(0.43, 0.25, 0)]);
  const sash = mesh(geometry(new TubeGeometry(sashCurve, 24, 0.05, 10, false)), cloth);
  sash.scale.set(1, 1, 1);
  const philosopherBody = group('costume_philosopher_body', [drape, sash]);

  const armShape = geometry(new CapsuleGeometry(0.065, 0.2, 6, 16));
  const handShape = geometry(new SphereGeometry(0.1, 24, 16));
  const arm = (name, side) => {
    const upper = mesh(armShape, trim, [0, -0.15, 0]);
    const hand = mesh(handShape, trim, [0, -0.34, 0]);
    const value = group(name, [upper, hand], [side * 0.44, 0.62, 0]);
    value.rotation.z = side * 0.22;
    return { value, hand };
  };
  const left = arm('armL', -1);
  const right = arm('armR', 1);
  left.value.position.set(-0.37, 0.5, 0);
  right.value.position.set(0.37, 0.5, 0);

  const toolAt = (name, children, position = [0, -0.36, 0.04], rotation = [0, 0, 0]) => {
    const value = group(name, children, position);
    value.rotation.set(...rotation);
    value.scale.setScalar(0.001);
    return value;
  };

  const quill = toolAt('prop_goal', [
    mesh(geometry(lathe([[0, 0], [0.012, 0.03], [0.008, 0.12], [0, 0.13]], 12)), ink, [0, -0.08, 0], [Math.PI, 0, 0]),
    mesh(geometry(new SphereGeometry(1, 20, 12)), paper, [0, 0.14, 0], [0, 0, 0.2])
  ], [0, -0.36, 0.12], [-1.2, 0, 0]);
  quill.children[1].scale.set(0.035, 0.2, 0.012);
  const scrollGroup = group('scroll', [
    mesh(geometry(new CylinderGeometry(0.05, 0.05, 0.32, 20)), paper, [0, 0, 0], [0, 0, Math.PI / 2]),
    mesh(geometry(new CylinderGeometry(0.018, 0.018, 0.38, 12)), wood, [0, 0, 0], [0, 0, Math.PI / 2])
  ], [0, -0.38, 0.06]);
  const leftScroll = group('prop_goal_scroll', [scrollGroup]);
  leftScroll.scale.setScalar(0.001);
  left.value.add(leftScroll);

  const spatula = toolAt('prop_maker', [
    mesh(geometry(new CylinderGeometry(0.022, 0.026, 0.34, 16)), wood, [0, 0.08, 0]),
    mesh(geometry(roundedBox(0.16, 0.2, 0.018, 0.008)), metal, [0, 0.34, 0])
  ], [0, -0.36, 0.06], [-Math.PI / 2, 0, 0]);
  const spoon = toolAt('prop_verify', [
    mesh(geometry(new CylinderGeometry(0.014, 0.016, 0.3, 12)), metal, [0, 0.08, 0]),
    mesh(geometry(new SphereGeometry(1, 20, 12)), metal, [0, 0.26, 0.01])
  ], [0, -0.36, 0.06], [-1.3, 0, 0]);
  spoon.children[1].scale.set(0.05, 0.07, 0.022);
  const magnifier = toolAt('prop_review', [
    mesh(geometry(new CylinderGeometry(0.022, 0.026, 0.22, 16)), wood, [0, 0.06, 0]),
    mesh(geometry(new TorusGeometry(0.13, 0.022, 16, 40)), metal, [0, 0.32, 0]),
    mesh(geometry(new CylinderGeometry(0.12, 0.12, 0.01, 40)), glass, [0, 0.32, 0], [Math.PI / 2, 0, 0])
  ], [0, -0.36, 0.06], [-1.4, 0, 0]);
  const stamp = toolAt('prop_judge', [
    mesh(geometry(lathe([[0, 0], [0.04, 0], [0.03, 0.08], [0.022, 0.2], [0.05, 0.24], [0.05, 0.28], [0, 0.3]], 24)), wood, [0, 0, 0]),
    mesh(geometry(roundedBox(0.2, 0.05, 0.14, 0.012)), ink, [0, -0.01, 0])
  ], [0, -0.36, 0.06], [Math.PI, 0, 0]);
  const parcel = group('prop_deliver', [
    mesh(geometry(new CylinderGeometry(0.3, 0.27, 0.025, 40)), paper, [0, 0, 0]),
    mesh(geometry(lathe([[0, 0.22], [0.08, 0.215], [0.17, 0.18], [0.23, 0.11], [0.26, 0.03], [0.265, 0.01], [0, 0.01]], 40)), metal, [0, 0.01, 0]),
    mesh(geometry(new SphereGeometry(0.03, 16, 10)), metal, [0, 0.245, 0])
  ], [0, 0.38, 0.5]);
  parcel.scale.setScalar(0.001);
  const review = group('prop_review_spot', [], [0, 0, 0]);
  review.scale.setScalar(0.001);
  right.value.add(quill, spatula, spoon, magnifier, stamp);

  const puffShape = geometry(new SphereGeometry(0.16, 20, 14));
  const steam = group('steam', [-0.55, 0.55, 0].map((x, index) => {
    const value = mesh(puffShape, steamMaterial, [x, 1.75, 0], [0, 0, 0], `puff${index + 1}`);
    value.castShadow = false;
    value.scale.setScalar(0.001);
    return value;
  }));
  steam.scale.setScalar(0.001);

  const trunk = group('trunk', [base, torso, chest, philosopherBody]);
  trunk.scale.set(0.82, 0.8, 0.82);
  const body = group('body', [trunk, left.value, right.value, neck, parcel, review, steam], [0, 0.16, 0]);
  const hop = group('hop', [body]);
  const shadowTexture = radialTexture(1.6);
  textures.push(shadowTexture);
  const shadow = contactShadow(1.3, 1.3, { opacity: 0.38, texture: shadowTexture });
  geometries.push(shadow.geometry);
  materials.push(shadow.material);
  const root = group('root', [shadow, hop]);

  return {
    root,
    hop,
    body,
    neck,
    head,
    eyes: eyePlane,
    canvas,
    eyeTexture,
    shadow,
    costumes: {
      philosopher: [philosopherHead, philosopherBody],
      devil: [devilHead],
      chef: [chefHead]
    },
    scroll: leftScroll,
    antenna,
    materials: { shell, trim, visor, glow, cloth, leaf, horn, wood, metal, paper, card, glass, ink, hat, steam: steamMaterial, eye: eyeMaterial },
    geometries,
    allMaterials: materials,
    textures
  };
}

const PAINT = {
  shell: '--brand',
  trim: '--bot-trim',
  visor: '--bot-visor',
  glow: '--brand-highlight',
  cloth: '--prop-paper',
  leaf: '--bot-leaf',
  horn: '--bot-devil-trim',
  wood: '--prop-wood',
  metal: '--prop-metal',
  paper: '--prop-paper',
  card: '--prop-box',
  glass: '--prop-paper',
  ink: '--on-brand',
  hat: '--prop-paper',
  steam: '--prop-paper',
  eye: '--bot-eye'
};

function ease(current, target, seconds, constant) {
  return current + (target - current) * (1 - Math.exp(-seconds / constant));
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
  const tones = { devil: 0, philosopher: 0, chef: 0, anger: 0, scroll: 0 };
  const targets = { devil: 0, philosopher: 0, chef: 0, anger: 0, scroll: 0 };
  const palette = {};
  const scratch = new Color();
  let current = null;
  let lastKey = null;
  let model = null;
  let face = null;
  let blink = { next: 2.5, left: 0 };
  let font = 'sans-serif';

  function onFinished(event) {
    if (event.action === reaction) reaction.stop();
  }
  mixer.addEventListener('finished', onFinished);

  function loopActionFor(next) {
    if (next.mode === 'working') return stageActions[next.botStage];
    if (next.mode === 'waiting') return waitingActions[Math.min(Math.max((next.waitLevel || 1) - 1, 0), waitingActions.length - 1)];
    return null;
  }

  function drawFace(openness = 1) {
    const ctx = rig.canvas.getContext('2d');
    ctx.fillStyle = palette.mask || 'white';
    ctx.strokeStyle = ctx.fillStyle;
    drawEyes(ctx, face, openness, font);
    rig.eyeTexture.needsUpdate = true;
  }

  function setFace(next) {
    if (next === face) return;
    face = next;
    drawFace(1);
  }

  function applyTones() {
    const { shell, trim, visor, eye, glow } = rig.materials;
    if (!palette.shell) return;
    shell.color.copy(palette.shell).lerp(palette.devilShell, tones.devil);
    if (tones.anger > 0) shell.color.lerp(palette.danger, tones.anger * 0.45);
    shell.roughness = 0.32 + tones.devil * 0.46;
    shell.clearcoat = 1 - tones.devil * 0.9;
    trim.color.copy(palette.trim).lerp(palette.devilTrim, tones.devil);
    visor.color.copy(palette.visor);
    eye.color.copy(palette.eye).lerp(palette.devilEye, Math.max(tones.devil, tones.anger * 0.8));
    if (tones.devil > 0) eye.color.multiplyScalar(1 - tones.devil * 0.3);
    glow.color.copy(palette.glow).lerp(palette.devilEye, tones.devil);
    glow.emissive.copy(glow.color);
    glow.emissiveIntensity = 0.9 - tones.devil * 0.5;
    const show = (list, amount) => list.forEach((part) => part.scale.setScalar(Math.max(0.001, amount)));
    show(rig.costumes.philosopher, tones.philosopher);
    show(rig.costumes.devil, tones.devil);
    rig.costumes.chef.forEach((part) => part.scale.setScalar(Math.max(0.001, tones.chef * (part.userData.size || 1))));
    rig.scroll.scale.setScalar(Math.max(0.001, tones.scroll));
    rig.antenna.scale.setScalar(Math.max(0.001, 1 - tones.chef));
  }

  function staticPose(next) {
    RING_STAGES.forEach((stage) => {
      const prop = rig.root.getObjectByName(`prop_${stage}`);
      if (prop) prop.scale.setScalar(next.mode === 'working' && stage === next.botStage ? 1 : 0.001);
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
      if (Math.abs(next - targets[name]) < 0.002) tones[name] = targets[name];
      else {
        tones[name] = next;
        moving = true;
      }
    }
    applyTones();
    return moving;
  }

  function stepBlink(seconds) {
    if (reducedMotion || !current) return false;
    if (blink.left > 0) {
      blink.left -= seconds;
      const t = Math.max(0, blink.left) / BLINK_SECONDS;
      drawFace(Math.abs(t * 2 - 1));
      if (blink.left <= 0) {
        drawFace(1);
        blink = { next: 2.5 + Math.random() * 3, left: 0 };
      }
      return true;
    }
    blink.next -= seconds;
    if (blink.next <= 0) blink.left = BLINK_SECONDS;
    return false;
  }

  return {
    root: rig.root,
    hop: rig.hop,
    paint(readToken = read) {
      font = readToken('--font') || font;
      for (const [name, token] of Object.entries(PAINT)) {
        const value = readToken(token);
        if (value && rig.materials[name]) rig.materials[name].color.setStyle(value);
      }
      rig.materials.glow.emissive.copy(rig.materials.glow.color);
      rig.materials.steam.emissive.setStyle(readToken('--prop-paper'));
      rig.materials.steam.emissiveIntensity = 0.25;
      rig.shadow.material.color.setStyle(readToken('--shadow'));
      palette.shell = new Color().setStyle(readToken('--brand'));
      palette.trim = new Color().setStyle(readToken('--bot-trim'));
      palette.visor = new Color().setStyle(readToken('--bot-visor'));
      palette.eye = new Color().setStyle(readToken('--bot-eye'));
      palette.glow = new Color().setStyle(readToken('--brand-highlight'));
      palette.devilShell = new Color().setStyle(readToken('--bot-devil'));
      palette.devilTrim = new Color().setStyle(readToken('--bot-devil-trim'));
      palette.devilEye = new Color().setStyle(readToken('--bot-devil-eye'));
      palette.danger = new Color().setStyle(readToken('--danger'));
      palette.mask = readToken('--prop-paper');
      applyTones();
      const previous = face;
      face = null;
      setFace(previous || botFace(model));
    },
    update(next) {
      model = next;
      const costume = stationConfig(next.botStage).costume;
      targets.philosopher = costume === 'philosopher' ? 1 : 0;
      targets.devil = costume === 'devil' ? 1 : 0;
      targets.chef = costume === 'chef' ? 1 : 0;
      targets.anger = next.mode === 'waiting' ? Math.max(0, ((next.waitLevel || 1) - 2) / 2) : 0;
      targets.scroll = next.mode === 'working' && next.botStage === 'goal' ? 1 : 0;
      setFace(botFace(next));
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
      setFace('happy');
      return true;
    },
    lookAt(x, y) {
      glance.toX = x;
      glance.toY = y;
    },
    step(seconds) {
      mixer.update(seconds);
      settleFades();
      if (!reaction.isRunning() && face === 'happy' && model) setFace(botFace(model));
      glance.x = ease(glance.x, glance.toX, seconds, GLANCE_EASE_SECONDS);
      glance.y = ease(glance.y, glance.toY, seconds, GLANCE_EASE_SECONDS);
      rig.head.parent.rotation.x = -glance.y * 0.18;
      rig.head.parent.rotation.z = -glance.x * 0.06;
      rig.eyeTexture.offset.set(-glance.x * 0.06, -glance.y * 0.05);
      const lift = rig.hop.position.y + rig.body.position.y;
      rig.shadow.scale.setScalar(1 / (1 + lift * 0.8));
      rig.shadow.material.opacity = 0.38 / (1 + lift * 1.5);
      const toning = stepTones(seconds);
      const blinking = stepBlink(seconds);
      const glancing = Math.abs(glance.x - glance.toX) > SETTLED || Math.abs(glance.y - glance.toY) > SETTLED;
      return Boolean(current || fading.size || reaction.isRunning() || glancing || toning || blinking);
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
      scratch.set(0, 0, 0);
    }
  };
}
