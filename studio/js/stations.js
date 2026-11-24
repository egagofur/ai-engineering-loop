import {
  AdditiveBlending,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3
} from '../vendor/three.module.min.js';

import { STAGES } from './list.js';
import { GUEST_SPOT, STATION_SPACING, stationConfig, stationX } from './kitchen.js';
import { lathe, mergeStatic, roundedBox } from './forms.js';

export const COUNTER_TOP = 0.45;
export const COUNTER_DEPTH = 1.36;
export const COUNTER_FRONT = COUNTER_DEPTH / 2;
export const COUNTER_LENGTH = 13.6;
export const BOT_Z = -0.38;
export const BOT_Y = COUNTER_TOP;
export const RAIL_Y = 2.0;
export const RAIL_Z = -1.15;
export const TICKET_Y = 1.77;
export const TABLE_TOP = 0.44;
export const GUEST_TOP = TABLE_TOP * 1.3;
export const ARC_Y = 1.45;
export const ARC_Z = 0.55;
export const WALL_Z = -2.5;
export const SHELF_Y = 2.62;
export const PENDANT_XS = [-4.2, -1.4, 1.4, 4.2];
export const PENDANT_Y = 2.72;
export const PENDANT_Z = 0.05;
const BACK_COUNTER_Z = -2.08;
const BACK_COUNTER_TOP = 0.62;
const DASHES = 22;
const STEAM_PUFFS = 5;
const FLAME_TONGUES = 11;
const PROP_SCALE = 1.5;
const GUEST_SCALE = 1.3;
const FRONT = 0.32;

function kit(registry, textures, stage = null) {
  const register = (material, token, options = {}) => {
    registry.push({ material, token, stage, ...options });
    return material;
  };
  const standard = (token, options = {}, extra = {}) => register(new MeshStandardMaterial({ roughness: 0.6, ...options }), token, extra);
  const physical = (token, options = {}, extra = {}) => register(new MeshPhysicalMaterial({ roughness: 0.5, ...options }), token, extra);
  const mesh = (geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], { cast = true } = {}) => {
    const value = new Mesh(geometry, material);
    value.position.set(...position);
    value.rotation.set(...rotation);
    value.castShadow = cast;
    value.receiveShadow = true;
    return value;
  };
  const box = (size, material, position, rotation, options) => mesh(roundedBox(size[0], size[1], size[2], size[3] ?? Math.min(size[0], size[1], size[2]) * 0.2), material, position, rotation, options);
  const blobMaterial = register(new MeshBasicMaterial({ transparent: true, opacity: 0.34, depthWrite: false, alphaMap: textures.blob, polygonOffset: true, polygonOffsetFactor: -2 }), '--shadow', { flat: true });
  const blob = (width, depth, x, y, z, rotation = 0) => {
    const plane = new PlaneGeometry(width, depth);
    plane.rotateX(-Math.PI / 2);
    plane.rotateY(rotation);
    const value = mesh(plane, blobMaterial, [x, y + 0.003, z], [0, 0, 0], { cast: false });
    value.receiveShadow = false;
    value.renderOrder = 1;
    return value;
  };
  return { register, standard, physical, mesh, box, blob };
}

function orderStation(k, textures) {
  const wood = k.standard('--prop-wood', { roughness: 0.45, map: textures.grain });
  const paper = k.standard('--prop-paper', { roughness: 0.85, map: textures.paper });
  const ink = k.physical('--on-brand', { roughness: 0.12, clearcoat: 1 });
  const feather = k.physical('--prop-paper', { roughness: 0.6, sheen: 0.5 });
  const brass = k.physical('--room-brass', { roughness: 0.28, metalness: 1, clearcoat: 0.4 });
  const leather = k.physical('--room-velvet', { roughness: 0.55, sheen: 0.4, sheenRoughness: 0.5 }, { sheen: '--room-velvet-sheen' });
  const book = new Group();
  book.add(
    k.box([0.5, 0.03, 0.36, 0.01], leather, [0, 0.015, 0]),
    k.box([0.23, 0.025, 0.33, 0.006], paper, [-0.12, 0.04, 0], [0, 0, 0.06]),
    k.box([0.23, 0.025, 0.33, 0.006], paper, [0.12, 0.04, 0], [0, 0, -0.06])
  );
  book.position.set(-0.42, 0, FRONT);
  book.rotation.y = 0.25;
  const pot = new Group();
  pot.add(
    k.mesh(lathe([[0, 0], [0.05, 0], [0.056, 0.03], [0.04, 0.07], [0.026, 0.08], [0, 0.08]], 24), ink, [0, 0, 0])
  );
  const quill = new Group();
  const plume = k.mesh(new SphereGeometry(1, 20, 12), feather, [0, 0.16, 0]);
  plume.scale.set(0.045, 0.17, 0.012);
  quill.add(plume, k.mesh(new CylinderGeometry(0.005, 0.007, 0.28, 8), brass, [0, 0.05, 0]));
  quill.position.set(0, 0.05, 0);
  quill.rotation.set(0.1, 0, -0.3);
  pot.add(quill);
  pot.position.set(-0.08, 0, FRONT + 0.05);
  const spike = new Group();
  spike.add(
    k.mesh(new CylinderGeometry(0.07, 0.08, 0.03, 24), brass, [0, 0.015, 0]),
    k.mesh(new CylinderGeometry(0.006, 0.006, 0.3, 8), brass, [0, 0.18, 0])
  );
  [0.08, 0.12, 0.16, 0.2].forEach((y, index) => spike.add(k.box([0.16, 0.004, 0.2, 0.002], paper, [0, y, 0], [0.05 * (index % 2 ? 1 : -1), index * 0.4, 0.04])));
  spike.position.set(0.48, 0, FRONT - 0.02);
  return [book, pot, spike, k.blob(0.8, 0.55, -0.3, 0, FRONT), k.blob(0.35, 0.35, 0.48, 0, FRONT)];
}

function cookStation(k, textures, dynamic) {
  const body = k.physical('--kitchen-steel', { roughness: 0.32, metalness: 0.9, map: textures.brushed });
  const top = k.physical('--kitchen-iron', { roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  const iron = k.physical('--kitchen-iron', { roughness: 0.42, metalness: 0.6, clearcoat: 0.3 });
  const handle = k.standard('--prop-wood', { roughness: 0.5, map: textures.grain });
  const food = k.physical('--kitchen-food', { roughness: 0.45, clearcoat: 0.4 });
  const leaf = k.standard('--bot-leaf', { roughness: 0.5 });
  const burner = k.register(new MeshStandardMaterial({ roughness: 0.4, metalness: 0.3, emissiveIntensity: 0 }), '--kitchen-iron', { burner: true });
  const steam = k.register(new MeshStandardMaterial({ roughness: 1, transparent: true, opacity: 0.26, depthWrite: false }), '--prop-paper', { steam: true });
  const stove = new Group();
  stove.add(
    k.box([1.32, 0.09, 0.62, 0.03], body, [0, 0.045, 0]),
    k.box([1.26, 0.014, 0.56, 0.006], top, [0, 0.094, 0])
  );
  for (const x of [-0.56, 0.56]) stove.add(k.mesh(new CylinderGeometry(0.025, 0.025, 0.03, 16), iron, [x, 0.045, 0.32], [Math.PI / 2, 0, 0]));
  const burners = [-0.34, 0.34].map((x) => {
    const ring = k.mesh(new TorusGeometry(0.14, 0.014, 10, 40), burner, [x, 0.104, 0], [Math.PI / 2, 0, 0], { cast: false });
    ring.userData.dynamic = true;
    return ring;
  });
  stove.add(...burners);
  const pan = new Group();
  pan.add(
    k.mesh(lathe([[0, 0], [0.2, 0], [0.22, 0.01], [0.24, 0.06], [0.225, 0.066], [0.205, 0.016], [0, 0.016]], 40), iron, [0, 0, 0]),
    k.mesh(new CylinderGeometry(0.018, 0.022, 0.32, 12), handle, [-0.36, 0.05, 0], [0, 0, Math.PI / 2 - 0.12])
  );
  for (const [x, z, s] of [[-0.06, 0.03, 1], [0.07, -0.05, 0.8], [0.03, 0.08, 0.7]]) {
    const piece = k.mesh(new SphereGeometry(1, 14, 10), food, [x, 0.03, z]);
    piece.scale.set(0.055 * s, 0.025 * s, 0.045 * s);
    pan.add(piece);
  }
  const herb = k.mesh(new SphereGeometry(1, 10, 8), leaf, [-0.02, 0.05, -0.02]);
  herb.scale.set(0.03, 0.008, 0.016);
  pan.add(herb);
  pan.position.set(-0.34, 0.1, 0);
  pan.userData.dynamic = true;
  const flame = buildFlame(k);
  flame.position.set(-0.34, 0.108, 0);
  const pot = new Group();
  pot.add(
    k.mesh(lathe([[0, 0], [0.15, 0], [0.16, 0.02], [0.16, 0.22], [0.17, 0.23], [0.15, 0.23], [0.145, 0.02], [0, 0.02]], 40), body, [0, 0, 0]),
    k.mesh(lathe([[0, 0.25], [0.06, 0.245], [0.15, 0.225], [0.165, 0.215], [0, 0.215]], 40), body, [0, 0, 0]),
    k.mesh(new SphereGeometry(0.024, 14, 10), iron, [0, 0.262, 0])
  );
  for (const side of [-1, 1]) pot.add(k.mesh(new TorusGeometry(0.035, 0.009, 8, 20, Math.PI), iron, [side * 0.17, 0.19, 0], [0, side > 0 ? 0 : Math.PI, Math.PI / 2]));
  pot.position.set(0.36, 0.1, 0);
  stove.add(pan, pot, flame);
  const puffs = new Group();
  puffs.userData.dynamic = true;
  for (let index = 0; index < STEAM_PUFFS; index += 1) {
    const puff = k.mesh(new SphereGeometry(0.045, 14, 10), steam, [0.36 + ((index % 3) - 1) * 0.05, 0.38, 0], [0, 0, 0], { cast: false });
    puff.scale.setScalar(0.001);
    puffs.add(puff);
  }
  stove.add(puffs);
  stove.position.set(0, 0, FRONT - 0.04);
  dynamic.burners = burners;
  dynamic.steam = puffs;
  dynamic.pan = pan;
  dynamic.flame = flame;
  return [stove, k.blob(1.5, 0.85, 0, 0, FRONT - 0.04)];
}

function buildFlame(k) {
  const glow = (token) => k.register(new MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending, toneMapped: false }), token, { flat: true });
  const outer = glow('--kitchen-flame');
  const core = glow('--kitchen-flame-core');
  const tongue = (radius, height) => {
    const shape = new ConeGeometry(radius, height, 18, 1, true);
    shape.translate(0, height / 2, 0);
    return shape;
  };
  const flame = new Group();
  flame.name = 'flame';
  const ring = [];
  for (let index = 0; index < FLAME_TONGUES; index += 1) {
    const angle = (index / FLAME_TONGUES) * Math.PI * 2;
    const tall = 0.09 + (index % 3) * 0.025;
    const part = k.mesh(tongue(0.022, tall), outer, [Math.cos(angle) * 0.1, 0, Math.sin(angle) * 0.1], [Math.sin(angle) * 0.18, 0, -Math.cos(angle) * 0.18], { cast: false });
    part.userData.phase = index * 1.7;
    ring.push(part);
  }
  const heart = k.mesh(tongue(0.075, 0.17), outer, [0, 0, 0], [0, 0, 0], { cast: false });
  const inner = k.mesh(tongue(0.045, 0.12), core, [0, 0, 0], [0, 0, 0], { cast: false });
  heart.userData.phase = 0.4;
  inner.userData.phase = 2.3;
  flame.add(...ring, heart, inner);
  flame.userData.dynamic = true;
  flame.userData.tongues = [...ring, heart, inner];
  flame.userData.materials = [outer, core];
  flame.visible = false;
  return flame;
}

function tasteStation(k, textures) {
  const ceramic = k.physical('--prop-paper', { roughness: 0.22, clearcoat: 0.9 });
  const soup = k.physical('--kitchen-soup', { roughness: 0.25, clearcoat: 0.7 });
  const steel = k.physical('--prop-metal', { roughness: 0.22, metalness: 1 });
  const board = k.standard('--prop-wood', { roughness: 0.5, map: textures.grain });
  const leaf = k.standard('--bot-leaf', { roughness: 0.5 });
  const terracotta = k.physical('--room-terracotta', { roughness: 0.7 });
  const group = new Group();
  group.add(
    k.box([0.86, 0.035, 0.44, 0.014], board, [-0.1, 0.018, 0], [0, 0.08, 0]),
    k.mesh(lathe([[0, 0], [0.08, 0], [0.13, 0.03], [0.17, 0.1], [0.175, 0.11], [0.16, 0.11], [0.12, 0.04], [0, 0.035]], 40), ceramic, [-0.2, 0.035, 0.02]),
    k.mesh(new CylinderGeometry(0.155, 0.125, 0.01, 40), soup, [-0.2, 0.13, 0.02], [0, 0, 0], { cast: false })
  );
  const spoon = new Group();
  const bowl = k.mesh(new SphereGeometry(1, 20, 12), steel, [0, 0, 0]);
  bowl.scale.set(0.05, 0.015, 0.065);
  spoon.add(bowl, k.mesh(new CylinderGeometry(0.008, 0.01, 0.28, 10), steel, [0, 0.008, -0.18], [Math.PI / 2, 0, 0]));
  spoon.position.set(0.14, 0.05, 0.06);
  spoon.rotation.y = 0.6;
  group.add(spoon);
  for (const [x, token] of [[0.5, ceramic], [0.6, steel]]) {
    group.add(k.mesh(lathe([[0, 0], [0.035, 0], [0.04, 0.04], [0.032, 0.11], [0.02, 0.13], [0, 0.135]], 20), token, [x, 0, -0.08]));
  }
  const herbs = new Group();
  herbs.add(k.mesh(lathe([[0, 0], [0.06, 0], [0.075, 0.1], [0.08, 0.11], [0, 0.11]], 24), terracotta, [0, 0, 0]));
  for (let index = 0; index < 7; index += 1) {
    const sprig = k.mesh(new SphereGeometry(1, 10, 8), leaf, [Math.cos(index * 0.9) * 0.04, 0.14 + (index % 3) * 0.03, Math.sin(index * 0.9) * 0.04], [index * 0.5, index, 0.3]);
    sprig.scale.set(0.035, 0.02, 0.05);
    herbs.add(sprig);
  }
  herbs.position.set(0.55, 0, 0.14);
  group.add(herbs);
  group.position.set(0, 0, FRONT - 0.02);
  return [group, k.blob(1.1, 0.6, 0, 0, FRONT - 0.02)];
}

function criticStation(k) {
  const ceramic = k.physical('--prop-paper', { roughness: 0.22, clearcoat: 0.9 });
  const food = k.physical('--kitchen-food', { roughness: 0.45, clearcoat: 0.5 });
  const leaf = k.standard('--bot-leaf', { roughness: 0.5 });
  const brass = k.physical('--room-brass', { roughness: 0.28, metalness: 1, clearcoat: 0.4 });
  const glass = k.physical('--prop-paper', { roughness: 0.02, transparent: true, opacity: 0.3, clearcoat: 1, depthWrite: false });
  const wine = k.physical('--room-velvet', { roughness: 0.1, clearcoat: 1 });
  const cloth = k.physical('--room-velvet', { roughness: 0.85, sheen: 0.8, sheenRoughness: 0.4 }, { sheen: '--room-velvet-sheen' });
  const group = new Group();
  const mound = k.mesh(new SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2), food, [-0.1, 0.03, 0]);
  mound.scale.set(0.12, 0.08, 0.1);
  const garnish = k.mesh(new SphereGeometry(1, 12, 8), leaf, [-0.07, 0.11, 0.01], [0.4, 0.3, 0.6]);
  garnish.scale.set(0.04, 0.009, 0.018);
  group.add(
    k.box([0.95, 0.008, 0.52, 0.003], cloth, [0, 0.004, 0], [0, 0, 0], { cast: false }),
    k.mesh(lathe([[0, 0.006], [0.16, 0.006], [0.26, 0.026], [0.27, 0.032], [0.15, 0.022], [0, 0.022]], 48), ceramic, [-0.1, 0.008, 0]),
    mound,
    garnish
  );
  const pepper = new Group();
  pepper.add(k.mesh(lathe([[0, 0], [0.04, 0], [0.045, 0.02], [0.03, 0.12], [0.036, 0.17], [0.02, 0.2], [0, 0.205]], 24), brass, [0, 0, 0]));
  pepper.position.set(0.34, 0, -0.08);
  const goblet = new Group();
  goblet.add(
    k.mesh(lathe([[0, 0], [0.045, 0], [0.045, 0.006], [0.007, 0.014], [0.007, 0.1], [0.05, 0.14], [0.056, 0.2], [0.051, 0.2], [0.045, 0.145], [0, 0.13]], 28), glass, [0, 0, 0], [0, 0, 0], { cast: false }),
    k.mesh(lathe([[0, 0.12], [0.04, 0.135], [0.048, 0.16], [0, 0.16]], 24), wine, [0, 0, 0], [0, 0, 0], { cast: false })
  );
  goblet.position.set(-0.42, 0, -0.06);
  group.add(pepper, goblet);
  group.position.set(0, 0, FRONT - 0.04);
  return [group, k.blob(1.1, 0.65, 0, 0, FRONT - 0.04)];
}

function plated(k, { ceramic, food, leaf, sauce }) {
  const dish = new Group();
  const mound = k.mesh(new SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), food, [0, 0.026, 0]);
  mound.scale.set(0.11, 0.07, 0.09);
  const pool = k.mesh(new CylinderGeometry(0.15, 0.15, 0.004, 40), sauce, [0.01, 0.026, 0.01], [0, 0, 0], { cast: false });
  dish.add(k.mesh(lathe([[0, 0], [0.15, 0], [0.24, 0.018], [0.25, 0.026], [0.14, 0.022], [0, 0.022]], 48), ceramic, [0, 0, 0]), pool, mound);
  [[-0.03, 0.09, 0.02, 0.5], [0.04, 0.085, -0.02, -0.4], [0.0, 0.1, 0.0, 1.2]].forEach(([x, y, z, turn]) => {
    const sprig = k.mesh(new SphereGeometry(1, 12, 8), leaf, [x, y, z], [0.3, turn, 0.5]);
    sprig.scale.set(0.036, 0.008, 0.016);
    dish.add(sprig);
  });
  return dish;
}

function headChefStation(k, textures, dynamic) {
  const steel = k.physical('--kitchen-steel', { roughness: 0.22, metalness: 1, map: textures.brushed });
  const brass = k.physical('--room-brass', { roughness: 0.24, metalness: 0.88, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.5 });
  const wood = k.physical('--prop-wood', { roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.15, map: textures.grain });
  const paper = k.standard('--prop-paper', { roughness: 0.85, map: textures.paper });
  const ceramic = k.physical('--prop-paper', { roughness: 0.22, clearcoat: 0.9 });
  const food = k.physical('--kitchen-food', { roughness: 0.45, clearcoat: 0.5 });
  const sauce = k.physical('--kitchen-soup', { roughness: 0.2, clearcoat: 0.8 });
  const leaf = k.standard('--bot-leaf', { roughness: 0.5 });
  const group = new Group();
  group.add(k.box([0.3, 0.016, 0.22, 0.006], steel, [0.42, 0.008, FRONT - 0.02], [0, -0.2, 0]));
  [0, 1, 2].forEach((index) => group.add(k.box([0.18, 0.004, 0.2, 0.002], paper, [0.42 + index * 0.012, 0.02 + index * 0.004, FRONT - 0.02], [0, -0.2 + (index - 1) * 0.1, 0])));
  const bell = new Group();
  bell.add(
    k.mesh(lathe([[0, 0], [0.112, 0], [0.12, 0.008], [0.12, 0.022], [0.112, 0.03], [0, 0.03]], 40), wood, [0, 0, 0]),
    k.mesh(lathe([[0, 0.033], [0.104, 0.033], [0.106, 0.04], [0.1, 0.06], [0.088, 0.085], [0.066, 0.11], [0.036, 0.127], [0, 0.131]], 48), brass, [0, 0, 0]),
    k.mesh(new CylinderGeometry(0.008, 0.008, 0.032, 12), brass, [0, 0.145, 0]),
    k.mesh(new SphereGeometry(0.02, 20, 14), brass, [0, 0.166, 0])
  );
  bell.position.set(-0.42, 0, FRONT);
  bell.userData.dynamic = true;
  dynamic.bell = bell;
  const pass = plated(k, { ceramic, food, leaf, sauce });
  pass.position.set(0.02, 0, FRONT + 0.04);
  pass.userData.dynamic = true;
  pass.userData.home = pass.position.x;
  dynamic.pass = pass;
  group.add(bell, pass);
  return [group, k.blob(1.5, 0.7, 0, 0, 0.1)];
}

function serveStation(k) {
  const ceramic = k.physical('--prop-paper', { roughness: 0.22, clearcoat: 0.9 });
  const steel = k.physical('--kitchen-steel', { roughness: 0.24, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6 });
  const napkin = k.physical('--brand-soft', { roughness: 0.85, sheen: 0.5 });
  const food = k.physical('--kitchen-food', { roughness: 0.45, clearcoat: 0.5 });
  const sauce = k.physical('--kitchen-soup', { roughness: 0.2, clearcoat: 0.8 });
  const leaf = k.standard('--bot-leaf', { roughness: 0.5 });
  const group = new Group();
  const cloche = new Group();
  cloche.add(
    k.mesh(lathe([[0, 0], [0.22, 0], [0.32, 0.02], [0.33, 0.028], [0.19, 0.016], [0, 0.016]], 48), ceramic, [0, 0, 0]),
    k.mesh(lathe([[0, 0.025], [0.255, 0.025], [0.262, 0.031], [0.258, 0.046], [0.25, 0.1], [0.21, 0.2], [0.14, 0.27], [0.06, 0.296], [0, 0.3]], 64), steel, [0, 0, 0]),
    k.mesh(new CylinderGeometry(0.009, 0.009, 0.03, 12), steel, [0, 0.312, 0]),
    k.mesh(new SphereGeometry(0.032, 24, 16), steel, [0, 0.338, 0])
  );
  cloche.position.set(-0.44, 0, FRONT);
  const dish = plated(k, { ceramic, food, leaf, sauce });
  dish.position.set(0.08, 0, FRONT + 0.06);
  group.add(cloche, dish);
  for (let index = 0; index < 4; index += 1) group.add(k.mesh(lathe([[0, 0], [0.13, 0], [0.19, 0.016], [0.19, 0.022], [0, 0.02]], 40), ceramic, [0.56, index * 0.024, FRONT - 0.1]));
  group.add(k.box([0.22, 0.03, 0.16, 0.01], napkin, [0.42, 0.015, FRONT + 0.16], [0, 0.4, 0]));
  return [group, k.blob(1.5, 0.7, 0, 0, FRONT)];
}

const BUILDERS = { goal: orderStation, maker: cookStation, verify: tasteStation, review: criticStation, judge: headChefStation, deliver: serveStation };

export function buildStation(stage, { registry, textures }) {
  const k = kit(registry, textures, stage);
  const dynamic = {};
  const group = new Group();
  group.name = `station_${stage}`;
  group.userData.stage = stage;
  const props = new Group();
  BUILDERS[stage](k, textures, dynamic).forEach((part) => props.add(part));
  props.scale.setScalar(PROP_SCALE);
  props.position.set(0, COUNTER_TOP, 0);
  props.scale.z = PROP_SCALE * 0.82;
  group.add(props);
  const lampMaterial = k.register(new MeshStandardMaterial({ roughness: 0.2, emissiveIntensity: 1 }), '--line-strong', { lamp: true });
  const bezel = k.physical('--prop-metal', { roughness: 0.25, metalness: 1 });
  const lamp = new Group();
  lamp.add(
    k.mesh(new CylinderGeometry(0.075, 0.075, 0.02, 32), bezel, [0, 0, 0], [Math.PI / 2, 0, 0], { cast: false }),
    k.mesh(new SphereGeometry(0.052, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), lampMaterial, [0, 0, 0.008], [Math.PI / 2, 0, 0], { cast: false })
  );
  lamp.position.set(0, 0.24, COUNTER_FRONT + 0.03);
  lamp.userData.dynamic = true;
  group.add(lamp);
  group.position.x = stationX(stage);
  mergeStatic(group);
  return { group, dynamic, lamp: lampMaterial, mood: stationConfig(stage).mood };
}

function bracket(k, material, x) {
  return [
    k.box([0.05, 0.42, 0.05, 0.012], material, [x, SHELF_Y - 0.2, WALL_Z + 0.04]),
    k.box([0.05, 0.05, 0.36, 0.012], material, [x, SHELF_Y - 0.04, WALL_Z + 0.2]),
    k.box([0.04, 0.4, 0.04, 0.01], material, [x, SHELF_Y - 0.2, WALL_Z + 0.2], [0.72, 0, 0])
  ];
}

function buildShell(k, textures) {
  const floor = k.physical('--kitchen-floor', { roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.35, map: textures.checker });
  const backFloor = k.physical('--kitchen-floor-back', { roughness: 0.55, map: textures.tiles });
  const tile = k.physical('--kitchen-tile', { roughness: 0.16, clearcoat: 0.8, clearcoatRoughness: 0.12, map: textures.subway });
  const plaster = k.standard('--kitchen-wall', { roughness: 0.9, map: textures.plaster });
  const front = k.physical('--kitchen-counter', { roughness: 0.48, clearcoat: 0.25, map: textures.grain });
  const top = k.physical('--room-marble', { roughness: 0.16, clearcoat: 0.7, clearcoatRoughness: 0.12, map: textures.marble });
  const steel = k.physical('--kitchen-steel', { roughness: 0.3, metalness: 0.95, map: textures.brushed });
  const kick = k.physical('--plinth-base', { roughness: 0.4, clearcoat: 0.4 });
  const shelf = k.standard('--prop-wood', { roughness: 0.45, map: textures.grain });
  const iron = k.physical('--kitchen-iron', { roughness: 0.38, metalness: 0.7, clearcoat: 0.3 });
  const trim = k.physical('--kitchen-trim', { roughness: 0.35, clearcoat: 0.6 });
  const group = new Group();
  const floorShape = new PlaneGeometry(40, 14);
  floorShape.rotateX(-Math.PI / 2);
  const backShape = new PlaneGeometry(40, 4.4);
  backShape.rotateX(-Math.PI / 2);
  group.add(
    k.mesh(floorShape, floor, [0, 0, 7.6], [0, 0, 0], { cast: false }),
    k.mesh(backShape, backFloor, [0, 0.001, -1.0], [0, 0, 0], { cast: false }),
    k.box([26, 2.3, 0.12, 0.02], tile, [0, 1.15, WALL_Z]),
    k.box([26, 4.2, 0.12, 0.02], plaster, [0, 4.4, WALL_Z - 0.01]),
    k.box([26, 0.06, 0.08, 0.02], trim, [0, 2.31, WALL_Z + 0.06]),
    k.box([COUNTER_LENGTH, COUNTER_TOP - 0.1, COUNTER_DEPTH - 0.1, 0.03], front, [0, (COUNTER_TOP - 0.1) / 2 + 0.06, 0]),
    k.box([COUNTER_LENGTH + 0.24, 0.05, COUNTER_DEPTH + 0.08, 0.02], top, [0, COUNTER_TOP - 0.025, 0]),
    k.box([COUNTER_LENGTH - 0.2, 0.06, COUNTER_DEPTH - 0.16, 0.01], kick, [0, 0.03, 0], [0, 0, 0], { cast: false }),
    k.box([22, BACK_COUNTER_TOP - 0.06, 0.62, 0.02], steel, [0, (BACK_COUNTER_TOP - 0.06) / 2, BACK_COUNTER_Z]),
    k.box([22.1, 0.04, 0.68, 0.01], steel, [0, BACK_COUNTER_TOP - 0.02, BACK_COUNTER_Z]),
    k.box([COUNTER_LENGTH + 1, 0.06, 0.34, 0.015], shelf, [0, SHELF_Y, WALL_Z + 0.22]),
    k.blob(COUNTER_LENGTH + 1.6, 2.4, 0, 0, 0.1),
    k.blob(24, 0.9, 0, 0, WALL_Z + 0.6),
    k.blob(22, 0.5, 0, BACK_COUNTER_TOP, BACK_COUNTER_Z)
  );
  for (let index = 0; index < 8; index += 1) {
    group.add(k.box([0.012, 0.42, 0.02, 0.004], iron, [-7 + index * 2, 0.32, BACK_COUNTER_Z + 0.32]));
  }
  for (const x of [-6.4, -3.2, 0, 3.2, 6.4]) group.add(...bracket(k, iron, x));
  const hood = new Group();
  const hoodShape = new CylinderGeometry(0.62, 1.05, 0.7, 4, 1, true);
  hoodShape.rotateY(Math.PI / 4);
  hood.add(
    k.mesh(hoodShape, steel, [0, 0, 0]),
    k.box([1.52, 0.08, 1.0, 0.02], steel, [0, -0.38, 0]),
    k.box([0.62, 1.6, 0.5, 0.02], steel, [0, 1.15, -0.12])
  );
  hood.scale.set(1, 1, 0.62);
  hood.position.set(stationX('maker'), 3.3, WALL_Z + 0.5);
  group.add(hood);
  const range = new Group();
  range.add(
    k.box([1.3, 0.05, 0.56, 0.01], iron, [0, 0.025, 0]),
    k.mesh(lathe([[0, 0], [0.14, 0], [0.15, 0.02], [0.15, 0.2], [0.16, 0.21], [0.14, 0.21], [0.135, 0.02], [0, 0.02]], 32), steel, [-0.3, 0.05, 0]),
    k.mesh(lathe([[0, 0], [0.18, 0], [0.2, 0.05], [0.18, 0.055], [0, 0.015]], 32), iron, [0.32, 0.05, 0.02])
  );
  range.position.set(stationX('maker'), BACK_COUNTER_TOP, BACK_COUNTER_Z);
  group.add(range);
  const extras = [
    [stationX('goal'), [[0.18, 0.3, 0.14], [0.16, 0.22, 0.12]]],
    [stationX('verify'), [[0.32, 0.05, 0.24], [0.3, 0.05, 0.22]]],
    [stationX('review'), [[0.22, 0.34, 0.16]]],
    [stationX('deliver'), [[0.4, 0.04, 0.28], [0.38, 0.04, 0.26], [0.36, 0.04, 0.24]]]
  ];
  for (const [x, stack] of extras) {
    let y = BACK_COUNTER_TOP;
    stack.forEach(([w, h, d], index) => {
      group.add(k.box([w, h, d, 0.012], index % 2 ? steel : trim, [x + 0.3, y + h / 2, BACK_COUNTER_Z]));
      y += h;
    });
  }
  const spots = [];
  for (let cluster = 0; cluster < 13; cluster += 1) {
    const x = -7.2 + cluster * 1.12;
    if (Math.abs(x - stationX('maker')) < 1.0) continue;
    spots.push(x, x + 0.26);
  }
  const jars = new InstancedMesh(lathe([[0, 0], [0.1, 0], [0.105, 0.02], [0.105, 0.2], [0.085, 0.23], [0.07, 0.25], [0.072, 0.29], [0, 0.29]], 20), k.physical('--prop-paper', { roughness: 0.18, clearcoat: 1 }), spots.length);
  jars.userData.colors = ['--room-terracotta', '--prop-box', '--bot-leaf', '--prop-paper', '--prop-pencil', '--kitchen-soup', '--room-velvet'];
  const dummy = new Object3D();
  for (let index = 0; index < jars.count; index += 1) {
    dummy.position.set(spots[index], SHELF_Y + 0.03, WALL_Z + 0.2 + (index % 2) * 0.05);
    dummy.rotation.set(0, index * 0.7, 0);
    const tall = 0.75 + ((index * 7) % 5) * 0.14;
    dummy.scale.set(0.85 + (index % 3) * 0.12, tall, 0.85 + (index % 3) * 0.12);
    dummy.updateMatrix();
    jars.setMatrixAt(index, dummy.matrix);
  }
  jars.castShadow = true;
  jars.receiveShadow = true;
  group.add(jars);
  for (const x of [-COUNTER_LENGTH / 2 + 0.1, 0, COUNTER_LENGTH / 2 - 0.1]) {
    group.add(k.box([0.04, 0.05, RAIL_Z - WALL_Z, 0.01], steel, [x, RAIL_Y, (RAIL_Z + WALL_Z) / 2]));
  }
  group.add(k.mesh(new CylinderGeometry(0.024, 0.024, COUNTER_LENGTH - 0.1, 20), steel, [0, RAIL_Y, RAIL_Z], [0, 0, Math.PI / 2]));
  const paper = k.standard('--prop-paper', { roughness: 0.85, map: textures.paper });
  [-6.5, -6.28, -6.06].forEach((x, index) => {
    group.add(
      k.box([0.2, 0.28, 0.008, 0.004], paper, [x, TICKET_Y + 0.02, RAIL_Z + 0.03], [0.05, 0, (index - 1) * 0.06]),
      k.box([0.05, 0.04, 0.04, 0.01], steel, [x, RAIL_Y - 0.03, RAIL_Z])
    );
  });
  return group;
}

function buildPendants(k) {
  const shade = k.physical('--kitchen-iron', { roughness: 0.35, metalness: 0.5, clearcoat: 0.6 });
  const inner = k.register(new MeshStandardMaterial({ roughness: 0.6, emissiveIntensity: 0.9 }), '--light-pendant', { emissive: '--light-pendant' });
  const bulb = k.register(new MeshBasicMaterial({ toneMapped: false }), '--light-pendant', { flat: true });
  const cord = k.standard('--kitchen-iron', { roughness: 0.6 });
  const group = new Group();
  group.name = 'pendants';
  for (const x of PENDANT_XS) {
    group.add(
      k.mesh(lathe([[0.04, 0.32], [0.06, 0.3], [0.12, 0.2], [0.24, 0.04], [0.26, 0], [0.25, 0], [0.23, 0.035], [0.11, 0.19], [0.05, 0.29], [0.03, 0.31]], 40), shade, [x, PENDANT_Y, PENDANT_Z], [0, 0, 0], { cast: false }),
      k.mesh(lathe([[0, 0.28], [0.045, 0.27], [0.1, 0.18], [0.22, 0.035], [0.235, 0.005]], 32, { open: true }), inner, [x, PENDANT_Y, PENDANT_Z], [0, 0, 0], { cast: false }),
      k.mesh(new SphereGeometry(0.06, 16, 12), bulb, [x, PENDANT_Y + 0.08, PENDANT_Z], [0, 0, 0], { cast: false }),
      k.mesh(new CylinderGeometry(0.008, 0.008, 3, 6), cord, [x, PENDANT_Y + 1.8, PENDANT_Z], [0, 0, 0], { cast: false })
    );
  }
  return group;
}

function buildGuest(k, textures) {
  const cloth = k.physical('--prop-paper', { roughness: 0.85, sheen: 0.6, sheenRoughness: 0.5, map: textures.fabric });
  const wood = k.standard('--prop-wood', { roughness: 0.5, map: textures.grain });
  const ceramic = k.physical('--prop-paper', { roughness: 0.25, clearcoat: 0.8 });
  const glass = k.physical('--prop-paper', { roughness: 0.03, transparent: true, opacity: 0.35, clearcoat: 1, depthWrite: false });
  const accent = k.physical('--brand', { roughness: 0.4, clearcoat: 0.6 });
  const leaf = k.standard('--bot-leaf', { roughness: 0.5 });
  const group = new Group();
  group.name = 'guest';
  group.add(
    k.mesh(lathe([[0, TABLE_TOP], [0.6, TABLE_TOP], [0.63, TABLE_TOP - 0.02], [0.64, TABLE_TOP - 0.16], [0.6, TABLE_TOP - 0.16], [0.59, TABLE_TOP - 0.03], [0, TABLE_TOP - 0.03]], 64), cloth, [0, 0, 0]),
    k.mesh(lathe([[0, 0], [0.24, 0], [0.24, 0.02], [0.06, 0.05], [0.04, 0.4], [0, 0.4]], 32), wood, [0, 0, 0]),
    k.mesh(lathe([[0, 0], [0.13, 0], [0.19, 0.012], [0.2, 0.018], [0.12, 0.01], [0, 0.01]], 40), ceramic, [0, TABLE_TOP, 0.18]),
    k.mesh(lathe([[0, 0], [0.035, 0], [0.035, 0.004], [0.006, 0.01], [0.006, 0.07], [0.045, 0.1], [0.05, 0.16], [0.046, 0.16], [0.04, 0.105], [0, 0.1]], 28), glass, [0.24, TABLE_TOP, 0.08], [0, 0, 0], { cast: false }),
    k.mesh(lathe([[0, 0], [0.04, 0], [0.05, 0.05], [0.03, 0.1], [0.022, 0.13], [0, 0.13]], 24), accent, [-0.22, TABLE_TOP, -0.12]),
    k.mesh(new SphereGeometry(0.045, 16, 12), leaf, [-0.22, TABLE_TOP + 0.16, -0.12])
  );
  const chair = new Group();
  chair.add(
    k.box([0.42, 0.04, 0.4, 0.015], wood, [0, 0.3, 0]),
    k.box([0.42, 0.42, 0.04, 0.015], wood, [0, 0.52, 0.19]),
    ...[[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]].map(([x, z]) => k.box([0.035, 0.3, 0.035, 0.01], wood, [x, 0.15, z]))
  );
  chair.position.set(0, 0, 0.72);
  group.add(chair, k.blob(1.7, 1.9, 0, 0, 0.3));
  group.scale.setScalar(GUEST_SCALE);
  group.position.set(GUEST_SPOT.x, 0, GUEST_SPOT.z);
  mergeStatic(group);
  return group;
}

function buildTicket(k) {
  const paper = k.physical('--brand', { roughness: 0.7, emissiveIntensity: 0.15 }, { emissive: '--brand' });
  const steel = k.physical('--prop-metal', { roughness: 0.22, metalness: 1 });
  const ticket = new Group();
  ticket.add(
    k.box([0.24, 0.32, 0.01, 0.005], paper, [0, TICKET_Y, RAIL_Z + 0.035]),
    k.box([0.06, 0.045, 0.045, 0.01], steel, [0, RAIL_Y - 0.03, RAIL_Z])
  );
  return ticket;
}

function buildReturnArc(k) {
  const dash = k.register(new MeshStandardMaterial({ roughness: 0.4, emissiveIntensity: 0.5 }), '--brand', { emissive: '--brand' });
  const from = stationX('judge');
  const to = stationX('maker');
  const curve = new CatmullRomCurve3([
    new Vector3(from, ARC_Y - 0.2, ARC_Z - 0.1),
    new Vector3((from + to) / 2, ARC_Y + 0.55, ARC_Z + 0.2),
    new Vector3(to, ARC_Y - 0.2, ARC_Z - 0.1)
  ]);
  const dashes = new InstancedMesh(new CylinderGeometry(0.018, 0.018, 0.16, 10), dash, DASHES);
  const dummy = new Object3D();
  const up = new Vector3(0, 1, 0);
  for (let index = 0; index < DASHES; index += 1) {
    const t = (index + 0.3) / (DASHES + 0.6);
    dummy.position.copy(curve.getPointAt(t));
    dummy.quaternion.setFromUnitVectors(up, curve.getTangentAt(t).normalize());
    dummy.updateMatrix();
    dashes.setMatrixAt(index, dummy.matrix);
  }
  const arrow = new Mesh(new ConeGeometry(0.06, 0.16, 20), dash);
  arrow.position.copy(curve.getPointAt(1));
  arrow.quaternion.setFromUnitVectors(up, curve.getTangentAt(1).normalize());
  const arc = new Group();
  arc.name = 'return_arc';
  arc.add(dashes, arrow);
  arc.userData.apex = curve.getPointAt(0.5);
  return arc;
}

export function buildKitchen({ registry, textures }) {
  const k = kit(registry, textures);
  const carrier = new Group();
  const shell = buildShell(k, textures);
  shell.add(buildPendants(k));
  mergeStatic(shell);
  const stations = {};
  const lamps = {};
  const dynamic = {};
  STAGES.forEach((stage) => {
    const built = buildStation(stage, { registry, textures });
    stations[stage] = built.group;
    lamps[stage] = built.lamp;
    Object.assign(dynamic, built.dynamic);
    carrier.add(built.group);
  });
  const ticket = buildTicket(k);
  const arc = buildReturnArc(k);
  carrier.add(shell, buildGuest(k, textures), ticket, arc);
  return { carrier, stations, lamps, ticket, arc, burners: dynamic.burners || [], steam: dynamic.steam || null, bell: dynamic.bell || null, pan: dynamic.pan || null, flame: dynamic.flame || null, pass: dynamic.pass || null };
}

export const STATION_WIDTH = STATION_SPACING;
