import {
  AmbientLight,
  CapsuleGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  WebGLRenderer
} from '../vendor/three.module.min.js';

import { BOT_ORBIT } from './ring2d.js';

const VIEW_EXTENT = 1.2;
const BOT_RADIUS = 0.108;
const EYE_SPREAD = 0.024;
const EYE_LIFT = 0.012;
const BOT_EASE_SECONDS = 0.22;
const SETTLED_DEGREES = 0.05;
const MAX_FRAME_SECONDS = 0.1;
const COLOR_TOKENS = { body: '--brand', eyes: '--on-brand' };

function readToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function paint(material, token) {
  const value = readToken(token);
  if (value) material.color.setStyle(value);
}

function placeOnOrbit(object, angleDegrees) {
  const radians = (angleDegrees * Math.PI) / 180;
  object.position.set(BOT_ORBIT * Math.sin(radians), BOT_ORBIT * Math.cos(radians), 0);
}

function shortestTurn(from, to) {
  return ((to - from + 540) % 360) - 180;
}

export function mountBot(el, model) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  el.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new OrthographicCamera(-VIEW_EXTENT, VIEW_EXTENT, VIEW_EXTENT, -VIEW_EXTENT, 0.1, 10);
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);
  scene.add(new AmbientLight(undefined, 0.9));
  const key = new DirectionalLight(undefined, 2.4);
  key.position.set(-1.2, 1.6, 2.4);
  scene.add(key);
  const rim = new DirectionalLight(undefined, 0.6);
  rim.position.set(1.5, -1, 1);
  scene.add(rim);

  const bot = new Group();
  scene.add(bot);
  const bodyGeometry = new SphereGeometry(BOT_RADIUS, 48, 32);
  const bodyMaterial = new MeshPhysicalMaterial({ roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12 });
  bot.add(new Mesh(bodyGeometry, bodyMaterial));
  const eyeGeometry = new CapsuleGeometry(0.0085, 0.02, 4, 12);
  const eyeMaterial = new MeshBasicMaterial();
  for (const side of [-1, 1]) {
    const eye = new Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(side * EYE_SPREAD, EYE_LIFT, BOT_RADIUS * 0.97);
    bot.add(eye);
  }

  let current = model;
  let botAngle = model.botAngle;
  let frame = 0;
  let lastTime = 0;

  function applyColors() {
    paint(bodyMaterial, COLOR_TOKENS.body);
    paint(eyeMaterial, COLOR_TOKENS.eyes);
  }

  function stepBot(seconds) {
    const remaining = shortestTurn(botAngle, current.botAngle);
    if (Math.abs(remaining) < SETTLED_DEGREES) {
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
    placeOnOrbit(bot, botAngle);
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
    const size = el.clientWidth || 1;
    renderer.setSize(size, el.clientHeight || size);
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
  placeOnOrbit(bot, botAngle);
  resize();

  return {
    update(next) {
      current = next;
      schedule();
    },
    dispose() {
      stop();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      darkScheme.removeEventListener('change', onTheme);
      bodyGeometry.dispose();
      eyeGeometry.dispose();
      bodyMaterial.dispose();
      eyeMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
  };
}
