import {
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry
} from '../vendor/three.module.min.js';

import { DINER_TABLES, dinerLayout, dinerPose, dinerSeats } from './kitchen.js';
import { lathe, mergeStatic, roundedBox } from './forms.js';

export const DINER_SCALE = 0.62;
export const DINER_HEAD = 1.62;
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
  const shell = m.register(new MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }), token);
  const root = new Group();
  const body = new Group();
  const torso = m.mesh(lathe([[0, 0], [0.2, 0.01], [0.32, 0.08], [0.38, 0.24], [0.37, 0.42], [0.3, 0.6], [0.16, 0.68], [0, 0.7]], 40), shell);
  const napkin = m.mesh(roundedBox(0.28, 0.24, 0.02, 0.008), shared.paper, [0, 0.44, 0.33], [-0.25, 0, 0]);
  const head = new Group();
  const skull = m.mesh(new SphereGeometry(1, 36, 24), shell);
  skull.scale.set(0.4, 0.33, 0.37);
  const visor = m.mesh(new SphereGeometry(1, 36, 18, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.26, Math.PI * 0.46), shared.visor, [0, 0, 0], [0, 0, 0], false);
  visor.scale.set(0.405, 0.335, 0.375);
  const eyes = [-0.1, 0.1].map((x) => m.mesh(new CapsuleGeometry(0.026, 0.05, 4, 10), shared.eye, [x, 0.02, 0.36], [0, 0, 0], false));
  head.add(skull, visor, ...eyes);
  head.position.y = 0.98;
  const arm = (side) => {
    const value = new Group();
    value.add(
      m.mesh(new CapsuleGeometry(0.06, 0.18, 6, 12), shell, [0, -0.14, 0]),
      m.mesh(new SphereGeometry(0.085, 20, 14), shared.trim, [0, -0.31, 0])
    );
    value.position.set(side * 0.36, 0.52, 0.04);
    value.rotation.z = side * 0.18;
    return value;
  };
  const armL = arm(-1);
  const armR = arm(1);
  const fork = new Group();
  fork.add(
    m.mesh(new CylinderGeometry(0.01, 0.012, 0.22, 8), shared.metal, [0, 0.06, 0]),
    m.mesh(roundedBox(0.05, 0.07, 0.012, 0.004), shared.metal, [0, 0.2, 0])
  );
  fork.position.set(0, -0.34, 0.05);
  fork.rotation.x = -1.3;
  armR.add(fork);
  const cup = m.mesh(lathe([[0, 0], [0.05, 0], [0.06, 0.12], [0.055, 0.12], [0.045, 0.01], [0, 0.01]], 24), shared.paper, [0, -0.42, 0.04]);
  armL.add(cup);
  body.add(torso, napkin, armL, armR, head);
  root.add(body);
  return { root, body, head, armL, armR };
}

export function buildDiners({ registry, textures, count }) {
  const m = maker(registry);
  const shared = {
    cloth: m.register(new MeshPhysicalMaterial({ roughness: 0.85, sheen: 0.6, sheenRoughness: 0.5, map: textures.fabric }), '--prop-paper'),
    wood: m.register(new MeshStandardMaterial({ roughness: 0.5, map: textures.planks }), '--prop-wood'),
    paper: m.register(new MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 0.7 }), '--prop-paper'),
    metal: m.register(new MeshStandardMaterial({ roughness: 0.25, metalness: 1 }), '--prop-metal'),
    visor: m.register(new MeshPhysicalMaterial({ roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 }), '--bot-visor'),
    trim: m.register(new MeshPhysicalMaterial({ roughness: 0.42, clearcoat: 0.6 }), '--bot-trim'),
    eye: m.register(new MeshStandardMaterial({ roughness: 0.3, emissiveIntensity: 0.8 }), '--bot-eye', { emissive: '--bot-eye' }),
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

export function poseDiners(figures, seconds, { reducedMotion = false } = {}) {
  for (const figure of figures) {
    const pose = dinerPose(figure.loop, seconds, figure.phase, { reducedMotion });
    figure.armR.rotation.x = pose.armR;
    figure.armL.rotation.x = pose.armL;
    figure.head.rotation.x = pose.head;
    figure.head.rotation.z = pose.tilt;
    figure.body.rotation.z = pose.sway;
  }
}

export function dinerHeadY() {
  return SEAT + DINER_HEAD * DINER_SCALE;
}
