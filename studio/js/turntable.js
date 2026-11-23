import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer
} from '../vendor/three.module.min.js';

import { RING_STAGES } from './ring2d.js';
import { createBot } from './bot.js';
import {
  CUT_FADE_MS,
  cameraPose,
  facing,
  hopHeight,
  labelVisibility,
  roomAngle,
  roomConfig,
  roomLighting,
  screenPoint,
  swapOffset,
  turnPlan
} from './diorama.js';
import { cubicBezier, EASE_OUT, ROOM_SWITCH_MS, ZOOM_MS } from './mood.js';
import { patternTexture, radialTexture, readToken, studioEnvironment } from './forms.js';
import { BOT_SPOT, FLOOR_TOP, PLAQUE_HEIGHT, PLAQUE_RADIUS, buildPlatter, buildRoom } from './rooms.js';

const BOT_SIZE = 0.34;
const DIM_ROOM = 0.5;
const HOP = 0.42;
const MAX_FRAME_SECONDS = 0.1;
const LABEL_GAP = 12;
const CENTRE_DROP = -0.62;
const CENTRE_GAP = 26;
const SPOT_ON = 14;
const SPOT_EASE_SECONDS = 0.35;
const CANDLE_BASE = 0.9;
const RADIANS = Math.PI / 180;

function toneColor(color, { tone, saturation }) {
  if (saturation !== 1) {
    const hsl = {};
    color.getHSL(hsl);
    color.setHSL(hsl.h, hsl.s * saturation, hsl.l);
  }
  if (tone !== 1) color.multiplyScalar(tone);
  return color;
}

function buildTextures() {
  return {
    planks: patternTexture('planks', { repeat: 0.9 }),
    marble: patternTexture('marble', { repeat: 0.55 }),
    tiles: patternTexture('tiles', { repeat: 0.8 }),
    stone: patternTexture('stone', { repeat: 0.7 }),
    concrete: patternTexture('concrete', { repeat: 0.8 }),
    paper: patternTexture('paper', { repeat: 1 }),
    pegboard: patternTexture('pegboard', { repeat: 2.5 }),
    panels: patternTexture('panels', { repeat: 1.6 }),
    shutter: patternTexture('shutter', { repeat: 1.6 }),
    fabric: patternTexture('fabric', { repeat: 2 }),
    blob: radialTexture(1.8)
  };
}

function disposeTree(object) {
  const geometries = new Set();
  const materials = new Set();
  object.traverse((child) => {
    if (child.geometry) geometries.add(child.geometry);
    if (child.material) [].concat(child.material).forEach((material) => materials.add(material));
    if (child.isLight && child.shadow && child.shadow.map) child.shadow.map.dispose();
  });
  object.removeFromParent();
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export function mountTurntable(el, model, { root, reducedMotion = false, onOpen = null } = {}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  el.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 60);
  const hemisphere = new HemisphereLight(undefined, undefined, 0.7);
  const key = new DirectionalLight(undefined, 2.4);
  key.position.set(-3.6, 7.2, 5.2);
  key.target.position.set(0, 0, 0.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3.3, right: 3.3, top: 3.3, bottom: -3.3, near: 3, far: 16 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 5;
  key.shadow.blurSamples = 16;
  const fill = new DirectionalLight(undefined, 0.55);
  fill.position.set(5, 3, 3);
  const rim = new DirectionalLight(undefined, 1.1);
  rim.position.set(1.5, 4, -6);
  const spot = new SpotLight(undefined, 0, 0, 0.4, 0.85, 2);
  spot.position.set(0, 3.1, 3.7);
  spot.target.position.set(0, FLOOR_TOP, BOT_SPOT - 0.45);
  scene.add(hemisphere, key, key.target, fill, rim, spot, spot.target);

  const textures = buildTextures();
  const stage = new Group();
  scene.add(stage);
  const read = readToken;
  let environment = null;

  const bot = createBot({ reducedMotion, size: BOT_SIZE, read });
  stage.add(bot.root);

  const ease = cubicBezier(...EASE_OUT);
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const scratch = new Vector3();
  let current = null;
  let outgoing = null;
  let modelNow = model;
  let width = 1;
  let height = 1;
  let frame = 0;
  let lastTime = 0;
  let zoomed = 0;
  let zoomTween = null;
  let turnTween = null;
  let swapTween = null;
  let spotLevel = 0;
  let elapsed = 0;
  let cutTimer = 0;

  function statusMap(next) {
    return Object.fromEntries(next.stages.map((item) => [item.stage, item.status]));
  }

  function buildCarrier(next) {
    const registry = [];
    const lights = [];
    const carrier = new Group();
    const { platter, base } = buildPlatter({ registry, textures });
    const rooms = {};
    RING_STAGES.forEach((name) => {
      const built = buildRoom(name, { registry, lights, textures });
      built.group.rotation.y = roomAngle(name) * RADIANS;
      platter.add(built.group);
      rooms[name] = built.group;
    });
    const floatMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0.28, depthWrite: false, alphaMap: textures.blob });
    registry.push({ material: floatMaterial, token: '--shadow' });
    const floatGeometry = new PlaneGeometry(6.4, 6.4);
    floatGeometry.rotateX(-Math.PI / 2);
    const floating = new Mesh(floatGeometry, floatMaterial);
    floating.position.y = -1.05;
    carrier.add(base, platter, floating);
    const angle = -roomAngle(next.botStage);
    platter.rotation.y = angle * RADIANS;
    return { carrier, platter, rooms, registry, lights, angle, statuses: statusMap(next), botStage: next.botStage };
  }

  function paintCarrier(target) {
    for (const entry of target.registry) {
      const status = entry.stage ? target.statuses[entry.stage] : null;
      const light = roomLighting(status);
      const material = entry.material;
      if (entry.plaque || entry.lamp) {
        const value = read(light.plaque);
        material.color.setStyle(value);
        material.emissive.setStyle(value);
        material.emissiveIntensity = entry.plaque ? light.glow * 0.6 : light.glow * 1.6;
        if (!light.glow) material.color.multiplyScalar(0.7);
        continue;
      }
      const value = read(entry.token);
      if (!value) continue;
      material.color.setStyle(value);
      if (entry.emissive) material.emissive.setStyle(read(entry.emissive));
      if (entry.sheen && material.sheenColor) material.sheenColor.setStyle(read(entry.sheen));
      if (entry.stage && !entry.flat) toneColor(material.color, light);
      if (entry.stage && !entry.flat && roomConfig(entry.stage).mood === 'dim') {
        material.color.multiplyScalar(DIM_ROOM);
        material.envMapIntensity = DIM_ROOM * 0.6;
      }
      if (entry.stage && entry.emissive) toneColor(material.emissive, light);
    }
    target.carrier.traverse((child) => {
      if (!child.isInstancedMesh || !child.userData.colors) return;
      const status = target.statuses[child.parent && child.parent.name.replace('room_', '')];
      const color = new Color();
      for (let index = 0; index < child.count; index += 1) {
        color.setStyle(read(child.userData.colors[index % child.userData.colors.length]));
        toneColor(color, roomLighting(status));
        child.setColorAt(index, color);
      }
      if (child.instanceColor) child.instanceColor.needsUpdate = true;
    });
    target.lights.forEach((entry) => {
      entry.light.color.setStyle(read(entry.token));
      entry.light.intensity = CANDLE_BASE;
    });
  }

  function paintScene() {
    hemisphere.color.setStyle(read('--light-sky'));
    hemisphere.groundColor.setStyle(read('--light-ground'));
    key.color.setStyle(read('--light-key'));
    fill.color.setStyle(read('--light-fill'));
    rim.color.setStyle(read('--light-key'));
    spot.color.setStyle(read('--light-now'));
    if (environment) environment.dispose();
    environment = studioEnvironment(renderer, read);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.85;
    bot.paint(read);
    if (current) paintCarrier(current);
    if (outgoing) paintCarrier(outgoing);
  }

  function frontStage() {
    return current ? current.botStage : modelNow.botStage;
  }

  function applyCamera() {
    const pose = cameraPose(zoomed, width / height);
    camera.position.set(...pose.position);
    camera.fov = pose.fov;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    camera.lookAt(...pose.target);
  }

  function project(point) {
    scratch.copy(point).project(camera);
    return screenPoint(scratch, width, height);
  }

  function placeOverlay() {
    if (!current) return;
    const offset = current.carrier.position;
    root.querySelectorAll('.stage[data-stage]').forEach((label) => {
      const name = label.dataset.stage;
      const a = (roomAngle(name) + current.angle) * RADIANS;
      const radius = PLAQUE_RADIUS + 0.04;
      const screen = project(new Vector3(Math.sin(a) * radius + offset.x, PLAQUE_HEIGHT + offset.y, Math.cos(a) * radius + offset.z));
      const visibility = labelVisibility(facing(name, current.angle));
      const labelWidth = label.offsetWidth;
      label.style.transform = `translate(${(screen.x - labelWidth / 2).toFixed(1)}px, ${(screen.y + LABEL_GAP).toFixed(1)}px)`;
      label.style.opacity = String(visibility.opacity);
      label.dataset.depth = visibility.depth;
    });
    const centre = root.querySelector('.ring-centre');
    if (centre) {
      const anchor = project(new Vector3(offset.x, CENTRE_DROP + offset.y, PLAQUE_RADIUS + offset.z));
      centre.style.top = `${(anchor.y + CENTRE_GAP).toFixed(1)}px`;
      centre.style.left = `${anchor.x.toFixed(1)}px`;
    }
    const button = root.querySelector('.ring-bot');
    if (!button) return;
    bot.root.getWorldPosition(scratch);
    const base = scratch.clone();
    const middle = project(base.clone().setY(base.y + bot.height * 0.5));
    const top = project(base.clone().setY(base.y + bot.height));
    const size = Math.max(40, (middle.y - top.y) * 2.4);
    button.style.width = `${size.toFixed(1)}px`;
    button.style.height = `${size.toFixed(1)}px`;
    button.style.transform = `translate(${(middle.x - size / 2).toFixed(1)}px, ${(middle.y - size / 2).toFixed(1)}px)`;
    const bubble = root.querySelector('.bot-bubble');
    if (bubble) bubble.style.transform = `translate(${(top.x + size * 0.2).toFixed(1)}px, ${(top.y - (bubble.offsetHeight || 28) - 4).toFixed(1)}px)`;
  }

  function placeBot(lift = 0) {
    const offset = current ? current.carrier.position : scratch.set(0, 0, 0);
    const scale = current ? current.carrier.scale.x : 1;
    bot.root.position.set(offset.x, FLOOR_TOP * scale + offset.y + lift, BOT_SPOT * scale + offset.z);
    bot.root.scale.setScalar(BOT_SIZE * scale);
  }

  function stepTween(tween, time) {
    if (tween.start === null) tween.start = time;
    return Math.min(1, (time - tween.start) / tween.duration);
  }

  function stepTurn(time) {
    if (!turnTween || !current) return false;
    const progress = stepTween(turnTween, time);
    const eased = ease(progress);
    current.angle = turnTween.from + (turnTween.to - turnTween.from) * eased;
    current.platter.rotation.y = current.angle * RADIANS;
    placeBot(hopHeight(eased, turnTween.steps) * HOP);
    if (progress >= 1) {
      turnTween = null;
      placeBot(0);
      return false;
    }
    return true;
  }

  function stepZoom(time) {
    if (!zoomTween) return false;
    const progress = stepTween(zoomTween, time);
    zoomed = zoomTween.from + (zoomTween.to - zoomTween.from) * ease(progress);
    applyCamera();
    if (progress >= 1) {
      const done = zoomTween.resolve;
      zoomTween = null;
      done();
      return false;
    }
    return true;
  }

  function finishSwap() {
    if (!swapTween) return;
    const done = swapTween.resolve;
    swapTween = null;
    if (outgoing) disposeTree(outgoing.carrier);
    outgoing = null;
    current.carrier.position.set(0, 0, 0);
    current.carrier.scale.setScalar(1);
    placeBot(0);
    done();
  }

  function stepSwap(time) {
    if (!swapTween) return false;
    const progress = stepTween(swapTween, time);
    const offsets = swapOffset(swapTween.direction, ease(progress));
    if (outgoing) {
      outgoing.carrier.position.set(offsets.outX, offsets.outY, 0);
      outgoing.carrier.scale.setScalar(offsets.outScale);
    }
    current.carrier.position.set(offsets.inX, offsets.inY, 0);
    current.carrier.scale.setScalar(offsets.inScale);
    placeBot(0);
    if (progress >= 1) {
      finishSwap();
      return false;
    }
    return true;
  }

  function stepLights(seconds) {
    const target = current && current.statuses[frontStage()] === 'now' ? SPOT_ON * roomLighting('now').spot : 0;
    spotLevel = reducedMotion ? target : spotLevel + (target - spotLevel) * (1 - Math.exp(-seconds / SPOT_EASE_SECONDS));
    if (Math.abs(spotLevel - target) < 0.01) spotLevel = target;
    spot.intensity = spotLevel;
    if (!reducedMotion && current) {
      elapsed += seconds;
      current.lights.forEach((entry) => {
        const flicker = 0.85 + 0.1 * Math.sin(elapsed * 11) + 0.05 * Math.sin(elapsed * 23 + 1.3);
        entry.light.intensity = CANDLE_BASE * flicker;
        if (entry.flicker) entry.flicker.scale.set(1, 0.9 + 0.12 * flicker, 1);
      });
    }
    return spotLevel !== target;
  }

  function render() {
    placeOverlay();
    renderer.render(scene, camera);
  }

  function tick(time) {
    frame = 0;
    const seconds = lastTime ? Math.min((time - lastTime) / 1000, MAX_FRAME_SECONDS) : 1 / 60;
    lastTime = time;
    const swapping = stepSwap(time);
    const zooming = stepZoom(time);
    const turning = stepTurn(time);
    const botMoving = bot.step(seconds);
    const lighting = stepLights(seconds);
    render();
    if (swapping || zooming || turning || botMoving || lighting) schedule();
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
    renderer.setSize(width, height);
    applyCamera();
    render();
    schedule();
  }

  function cutTo(apply) {
    window.clearTimeout(cutTimer);
    el.dataset.cut = 'out';
    cutTimer = window.setTimeout(() => {
      apply();
      render();
      el.dataset.cut = 'in';
      cutTimer = window.setTimeout(() => delete el.dataset.cut, CUT_FADE_MS);
    }, CUT_FADE_MS);
  }

  function turnTo(next) {
    const plan = turnPlan(current.angle, next.botStage, { reducedMotion });
    current.botStage = next.botStage;
    if (!plan.steps) return;
    if (plan.fade) {
      turnTween = null;
      cutTo(() => {
        current.angle = plan.to;
        current.platter.rotation.y = plan.to * RADIANS;
      });
      return;
    }
    turnTween = { start: null, duration: plan.ms, from: current.angle, to: plan.to, steps: plan.steps };
  }

  function swapTo(next, direction) {
    finishSwap();
    turnTween = null;
    const incoming = buildCarrier(next);
    paintCarrier(incoming);
    stage.add(incoming.carrier);
    if (reducedMotion || !current) {
      const previous = current;
      current = incoming;
      const apply = () => {
        if (previous) disposeTree(previous.carrier);
        placeBot(0);
      };
      if (previous && reducedMotion) {
        incoming.carrier.visible = false;
        cutTo(() => {
          incoming.carrier.visible = true;
          apply();
        });
      } else apply();
      return Promise.resolve();
    }
    outgoing = current;
    current = incoming;
    if (bot.react()) schedule();
    return new Promise((resolve) => {
      swapTween = { start: null, duration: ROOM_SWITCH_MS * 1.3, direction, resolve };
      stepSwap(performance.now());
      schedule();
    });
  }

  function onVisibility() {
    if (document.hidden) stop();
    else schedule();
  }

  function onTheme() {
    paintScene();
    render();
    schedule();
  }

  const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const glances = finePointer.matches && !reducedMotion;

  function hitsFrontRoom(event) {
    if (!current || zoomed > 0.01) return false;
    const box = el.getBoundingClientRect();
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(current.rooms[frontStage()], true).length > 0;
  }

  function onPointerMove(event) {
    if (glances) {
      bot.root.getWorldPosition(scratch);
      scratch.y += bot.height * 0.75;
      const centre = project(scratch);
      const box = el.getBoundingClientRect();
      const dx = event.clientX - box.left - centre.x;
      const dy = event.clientY - box.top - centre.y;
      const length = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, length / 160);
      bot.lookAt((dx / length) * reach, (-dy / length) * reach);
    }
    const hover = hitsFrontRoom(event);
    if (hover) el.dataset.hover = 'room';
    else delete el.dataset.hover;
    schedule();
  }

  function onPointerLeave() {
    bot.lookAt(0, 0);
    delete el.dataset.hover;
    schedule();
  }

  function onClick(event) {
    if (onOpen && hitsFrontRoom(event)) onOpen();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(el);
  document.addEventListener('visibilitychange', onVisibility);
  darkScheme.addEventListener('change', onTheme);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerleave', onPointerLeave);
  el.addEventListener('click', onClick);

  current = buildCarrier(model);
  stage.add(current.carrier);
  paintScene();
  bot.update(model);
  placeBot(0);
  width = el.clientWidth || 1;
  height = el.clientHeight || 1;
  renderer.setSize(width, height);
  applyCamera();
  render();
  schedule();

  return {
    update(next, { swap = false, direction = 0 } = {}) {
      modelNow = next;
      let done = Promise.resolve();
      if (swap) done = swapTo(next, direction);
      else if (current) {
        current.statuses = statusMap(next);
        paintCarrier(current);
        if (next.botStage !== current.botStage) turnTo(next);
      }
      bot.update(next);
      render();
      schedule();
      return done;
    },
    react() {
      if (bot.react()) schedule();
    },
    zoom(direction) {
      const to = direction === 'in' ? 1 : 0;
      if (zoomTween) zoomTween.resolve();
      zoomTween = null;
      if (reducedMotion) {
        zoomed = to;
        applyCamera();
        render();
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        zoomTween = { start: null, duration: direction === 'in' ? ZOOM_MS : ZOOM_MS * 0.8, from: zoomed, to, resolve };
        schedule();
      });
    },
    dispose() {
      stop();
      window.clearTimeout(cutTimer);
      finishSwap();
      if (zoomTween) zoomTween.resolve();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      darkScheme.removeEventListener('change', onTheme);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('click', onClick);
      delete el.dataset.hover;
      delete el.dataset.cut;
      root.querySelectorAll('.stage[data-stage], .ring-bot, .ring-centre, .bot-bubble').forEach((node) => node.removeAttribute('style'));
      bot.dispose();
      if (current) disposeTree(current.carrier);
      Object.values(textures).forEach((texture) => texture.dispose());
      if (environment) environment.dispose();
      key.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
  };
}
