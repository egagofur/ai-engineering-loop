import {
  CapsuleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Shape,
  SphereGeometry,
  TorusGeometry
} from '../vendor/three.module.min.js';

import { RING_STAGES } from './ring2d.js';
import { ROOM_SPACING, roomConfig } from './diorama.js';
import { lathe, mergeStatic, roundedBox, sectorSlab, wallPanel } from './forms.js';

export const DECK_RADIUS = 2.46;
export const HUB_RADIUS = 0.62;
export const ROOM_INNER = 0.66;
export const ROOM_OUTER = 2.3;
export const FLOOR_TOP = 0.06;
export const BOT_SPOT = 1.74;
export const PLAQUE_RADIUS = DECK_RADIUS + 0.005;
export const PLAQUE_HEIGHT = -0.2;
const HALF_SPAN = ROOM_SPACING / 2;
const WALL_RADIUS = 0.72;
const WALL_HEIGHT = 1.02;
const PROP_SCALE = 1.32;
const PROP_SPREAD = 1.28;

function kit(stage, registry, textures) {
  const geometries = [];
  const register = (material, token, options = {}) => {
    registry.push({ material, token, stage, ...options });
    return material;
  };
  const standard = (token, options = {}, extra = {}) => register(new MeshStandardMaterial({ roughness: 0.6, ...options }), token, extra);
  const physical = (token, options = {}, extra = {}) => register(new MeshPhysicalMaterial({ roughness: 0.5, ...options }), token, extra);
  const shape = (value) => {
    geometries.push(value);
    return value;
  };
  const mesh = (geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], { cast = true } = {}) => {
    const value = new Mesh(shape(geometry), material);
    value.position.set(...position);
    value.rotation.set(...rotation);
    value.castShadow = cast;
    value.receiveShadow = true;
    return value;
  };
  const box = (size, material, position, rotation, options) => mesh(roundedBox(size[0], size[1], size[2], size[3] ?? Math.min(size[0], size[1], size[2]) * 0.18), material, position, rotation, options);
  const blobMaterial = register(new MeshBasicMaterial({ transparent: true, opacity: 0.34, depthWrite: false, alphaMap: textures.blob, polygonOffset: true, polygonOffsetFactor: -2 }), '--shadow', { flat: true });
  const blob = (width, depth, x, z) => {
    const plane = new PlaneGeometry(width, depth);
    plane.rotateX(-Math.PI / 2);
    const value = mesh(plane, blobMaterial, [x, FLOOR_TOP + 0.003, z], [0, 0, 0], { cast: false });
    value.receiveShadow = false;
    return value;
  };
  return { geometries, standard, physical, mesh, box, blob, register };
}

function goalRoom(k, textures) {
  const marble = k.physical('--room-marble', { roughness: 0.22, clearcoat: 0.5, clearcoatRoughness: 0.2, map: textures.marble });
  const wood = k.standard('--prop-wood', { roughness: 0.55, map: textures.planks });
  const parchment = k.standard('--room-parchment', { roughness: 0.85, map: textures.paper });
  const terracotta = k.physical('--room-terracotta', { roughness: 0.6, clearcoat: 0.25 });
  const ink = k.physical('--on-brand', { roughness: 0.15, clearcoat: 1 });
  const leaf = k.standard('--bot-leaf', { roughness: 0.5 });
  const parts = [];
  const column = new Group();
  column.add(
    k.box([0.3, 0.07, 0.3, 0.02], marble, [0, 0.035, 0]),
    k.mesh(lathe([[0.1, 0], [0.098, 0.3], [0.092, 0.6], [0.084, 0.82], [0, 0.82]], 32), marble, [0, 0.07, 0]),
    k.mesh(lathe([[0, 0], [0.09, 0], [0.13, 0.04], [0.14, 0.06], [0, 0.06]], 32), marble, [0, 0.88, 0]),
    k.box([0.3, 0.05, 0.3, 0.015], marble, [0, 0.96, 0])
  );
  column.position.set(-0.46, FLOOR_TOP, 1.02);
  parts.push(column, k.blob(0.5, 0.5, -0.46, 1.02));

  const desk = new Group();
  const leg = () => lathe([[0.022, 0], [0.03, 0.05], [0.018, 0.12], [0.026, 0.2], [0.018, 0.28], [0.024, 0.3], [0, 0.3]], 16);
  desk.add(k.box([0.56, 0.04, 0.3, 0.015], wood, [0, 0.32, 0]));
  for (const [x, z] of [[-0.24, -0.11], [0.24, -0.11], [-0.24, 0.11], [0.24, 0.11]]) desk.add(k.mesh(leg(), wood, [x, 0, z]));
  desk.add(
    k.box([0.26, 0.006, 0.18, 0.002], parchment, [0.02, 0.345, 0.01], [0, 0.1, 0]),
    k.mesh(new CylinderGeometry(0.018, 0.018, 0.2, 16), parchment, [-0.12, 0.36, 0.01], [Math.PI / 2, 0, 0.1]),
    k.mesh(new CylinderGeometry(0.018, 0.018, 0.2, 16), parchment, [0.16, 0.36, 0.02], [Math.PI / 2, 0, 0.1]),
    k.mesh(lathe([[0, 0], [0.03, 0], [0.034, 0.02], [0.02, 0.045], [0.012, 0.05], [0, 0.05]], 20), ink, [0.2, 0.34, -0.08])
  );
  desk.position.set(0.44, FLOOR_TOP, 1.0);
  desk.rotation.y = -0.45;
  parts.push(desk, k.blob(0.75, 0.5, 0.44, 1.0));

  const amphora = k.mesh(lathe([[0, 0], [0.05, 0], [0.07, 0.03], [0.11, 0.12], [0.12, 0.2], [0.09, 0.3], [0.045, 0.36], [0.04, 0.4], [0.06, 0.42], [0.05, 0.43], [0, 0.43]], 32), terracotta, [-0.12, FLOOR_TOP, 0.88]);
  parts.push(amphora, k.blob(0.3, 0.3, -0.12, 0.88));

  const wreath = new InstancedMesh(new SphereGeometry(1, 12, 8), leaf, 18);
  k.geometries.push(wreath.geometry);
  const dummy = new Object3D();
  for (let index = 0; index < 18; index += 1) {
    const side = index < 9 ? -1 : 1;
    const a = Math.PI * (1.5 + side * (0.12 + ((index % 9) / 8) * 0.62));
    dummy.position.set(Math.cos(a) * 0.15, 0.8 + Math.sin(a) * 0.15, WALL_RADIUS + 0.025);
    dummy.rotation.set(0, 0, a + side * (Math.PI / 2 + 0.45));
    dummy.scale.set(0.035, 0.016, 0.01);
    dummy.updateMatrix();
    wreath.setMatrixAt(index, dummy.matrix);
  }
  wreath.castShadow = true;
  wreath.userData.fixed = true;
  parts.push(wreath);
  return parts;
}

function makerRoom(k, textures) {
  const wood = k.standard('--prop-wood', { roughness: 0.5, map: textures.planks });
  const steel = k.standard('--prop-metal', { roughness: 0.3, metalness: 1 });
  const board = k.standard('--room-pegboard', { roughness: 0.8, map: textures.pegboard });
  const toolbox = k.physical('--danger', { roughness: 0.35, clearcoat: 0.8 });
  const rubber = k.standard('--on-brand', { roughness: 0.7 });
  const parts = [];
  const bench = new Group();
  bench.add(k.box([0.64, 0.07, 0.32, 0.02], wood, [0, 0.34, 0]));
  for (const x of [-0.27, 0.27]) {
    for (const z of [-0.11, 0.11]) bench.add(k.box([0.05, 0.31, 0.05, 0.012], wood, [x, 0.155, z]));
  }
  bench.add(
    k.box([0.58, 0.025, 0.26, 0.01], wood, [0, 0.09, 0]),
    k.box([0.09, 0.06, 0.07, 0.015], steel, [-0.2, 0.405, 0.06]),
    k.box([0.03, 0.03, 0.12, 0.01], steel, [-0.2, 0.42, 0.15])
  );
  bench.position.set(-0.42, FLOOR_TOP, 1.02);
  bench.rotation.y = 0.45;
  parts.push(bench, k.blob(0.85, 0.5, -0.42, 1.02));

  const pegboard = k.box([0.46, 0.34, 0.02, 0.008], board, [0, 0.7, WALL_RADIUS + 0.02]);
  const wrench = new Group();
  wrench.add(k.mesh(new CapsuleGeometry(0.012, 0.16, 4, 10), steel), k.mesh(new TorusGeometry(0.028, 0.011, 10, 24, Math.PI * 1.6), steel, [0, 0.1, 0], [0, 0, -Math.PI * 0.3]));
  wrench.position.set(-0.1, 0.7, WALL_RADIUS + 0.05);
  wrench.rotation.z = 0.3;
  const driver = new Group();
  driver.add(k.mesh(new CapsuleGeometry(0.02, 0.06, 4, 12), toolbox, [0, -0.04, 0]), k.mesh(new CylinderGeometry(0.006, 0.006, 0.1, 8), steel, [0, 0.05, 0]));
  driver.position.set(0.09, 0.7, WALL_RADIUS + 0.05);
  driver.rotation.z = -0.25;
  parts.push(pegboard, wrench, driver);

  const box = new Group();
  box.add(
    k.box([0.3, 0.14, 0.16, 0.03], toolbox, [0, 0.07, 0]),
    k.mesh(new TorusGeometry(0.06, 0.012, 10, 24, Math.PI), rubber, [0, 0.14, 0])
  );
  box.position.set(0.48, FLOOR_TOP, 0.9);
  box.rotation.y = -0.5;
  parts.push(box, k.blob(0.45, 0.35, 0.48, 0.9));

  const blocks = new InstancedMesh(roundedBox(0.13, 0.13, 0.13, 0.025), k.physical('--prop-paper', { roughness: 0.4, clearcoat: 0.7 }, { instanced: true }), 4);
  k.geometries.push(blocks.geometry);
  const dummy = new Object3D();
  [[0, 0.065, 0, 0.1], [0.14, 0.065, 0.03, -0.2], [0.07, 0.195, 0.01, 0.35], [0.06, 0.065, 0.15, 0.6]].forEach(([x, y, z, r], index) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, r, 0);
    dummy.updateMatrix();
    blocks.setMatrixAt(index, dummy.matrix);
  });
  blocks.userData.colors = ['--brand', '--ok-fill', '--prop-pencil', '--prop-paper'];
  blocks.position.set(0.5, FLOOR_TOP, 1.38);
  blocks.castShadow = true;
  blocks.receiveShadow = true;
  parts.push(blocks, k.blob(0.4, 0.4, 0.57, 1.45));
  return parts;
}

function verifyRoom(k, textures) {
  const white = k.physical('--room-bench', { roughness: 0.3, clearcoat: 0.6 });
  const steel = k.standard('--prop-metal', { roughness: 0.25, metalness: 1 });
  const glass = k.physical('--prop-paper', { roughness: 0.03, transparent: true, opacity: 0.32, clearcoat: 1, depthWrite: false });
  const liquidGreen = k.physical('--ok-fill', { roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.85 });
  const liquidOrange = k.physical('--brand', { roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.85 });
  const screen = k.physical('--bot-visor', { roughness: 0.1, clearcoat: 1 });
  const check = k.standard('--ok-fill', { roughness: 0.4, emissiveIntensity: 1.1 }, { emissive: '--ok-fill' });
  const parts = [];
  const bench = new Group();
  bench.add(k.box([0.66, 0.045, 0.3, 0.015], white, [0, 0.35, 0]));
  for (const x of [-0.29, 0.29]) {
    for (const z of [-0.11, 0.11]) bench.add(k.mesh(new CylinderGeometry(0.014, 0.014, 0.33, 12), steel, [x, 0.165, z]));
  }
  bench.add(k.box([0.6, 0.02, 0.24, 0.008], white, [0, 0.1, 0]));
  const flask = lathe([[0, 0], [0.07, 0], [0.075, 0.01], [0.06, 0.07], [0.022, 0.13], [0.02, 0.18], [0.026, 0.19], [0, 0.19]], 28);
  const fill = lathe([[0, 0.005], [0.066, 0.005], [0.068, 0.015], [0.052, 0.07], [0, 0.07]], 28);
  bench.add(
    k.mesh(flask, glass, [-0.18, 0.372, 0.02], [0, 0, 0], { cast: false }),
    k.mesh(fill, liquidGreen, [-0.18, 0.372, 0.02]),
    k.mesh(flask.clone(), glass, [-0.04, 0.372, -0.04], [0, 0, 0], { cast: false }),
    k.mesh(fill.clone(), liquidOrange, [-0.04, 0.372, -0.04])
  );
  const rack = k.box([0.22, 0.03, 0.07, 0.01], steel, [0.17, 0.43, 0.0]);
  bench.add(rack);
  const tubes = new InstancedMesh(new CapsuleGeometry(0.016, 0.12, 4, 12), glass, 4);
  const liquids = new InstancedMesh(new CapsuleGeometry(0.013, 0.05, 4, 12), liquidGreen, 4);
  k.geometries.push(tubes.geometry, liquids.geometry);
  const dummy = new Object3D();
  for (let index = 0; index < 4; index += 1) {
    dummy.position.set(0.09 + index * 0.053, 0.44, 0);
    dummy.updateMatrix();
    tubes.setMatrixAt(index, dummy.matrix);
    dummy.position.y = 0.405;
    dummy.updateMatrix();
    liquids.setMatrixAt(index, dummy.matrix);
  }
  bench.add(tubes, liquids);
  bench.position.set(-0.4, FLOOR_TOP, 1.0);
  bench.rotation.y = 0.45;
  parts.push(bench, k.blob(0.85, 0.5, -0.4, 1.0));

  const panel = new Group();
  panel.add(k.box([0.42, 0.28, 0.03, 0.03], screen, [0, 0, 0]));
  const tick = new Group();
  tick.add(
    k.mesh(new CapsuleGeometry(0.018, 0.06, 4, 10), check, [-0.04, -0.02, 0.02], [0, 0, 0.8], { cast: false }),
    k.mesh(new CapsuleGeometry(0.018, 0.15, 4, 10), check, [0.035, 0.02, 0.02], [0, 0, -0.62], { cast: false })
  );
  panel.add(tick);
  panel.position.set(0.06, 0.68, WALL_RADIUS + 0.03);
  parts.push(panel);

  const scope = new Group();
  scope.add(
    k.mesh(lathe([[0, 0], [0.09, 0], [0.095, 0.015], [0.08, 0.03], [0, 0.03]], 28), white),
    k.mesh(new CapsuleGeometry(0.025, 0.2, 4, 12), white, [-0.04, 0.15, 0], [0, 0, 0.25]),
    k.mesh(new CylinderGeometry(0.03, 0.026, 0.18, 20), steel, [0.03, 0.24, 0], [0, 0, -0.4]),
    k.mesh(new CylinderGeometry(0.06, 0.06, 0.012, 24), steel, [0.02, 0.1, 0])
  );
  scope.position.set(0.46, FLOOR_TOP, 1.0);
  scope.rotation.y = -0.6;
  parts.push(scope, k.blob(0.35, 0.35, 0.46, 1.0));
  return parts;
}

function reviewRoom(k, textures, lights) {
  const velvet = k.physical('--room-velvet', { roughness: 0.75, sheen: 1, sheenRoughness: 0.4, map: textures.fabric }, { sheen: '--room-velvet-sheen' });
  const darkWood = k.standard('--room-dark-wood', { roughness: 0.45, map: textures.planks });
  const wax = k.physical('--prop-paper', { roughness: 0.45, clearcoat: 0.3 });
  const brass = k.standard('--room-brass', { roughness: 0.3, metalness: 1 });
  const flameMaterial = k.register(new MeshBasicMaterial(), '--candle-flame', { flat: true, lit: true });
  const rug = k.physical('--room-rug', { roughness: 0.9, sheen: 0.6, map: textures.fabric });
  const parts = [];
  const chair = new Group();
  chair.add(
    k.box([0.42, 0.12, 0.38, 0.05], velvet, [0, 0.17, 0]),
    k.box([0.42, 0.46, 0.1, 0.05], velvet, [0, 0.4, -0.15], [-0.12, 0, 0]),
    k.box([0.08, 0.2, 0.36, 0.035], velvet, [-0.21, 0.26, 0.01]),
    k.box([0.08, 0.2, 0.36, 0.035], velvet, [0.21, 0.26, 0.01])
  );
  for (const x of [-0.18, 0.18]) {
    for (const z of [-0.15, 0.15]) chair.add(k.mesh(new CylinderGeometry(0.018, 0.012, 0.12, 12), darkWood, [x, 0.06, z]));
  }
  chair.position.set(0.42, FLOOR_TOP, 1.02);
  chair.rotation.y = -0.55;
  parts.push(chair, k.blob(0.65, 0.6, 0.42, 1.02));

  const table = new Group();
  table.add(
    k.mesh(lathe([[0, 0], [0.09, 0], [0.09, 0.015], [0.03, 0.03], [0.022, 0.2], [0.03, 0.22], [0.13, 0.225], [0.13, 0.245], [0, 0.245]], 32), darkWood),
    k.mesh(lathe([[0, 0], [0.04, 0], [0.042, 0.01], [0.015, 0.02], [0.015, 0.03], [0.04, 0.035], [0, 0.035]], 24), brass, [0, 0.245, 0]),
    k.mesh(new CylinderGeometry(0.022, 0.024, 0.12, 20), wax, [0, 0.34, 0])
  );
  const flame = k.mesh(lathe([[0, 0], [0.012, 0.01], [0.014, 0.025], [0.006, 0.045], [0, 0.055]], 16), flameMaterial, [0, 0.4, 0], [0, 0, 0], { cast: false });
  flame.userData.dynamic = true;
  flame.name = 'flame';
  table.add(flame);
  const candle = new PointLight(undefined, 0.5, 2.2, 2);
  candle.position.set(0, 0.48, 0.02);
  candle.name = 'candle';
  table.add(candle);
  lights.push({ light: candle, token: '--room-review-light', stage: 'review', flicker: flame });
  table.position.set(-0.44, FLOOR_TOP, 1.12);
  parts.push(table, k.blob(0.35, 0.35, -0.44, 1.12));

  const shelf = new Group();
  shelf.add(
    k.box([0.4, 0.66, 0.14, 0.02], darkWood, [0, 0.33, 0]),
    k.box([0.36, 0.015, 0.12, 0.005], darkWood, [0, 0.33, 0.012])
  );
  const books = new InstancedMesh(roundedBox(0.04, 0.2, 0.1, 0.008), k.physical('--prop-paper', { roughness: 0.6, clearcoat: 0.3 }, { instanced: true }), 10);
  k.geometries.push(books.geometry);
  const dummy = new Object3D();
  for (let index = 0; index < 10; index += 1) {
    const row = index < 5 ? 0 : 1;
    const column = index % 5;
    dummy.position.set(-0.13 + column * 0.06, 0.14 + row * 0.31 - (column % 2) * 0.01, 0.02);
    dummy.rotation.set(0, 0, column === 4 ? 0.25 : 0);
    dummy.scale.set(1, 0.85 + (index % 3) * 0.08, 1);
    dummy.updateMatrix();
    books.setMatrixAt(index, dummy.matrix);
  }
  books.userData.colors = ['--room-velvet', '--room-dark-wood', '--room-brass', '--room-rug', '--on-brand'];
  books.castShadow = true;
  shelf.add(books);
  shelf.position.set(-0.12, FLOOR_TOP, 0.83);
  shelf.rotation.y = 0.1;
  parts.push(shelf);

  const carpet = k.mesh(new CylinderGeometry(0.5, 0.5, 0.008, 48), rug, [0.1, FLOOR_TOP + 0.004, 1.5], [0, 0, 0], { cast: false });
  carpet.userData.fixed = true;
  parts.push(carpet);
  return parts;
}

function judgeRoom(k, textures) {
  const oak = k.standard('--room-oak', { roughness: 0.45, map: textures.panels });
  const oakPlain = k.physical('--room-oak', { roughness: 0.35, clearcoat: 0.5, map: textures.planks });
  const brass = k.standard('--room-brass', { roughness: 0.28, metalness: 1 });
  const banner = k.physical('--brand', { roughness: 0.7, sheen: 0.6 });
  const parts = [];
  const bench = new Group();
  bench.add(
    k.box([0.92, 0.44, 0.28, 0.03], oak, [0, 0.22, 0]),
    k.box([0.98, 0.04, 0.34, 0.015], oakPlain, [0, 0.46, 0.01]),
    k.box([0.7, 0.28, 0.02, 0.01], oakPlain, [0, 0.22, 0.145])
  );
  const scales = new Group();
  scales.add(
    k.mesh(lathe([[0, 0], [0.06, 0], [0.065, 0.012], [0.02, 0.025], [0.012, 0.03], [0, 0.03]], 24), brass),
    k.mesh(new CylinderGeometry(0.008, 0.01, 0.24, 12), brass, [0, 0.15, 0]),
    k.mesh(new CapsuleGeometry(0.007, 0.22, 4, 8), brass, [0, 0.26, 0], [0, 0, Math.PI / 2 + 0.08]),
    k.mesh(new SphereGeometry(0.016, 16, 12), brass, [0, 0.275, 0])
  );
  for (const side of [-1, 1]) {
    const y = 0.26 - side * 0.01;
    scales.add(
      k.mesh(new CylinderGeometry(0.002, 0.002, 0.12, 6), brass, [side * 0.11, y - 0.06, 0], [0, 0, 0], { cast: false }),
      k.mesh(lathe([[0, 0], [0.05, 0.004], [0.055, 0.02], [0.052, 0.022], [0, 0.008]], 24), brass, [side * 0.11, y - 0.135, 0])
    );
  }
  scales.position.set(-0.28, 0.48, 0.02);
  const block = new Group();
  block.add(
    k.mesh(lathe([[0, 0], [0.07, 0], [0.075, 0.01], [0.07, 0.025], [0, 0.025]], 28), oakPlain),
    k.mesh(new CylinderGeometry(0.009, 0.01, 0.17, 12), oakPlain, [0.03, 0.045, 0.02], [0, 0.5, Math.PI / 2]),
    k.mesh(new CapsuleGeometry(0.03, 0.06, 6, 16), oakPlain, [-0.06, 0.045, -0.02], [Math.PI / 2, 0, 0.5])
  );
  block.position.set(0.28, 0.48, 0.03);
  bench.add(scales, block);
  bench.position.set(0, FLOOR_TOP, 1.0);
  parts.push(bench, k.blob(1.2, 0.55, 0, 1.0));
  const seal = new Group();
  seal.add(
    k.box([0.24, 0.36, 0.015, 0.01], banner, [0, 0, 0]),
    k.mesh(lathe([[0, 0], [0.07, 0], [0.075, 0.01], [0.06, 0.02], [0, 0.022]], 32), brass, [0, 0.03, 0.01], [Math.PI / 2, 0, 0])
  );
  seal.position.set(0, 0.8, WALL_RADIUS + 0.02);
  parts.push(seal);
  return parts;
}

function deliverRoom(k, textures) {
  const crate = k.standard('--prop-wood', { roughness: 0.6, map: textures.panels }, { instanced: true });
  const pallet = k.standard('--prop-wood', { roughness: 0.6, map: textures.planks });
  const cardboard = k.standard('--room-cardboard', { roughness: 0.8, map: textures.paper });
  const tape = k.standard('--room-tape', { roughness: 0.4 });
  const shutter = k.physical('--room-shutter', { roughness: 0.35, metalness: 0.6, map: textures.shutter });
  const frame = k.standard('--prop-metal', { roughness: 0.35, metalness: 0.8 });
  const stripe = k.physical('--prop-pencil', { roughness: 0.4, clearcoat: 0.4 });
  const parts = [];
  const door = new Group();
  door.add(
    k.box([0.5, 0.6, 0.03, 0.012], shutter, [0, 0.3, 0]),
    k.box([0.06, 0.66, 0.05, 0.015], frame, [-0.28, 0.33, 0.01]),
    k.box([0.06, 0.66, 0.05, 0.015], frame, [0.28, 0.33, 0.01]),
    k.box([0.62, 0.06, 0.06, 0.015], frame, [0, 0.66, 0.01])
  );
  door.position.set(0, FLOOR_TOP, WALL_RADIUS + 0.03);
  parts.push(door);

  const crates = new InstancedMesh(roundedBox(0.2, 0.2, 0.2, 0.022), crate, 3);
  k.geometries.push(crates.geometry);
  const dummy = new Object3D();
  [[0, 0.1, 0, 0.1], [0.22, 0.1, 0.04, -0.12], [0.1, 0.3, 0.02, 0.3]].forEach(([x, y, z, r], index) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, r, 0);
    dummy.updateMatrix();
    crates.setMatrixAt(index, dummy.matrix);
  });
  crates.position.set(-0.6, FLOOR_TOP, 1.0);
  crates.rotation.y = 0.45;
  crates.castShadow = true;
  crates.receiveShadow = true;
  parts.push(crates, k.blob(0.7, 0.55, -0.48, 1.05));

  const skid = new Group();
  for (const z of [-0.13, 0, 0.13]) skid.add(k.box([0.42, 0.03, 0.07, 0.008], pallet, [0, 0.055, z]));
  for (const x of [-0.17, 0, 0.17]) skid.add(k.box([0.06, 0.04, 0.34, 0.008], pallet, [x, 0.02, 0]));
  skid.add(
    k.box([0.26, 0.2, 0.22, 0.02], cardboard, [-0.02, 0.17, -0.01], [0, 0.15, 0]),
    k.box([0.05, 0.204, 0.224, 0.006], tape, [-0.02, 0.17, -0.01], [0, 0.15, 0]),
    k.box([0.16, 0.12, 0.14, 0.015], cardboard, [0.08, 0.33, 0.02], [0, -0.2, 0])
  );
  skid.position.set(0.46, FLOOR_TOP, 1.05);
  skid.rotation.y = -0.45;
  parts.push(skid, k.blob(0.6, 0.55, 0.46, 1.05));

  const line = k.mesh(sectorSlab({ inner: 2.02, outer: 2.08, start: -HALF_SPAN + 4, end: HALF_SPAN - 4, thickness: 0.006, bevel: 0.002 }), stripe, [0, FLOOR_TOP, 0], [0, 0, 0], { cast: false });
  line.userData.fixed = true;
  parts.push(line);
  return parts;
}

const BUILDERS = { goal: goalRoom, maker: makerRoom, verify: verifyRoom, review: reviewRoom, judge: judgeRoom, deliver: deliverRoom };

function floorTexture(config, textures) {
  return { marble: textures.marble, planks: textures.planks, tiles: textures.tiles, stone: textures.stone, concrete: textures.concrete }[config.floor];
}

export function buildRoom(stage, { registry, lights, textures }) {
  const config = roomConfig(stage);
  const k = kit(stage, registry, textures);
  const group = new Group();
  group.name = `room_${stage}`;
  const floorMaterial = k.physical(config.floorToken, { roughness: config.floor === 'marble' || config.floor === 'tiles' ? 0.28 : 0.55, clearcoat: config.floor === 'marble' ? 0.6 : 0.15, clearcoatRoughness: 0.3, map: floorTexture(config, textures) });
  const wallMaterial = k.physical(config.wallToken, { roughness: 0.75, map: stage === 'judge' ? textures.panels : textures.paper });
  const trimMaterial = k.physical('--plinth', { roughness: 0.4, clearcoat: 0.4 });
  const plaqueMaterial = k.register(new MeshStandardMaterial({ roughness: 0.3, emissiveIntensity: 1 }), '--line-strong', { plaque: true });
  const lampMaterial = k.register(new MeshStandardMaterial({ roughness: 0.2, emissiveIntensity: 1 }), '--line-strong', { lamp: true });
  const floor = k.mesh(sectorSlab({ inner: ROOM_INNER, outer: ROOM_OUTER, start: -HALF_SPAN + 1.6, end: HALF_SPAN - 1.6, thickness: FLOOR_TOP, bevel: 0.015 }), floorMaterial, [0, 0, 0], [0, 0, 0], { cast: false });
  const wall = k.mesh(wallPanel({ radius: WALL_RADIUS, start: -HALF_SPAN + 2.5, end: HALF_SPAN - 2.5, height: WALL_HEIGHT, thickness: 0.06 }), wallMaterial, [0, FLOOR_TOP, 0]);
  const skirting = k.mesh(wallPanel({ radius: WALL_RADIUS + 0.012, start: -HALF_SPAN + 2.6, end: HALF_SPAN - 2.6, height: 0.05, thickness: 0.02, bevel: 0.006 }), trimMaterial, [0, FLOOR_TOP, 0], [0, 0, 0], { cast: false });
  BUILDERS[stage](k, textures, lights).forEach((part) => {
    if (part.userData.fixed) {
      group.add(part);
      return;
    }
    const onWall = part.position.z < WALL_RADIUS + 0.08;
    part.scale.multiplyScalar(PROP_SCALE);
    if (!onWall) {
      part.position.x *= PROP_SPREAD;
      part.position.z *= PROP_SPREAD;
      part.position.y = FLOOR_TOP + (part.position.y - FLOOR_TOP) * PROP_SCALE;
    }
    group.add(part);
  });
  group.add(floor, wall, skirting);

  const sconce = new Group();
  sconce.add(
    k.mesh(new CylinderGeometry(0.03, 0.03, 0.02, 20), trimMaterial, [0, 0, 0], [Math.PI / 2, 0, 0], { cast: false }),
    k.mesh(new SphereGeometry(0.03, 20, 14), lampMaterial, [0, 0, 0.03], [0, 0, 0], { cast: false })
  );
  sconce.position.set(0.3, 0.94, Math.sqrt(WALL_RADIUS ** 2 - 0.09) + 0.01);
  sconce.userData.dynamic = true;
  const plaque = k.mesh(roundedBox(0.36, 0.08, 0.03, 0.012), plaqueMaterial, [0, PLAQUE_HEIGHT, PLAQUE_RADIUS], [0, 0, 0], { cast: false });
  plaque.userData.dynamic = true;
  group.add(sconce, plaque);
  mergeStatic(group);
  return { group, geometries: k.geometries };
}

export function buildPlatter({ registry, textures }) {
  const geometries = [];
  const keep = (geometry) => {
    geometries.push(geometry);
    return geometry;
  };
  const plinth = new MeshPhysicalMaterial({ roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.25, map: textures.paper });
  const accent = new MeshPhysicalMaterial({ roughness: 0.25, metalness: 0.7, clearcoat: 0.6 });
  const base = new MeshPhysicalMaterial({ roughness: 0.3, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  registry.push({ material: plinth, token: '--plinth' }, { material: accent, token: '--brand' }, { material: base, token: '--plinth-base' });
  const mesh = (geometry, material, cast = true) => {
    const value = new Mesh(keep(geometry), material);
    value.castShadow = cast;
    value.receiveShadow = true;
    return value;
  };
  const platter = new Group();
  const disc = mesh(lathe([[0, -0.46], [2.24, -0.46], [2.38, -0.44], [2.45, -0.38], [DECK_RADIUS, -0.3], [DECK_RADIUS, -0.08], [2.44, -0.02], [2.38, 0], [0, 0]], 128), plinth);
  const band = mesh(lathe([[DECK_RADIUS - 0.005, -0.31], [DECK_RADIUS + 0.012, -0.305], [DECK_RADIUS + 0.014, -0.29], [DECK_RADIUS - 0.005, -0.285]], 128), accent, false);
  const hub = mesh(lathe([[0, 0], [HUB_RADIUS, 0], [HUB_RADIUS, 1.12], [HUB_RADIUS - 0.02, 1.18], [HUB_RADIUS - 0.08, 1.22], [0.3, 1.25], [0, 1.255]], 96), plinth);
  const crown = mesh(new TorusGeometry(HUB_RADIUS - 0.14, 0.018, 16, 96), accent, false);
  crown.rotation.x = Math.PI / 2;
  crown.position.y = 1.235;
  platter.add(disc, band, hub, crown);
  const dividerShape = new Shape();
  const r0 = ROOM_INNER - 0.02;
  dividerShape.moveTo(r0, 0);
  dividerShape.lineTo(1.62, 0);
  dividerShape.quadraticCurveTo(1.68, 0, 1.68, 0.06);
  dividerShape.lineTo(1.68, 0.2);
  dividerShape.quadraticCurveTo(1.68, 0.27, 1.6, 0.29);
  dividerShape.quadraticCurveTo(1.1, 0.38, r0 + 0.12, 0.86);
  dividerShape.quadraticCurveTo(r0, 0.92, r0, 0.82);
  dividerShape.lineTo(r0, 0);
  const divider = keep(new ExtrudeGeometry(dividerShape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.018, bevelSegments: 4, curveSegments: 12 }));
  divider.translate(0, 0, -0.015);
  divider.rotateY(-Math.PI / 2);
  divider.computeVertexNormals();
  RING_STAGES.forEach((stage, index) => {
    const value = new Mesh(divider, plinth);
    value.castShadow = true;
    value.receiveShadow = true;
    value.rotation.y = ((index * ROOM_SPACING + HALF_SPAN) * Math.PI) / 180;
    value.position.y = FLOOR_TOP - 0.01;
    platter.add(value);
  });
  return { platter, geometries, materials: [plinth, accent, base], base: mesh(lathe([[0, -0.78], [1.32, -0.78], [1.4, -0.75], [1.43, -0.69], [1.4, -0.5], [0, -0.46]], 96), base) };
}
