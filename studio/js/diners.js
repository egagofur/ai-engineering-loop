import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry
} from '../vendor/three.module.min.js';

import { DINER_TABLES, dinerGlance, dinerLayout, dinerPose, dinerSeats } from './kitchen.js';
import { lathe, mergeStatic, roundedBox } from './forms.js';
import { BLINK_SECONDS, EYE_GAP, EYE_PITCH, blinkOpenness, eyeDecal, nextBlink } from './bot.js';

export const DINER_SCALE = 0.62;
export const DINER_RADIUS = 0.42;
export const DINER_HEAD = DINER_RADIUS * 2 + 0.12;
const TABLE_TOP = 0.56;
const SEAT = 0.34;

function maker(registry) {
  const register = (material, token, options = {}) => {
    registry.push({ material, token, stage: null, ...options });
    return material;
  };
  const mesh = (geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], cast = true) => {
    const value = new Mesh(geometry, material);
    value.position.set(...position);
    value.rotation.set(...rotation);
    value.castShadow = cast;
    value.receiveShadow = true;
    return value;
  };
  return { register, mesh };
}

function buildTable(m, shared, textures) {
  const group = new Group();
  group.add(
    m.mesh(lathe([[0, TABLE_TOP], [0.55, TABLE_TOP], [0.58, TABLE_TOP - 0.02], [0.59, TABLE_TOP - 0.15], [0.55, TABLE_TOP - 0.15], [0.54, TABLE_TOP - 0.03], [0, TABLE_TOP - 0.03]], 56), shared.cloth),
    m.mesh(lathe([[0, 0], [0.22, 0], [0.22, 0.02], [0.05, 0.05], [0.04, TABLE_TOP - 0.03], [0, TABLE_TOP - 0.03]], 28), shared.wood)
  );
  const blob = new PlaneGeometry(1.6, 1.6);
  blob.rotateX(-Math.PI / 2);
  const shadow = m.mesh(blob, shared.blob, [0, 0.003, -0.2], [0, 0, 0], false);
  shadow.receiveShadow = false;
  shadow.renderOrder = 1;
  group.add(shadow);
  void textures;
  return group;
}

function buildChair(m, shared) {
  const chair = new Group();
  chair.add(
    m.mesh(roundedBox(0.4, 0.04, 0.38, 0.014), shared.wood, [0, SEAT - 0.02, 0]),
    m.mesh(roundedBox(0.4, 0.42, 0.04, 0.014), shared.wood, [0, SEAT + 0.2, -0.18]),
    ...[[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]].map(([x, z]) => m.mesh(roundedBox(0.035, SEAT - 0.04, 0.035, 0.01), shared.wood, [x, (SEAT - 0.04) / 2, z]))
  );
  return chair;
}

function buildFigure(m, shared, token) {
  const shell = m.register(new MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }), token);
  const root = new Group();
  const body = new Group();
  const sphere = m.mesh(new SphereGeometry(DINER_RADIUS, 40, 28), shell, [0, DINER_RADIUS + 0.12, 0]);
  const head = new Group();
  head.position.y = DINER_RADIUS + 0.12;
  const gaze = new Group();
  const decals = [];
  const eyes = [-1, 1].map((side) => {
    const pivot = new Group();
    const decal = eyeDecal(side, DINER_RADIUS);
    decals.push(decal);
    pivot.add(m.mesh(decal.geometry, shared.eye, [0, 0, 0], [0, 0, 0], false));
    pivot.rotation.set(-EYE_PITCH, side * EYE_GAP / 2, 0);
    return pivot;
  });
  gaze.add(...eyes);
  head.add(gaze);
  const arm = (side) => {
    const value = new Group();
    value.position.set(side * (DINER_RADIUS + 0.06), DINER_RADIUS * 0.7, 0.1);
    return value;
  };
  const armL = arm(-1);
  const armR = arm(1);
  const fork = new Group();
  fork.add(
    m.mesh(new CylinderGeometry(0.012, 0.014, 0.24, 8), shared.metal, [0, 0.06, 0]),
    m.mesh(roundedBox(0.06, 0.08, 0.012, 0.004), shared.metal, [0, 0.2, 0])
  );
  fork.position.set(0, -0.16, 0.1);
  fork.rotation.x = -1.2;
  armR.add(fork);
  const cup = m.mesh(lathe([[0, 0], [0.06, 0], [0.07, 0.13], [0.064, 0.13], [0.055, 0.012], [0, 0.012]], 24), shared.paper, [0, -0.2, 0.1]);
  armL.add(cup);
  body.add(sphere, head, armL, armR);
  root.add(body);
  return { root, body, head, gaze, armL, armR, decals, open: 1, blinkAt: null };
}

export function buildDiners({ registry, textures, count }) {
  const m = maker(registry);
  const shared = {
    cloth: m.register(new MeshPhysicalMaterial({ roughness: 0.85, sheen: 0.6, sheenRoughness: 0.5, map: textures.fabric }), '--prop-paper'),
    wood: m.register(new MeshStandardMaterial({ roughness: 0.5, map: textures.planks }), '--prop-wood'),
    paper: m.register(new MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 0.7 }), '--prop-paper'),
    metal: m.register(new MeshStandardMaterial({ roughness: 0.25, metalness: 1 }), '--prop-metal'),
    eye: m.register(new MeshBasicMaterial(), '--bot-visor'),
    food: m.register(new MeshPhysicalMaterial({ roughness: 0.45, clearcoat: 0.5 }), '--kitchen-food'),
    blob: m.register(new MeshBasicMaterial({ transparent: true, opacity: 0.28, depthWrite: false, alphaMap: textures.blob, polygonOffset: true, polygonOffsetFactor: -2 }), '--shadow', { flat: true })
  };
  const group = new Group();
  group.name = 'dining';
  const layout = dinerLayout(dinerSeats(count));
  const used = new Set(layout.map((seat) => seat.table));
  DINER_TABLES.forEach((spot, index) => {
    if (!used.has(index)) return;
    const table = buildTable(m, shared, textures);
    table.position.set(spot.x, 0, spot.z);
    group.add(table);
  });
  const figures = layout.map((seat) => {
    const chair = buildChair(m, shared);
    chair.position.set(seat.x, 0, seat.z - 0.05);
    const plate = new Group();
    const food = m.mesh(new SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), shared.food, [0, 0.012, 0]);
    food.scale.set(0.07, 0.04, 0.06);
    plate.add(m.mesh(lathe([[0, 0], [0.12, 0], [0.17, 0.012], [0.18, 0.018], [0.11, 0.01], [0, 0.01]], 36), shared.paper), food);
    plate.position.set(seat.x, TABLE_TOP, seat.z + 0.46);
    group.add(chair, plate);
    const figure = buildFigure(m, shared, `--diner-${(seat.index % 6) + 1}`);
    figure.root.position.set(seat.x, SEAT, seat.z + 0.02);
    figure.root.scale.setScalar(DINER_SCALE);
    figure.root.userData.dynamic = true;
    group.add(figure.root);
    return { ...figure, ...seat };
  });
  mergeStatic(group);
  return { group, figures };
}

export function poseDiners(figures, seconds, { reducedMotion = false, bot = null } = {}) {
  for (const figure of figures) {
    const pose = dinerPose(figure.loop, seconds, figure.phase, { reducedMotion });
    figure.armR.rotation.x = pose.armR + 0.5;
    figure.armL.rotation.x = pose.armL + 0.3;
    figure.head.rotation.x = pose.head;
    figure.head.rotation.z = pose.tilt;
    figure.body.rotation.z = pose.sway;
    const look = bot && !reducedMotion ? dinerGlance(seconds, figure.phase) : 0;
    const toward = bot ? Math.max(-1.3, Math.min(1.3, Math.atan2(bot.x - figure.x, Math.abs(bot.z - figure.z)) * 1.6)) : 0;
    figure.gaze.rotation.set(-look * 0.25, look * toward, 0);
    blinkDiner(figure, seconds, reducedMotion);
  }
}

export function blinkDiner(figure, seconds, reducedMotion = false, random = Math.random) {
  let open = 1;
  if (!reducedMotion) {
    if (figure.blinkAt === null || seconds - figure.blinkAt > 30) figure.blinkAt = seconds + nextBlink(random);
    if (seconds - figure.blinkAt >= BLINK_SECONDS) figure.blinkAt = seconds + nextBlink(random);
    open = blinkOpenness(seconds - figure.blinkAt);
  }
  if (open === figure.open) return false;
  figure.open = open;
  figure.decals.forEach((decal) => decal.shape(open));
  return true;
}
