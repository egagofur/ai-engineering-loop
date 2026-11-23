import {
  AmbientLight,
  DirectionalLight,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  TorusGeometry,
  WebGLRenderer
} from '../vendor/three.module.min.js';

export { ringModel } from './ring2d.js';

const RING_RADIUS = 2;
const BOT_RADIUS = RING_RADIUS * 0.78;
const RING_TILT = -1.05;
const BOT_EASE_SECONDS = 0.22;
const SETTLED_DEGREES = 0.05;
const MAX_FRAME_SECONDS = 0.1;
const FALLBACK_HEIGHT = 320;
const STATUS_TOKENS = { done: '--ok', now: '--brand', pending: '--line-strong', skipped: '--faint' };
const STATUS_SCALE = { done: 1, now: 1.4, pending: 0.85, skipped: 0.75 };
const SKIPPED_OPACITY = 0.4;

function readToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function paint(material, token) {
  const value = readToken(token);
  if (value) material.color.setStyle(value);
}

function placeOnRing(object, angleDegrees, radius) {
  const radians = (angleDegrees * Math.PI) / 180;
  object.position.set(radius * Math.sin(radians), radius * Math.cos(radians), object.position.z);
}

function shortestTurn(from, to) {
  return ((to - from + 540) % 360) - 180;
}

export function mountRing(el, model, { reducedMotion = false } = {}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  el.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.set(0, 0, 7.2);
  camera.lookAt(0, 0, 0);
  scene.add(new AmbientLight(undefined, 1.6));
  const sun = new DirectionalLight(undefined, 1.4);
  sun.position.set(2, 4, 6);
  scene.add(sun);

  const loop = new Group();
  loop.rotation.x = RING_TILT;
  scene.add(loop);

  const trackGeometry = new TorusGeometry(RING_RADIUS, 0.035, 12, 160);
  const trackMaterial = new MeshLambertMaterial();
  loop.add(new Mesh(trackGeometry, trackMaterial));

  const markerGeometry = new SphereGeometry(0.17, 24, 16);
  const markers = model.stages.map(({ angle }) => {
    const mesh = new Mesh(markerGeometry, new MeshLambertMaterial({ transparent: true }));
    placeOnRing(mesh, angle, RING_RADIUS);
    loop.add(mesh);
    return mesh;
  });

  const botGeometry = new IcosahedronGeometry(0.2, 1);
  const botMaterial = new MeshLambertMaterial({ flatShading: true });
  const bot = new Mesh(botGeometry, botMaterial);
  bot.position.z = 0.32;
  loop.add(bot);

  let current = model;
  let botAngle = model.botAngle;
  let frame = 0;
  let lastTime = 0;

  function applyColors() {
    paint(trackMaterial, '--line-strong');
    paint(botMaterial, '--brand');
    current.stages.forEach(({ status }, index) => {
      const material = markers[index].material;
      paint(material, STATUS_TOKENS[status]);
      material.opacity = status === 'skipped' ? SKIPPED_OPACITY : 1;
      markers[index].scale.setScalar(STATUS_SCALE[status]);
    });
  }

  function stepBot(seconds) {
    const remaining = shortestTurn(botAngle, current.botAngle);
    if (reducedMotion || Math.abs(remaining) < SETTLED_DEGREES) {
      botAngle = current.botAngle;
      return true;
    }
    botAngle += remaining * (1 - Math.exp(-seconds / BOT_EASE_SECONDS));
    return false;
  }

  function tick(time) {
    frame = 0;
    const seconds = lastTime ? Math.min((time - lastTime) / 1000, MAX_FRAME_SECONDS) : 1 / 60;
    lastTime = time;
    const settled = stepBot(seconds);
    placeOnRing(bot, botAngle, BOT_RADIUS);
    renderer.render(scene, camera);
    if (settled) lastTime = 0;
    else schedule();
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
    const height = el.clientHeight || FALLBACK_HEIGHT;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    schedule();
  }

  function onVisibility() {
    if (document.hidden) stop();
    else schedule();
  }

  function onTheme() {
    applyColors();
    schedule();
  }

  const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(el);
  document.addEventListener('visibilitychange', onVisibility);
  darkScheme.addEventListener('change', onTheme);

  applyColors();
  placeOnRing(bot, botAngle, BOT_RADIUS);
  resize();

  return {
    update(next) {
      current = next;
      applyColors();
      schedule();
    },
    dispose() {
      stop();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      darkScheme.removeEventListener('change', onTheme);
      trackGeometry.dispose();
      markerGeometry.dispose();
      botGeometry.dispose();
      trackMaterial.dispose();
      botMaterial.dispose();
      markers.forEach((marker) => marker.material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
  };
}
