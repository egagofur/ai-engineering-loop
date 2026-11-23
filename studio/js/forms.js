import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  ExtrudeGeometry,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  Shape,
  SRGBColorSpace,
  Vector2
} from '../vendor/three.module.min.js';

export function readToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function roundedRectShape(width, height, radius) {
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  const shape = new Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

export function roundedBox(width, height, depth, radius = 0.03, segments = 3) {
  const bevel = Math.min(radius, width / 2.2, height / 2.2, depth / 2.2);
  const inset = Math.min(bevel * 1.2, width / 2.5, height / 2.5);
  const shape = roundedRectShape(width - bevel * 2, height - bevel * 2, inset);
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(0.0001, depth - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segments,
    curveSegments: 6
  });
  geometry.translate(0, 0, -(depth - bevel * 2) / 2);
  geometry.computeVertexNormals();
  return geometry;
}

export function lathe(points, segments = 40) {
  return new LatheGeometry(points.map(([x, y]) => new Vector2(x, y)), segments);
}

export function bakeInto(target, matrix) {
  const geometry = target.index ? target.toNonIndexed() : target.clone();
  geometry.applyMatrix4(matrix);
  return geometry;
}

export function mergeGeometries(list) {
  const prepared = list.map((geometry) => (geometry.index ? geometry.toNonIndexed() : geometry));
  const count = prepared.reduce((sum, geometry) => sum + geometry.attributes.position.count, 0);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let offset = 0;
  prepared.forEach((geometry) => {
    const n = geometry.attributes.position.count;
    position.set(geometry.attributes.position.array.subarray(0, n * 3), offset * 3);
    if (geometry.attributes.normal) normal.set(geometry.attributes.normal.array.subarray(0, n * 3), offset * 3);
    if (geometry.attributes.uv) uv.set(geometry.attributes.uv.array.subarray(0, n * 2), offset * 2);
    offset += n;
  });
  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(position, 3));
  merged.setAttribute('normal', new BufferAttribute(normal, 3));
  merged.setAttribute('uv', new BufferAttribute(uv, 2));
  merged.computeBoundingSphere();
  return merged;
}

const scratch = new Matrix4();

export function mergeStatic(group, { castShadow = true, receiveShadow = true } = {}) {
  group.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const remove = [];
  group.traverse((child) => {
    if (!child.isMesh || child.isInstancedMesh || child.userData.dynamic) return;
    let parent = child.parent;
    while (parent && parent !== group) {
      if (parent.userData.dynamic) return;
      parent = parent.parent;
    }
    scratch.multiplyMatrices(inverse, child.matrixWorld);
    const key = `${child.material.uuid}|${child.castShadow ? 1 : 0}`;
    if (!buckets.has(key)) buckets.set(key, { material: child.material, cast: child.castShadow, parts: [] });
    buckets.get(key).parts.push(bakeInto(child.geometry, scratch));
    remove.push(child);
  });
  const sources = new Set(remove.map((child) => child.geometry));
  remove.forEach((child) => child.removeFromParent());
  sources.forEach((geometry) => geometry.dispose());
  const meshes = [];
  for (const { material, cast, parts } of buckets.values()) {
    const geometry = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = castShadow && cast;
    mesh.receiveShadow = receiveShadow;
    group.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, y, seed, period) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const wrap = (value) => ((value % period) + period) % period;
  const a = hash(wrap(x0), wrap(y0), seed);
  const b = hash(wrap(x0 + 1), wrap(y0), seed);
  const c = hash(wrap(x0), wrap(y0 + 1), seed);
  const d = hash(wrap(x0 + 1), wrap(y0 + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x, y, seed, period, octaves = 4) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let index = 0; index < octaves; index += 1) {
    sum += amplitude * valueNoise(x * frequency, y * frequency, seed + index, period * frequency);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}

const PATTERNS = {
  planks(u, v) {
    const rows = 6;
    const row = Math.floor(v * rows);
    const shift = hash(row, 1, 3) * 0.6;
    const along = (u + shift) * 2;
    const plank = Math.floor(along);
    const local = v * rows - row;
    const seam = Math.min(local, 1 - local) < 0.035 || Math.min(along - plank, 1 - (along - plank)) < 0.012 ? 0.55 : 1;
    const grain = 0.5 + 0.5 * Math.sin((u * 60 + fbm(u * 8, v * 40, 5, 8) * 6) * Math.PI);
    const tone = 0.8 + hash(plank, row, 7) * 0.2;
    return seam * tone * (0.86 + grain * 0.14);
  },
  marble(u, v) {
    const n = fbm(u * 4, v * 4, 11, 4, 5);
    const vein = Math.abs(Math.sin((u * 3 + v * 2 + n * 4) * Math.PI));
    return 0.88 + 0.12 * Math.pow(vein, 0.35) - (vein < 0.06 ? 0.1 : 0);
  },
  tiles(u, v) {
    const n = 8;
    const fu = (u * n) % 1;
    const fv = (v * n) % 1;
    const grout = Math.min(fu, 1 - fu, fv, 1 - fv) < 0.04 ? 0.72 : 1;
    return grout * (0.95 + hash(Math.floor(u * n), Math.floor(v * n), 2) * 0.05);
  },
  paper(u, v) {
    return 0.93 + fbm(u * 10, v * 10, 41, 10, 4) * 0.07;
  },
  panels(u, v) {
    const fu = (u * 3) % 1;
    const fv = (v * 2) % 1;
    const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
    const bevel = edge < 0.03 ? 0.7 : edge < 0.07 ? 1.05 : 1;
    return bevel * (0.88 + 0.12 * (0.5 + 0.5 * Math.sin((v * 40 + fbm(u * 6, v * 20, 5, 6) * 4) * Math.PI)));
  },
  fabric(u, v) {
    const weave = 0.5 + 0.25 * Math.sin(u * 160 * Math.PI) * Math.sin(v * 160 * Math.PI);
    return 0.86 + weave * 0.12 + fbm(u * 8, v * 8, 51, 8) * 0.06;
  }
};

export function patternTexture(name, { size = 256, repeat = 1 } = {}) {
  const pattern = PATTERNS[name] || PATTERNS.paper;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = Math.round(255 * Math.min(1, Math.max(0, pattern(x / size, y / size))));
      data.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function radialTexture(power = 2, size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const value = Math.round(255 * Math.max(0, 1 - Math.hypot(dx, dy)) ** power);
      data.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function contactShadow(width, depth, { opacity = 0.32, texture, token = '--shadow' } = {}) {
  const material = new MeshBasicMaterial({ transparent: true, opacity, depthWrite: false, alphaMap: texture, polygonOffset: true, polygonOffsetFactor: -2 });
  material.userData.token = token;
  const geometry = new PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 1;
  mesh.userData.dynamic = true;
  return mesh;
}

export function studioEnvironment(renderer, read = readToken) {
  const scene = new Scene();
  const geometries = [];
  const materials = [];
  const panel = (token, strength, size, position, look) => {
    const material = new MeshBasicMaterial({ side: DoubleSide });
    material.color.setStyle(read(token));
    material.color.multiplyScalar(strength);
    const geometry = new PlaneGeometry(size[0], size[1]);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.lookAt(...look);
    geometries.push(geometry);
    materials.push(material);
    scene.add(mesh);
  };
  const roomMaterial = new MeshBasicMaterial({ side: BackSide });
  roomMaterial.color.setStyle(read('--env-room') || read('--stage-bottom'));
  const roomGeometry = new BoxGeometry(20, 12, 20);
  const room = new Mesh(roomGeometry, roomMaterial);
  room.position.y = 4;
  scene.add(room);
  geometries.push(roomGeometry);
  materials.push(roomMaterial);
  panel('--env-light', 6, [8, 8], [0, 9.5, 0], [0, 0, 0]);
  panel('--env-light', 4, [3, 6], [-8, 4, 3], [0, 1, 0]);
  panel('--env-light', 2.2, [3, 5], [8, 3, -2], [0, 1, 0]);
  panel('--env-warm', 1.6, [10, 2], [0, 1.5, 9], [0, 1, 0]);
  const generator = new PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0.04);
  generator.dispose();
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  return target;
}
