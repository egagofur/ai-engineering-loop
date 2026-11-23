import {
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  CapsuleGeometry,
  ColorKeyframeTrack,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  Group,
  LoopOnce,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  VectorKeyframeTrack
} from '../vendor/three.module.min.js';

import { RING_STAGES } from './ring2d.js';

export const REACTION_SECONDS = 0.7;

const GLANCE_EASE_SECONDS = 0.12;
const GLANCE_REACH = 0.14;
const SETTLED = 0.0005;
const CROSSFADE_SECONDS = 0.45;
const SHADOW_OPACITY = 0.16;
const REVIEW_BODY = [0.09, 0.085, 0.1];
const REVIEW_EYES = [0.78, 0.2, 0.14];
const ANNOYED_BODY = [0.9, 0.07, 0.02];
const ANGRY_BODY = [0.78, 0.025, 0.015];

const number = (name, times, values) => new NumberKeyframeTrack(name, times, values);
const vector = (name, times, values) => new VectorKeyframeTrack(name, times, values);
const shown = (name, duration) => vector(`${name}.scale`, [0, duration], [1, 1, 1, 1, 1, 1]);

function breathe(duration, lift = 0.05) {
  const half = duration / 2;
  return [
    number('body.position[y]', [0, half, duration], [0, lift, 0]),
    vector('body.scale', [0, half, duration], [1, 1, 1, 1.02, 0.98, 1.02, 1, 1, 1])
  ];
}

function repeat(times, period, values) {
  const keys = [];
  const out = [];
  for (let time = 0, index = 0; time <= times + 1e-9; time += period, index += 1) {
    keys.push(Number(time.toFixed(4)));
    out.push(values[index % values.length]);
  }
  return [keys, out];
}

const WRITING_LINES = [0.12, 0, -0.12];
const LINE_START = -0.4;
const LINE_LENGTH = 0.6;
const LINE_SECONDS = 0.8;
const SCROLL_CENTER = [-0.05, -0.95];

function goalClip() {
  const duration = WRITING_LINES.length * LINE_SECONDS;
  const quillKeys = [];
  const quillValues = [];
  WRITING_LINES.forEach((lineY, index) => {
    const start = index * LINE_SECONDS;
    const y = SCROLL_CENTER[1] + lineY;
    quillKeys.push(start, start + LINE_SECONDS * 0.85, start + LINE_SECONDS * 0.97);
    quillValues.push(LINE_START + SCROLL_CENTER[0], y, 1.12, LINE_START + LINE_LENGTH + SCROLL_CENTER[0], y, 1.12, LINE_START + SCROLL_CENTER[0], y - 0.06, 1.2);
  });
  const lines = WRITING_LINES.map((lineY, index) => {
    const start = index * LINE_SECONDS;
    const keys = [0, start, start + LINE_SECONDS * 0.85, duration].filter((value, position, all) => position === 0 || value > all[position - 1]);
    const values = keys.flatMap((time) => (time <= start ? [0.001, 1, 1] : [1, 1, 1]));
    return vector(`line${index + 1}.scale`, keys, values);
  });
  const [wiggleKeys, wiggleValues] = repeat(duration, 0.12, [0.1, -0.1]);
  return new AnimationClip('goal', duration, [
    shown('prop_goal', duration),
    ...breathe(duration, 0.03),
    vector('quill.position', quillKeys, quillValues),
    number('quill.rotation[z]', wiggleKeys, wiggleValues),
    ...lines
  ]);
}

function swingClip(stage, tool, duration) {
  return new AnimationClip(stage, duration, [
    shown(`prop_${stage}`, duration),
    ...breathe(duration),
    number(`${tool}.rotation[z]`, [0, duration * 0.3, duration * 0.42, duration * 0.5, duration], [0, 0.45, -1.15, -1.0, 0])
  ]);
}

function verifyClip() {
  const duration = 2;
  return new AnimationClip('verify', duration, [
    shown('prop_verify', duration),
    ...breathe(duration),
    number('magnifier.position[x]', [0, duration / 2, duration], [-0.5, 0.5, -0.5]),
    number('magnifier.rotation[z]', [0, duration / 2, duration], [0.15, -0.15, 0.15]),
    vector('check.scale', [0, 0.85, 1.0, 1.12, 1.8, duration], [0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 1.25, 1.25, 1.25, 1, 1, 1, 1, 1, 1, 0.001, 0.001, 0.001])
  ]);
}

function reviewClip(colors) {
  const duration = 2.6;
  const dot = (name, start) => vector(`${name}.scale`, [0, start, start + 0.15, duration - 0.3, duration], [0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 1, 1, 1, 1, 1, 1, 0.001, 0.001, 0.001]);
  const wisp = (name, offset) => number(`${name}.position[y]`, [0, duration], [0.2 + offset, 1.1 + offset]);
  return new AnimationClip('review', duration, [
    shown('prop_review', duration),
    ...breathe(duration, 0.03),
    new ColorKeyframeTrack('sphere.material.color', [0, duration], [...colors.reviewBody, ...colors.reviewBody]),
    number('sphere.material.roughness', [0, duration], [0.85, 0.85]),
    number('sphere.material.clearcoat', [0, duration], [0.05, 0.05]),
    new ColorKeyframeTrack('eyeLeft.material.color', [0, duration], [...colors.reviewEyes, ...colors.reviewEyes]),
    number('body.rotation[z]', [0, 0.6, 1.3, 1.9, duration], [0, 0.2, 0.2, 0, 0]),
    dot('dot1', 0.3),
    dot('dot2', 0.6),
    dot('dot3', 0.9),
    wisp('wisp1', 0),
    wisp('wisp2', -0.35),
    wisp('wisp3', -0.7)
  ]);
}

function deliverClip() {
  const duration = 1.8;
  return new AnimationClip('deliver', duration, [
    shown('prop_deliver', duration),
    ...breathe(duration),
    number('package.position[y]', [0, duration / 2, duration], [-0.85, -0.76, -0.85]),
    number('body.rotation[z]', [0, duration / 4, (duration * 3) / 4, duration], [0, 0.08, -0.08, 0])
  ]);
}

const tint = (color, duration) => new ColorKeyframeTrack('sphere.material.color', [0, duration], [...color, ...color]);
const browsDown = (angle, duration) => [
  shown('brows', duration),
  number('browLeft.rotation[z]', [0, duration], [-angle, -angle]),
  number('browRight.rotation[z]', [0, duration], [angle, angle])
];

function puff(name, start, duration) {
  const end = Math.min(duration, start + 0.6);
  return [
    number(`${name}.position[y]`, [0, start, end, duration], [0.9, 0.9, 1.5, 1.5]),
    vector(`${name}.scale`, [0, start, start + 0.1, end, duration], [0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 1, 1, 1, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001])
  ];
}

function waitingClips(colors) {
  const calm = 3.2;
  const tap = 1.2;
  const grumble = 1.6;
  const rant = 0.9;
  return [
    new AnimationClip('waiting-1', calm, [
      ...breathe(calm, 0.02),
      number('eyes.scale[y]', [0, 2.6, 2.7, 2.8, calm], [1, 1, 0.1, 1, 1])
    ]),
    new AnimationClip('waiting-2', tap, [
      number('body.position[y]', [0, 0.15, 0.3, 0.6, 0.75, 0.9, tap], [0, 0.06, 0, 0, 0.06, 0, 0]),
      number('body.rotation[z]', [0, 0.3, 0.6, 0.9, tap], [0, 0.05, 0, -0.05, 0]),
      number('eyes.scale[y]', [0, 0.95, 1.02, 1.1, tap], [1, 1, 0.15, 1, 1])
    ]),
    new AnimationClip('waiting-3', grumble, [
      ...breathe(grumble, 0.02),
      ...browsDown(0.32, grumble),
      tint(colors.annoyed, grumble),
      number('body.rotation[z]', [0, 0.1, 0.2, 0.3, 0.4, grumble], [0, 0.05, -0.05, 0.05, 0, 0])
    ]),
    new AnimationClip('waiting-4', rant, [
      number('body.position[y]', [0, rant * 0.25, rant * 0.5, rant * 0.75, rant], [0, 0.35, 0, 0.3, 0]),
      vector('body.scale', [0, rant * 0.5, rant * 0.55, rant], [1, 1, 1, 1.08, 0.9, 1.08, 1, 1, 1, 1, 1, 1]),
      ...browsDown(0.5, rant),
      tint(colors.angry, rant),
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
    number('hop.position[y]', [0, end * 0.2, end * 0.5, end * 0.8, end], [0, 0.9, 1.1, 0.15, 0]),
    number('hop.rotation[y]', [0, end * 0.85, end], [0, Math.PI * 2, Math.PI * 2]),
    number('face.scale[y]', [0, end * 0.15, end * 0.75, end], [1, 0.35, 0.35, 1])
  ]);
}

export function buildClips(colors = { reviewBody: REVIEW_BODY, reviewEyes: REVIEW_EYES, annoyed: ANNOYED_BODY, angry: ANGRY_BODY }) {
  return {
    stages: {
      goal: goalClip(),
      maker: swingClip('maker', 'hammer', 1.2),
      verify: verifyClip(),
      review: reviewClip(colors),
      judge: swingClip('judge', 'gavel', 1.4),
      deliver: deliverClip()
    },
    waiting: waitingClips(colors),
    reaction: reactionClip()
  };
}

function shadowTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const alpha = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      const value = Math.round(255 * alpha * alpha);
      data.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

function buildRig() {
  const geometries = [];
  const materials = [];
  const painted = [];
  const geometry = (value) => {
    geometries.push(value);
    return value;
  };
  const material = (value, token) => {
    materials.push(value);
    if (token) painted.push([value, token]);
    return value;
  };
  const matte = (token) => material(new MeshStandardMaterial({ roughness: 0.7 }), token);
  const mesh = (shape, surface, name) => {
    const value = new Mesh(shape, surface);
    if (name) value.name = name;
    return value;
  };
  const group = (name, children = [], position = [0, 0, 0]) => {
    const value = new Group();
    value.name = name || '';
    value.position.set(...position);
    children.forEach((child) => value.add(child));
    return value;
  };
  const at = (object, position, rotation = [0, 0, 0], scale = null) => {
    object.position.set(...position);
    object.rotation.set(...rotation);
    if (scale) object.scale.set(...scale);
    return object;
  };

  const paper = matte('--prop-paper');
  const wood = matte('--prop-wood');
  const metal = material(new MeshStandardMaterial({ roughness: 0.35, metalness: 0.6 }), '--prop-metal');
  const box = matte('--prop-box');
  const pencil = matte('--prop-pencil');
  const ink = material(new MeshBasicMaterial(), '--on-brand');
  const leaf = matte('--ok-fill');
  const muted = material(new MeshBasicMaterial(), '--muted');
  const check = material(new MeshBasicMaterial(), '--ok-fill');
  const horn = material(new MeshStandardMaterial({ roughness: 0.9 }), '--on-brand');
  const wispMaterial = material(new MeshBasicMaterial({ transparent: true, opacity: 0.28, depthWrite: false }), '--muted');

  const body = material(new MeshPhysicalMaterial({ roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.35 }), '--brand');
  const eye = material(new MeshBasicMaterial(), '--on-brand');
  const eyeShape = geometry(new CapsuleGeometry(0.085, 0.2, 4, 12));
  const eyeLeft = at(mesh(eyeShape, eye, 'eyeLeft'), [-0.22, 0.12, 0.96]);
  const eyeRight = at(mesh(eyeShape, eye, 'eyeRight'), [0.22, 0.12, 0.96]);
  const eyes = group('eyes', [eyeLeft, eyeRight]);
  const browShape = geometry(new BoxGeometry(0.34, 0.07, 0.05));
  const brows = group('brows', [
    at(mesh(browShape, eye, 'browLeft'), [-0.24, 0.43, 0.93]),
    at(mesh(browShape, eye, 'browRight'), [0.24, 0.43, 0.93])
  ]);
  brows.scale.setScalar(0.001);
  const face = group('face', [eyes, brows]);
  const sphere = mesh(geometry(new SphereGeometry(1, 48, 32)), body, 'sphere');

  const rod = (radius, length, surface, name) => mesh(geometry(new CylinderGeometry(radius, radius, length, 10)), surface, name);
  const cube = (x, y, z, surface, name) => mesh(geometry(new BoxGeometry(x, y, z)), surface, name);
  const ball = (radius, surface, name) => mesh(geometry(new SphereGeometry(radius, 12, 8)), surface, name);

  const lineShape = geometry(new BoxGeometry(LINE_LENGTH, 0.025, 0.01));
  lineShape.translate(LINE_LENGTH / 2, 0, 0);
  const scroll = group('scroll', [
    cube(0.95, 0.5, 0.03, paper),
    at(rod(0.06, 1.05, paper), [0, 0.28, 0.02], [0, 0, Math.PI / 2]),
    at(rod(0.06, 1.05, paper), [0, -0.28, 0.02], [0, 0, Math.PI / 2]),
    ...WRITING_LINES.map((lineY, index) => at(mesh(lineShape, ink, `line${index + 1}`), [LINE_START, lineY, 0.03], [0, 0, 0], [0.001, 1, 1]))
  ], [SCROLL_CENTER[0], SCROLL_CENTER[1], 1.06]);
  const nibShape = geometry(new ConeGeometry(0.04, 0.22, 8));
  nibShape.rotateZ(Math.PI);
  nibShape.translate(0, 0.11, 0);
  const quill = group('quill', [
    mesh(nibShape, ink),
    at(ball(1, paper), [0.1, 0.45, 0], [0, 0, -0.35], [0.1, 0.36, 0.03])
  ], [LINE_START + SCROLL_CENTER[0], SCROLL_CENTER[1] + WRITING_LINES[0], 1.12]);
  const wreath = group('', [
    at(mesh(geometry(new TorusGeometry(0.72, 0.05, 6, 28, Math.PI * 1.7)), leaf), [0, 0, 0], [0, 0, -Math.PI * 0.35]),
    ...Array.from({ length: 9 }, (unused, index) => {
      const angle = -Math.PI * 0.35 + (index + 0.5) * (Math.PI * 1.7) / 9;
      return at(ball(1, leaf), [0.72 * Math.cos(angle), 0.72 * Math.sin(angle), 0], [0, 0, angle], [0.22, 0.1, 0.08]);
    })
  ], [0, 0.72, 0.15]);
  wreath.rotation.x = -1.05;
  const knot = at(ball(0.2, paper), [0.62, -0.42, 0.72]);
  const drape = mesh(geometry(new SphereGeometry(1.04, 32, 12, 0, Math.PI * 2, Math.PI * 0.68, Math.PI * 0.32)), paper);

  const hammer = group('hammer', [
    at(rod(0.06, 0.8, wood), [0, 0.35, 0]),
    at(cube(0.42, 0.18, 0.18, metal), [0, 0.78, 0])
  ], [0.95, -0.1, 0.9]);
  const gavel = group('gavel', [
    at(rod(0.05, 0.75, wood), [0, 0.35, 0]),
    at(rod(0.14, 0.45, wood), [0, 0.76, 0], [0, 0, Math.PI / 2])
  ], [0.95, -0.1, 0.9]);
  const magnifier = group('magnifier', [
    mesh(geometry(new TorusGeometry(0.3, 0.06, 8, 24)), metal),
    at(rod(0.06, 0.45, wood), [0.3, -0.38, 0], [0, 0, 0.7])
  ], [-0.5, -0.1, 1.15]);
  const checkMark = group('check', [
    at(mesh(geometry(new CapsuleGeometry(0.05, 0.16, 4, 8)), check), [-0.08, -0.04, 0], [0, 0, 0.8]),
    at(mesh(geometry(new CapsuleGeometry(0.05, 0.34, 4, 8)), check), [0.08, 0.06, 0], [0, 0, -0.6])
  ], [1.15, 0.9, 0.8]);
  checkMark.scale.setScalar(0.001);
  const dots = [0.1, 0.13, 0.16].map((radius, index) => {
    const dot = at(ball(radius, muted, `dot${index + 1}`), [0.9 + index * 0.28, 1.0 + index * 0.26, 0.8]);
    dot.scale.setScalar(0.001);
    return dot;
  });
  const hornShape = geometry(new ConeGeometry(0.16, 0.42, 10));
  const wisps = [-1.15, 1.2, -1.3].map((x, index) => at(ball(0.16, wispMaterial, `wisp${index + 1}`), [x, 0.2 - index * 0.35, 0.3]));
  const pack = group('package', [
    cube(0.9, 0.6, 0.6, box),
    at(cube(0.92, 0.1, 0.62, paper), [0, 0, 0])
  ], [0, -0.85, 1.05]);

  const props = {
    goal: group('prop_goal', [drape, knot, scroll, quill, wreath]),
    maker: group('prop_maker', [hammer, at(cube(0.4, 0.3, 0.3, wood), [1.55, -0.78, 0.6])]),
    verify: group('prop_verify', [magnifier, checkMark]),
    review: group('prop_review', [
      at(mesh(hornShape, horn), [-0.45, 0.92, 0.1], [0, 0, 0.35]),
      at(mesh(hornShape, horn), [0.45, 0.92, 0.1], [0, 0, -0.35]),
      ...dots,
      ...wisps
    ]),
    judge: group('prop_judge', [gavel, at(rod(0.3, 0.1, wood), [1.5, -0.82, 0.6])]),
    deliver: group('prop_deliver', [pack])
  };
  Object.values(props).forEach((prop) => prop.scale.setScalar(0.001));

  const puffMaterial = material(new MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false }), '--prop-paper');
  const steam = group('steam', [-0.75, 0.75, 0].map((x, index) => {
    const value = at(ball(0.2, puffMaterial, `puff${index + 1}`), [x, 0.9, 0.3]);
    value.scale.setScalar(0.001);
    return value;
  }));
  steam.scale.setScalar(0.001);
  const bodyGroup = group('body', [sphere, face, steam, ...Object.values(props)]);
  const hop = group('hop', [bodyGroup]);
  const shadowMaterial = material(new MeshBasicMaterial({ transparent: true, opacity: SHADOW_OPACITY, depthWrite: false, alphaMap: shadowTexture() }), '--shadow');
  const shadow = at(mesh(geometry(new PlaneGeometry(2, 2)), shadowMaterial), [0, -1.02, -1.2], [0, 0, 0], [0.8, 0.16, 1]);
  const root = group('root', [shadow, hop]);

  return { root, face, brows, props, sphere, eyeLeft, geometries, materials, painted, shadowMaterial };
}

function ease(current, target, seconds, constant) {
  return current + (target - current) * (1 - Math.exp(-seconds / constant));
}

export function createBot({ reducedMotion = false, radius = 1 } = {}) {
  const rig = buildRig();
  rig.root.scale.setScalar(radius);
  const clips = buildClips({ reviewBody: REVIEW_BODY, reviewEyes: REVIEW_EYES, annoyed: ANNOYED_BODY, angry: ANGRY_BODY });
  const mixer = new AnimationMixer(rig.root);
  const stageActions = Object.fromEntries(RING_STAGES.map((stage) => [stage, mixer.clipAction(clips.stages[stage])]));
  const waitingActions = clips.waiting.map((clip) => mixer.clipAction(clip));
  const reaction = mixer.clipAction(clips.reaction);
  reaction.setLoop(LoopOnce, 1);
  const fading = new Set();
  const glance = { x: 0, y: 0, toX: 0, toY: 0 };
  let current = null;
  let lastKey = null;

  function onFinished(event) {
    if (event.action === reaction) reaction.stop();
  }
  mixer.addEventListener('finished', onFinished);

  function loopActionFor(model) {
    if (model.mode === 'working') return stageActions[model.botStage];
    if (model.mode === 'waiting') return waitingActions[Math.min(Math.max((model.waitLevel || 1) - 1, 0), waitingActions.length - 1)];
    return null;
  }

  function staticPose(model) {
    RING_STAGES.forEach((stage) => rig.props[stage].scale.setScalar(model.mode === 'working' && stage === model.botStage ? 1 : 0.001));
    const cross = model.mode === 'waiting' && (model.waitLevel || 1) >= 3;
    rig.brows.scale.setScalar(cross ? 1 : 0.001);
    rig.brows.children[0].rotation.z = cross ? -0.4 : 0;
    rig.brows.children[1].rotation.z = cross ? 0.4 : 0;
  }

  function settleFades() {
    for (const action of fading) {
      if (action.getEffectiveWeight() === 0) {
        action.stop();
        fading.delete(action);
      }
    }
  }

  return {
    root: rig.root,
    paint(read) {
      rig.painted.forEach(([surface, token]) => {
        const value = read(token);
        if (value) surface.color.setStyle(value);
      });
    },
    update(model) {
      const key = `${model.mode}|${model.botStage}|${model.waitLevel || 1}`;
      if (key === lastKey) return;
      lastKey = key;
      if (reducedMotion) {
        staticPose(model);
        return;
      }
      const action = loopActionFor(model);
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
      return true;
    },
    lookAt(x, y) {
      glance.toX = x * GLANCE_REACH;
      glance.toY = y * GLANCE_REACH;
    },
    step(seconds) {
      mixer.update(seconds);
      settleFades();
      glance.x = ease(glance.x, glance.toX, seconds, GLANCE_EASE_SECONDS);
      glance.y = ease(glance.y, glance.toY, seconds, GLANCE_EASE_SECONDS);
      rig.face.position.set(glance.x, glance.y, 0);
      const glancing = Math.abs(glance.x - glance.toX) > SETTLED || Math.abs(glance.y - glance.toY) > SETTLED;
      return Boolean(current || fading.size || reaction.isRunning() || glancing);
    },
    dispose() {
      mixer.removeEventListener('finished', onFinished);
      mixer.stopAllAction();
      mixer.uncacheRoot(rig.root);
      rig.root.removeFromParent();
      rig.geometries.forEach((value) => value.dispose());
      rig.materials.forEach((value) => {
        if (value.alphaMap) value.alphaMap.dispose();
        value.dispose();
      });
    }
  };
}
