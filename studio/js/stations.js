import {
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
import { GUEST_SPOT, stationConfig, stationX } from './kitchen.js';
import { lathe, mergeStatic, roundedBox } from './forms.js';

export const COUNTER_TOP = 0.45;
export const COUNTER_FRONT = 0.48;
export const COUNTER_LENGTH = 13.6;
export const BOT_Z = -0.78;
export const RAIL_Y = 2.0;
export const RAIL_Z = -1.6;
export const TICKET_Y = 1.77;
export const TABLE_TOP = 0.44;
export const GUEST_TOP = TABLE_TOP * 1.3;
export const ARC_Y = 1.2;
export const ARC_Z = 0.78;
const DASHES = 22;
const STEAM_PUFFS = 3;
const PROP_SCALE = 1.35;
const GUEST_SCALE = 1.3;

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
  const blobMaterial = register(new MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, alphaMap: textures.blob, polygonOffset: true, polygonOffsetFactor: -2 }), '--shadow', { flat: true });
  const blob = (width, depth, x, y, z) => {
    const plane = new PlaneGeometry(width, depth);
    plane.rotateX(-Math.PI / 2);
    const value = mesh(plane, blobMaterial, [x, y + 0.003, z], [0, 0, 0], { cast: false });
    value.receiveShadow = false;
    value.renderOrder = 1;
    return value;
  };
  return { register, standard, physical, mesh, box, blob };
}

function orderStation(k, textures) {
  const wood = k.standard('--prop-wood', { roughness: 0.5, map: textures.planks });
  const paper = k.standard('--prop-paper', { roughness: 0.85, map: textures.paper });
  const ink = k.physical('--on-brand', { roughness: 0.15, clearcoat: 1 });
  const feather = k.physical('--prop-paper', { roughness: 0.6, sheen: 0.5 });
  const brass = k.physical('--room-brass', { roughness: 0.3, metalness: 0.9 });
  const lectern = new Group();
  lectern.add(
    k.mesh(lathe([[0, 0], [0.17, 0], [0.18, 0.02], [0.15, 0.04], [0, 0.04]], 32), wood, [0, 0, 0]),
    k.mesh(new CylinderGeometry(0.03, 0.04, 0.34, 20), wood, [0, 0.2, 0]),
    k.box([0.46, 0.03, 0.34, 0.012], wood, [0, 0.4, 0], [-0.45, 0, 0]),
    k.box([0.46, 0.04, 0.03, 0.01], wood, [0, 0.33, 0.165], [-0.45, 0, 0]),
    k.box([0.26, 0.012, 0.22, 0.004], paper, [-0.03, 0.42, 0.012], [-0.45, 0, 0.05]),
    k.mesh(lathe([[0, 0], [0.03, 0], [0.034, 0.02], [0.02, 0.045], [0.012, 0.05], [0, 0.05]], 20), ink, [0.17, 0.41, -0.06], [-0.45, 0, 0])
  );
  const quill = new Group();
  const plume = k.mesh(new SphereGeometry(1, 20, 12), feather, [0, 0.09, 0], [0, 0, 0]);
  plume.scale.set(0.028, 0.12, 0.01);
  quill.add(plume, k.mesh(new CylinderGeometry(0.004, 0.006, 0.2, 8), brass, [0, 0.02, 0]));
  quill.position.set(0.17, 0.46, -0.09);
  quill.rotation.set(-0.3, 0, -0.35);
  lectern.add(quill);
  lectern.position.set(0.34, COUNTER_TOP, 0.06);
  lectern.rotation.y = -0.35;
  return [lectern, k.blob(0.6, 0.5, 0.34, COUNTER_TOP, 0.06)];
}

function cookStation(k, textures, dynamic) {
  const body = k.physical('--kitchen-steel', { roughness: 0.3, metalness: 0.75, clearcoat: 0.4 });
  const top = k.physical('--plinth-base', { roughness: 0.35, clearcoat: 0.6 });
  const iron = k.physical('--kitchen-iron', { roughness: 0.45, metalness: 0.6, clearcoat: 0.3 });
  const handle = k.standard('--prop-wood', { roughness: 0.5, map: textures.planks });
  const burner = k.register(new MeshStandardMaterial({ roughness: 0.4, metalness: 0.3, emissiveIntensity: 0 }), '--kitchen-iron', { burner: true });
  const steam = k.register(new MeshStandardMaterial({ roughness: 1, transparent: true, opacity: 0.5, depthWrite: false }), '--prop-paper', { steam: true });
  const stove = new Group();
  stove.add(
    k.box([0.96, 0.12, 0.62, 0.03], body, [0, 0.06, 0]),
    k.box([0.92, 0.015, 0.58, 0.006], top, [0, 0.125, 0])
  );
  const burners = [-0.22, 0.22].map((x) => {
    const ring = k.mesh(new TorusGeometry(0.12, 0.016, 12, 40), burner, [x, 0.14, 0.02], [Math.PI / 2, 0, 0], { cast: false });
    ring.userData.dynamic = true;
    return ring;
  });
  stove.add(...burners);
  const pan = new Group();
  pan.add(
    k.mesh(lathe([[0, 0], [0.18, 0], [0.2, 0.01], [0.22, 0.055], [0.205, 0.06], [0.19, 0.016], [0, 0.016]], 40), iron, [0, 0, 0]),
    k.mesh(new CylinderGeometry(0.018, 0.02, 0.3, 12), handle, [-0.3, 0.04, 0], [0, 0, Math.PI / 2 - 0.12])
  );
  pan.position.set(-0.22, 0.15, 0.02);
  const pot = k.mesh(lathe([[0, 0], [0.13, 0], [0.14, 0.02], [0.14, 0.18], [0.15, 0.19], [0.13, 0.19], [0.125, 0.02], [0, 0.02]], 40), body, [0.22, 0.15, 0.02]);
  stove.add(pan, pot);
  const puffs = new Group();
  puffs.userData.dynamic = true;
  for (let index = 0; index < STEAM_PUFFS; index += 1) {
    const puff = k.mesh(new SphereGeometry(0.07, 16, 12), steam, [-0.22 + (index - 1) * 0.06, 0.3, 0.02], [0, 0, 0], { cast: false });
    puff.scale.setScalar(0.001);
    puffs.add(puff);
  }
  stove.add(puffs);
  stove.position.set(0, COUNTER_TOP, 0.04);
  dynamic.burners = burners;
  dynamic.steam = puffs;
  return [stove, k.blob(1.2, 0.8, 0, COUNTER_TOP, 0.04)];
}

function tasteStation(k, textures) {
  const ceramic = k.physical('--prop-paper', { roughness: 0.25, clearcoat: 0.8 });
  const soup = k.physical('--kitchen-soup', { roughness: 0.3, clearcoat: 0.6 });
  const steel = k.physical('--prop-metal', { roughness: 0.25, metalness: 1 });
  const red = k.physical('--danger', { roughness: 0.2, clearcoat: 1 });
  const board = k.standard('--prop-wood', { roughness: 0.55, map: textures.planks });
  const glass = k.physical('--prop-paper', { roughness: 0.05, transparent: true, opacity: 0.45, clearcoat: 1, depthWrite: false });
  const group = new Group();
  group.add(
    k.box([0.7, 0.03, 0.42, 0.012], board, [0.05, 0.015, 0.02], [0, 0.12, 0]),
    k.mesh(lathe([[0, 0], [0.07, 0], [0.12, 0.03], [0.16, 0.09], [0.165, 0.1], [0.15, 0.1], [0.11, 0.035], [0, 0.03]], 40), ceramic, [-0.08, 0.03, 0.04]),
    k.mesh(new CylinderGeometry(0.145, 0.12, 0.01, 40), soup, [-0.08, 0.11, 0.04], [0, 0, 0], { cast: false })
  );
  const spoon = new Group();
  const bowl = k.mesh(new SphereGeometry(1, 20, 12), steel, [0, 0, 0]);
  bowl.scale.set(0.045, 0.014, 0.06);
  spoon.add(bowl, k.mesh(new CylinderGeometry(0.008, 0.01, 0.26, 10), steel, [0, 0.008, -0.17], [Math.PI / 2, 0, 0]));
  spoon.position.set(0.24, 0.05, 0.1);
  spoon.rotation.y = 0.5;
  const thermometer = new Group();
  thermometer.add(
    k.mesh(new CylinderGeometry(0.012, 0.012, 0.32, 12), glass, [0, 0.16, 0]),
    k.mesh(new CylinderGeometry(0.005, 0.005, 0.2, 8), red, [0, 0.12, 0]),
    k.mesh(new SphereGeometry(0.022, 16, 12), red, [0, 0.01, 0]),
    k.mesh(new CylinderGeometry(0.02, 0.02, 0.03, 16), steel, [0, 0.33, 0])
  );
  thermometer.position.set(-0.02, 0.08, 0.02);
  thermometer.rotation.z = -0.45;
  group.add(spoon, thermometer);
  group.position.set(0, COUNTER_TOP, 0.04);
  return [group, k.blob(0.9, 0.6, 0, COUNTER_TOP, 0.04)];
}

function criticStation(k) {
  const ceramic = k.physical('--prop-paper', { roughness: 0.25, clearcoat: 0.8 });
  const food = k.physical('--kitchen-food', { roughness: 0.45, clearcoat: 0.5 });
  const leaf = k.standard('--bot-leaf', { roughness: 0.5 });
  const brass = k.physical('--room-brass', { roughness: 0.3, metalness: 0.9, clearcoat: 0.4 });
  const glass = k.physical('--prop-paper', { roughness: 0.02, transparent: true, opacity: 0.3, clearcoat: 1, depthWrite: false });
  const cloth = k.physical('--room-velvet', { roughness: 0.85, sheen: 0.8, sheenRoughness: 0.4 }, { sheen: '--room-velvet-sheen' });
  const group = new Group();
  const mound = k.mesh(new SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2), food, [0, 0.025, 0]);
  mound.scale.set(0.11, 0.07, 0.09);
  const garnish = k.mesh(new SphereGeometry(1, 12, 8), leaf, [0.03, 0.1, 0.01], [0.4, 0.3, 0.6]);
  garnish.scale.set(0.035, 0.008, 0.016);
  group.add(
    k.box([0.8, 0.008, 0.5, 0.003], cloth, [0, 0.004, 0.02], [0, 0, 0], { cast: false }),
    k.mesh(lathe([[0, 0.006], [0.15, 0.006], [0.24, 0.024], [0.25, 0.03], [0.14, 0.02], [0, 0.02]], 48), ceramic, [0, 0.008, 0.02]),
    mound,
    garnish
  );
  const magnifier = new Group();
  magnifier.add(
    k.mesh(new CylinderGeometry(0.018, 0.022, 0.26, 16), brass, [0, -0.2, 0]),
    k.mesh(new TorusGeometry(0.12, 0.016, 16, 48), brass, [0, 0, 0]),
    k.mesh(new CylinderGeometry(0.11, 0.11, 0.008, 40), glass, [0, 0, 0], [Math.PI / 2, 0, 0], { cast: false })
  );
  magnifier.position.set(0.12, 0.32, 0.12);
  magnifier.rotation.set(-0.9, 0.2, 0.35);
  group.add(magnifier);
  group.position.set(0, COUNTER_TOP, 0.04);
  return [group, k.blob(0.8, 0.55, 0, COUNTER_TOP, 0.04)];
}

function headChefStation(k, textures) {
  const steel = k.physical('--kitchen-steel', { roughness: 0.25, metalness: 0.85, clearcoat: 0.5 });
  const brass = k.physical('--room-brass', { roughness: 0.22, metalness: 1, clearcoat: 0.6 });
  const dark = k.physical('--plinth-base', { roughness: 0.4, clearcoat: 0.5 });
  const wood = k.standard('--prop-wood', { roughness: 0.5, map: textures.planks });
  const ink = k.standard('--brand', { roughness: 0.6 });
  const paper = k.standard('--prop-paper', { roughness: 0.85, map: textures.paper });
  const group = new Group();
  group.add(
    k.box([1.5, 0.035, 0.42, 0.012], steel, [0, 0.2, -0.02]),
    k.box([0.035, 0.2, 0.035, 0.01], steel, [-0.7, 0.1, -0.16]),
    k.box([0.035, 0.2, 0.035, 0.01], steel, [0.7, 0.1, -0.16]),
    k.box([0.035, 0.2, 0.035, 0.01], steel, [-0.7, 0.1, 0.12]),
    k.box([0.035, 0.2, 0.035, 0.01], steel, [0.7, 0.1, 0.12])
  );
  const bell = new Group();
  bell.add(
    k.mesh(new CylinderGeometry(0.1, 0.11, 0.025, 32), dark, [0, 0.012, 0]),
    k.mesh(lathe([[0, 0.12], [0.03, 0.118], [0.065, 0.1], [0.085, 0.07], [0.095, 0.035], [0.1, 0.028], [0, 0.028]], 40), brass, [0, 0, 0]),
    k.mesh(new CylinderGeometry(0.008, 0.008, 0.03, 10), brass, [0, 0.13, 0]),
    k.mesh(new SphereGeometry(0.016, 16, 10), brass, [0, 0.148, 0])
  );
  bell.position.set(-0.34, 0.0, 0.18);
  const stamp = new Group();
  stamp.add(
    k.mesh(lathe([[0, 0], [0.05, 0], [0.038, 0.06], [0.026, 0.16], [0.05, 0.2], [0.05, 0.23], [0, 0.245]], 28), wood, [0, 0.04, 0]),
    k.box([0.16, 0.04, 0.12, 0.01], dark, [0, 0.02, 0])
  );
  stamp.position.set(0.3, 0, 0.2);
  stamp.rotation.y = -0.3;
  const pad = k.box([0.2, 0.02, 0.14, 0.006], ink, [0.05, 0.01, 0.26], [0, 0.2, 0]);
  const slip = k.box([0.22, 0.006, 0.3, 0.002], paper, [0.12, 0.222, -0.02], [0, -0.15, 0]);
  group.add(bell, stamp, pad, slip);
  group.position.set(0, COUNTER_TOP, 0.02);
  return [group, k.blob(1.6, 0.7, 0, COUNTER_TOP, 0.02)];
}

function serveStation(k) {
  const ceramic = k.physical('--prop-paper', { roughness: 0.25, clearcoat: 0.8 });
  const steel = k.physical('--kitchen-steel', { roughness: 0.12, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.05 });
  const napkin = k.physical('--brand-soft', { roughness: 0.85, sheen: 0.5 });
  const group = new Group();
  group.add(
    k.mesh(lathe([[0, 0], [0.2, 0], [0.3, 0.02], [0.31, 0.028], [0.18, 0.016], [0, 0.016]], 48), ceramic, [0, 0, 0.02]),
    k.mesh(lathe([[0, 0.3], [0.06, 0.296], [0.14, 0.27], [0.21, 0.2], [0.25, 0.1], [0.26, 0.03], [0.27, 0.022], [0, 0.022]], 48), steel, [0, 0, 0.02]),
    k.mesh(new SphereGeometry(0.032, 20, 14), steel, [0, 0.325, 0.02]),
    k.mesh(new CylinderGeometry(0.008, 0.008, 0.03, 10), steel, [0, 0.305, 0.02])
  );
  for (let index = 0; index < 3; index += 1) group.add(k.mesh(new CylinderGeometry(0.2, 0.17, 0.02, 40), ceramic, [0.52, 0.01 + index * 0.022, -0.06]));
  group.add(k.box([0.2, 0.025, 0.14, 0.008], napkin, [-0.46, 0.012, 0.12], [0, 0.4, 0]));
  group.position.set(-0.2, COUNTER_TOP, 0.04);
  return [group, k.blob(1.3, 0.7, -0.1, COUNTER_TOP, 0.04)];
}

const BUILDERS = { goal: orderStation, maker: cookStation, verify: tasteStation, review: criticStation, judge: headChefStation, deliver: serveStation };

export function buildStation(stage, { registry, textures }) {
  const k = kit(registry, textures, stage);
  const dynamic = {};
  const group = new Group();
  group.name = `station_${stage}`;
  const mat = k.physical('--kitchen-mat', { roughness: 0.35, clearcoat: 0.5, map: textures.tiles });
  group.add(k.box([1.86, 0.012, 0.86, 0.006], mat, [0, COUNTER_TOP + 0.006, 0], [0, 0, 0], { cast: false }));
  const props = new Group();
  BUILDERS[stage](k, textures, dynamic).forEach((part) => props.add(part));
  props.scale.setScalar(PROP_SCALE);
  props.position.y = COUNTER_TOP * (1 - PROP_SCALE);
  group.add(props);
  const lampMaterial = k.register(new MeshStandardMaterial({ roughness: 0.2, emissiveIntensity: 1 }), '--line-strong', { lamp: true });
  const bezel = k.physical('--prop-metal', { roughness: 0.25, metalness: 1 });
  const lamp = new Group();
  lamp.add(
    k.mesh(new CylinderGeometry(0.085, 0.085, 0.02, 32), bezel, [0, 0, 0], [Math.PI / 2, 0, 0], { cast: false }),
    k.mesh(new SphereGeometry(0.06, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), lampMaterial, [0, 0, 0.008], [Math.PI / 2, 0, 0], { cast: false })
  );
  lamp.position.set(0, 0.3, COUNTER_FRONT + 0.005);
  lamp.userData.dynamic = true;
  group.add(lamp);
  group.position.x = stationX(stage);
  mergeStatic(group);
  return { group, dynamic, lamp: lampMaterial, mood: stationConfig(stage).mood };
}

function buildShell(k, textures) {
  const floor = k.physical('--kitchen-floor', { roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.4, map: textures.tiles });
  const wall = k.physical('--kitchen-wall', { roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2, map: textures.tiles });
  const counter = k.physical('--kitchen-counter', { roughness: 0.5, clearcoat: 0.3, map: textures.panels });
  const top = k.physical('--room-marble', { roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.2, map: textures.marble });
  const kick = k.physical('--plinth-base', { roughness: 0.4, clearcoat: 0.4 });
  const shelf = k.standard('--prop-wood', { roughness: 0.5, map: textures.planks });
  const steel = k.physical('--prop-metal', { roughness: 0.22, metalness: 1, clearcoat: 0.4 });
  const group = new Group();
  const floorShape = new PlaneGeometry(22, 12);
  floorShape.rotateX(-Math.PI / 2);
  const ground = k.mesh(floorShape, floor, [0, 0, 1.6], [0, 0, 0], { cast: false });
  group.add(
    ground,
    k.box([16.4, 3.5, 0.14, 0.03], wall, [0, 1.75, -1.85]),
    k.box([COUNTER_LENGTH, COUNTER_TOP - 0.07, 0.9, 0.03], counter, [0, (COUNTER_TOP - 0.07) / 2 + 0.05, 0]),
    k.box([COUNTER_LENGTH + 0.2, 0.05, 1.0, 0.02], top, [0, COUNTER_TOP - 0.025, 0]),
    k.box([COUNTER_LENGTH - 0.2, 0.05, 0.84, 0.01], kick, [0, 0.025, 0], [0, 0, 0], { cast: false }),
    k.box([COUNTER_LENGTH, 0.05, 0.3, 0.015], shelf, [0, 2.7, -1.62]),
    k.blob(COUNTER_LENGTH + 1.2, 1.9, 0, 0, 0.05)
  );
  const jars = new InstancedMesh(roundedBox(0.16, 0.22, 0.16, 0.05), k.physical('--prop-paper', { roughness: 0.15, clearcoat: 1 }), 14);
  jars.userData.colors = ['--prop-box', '--bot-leaf', '--room-terracotta', '--prop-paper', '--prop-pencil'];
  const dummy = new Object3D();
  for (let index = 0; index < jars.count; index += 1) {
    dummy.position.set(-6.2 + index * 0.95 + (index % 3) * 0.08, 2.84, -1.62);
    dummy.rotation.set(0, index * 0.7, 0);
    dummy.scale.set(1, 0.8 + (index % 4) * 0.12, 1);
    dummy.updateMatrix();
    jars.setMatrixAt(index, dummy.matrix);
  }
  jars.castShadow = true;
  group.add(jars);
  for (const x of [-COUNTER_LENGTH / 2 + 0.1, 0, COUNTER_LENGTH / 2 - 0.1]) {
    group.add(k.box([0.04, 0.05, 0.2, 0.01], steel, [x, RAIL_Y, RAIL_Z - 0.09]));
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

function buildGuest(k, textures) {
  const cloth = k.physical('--prop-paper', { roughness: 0.85, sheen: 0.6, sheenRoughness: 0.5, map: textures.fabric });
  const wood = k.standard('--prop-wood', { roughness: 0.5, map: textures.planks });
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
  return { carrier, stations, lamps, ticket, arc, burners: dynamic.burners || [], steam: dynamic.steam || null };
}
