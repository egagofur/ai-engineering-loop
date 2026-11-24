import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial
} from '../vendor/three.module.min.js';

import { roundedBox } from './forms.js';

export const WORKSTATION = { width: 0.66, depth: 0.5, top: 0.7, z: -3.9 };

export function workstationTop(stage) {
  return stage === 'maker' ? 'hob' : 'board';
}

export function buildWorkstation(stage) {
  const { width, depth, top: height } = WORKSTATION;
  const steel = new MeshStandardMaterial({ roughness: 0.3, metalness: 1 });
  const top = new MeshStandardMaterial({ roughness: workstationTop(stage) === 'hob' ? 0.18 : 0.6 });
  const paints = [
    { material: steel, token: '--kitchen-steel' },
    { material: top, token: workstationTop(stage) === 'hob' ? '--kitchen-iron' : '--prop-wood' }
  ];
  const group = new Group();
  const part = (geometry, material, x, y, z) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  part(roundedBox(width, 0.035, depth, 0.008), steel, 0, height - 0.018, 0);
  part(roundedBox(width - 0.06, 0.02, depth - 0.06, 0.006), steel, 0, 0.16, 0);
  const leg = new CylinderGeometry(0.016, 0.016, height - 0.02, 10);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => part(leg, steel, sx * (width / 2 - 0.03), (height - 0.02) / 2, sz * (depth / 2 - 0.03)));
  if (workstationTop(stage) === 'hob') part(new CylinderGeometry(0.1, 0.1, 0.012, 32), top, width / 2 - 0.13, height + 0.006, depth / 2 - 0.12);
  else part(roundedBox(0.2, 0.016, 0.14, 0.005), top, width / 2 - 0.13, height + 0.009, depth / 2 - 0.1);
  return {
    group,
    paint(read) {
      paints.forEach(({ material, token }) => {
        const value = read(token);
        if (value) material.color.setStyle(value);
      });
    },
    dispose() {
      group.removeFromParent();
      const geometries = new Set();
      group.traverse((child) => {
        if (child.geometry) geometries.add(child.geometry);
      });
      geometries.forEach((geometry) => geometry.dispose());
      paints.forEach(({ material }) => material.dispose());
    }
  };
}
