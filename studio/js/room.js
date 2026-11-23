import {
  AmbientLight,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer
} from '../vendor/three.module.min.js';

import { createBot } from './bot.js';
import { cubicBezier, EASE_OUT, ROOM_SWITCH_MS, ZOOM_MS } from './mood.js';

const BOT_SIZE = 0.55;
const CAMERA_REST = { x: 0.6, y: 3.1, z: 7.4, fov: 36 };
const CAMERA_CLOSE = { x: 0, y: 1.2, z: 2.6, fov: 22 };
const LOOK_AT = { x: 0, y: 0.5, z: -0.4 };
const SWITCH_OFFSET = 4;
const WIDE_ASPECT = 1.4;
const MAX_FRAME_SECONDS = 0.1;

export const ROOM_CONFIG = {
  goal: { mood: 'bright', floor: '--prop-box', wall: '--line-strong', dressing: ['columns', 'desk'] },
  maker: { mood: 'bright', floor: '--prop-wood', wall: '--line-strong', dressing: ['blocks', 'desk'] },
  verify: { mood: 'bright', floor: '--prop-metal', wall: '--line-strong', dressing: ['checklist', 'desk'] },
  review: { mood: 'dim', floor: '--line-strong', wall: '--on-brand', dressing: ['candles', 'desk'] },
  judge: { mood: 'bright', floor: '--prop-wood', wall: '--line-strong', dressing: ['bench'] },
  deliver: { mood: 'bright', floor: '--prop-box', wall: '--line-strong', dressing: ['parcels', 'door'] }
};

export function fitFov(fov, aspect) {
  if (aspect >= WIDE_ASPECT) return fov;
  const half = Math.tan((fov * Math.PI) / 360) * WIDE_ASPECT;
  return (Math.atan(half / aspect) * 360) / Math.PI;
}

export function roomConfig(stage) {
  return ROOM_CONFIG[stage] || ROOM_CONFIG.goal;
}

function readToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function buildDressing(config) {
  const geometries = [];
  const materials = [];
  const painted = [];
  const surface = (token, options = {}) => {
    const material = new MeshStandardMaterial({ roughness: 0.75, ...options });
    materials.push(material);
    painted.push([material, token]);
    return material;
  };
  const shape = (value) => {
    geometries.push(value);
    return value;
  };
  const box = (size, position, token, options) => {
    const mesh = new Mesh(shape(new BoxGeometry(...size)), surface(token, options));
    mesh.position.set(...position);
    return mesh;
  };
  const column = (x) => {
    const group = new Group();
    const shaft = new Mesh(shape(new CylinderGeometry(0.16, 0.18, 2.2, 14)), surface('--prop-paper'));
    shaft.position.set(0, 1.1, 0);
    group.add(shaft, box([0.5, 0.14, 0.5], [0, 2.25, 0], '--prop-paper'), box([0.5, 0.12, 0.5], [0, 0.06, 0], '--prop-paper'));
    group.position.set(x, 0, -1.3);
    return group;
  };
  const group = new Group();
  group.add(box([7, 0.2, 4.6], [0, -0.1, 0], config.floor));
  group.add(box([7, 3.4, 0.2], [0, 1.6, -2.2], config.wall));
  const parts = {
    desk: () => {
      const desk = new Group();
      desk.add(box([2, 0.1, 0.9], [0, 0.82, 0], '--prop-wood'));
      for (const [x, z] of [[-0.9, -0.35], [0.9, -0.35], [-0.9, 0.35], [0.9, 0.35]]) desk.add(box([0.08, 0.8, 0.08], [x, 0.4, z], '--prop-wood'));
      desk.position.set(1.7, 0, -0.9);
      return desk;
    },
    columns: () => {
      const pair = new Group();
      pair.add(column(-2.6), column(-1.6));
      return pair;
    },
    blocks: () => {
      const stack = new Group();
      [[0, 0.2, 0], [0.45, 0.2, 0.1], [0.2, 0.6, 0.05]].forEach((position) => stack.add(box([0.4, 0.4, 0.4], position, '--prop-box')));
      stack.position.set(-2.2, 0, -0.6);
      return stack;
    },
    checklist: () => {
      const board = new Group();
      board.add(box([1.3, 1.6, 0.06], [0, 0, 0], '--prop-paper'));
      [0.45, 0.05, -0.35].forEach((y) => {
        board.add(box([0.18, 0.18, 0.04], [-0.4, y, 0.05], '--ok-fill'));
        board.add(box([0.6, 0.06, 0.04], [0.15, y, 0.05], '--line-strong'));
      });
      board.position.set(-2, 1.7, -2.05);
      return board;
    },
    candles: () => {
      const candles = new Group();
      [-2.4, -1.9].forEach((x, index) => {
        candles.add(box([0.14, 0.5 + index * 0.2, 0.14], [x, 0.25 + index * 0.1, -1.4], '--prop-paper'));
        candles.add(box([0.06, 0.12, 0.06], [x, 0.58 + index * 0.2, -1.4], '--brand', { emissiveIntensity: 1 }));
      });
      return candles;
    },
    bench: () => {
      const bench = new Group();
      bench.add(box([3.2, 1.1, 0.9], [0, 0.55, -1.5], '--prop-wood'));
      bench.add(box([3.4, 0.12, 1.0], [0, 1.15, -1.5], '--prop-wood'));
      return bench;
    },
    parcels: () => {
      const parcels = new Group();
      [[0, 0.25, 0, 0.5], [0.55, 0.2, 0.15, 0.4], [0.25, 0.65, 0.05, 0.4]].forEach(([x, y, z, size]) => parcels.add(box([size, size, size], [x, y, z], '--prop-box')));
      parcels.position.set(-2.3, 0, -0.7);
      return parcels;
    },
    door: () => {
      const door = new Group();
      door.add(box([0.14, 2.2, 0.2], [-0.6, 1.1, 0], '--prop-wood'), box([0.14, 2.2, 0.2], [0.6, 1.1, 0], '--prop-wood'), box([1.34, 0.14, 0.2], [0, 2.2, 0], '--prop-wood'));
      door.position.set(2, 0, -2.05);
      return door;
    }
  };
  config.dressing.forEach((name) => group.add(parts[name]()));
  return {
    group,
    paint() {
      painted.forEach(([material, token]) => {
        const value = readToken(token);
        if (value) material.color.setStyle(value);
        if (material.emissiveIntensity && value) material.emissive.setStyle(value);
      });
    },
    dispose() {
      group.removeFromParent();
      geometries.forEach((value) => value.dispose());
      materials.forEach((value) => value.dispose());
    }
  };
}

export function mountRoom(el, model, { reducedMotion = false } = {}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  el.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA_REST.fov, 1, 0.1, 60);
  const hemisphere = new HemisphereLight(undefined, undefined, 0.9);
  const ambient = new AmbientLight(undefined, 0.35);
  const key = new DirectionalLight(undefined, 1.6);
  key.position.set(3, 5, 4);
  const fill = new DirectionalLight(undefined, 0.45);
  fill.position.set(-4, 2, 3);
  scene.add(hemisphere, ambient, key, fill);

  const stageRoot = new Group();
  scene.add(stageRoot);
  const ease = cubicBezier(...EASE_OUT);
  const bot = createBot({ reducedMotion, radius: BOT_SIZE });
  bot.root.position.set(0, BOT_SIZE + 0.02, 0.4);
  stageRoot.add(bot.root);

  let dressing = null;
  let current = model;
  let stage = null;
  let frame = 0;
  let lastTime = 0;
  const tweens = [];

  let lastFov = CAMERA_REST.fov;

  function setCamera(from, to, progress) {
    const value = (name) => from[name] + (to[name] - from[name]) * progress;
    lastFov = value('fov');
    camera.position.set(value('x'), value('y'), value('z'));
    camera.fov = fitFov(value('fov'), camera.aspect);
    camera.updateProjectionMatrix();
    camera.lookAt(LOOK_AT.x, LOOK_AT.y, LOOK_AT.z);
  }

  function paint() {
    if (dressing) dressing.paint();
    bot.paint(readToken);
    const dim = roomConfig(stage).mood === 'dim';
    hemisphere.intensity = dim ? 0.3 : 0.7;
    key.intensity = dim ? 0.7 : 1.2;
  }

  function setStage(next) {
    if (next === stage) return;
    stage = next;
    if (dressing) dressing.dispose();
    dressing = buildDressing(roomConfig(stage));
    stageRoot.add(dressing.group);
    paint();
  }

  function animate(duration, apply) {
    return new Promise((resolve) => {
      if (reducedMotion || duration <= 0) {
        apply(1);
        render();
        resolve();
        return;
      }
      tweens.push({ start: null, duration, apply, resolve });
      schedule();
    });
  }

  function stepTweens(time) {
    for (let index = tweens.length - 1; index >= 0; index -= 1) {
      const tween = tweens[index];
      if (tween.start === null) tween.start = time;
      const progress = Math.min(1, (time - tween.start) / tween.duration);
      tween.apply(ease(progress));
      if (progress >= 1) {
        tweens.splice(index, 1);
        tween.resolve();
      }
    }
  }

  function render() {
    renderer.render(scene, camera);
  }

  function tick(time) {
    frame = 0;
    const seconds = lastTime ? Math.min((time - lastTime) / 1000, MAX_FRAME_SECONDS) : 1 / 60;
    lastTime = time;
    stepTweens(time);
    const moving = bot.step(seconds);
    render();
    if (moving || tweens.length) schedule();
    else lastTime = 0;
  }

  function schedule() {
    if (frame || document.hidden) return;
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }

  function resize() {
    const width = el.clientWidth || 1;
    const height = el.clientHeight || 1;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.fov = fitFov(lastFov, camera.aspect);
    camera.updateProjectionMatrix();
    schedule();
    render();
  }

  function onVisibility() {
    if (document.hidden) stop();
    else schedule();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(el);
  document.addEventListener('visibilitychange', onVisibility);

  setStage(model.botStage);
  bot.update(model);
  setCamera(CAMERA_CLOSE, CAMERA_REST, reducedMotion ? 1 : 0);
  resize();

  return {
    enter() {
      return animate(ZOOM_MS, (progress) => setCamera(CAMERA_CLOSE, CAMERA_REST, progress));
    },
    leave() {
      return animate(ZOOM_MS * 0.8, (progress) => setCamera(CAMERA_REST, CAMERA_CLOSE, progress));
    },
    update(next, { direction = 0 } = {}) {
      current = next;
      if (direction && !reducedMotion) {
        setStage(next.botStage);
        bot.update(current);
        bot.react();
        return animate(ROOM_SWITCH_MS, (progress) => {
          stageRoot.position.x = direction * SWITCH_OFFSET * (1 - progress);
        });
      }
      setStage(next.botStage);
      bot.update(current);
      schedule();
      return Promise.resolve();
    },
    react() {
      if (bot.react()) schedule();
    },
    dispose() {
      stop();
      tweens.splice(0).forEach((tween) => tween.resolve());
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      bot.dispose();
      if (dressing) dressing.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
  };
}
