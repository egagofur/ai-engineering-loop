import {
  AmbientLight,
  BufferGeometry,
  CircleGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  WebGLRenderer
} from '../vendor/three.module.min.js';

import {
  BOT_WORLD_RADIUS,
  RING_BANDS,
  RING_MARK_RADIUS,
  cameraDistance,
  nudgeLabel,
  projectPoint,
  ringView,
  tiltedPoint
} from './ring2d.js';
import { createBot } from './bot.js';

const DUST_COUNT = 900;
const DUST_DRIFT = 0.012;
const SHIMMER = 0.06;
const MARKER_RADIUS = 0.04;
const HALO_RADIUS = 0.075;
const ORBIT_EASE_SECONDS = 0.28;
const SETTLED_DEGREES = 0.05;
const MAX_FRAME_SECONDS = 0.1;
const LABEL_GAP = 9;
const CENTRE_LIFT = 0.16;
const FAR_SCALE = 0.8;
const FAR_OPACITY = 0.55;
const STATUS_TOKENS = { done: '--ok-fill', now: '--brand', pending: '--line-strong', skipped: '--faint' };

function readToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function shortestTurn(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function radialTexture(power) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const value = Math.round(255 * Math.max(0, 1 - Math.hypot(dx, dy)) ** power);
      data.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

function dustGeometry() {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const inner = RING_BANDS[0][0];
  const outer = RING_BANDS.at(-1)[1];
  const positions = [];
  for (let index = 0; index < DUST_COUNT; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = inner + (outer - inner) * Math.sqrt(random());
    positions.push(radius * Math.cos(angle), radius * Math.sin(angle), (random() - 0.5) * 0.02);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

export function mountRing3d(el, model, { root, reducedMotion = false } = {}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  el.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(28, 1, 0.1, 50);
  scene.add(new AmbientLight(undefined, 0.95));
  const key = new DirectionalLight(undefined, 1.25);
  key.position.set(-2, 3, 4);
  scene.add(key);
  const rim = new DirectionalLight(undefined, 0.9);
  rim.position.set(2.5, 1.5, -3);
  scene.add(rim);

  const disposables = [];
  const painted = [];
  const keep = (value) => {
    disposables.push(value);
    return value;
  };
  const tinted = (value, token) => {
    painted.push([keep(value), token]);
    return value;
  };

  const plane = new Group();
  plane.rotation.order = 'ZYX';
  scene.add(plane);
  const bands = RING_BANDS.map(([inner, outer, opacity, token]) => {
    const material = tinted(new MeshBasicMaterial({ transparent: true, opacity, side: DoubleSide, depthWrite: false }), token);
    const band = new Mesh(keep(new RingGeometry(inner, outer, 192, 1)), material);
    band.userData.opacity = opacity;
    plane.add(band);
    return band;
  });
  const glowTexture = keep(radialTexture(2));
  const glow = new Mesh(keep(new CircleGeometry(RING_BANDS[0][0], 64)), tinted(new MeshBasicMaterial({ transparent: true, opacity: 0.5, alphaMap: glowTexture, depthWrite: false }), '--ring-glow'));
  glow.position.z = -0.002;
  plane.add(glow);
  const dust = new Points(keep(dustGeometry()), tinted(new PointsMaterial({ size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.6, depthWrite: false }), '--ring-dust'));
  plane.add(dust);

  const markerShape = keep(new SphereGeometry(MARKER_RADIUS, 20, 14));
  const haloShape = keep(new SphereGeometry(HALO_RADIUS, 20, 14));
  const markers = model.stages.map(() => {
    const marker = new Mesh(markerShape, keep(new MeshStandardMaterial({ roughness: 0.35, transparent: true })));
    const halo = new Mesh(haloShape, keep(new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })));
    marker.add(halo);
    scene.add(marker);
    return { marker, halo };
  });

  const bot = createBot({ reducedMotion, radius: BOT_WORLD_RADIUS });
  scene.add(bot.root);

  let current = model;
  let botAngle = model.botAngle;
  let view = ringView(el.clientWidth || 1);
  let width = 1;
  let height = 1;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;

  function cameraState() {
    return { fov: view.fov, distance: camera.position.z };
  }

  function point(angle, lift = 0) {
    const value = tiltedPoint(angle, RING_MARK_RADIUS, view);
    return { x: value.x, y: value.y + lift, z: value.z };
  }

  function paint() {
    painted.forEach(([material, token]) => {
      const value = readToken(token);
      if (value) material.color.setStyle(value);
    });
    current.stages.forEach(({ status }, index) => {
      const value = readToken(STATUS_TOKENS[status] || STATUS_TOKENS.pending);
      if (value) {
        markers[index].marker.material.color.setStyle(value);
        markers[index].halo.material.color.setStyle(value);
      }
    });
    bot.paint(readToken);
  }

  function placeMarkers() {
    current.stages.forEach(({ angle, status }, index) => {
      const { marker, halo } = markers[index];
      const value = point(angle);
      marker.position.set(value.x, value.y, value.z);
      const far = value.z < 0;
      marker.scale.setScalar(far ? FAR_SCALE : 1);
      marker.material.opacity = (status === 'skipped' ? 0.5 : 1) * (far ? FAR_OPACITY + 0.3 : 1);
      halo.visible = status === 'now';
    });
  }

  function placeLabels() {
    const centre = root.querySelector('.ring-centre');
    const box = root.getBoundingClientRect();
    if (centre) {
      const anchor = projectPoint({ x: 0, y: CENTRE_LIFT, z: 0 }, cameraState(), width, height);
      centre.style.top = `${anchor.y.toFixed(1)}px`;
    }
    const centreRect = centre ? centre.getBoundingClientRect() : null;
    const centreBox = centreRect && {
      left: centreRect.left - box.left,
      right: centreRect.right - box.left,
      top: centreRect.top - box.top,
      bottom: centreRect.bottom - box.top
    };
    root.querySelectorAll('.stage[data-stage]').forEach((label) => {
      const stage = current.stages.find((item) => item.stage === label.dataset.stage);
      if (!stage) return;
      const value = point(stage.angle);
      const screen = projectPoint(value, cameraState(), width, height);
      const labelWidth = label.offsetWidth;
      const labelHeight = label.offsetHeight;
      const placed = nudgeLabel({
        left: screen.x - labelWidth / 2,
        top: screen.y + LABEL_GAP,
        width: labelWidth,
        height: labelHeight
      }, centreBox, value.z < 0 ? 'up' : 'down');
      label.style.transform = `translate(${placed.left.toFixed(1)}px, ${placed.top.toFixed(1)}px)`;
      label.dataset.depth = value.z < 0 ? 'far' : 'near';
    });
  }

  function placeBot() {
    const value = point(botAngle, BOT_WORLD_RADIUS + MARKER_RADIUS * 0.5);
    bot.root.position.set(value.x, value.y, value.z);
    const button = root.querySelector('.ring-bot');
    if (!button) return;
    const centre = projectPoint(value, cameraState(), width, height);
    const top = projectPoint({ ...value, y: value.y + BOT_WORLD_RADIUS }, cameraState(), width, height);
    const size = Math.max(32, (centre.y - top.y) * 2.4);
    button.style.width = `${size.toFixed(1)}px`;
    button.style.height = `${size.toFixed(1)}px`;
    button.style.transform = `translate(${(centre.x - size / 2).toFixed(1)}px, ${(centre.y - size / 2).toFixed(1)}px)`;
  }

  function stepOrbit(seconds) {
    const remaining = shortestTurn(botAngle, current.botAngle);
    if (reducedMotion || Math.abs(remaining) < SETTLED_DEGREES) {
      botAngle = current.botAngle;
      return true;
    }
    botAngle += remaining * (1 - Math.exp(-seconds / ORBIT_EASE_SECONDS));
    return false;
  }

  function ambient(seconds) {
    if (reducedMotion) return false;
    elapsed += seconds;
    dust.rotation.z += DUST_DRIFT * seconds;
    bands.forEach((band, index) => {
      band.material.opacity = band.userData.opacity * (1 + SHIMMER * Math.sin(elapsed * 0.7 + index * 1.3));
    });
    markers.forEach(({ halo }) => {
      if (!halo.visible) return;
      const pulse = (Math.sin(elapsed * 2.2) + 1) / 2;
      halo.scale.setScalar(1 + pulse * 0.35);
      halo.material.opacity = 0.32 - pulse * 0.2;
    });
    return true;
  }

  function tick(time) {
    frame = 0;
    const seconds = lastTime ? Math.min((time - lastTime) / 1000, MAX_FRAME_SECONDS) : 1 / 60;
    lastTime = time;
    const drifting = ambient(seconds);
    const orbitSettled = stepOrbit(seconds);
    const botMoving = bot.step(seconds);
    placeBot();
    renderer.render(scene, camera);
    if (drifting || botMoving || !orbitSettled) schedule();
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
    width = el.clientWidth || 1;
    height = el.clientHeight || 1;
    view = ringView(width);
    plane.rotation.set((-view.tilt * Math.PI) / 180, 0, (view.roll * Math.PI) / 180);
    renderer.setSize(width, height);
    camera.fov = view.fov;
    camera.aspect = width / height;
    camera.position.set(0, 0, cameraDistance(view, width / height));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    placeMarkers();
    placeLabels();
    placeBot();
    schedule();
  }

  function onVisibility() {
    if (document.hidden) stop();
    else schedule();
  }

  function onTheme() {
    paint();
    schedule();
  }

  const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const glances = finePointer.matches && !reducedMotion;

  function onPointerMove(event) {
    const box = el.getBoundingClientRect();
    const centre = projectPoint(bot.root.position, cameraState(), width, height);
    const dx = event.clientX - box.left - centre.x;
    const dy = event.clientY - box.top - centre.y;
    const length = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, length / 80);
    bot.lookAt((dx / length) * reach, (-dy / length) * reach);
    schedule();
  }

  function onPointerLeave() {
    bot.lookAt(0, 0);
    schedule();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(el);
  document.addEventListener('visibilitychange', onVisibility);
  darkScheme.addEventListener('change', onTheme);
  if (glances) {
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerleave', onPointerLeave);
  }

  paint();
  bot.update(model);
  resize();

  return {
    update(next) {
      current = next;
      paint();
      placeMarkers();
      placeLabels();
      bot.update(next);
      schedule();
    },
    react() {
      if (bot.react()) schedule();
    },
    dispose() {
      stop();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      darkScheme.removeEventListener('change', onTheme);
      if (glances) {
        root.removeEventListener('pointermove', onPointerMove);
        root.removeEventListener('pointerleave', onPointerLeave);
      }
      root.querySelectorAll('.stage[data-stage], .ring-bot, .ring-centre').forEach((node) => node.removeAttribute('style'));
      bot.dispose();
      disposables.forEach((value) => value.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
  };
}
