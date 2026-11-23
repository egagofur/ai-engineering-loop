import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer
} from '../vendor/three.module.min.js';

import { STAGES } from './list.js';
import { createBot } from './bot.js';
import {
  CUT_FADE_MS,
  GUEST_SPOT,
  cameraPose,
  hopHeight,
  lampGlow,
  returnPath,
  screenPoint,
  stationLighting,
  stationX,
  swapOffset,
  ticketTarget,
  walkPlan
} from './kitchen.js';
import { cubicBezier, EASE_OUT, ROOM_SWITCH_MS, ZOOM_MS } from './mood.js';
import { patternTexture, radialTexture, readToken, studioEnvironment } from './forms.js';
import { buildDiners, dinerHeadY, poseDiners } from './diners.js';
import { createCarriers, swapMode } from './carriers.js';
import { BOT_Z, COUNTER_FRONT, GUEST_TOP, RAIL_Z, TICKET_Y, buildKitchen } from './stations.js';

const BOT_SIZE = 0.8;
const DIM_STATION = 0.55;
const HOP = 0.14;
const MAX_FRAME_SECONDS = 0.1;
const LABEL_GAP = 8;
const SPOT_ON = 16;
const CRITIC_SPOT = 7;
const SPOT_EASE_SECONDS = 0.35;
const TICKET_EASE_SECONDS = 0.28;
const TURN_EASE_SECONDS = 0.16;
const STEAM_SECONDS = 1.8;
const GUEST_REACH = 0.85;

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
    marble: patternTexture('marble', { repeat: 0.35 }),
    tiles: patternTexture('tiles', { repeat: 8 }),
    paper: patternTexture('paper', { repeat: 1 }),
    panels: patternTexture('panels', { repeat: 2 }),
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
  });
  object.removeFromParent();
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function settle(current, target, seconds, constant) {
  const next = current + (target - current) * (1 - Math.exp(-seconds / constant));
  return Math.abs(next - target) < 0.002 ? target : next;
}

export function mountKitchen(el, model, { root, reducedMotion = false, onOpen = null, diners = 0 } = {}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  el.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(36, 1, 0.1, 80);
  const hemisphere = new HemisphereLight(undefined, undefined, 0.75);
  const key = new DirectionalLight(undefined, 2.3);
  key.position.set(-4.5, 9, 6.5);
  key.target.position.set(0, 0, 0.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 6, bottom: -6, near: 3, far: 24 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 5;
  key.shadow.blurSamples = 16;
  const fill = new DirectionalLight(undefined, 0.5);
  fill.position.set(6, 3, 4);
  const rim = new DirectionalLight(undefined, 0.9);
  rim.position.set(2, 5, -7);
  const spot = new SpotLight(undefined, 0, 0, 0.42, 0.8, 2);
  spot.position.set(0, 3.4, 1.6);
  const critic = new SpotLight(undefined, 0, 0, 0.32, 0.7, 2);
  critic.position.set(stationX('review'), 3.1, 0.9);
  critic.target.position.set(stationX('review'), 0.45, 0.04);
  scene.add(hemisphere, key, key.target, fill, rim, spot, spot.target, critic, critic.target);

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
  let width = 1;
  let height = 1;
  let frame = 0;
  let lastTime = 0;
  let zoomed = 0;
  let zoomTween = null;
  let walkTween = null;
  let swapTween = null;
  let spotLevel = 0;
  let elapsed = 0;
  let cutTimer = 0;
  let cutApply = null;
  const cutWaiters = [];
  let heading = 0;

  function statusMap(next) {
    return Object.fromEntries(next.stages.map((item) => [item.stage, item.status]));
  }

  function buildCarrier(next) {
    const registry = [];
    const built = buildKitchen({ registry, textures });
    const dining = buildDiners({ registry, textures, count: diners });
    built.carrier.add(dining.group);
    poseDiners(dining.figures, 0, { reducedMotion: true });
    const target = ticketTarget(next);
    built.ticket.position.x = target.x;
    built.arc.visible = Boolean(returnPath(next));
    return { ...built, figures: dining.figures, registry, statuses: statusMap(next), botStage: target.stage, botX: target.x, ticketX: target.x, ticketTo: target.x, model: next };
  }

  function retarget(target, next) {
    const ticket = ticketTarget(next);
    target.statuses = statusMap(next);
    target.model = next;
    target.arc.visible = Boolean(returnPath(next));
    target.botStage = ticket.stage;
    target.botX = ticket.x;
    target.ticketX = ticket.x;
    target.ticketTo = ticket.x;
    target.ticket.position.x = ticket.x;
    paintCarrier(target);
  }

  const carriers = createCarriers(stage, {
    build: buildCarrier,
    dispose: (target) => disposeTree(target.carrier)
  });

  function syncCarriers() {
    current = carriers.current;
    outgoing = carriers.outgoing;
  }

  function paintCarrier(target) {
    for (const entry of target.registry) {
      const status = entry.stage ? target.statuses[entry.stage] : null;
      const light = stationLighting(status);
      const material = entry.material;
      if (entry.lamp) {
        const value = read(light.lamp);
        material.color.setStyle(value);
        material.emissive.setStyle(value);
        material.emissiveIntensity = lampGlow(status, elapsed, { reducedMotion }) * 1.6;
        if (!light.glow) material.color.multiplyScalar(0.7);
        continue;
      }
      const value = read(entry.token);
      if (!value) continue;
      material.color.setStyle(value);
      if (entry.emissive) material.emissive.setStyle(read(entry.emissive));
      if (entry.burner) material.emissive.setStyle(read('--kitchen-flame'));
      if (entry.sheen && material.sheenColor) material.sheenColor.setStyle(read(entry.sheen));
      if (entry.stage && !entry.flat) toneColor(material.color, light);
      if (entry.stage === 'review' && !entry.flat) {
        material.color.multiplyScalar(DIM_STATION);
        material.envMapIntensity = DIM_STATION;
      }
    }
    target.carrier.traverse((child) => {
      if (!child.isInstancedMesh || !child.userData.colors) return;
      const color = new Color();
      for (let index = 0; index < child.count; index += 1) {
        color.setStyle(read(child.userData.colors[index % child.userData.colors.length]));
        child.setColorAt(index, color);
      }
      if (child.instanceColor) child.instanceColor.needsUpdate = true;
    });
  }

  function paintScene() {
    hemisphere.color.setStyle(read('--light-sky'));
    hemisphere.groundColor.setStyle(read('--light-ground'));
    key.color.setStyle(read('--light-key'));
    fill.color.setStyle(read('--light-fill'));
    rim.color.setStyle(read('--light-key'));
    spot.color.setStyle(read('--light-now'));
    critic.color.setStyle(read('--bot-devil-eye'));
    if (environment) environment.dispose();
    environment = studioEnvironment(renderer, read);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.85;
    bot.paint(read);
    if (current) paintCarrier(current);
    if (outgoing) paintCarrier(outgoing);
  }

  function offset() {
    return current ? current.carrier.position : scratch.set(0, 0, 0);
  }

  function applyCamera() {
    const focus = current ? current.botX + current.carrier.position.x : 0;
    const pose = cameraPose(zoomed, width / height, focus);
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

  function place(node, point, { anchor = 'top', gap = 0 } = {}) {
    if (!node) return;
    const screen = project(point);
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    if (anchor === 'side') {
      node.style.transform = `translate(${(screen.x + gap).toFixed(1)}px, ${(screen.y - h / 2).toFixed(1)}px)`;
      return;
    }
    const y = anchor === 'top' ? screen.y + gap : screen.y - h - gap;
    node.style.transform = `translate(${(screen.x - w / 2).toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  function placeOverlay() {
    if (!current) return;
    const base = current.carrier.position;
    root.querySelectorAll('.stage[data-stage]').forEach((label) => {
      place(label, new Vector3(stationX(label.dataset.stage) + base.x, 0.12 + base.y, COUNTER_FRONT + 0.02 + base.z), { gap: LABEL_GAP });
    });
    place(root.querySelector('.kitchen-ticket'), new Vector3(current.ticketX + base.x, TICKET_Y + 0.2 + base.y, RAIL_Z + base.z), { anchor: 'bottom', gap: 4 });
    if (current.arc.visible) place(root.querySelector('.kitchen-return'), current.arc.userData.apex.clone().add(base), { anchor: 'bottom', gap: 10 });
    place(root.querySelector('.guest'), new Vector3(GUEST_SPOT.x + GUEST_REACH + base.x, GUEST_TOP + base.y, GUEST_SPOT.z + base.z), { anchor: 'side', gap: 14 });
    root.querySelectorAll('.diner-tag[data-diner]').forEach((tag) => {
      const figure = current.figures[Number(tag.dataset.diner)];
      if (!figure) return;
      place(tag, new Vector3(figure.x + base.x, dinerHeadY() + 0.08 + base.y, figure.z + base.z), { anchor: 'bottom', gap: 2 });
    });
    const button = root.querySelector('.ring-bot');
    if (!button) return;
    bot.root.getWorldPosition(scratch);
    const foot = scratch.clone();
    const middle = project(foot.clone().setY(foot.y + bot.height * 0.55));
    const top = project(foot.clone().setY(foot.y + bot.height));
    const size = Math.max(40, (middle.y - top.y) * 2.4);
    button.style.width = `${size.toFixed(1)}px`;
    button.style.height = `${size.toFixed(1)}px`;
    button.style.transform = `translate(${(middle.x - size / 2).toFixed(1)}px, ${(middle.y - size / 2).toFixed(1)}px)`;
    const bubble = root.querySelector('.bot-bubble');
    if (bubble) bubble.style.transform = `translate(${(top.x + size * 0.2).toFixed(1)}px, ${(top.y - (bubble.offsetHeight || 28) - 4).toFixed(1)}px)`;
  }

  function placeBot(lift = 0) {
    const base = offset();
    const scale = current ? current.carrier.scale.x : 1;
    const x = current ? current.botX : 0;
    bot.root.position.set(base.x + x * scale, base.y + lift, base.z + BOT_Z * scale);
    bot.root.scale.setScalar(BOT_SIZE * scale);
    bot.root.rotation.y = heading;
  }

  function stepTween(tween, time) {
    if (tween.start === null) tween.start = time;
    return Math.min(1, (time - tween.start) / tween.duration);
  }

  function stepWalk(time, seconds) {
    const wanted = walkTween ? Math.sign(walkTween.to - walkTween.from) * Math.PI / 2 : 0;
    heading = reducedMotion ? 0 : settle(heading, wanted, seconds, TURN_EASE_SECONDS);
    if (!walkTween || !current) {
      placeBot(0);
      return heading !== 0;
    }
    const progress = stepTween(walkTween, time);
    const eased = ease(progress);
    current.botX = walkTween.from + (walkTween.to - walkTween.from) * eased;
    placeBot(hopHeight(progress, walkTween.hops) * HOP);
    if (progress >= 1) {
      walkTween = null;
      placeBot(0);
    }
    return true;
  }

  function stepTicket(seconds) {
    if (!current) return false;
    current.ticketX = reducedMotion ? current.ticketTo : settle(current.ticketX, current.ticketTo, seconds, TICKET_EASE_SECONDS);
    current.ticket.position.x = current.ticketX;
    return current.ticketX !== current.ticketTo;
  }

  function stepZoom(time) {
    if (!zoomTween) return false;
    const progress = stepTween(zoomTween, time);
    zoomed = zoomTween.from + (zoomTween.to - zoomTween.from) * ease(progress);
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
    carriers.finish();
    syncCarriers();
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

  function stepStation(seconds) {
    if (!current) return false;
    elapsed += seconds;
    const statuses = current.statuses;
    const now = STAGES.find((name) => statuses[name] === 'now');
    let moving = false;
    if (now && !reducedMotion) {
      const lamp = current.lamps[now];
      lamp.emissiveIntensity = lampGlow('now', elapsed) * 1.6;
      moving = true;
    }
    if (current.figures.length && !reducedMotion && current.model.mode !== 'settled') {
      poseDiners(current.figures, elapsed);
      moving = true;
    }
    const cooking = statuses.maker === 'now';
    current.burners.forEach((ring) => {
      ring.material.emissiveIntensity = cooking ? 1.1 : 0;
    });
    if (current.steam) {
      current.steam.children.forEach((puff, index) => {
        if (!cooking || reducedMotion) {
          puff.scale.setScalar(cooking ? 0.8 : 0.001);
          puff.position.y = 0.3;
          return;
        }
        const t = ((elapsed / STEAM_SECONDS) + index / current.steam.children.length) % 1;
        puff.position.y = 0.26 + t * 0.55;
        puff.scale.setScalar(Math.max(0.001, Math.sin(Math.PI * t) * (0.8 + t * 0.6)));
      });
      moving = moving || (cooking && !reducedMotion);
    }
    const target = statuses[current.botStage] === 'now' ? SPOT_ON : 0;
    spotLevel = reducedMotion ? target : settle(spotLevel, target, seconds, SPOT_EASE_SECONDS);
    spot.intensity = spotLevel;
    const focus = current.botX + current.carrier.position.x;
    spot.position.x = focus;
    spot.target.position.set(focus, 0.45, 0);
    const criticOn = statuses.review !== 'skipped';
    critic.intensity = criticOn ? CRITIC_SPOT * (statuses.review === 'now' ? 1.6 : 1) : 0;
    critic.position.x = stationX('review') + current.carrier.position.x;
    critic.target.position.x = critic.position.x;
    return moving || spotLevel !== target;
  }

  function render() {
    applyCamera();
    placeOverlay();
    renderer.render(scene, camera);
  }

  function tick(time) {
    frame = 0;
    const seconds = lastTime ? Math.min((time - lastTime) / 1000, MAX_FRAME_SECONDS) : 1 / 60;
    lastTime = time;
    const swapping = stepSwap(time);
    const zooming = stepZoom(time);
    const walking = stepWalk(time, seconds);
    const sliding = stepTicket(seconds);
    const botMoving = bot.step(seconds);
    const station = stepStation(seconds);
    render();
    if (swapping || zooming || walking || sliding || botMoving || station) schedule();
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
    render();
    schedule();
  }

  function cutTo(apply) {
    cutApply = apply;
    return new Promise((resolve) => {
      cutWaiters.push(resolve);
      if (el.dataset.cut === 'out') return;
      window.clearTimeout(cutTimer);
      el.dataset.cut = 'out';
      cutTimer = window.setTimeout(() => {
        const run = cutApply;
        cutApply = null;
        if (run) run();
        render();
        el.dataset.cut = 'in';
        cutWaiters.splice(0).forEach((done) => done());
        cutTimer = window.setTimeout(() => delete el.dataset.cut, CUT_FADE_MS);
      }, CUT_FADE_MS);
    });
  }

  function walkTo(next) {
    const target = ticketTarget(next);
    current.botStage = target.stage;
    current.ticketTo = target.x;
    const plan = walkPlan(current.botX, target.x, { reducedMotion });
    if (!plan.steps && !plan.fade) return;
    if (plan.fade) {
      walkTween = null;
      cutTo(() => {
        current.botX = target.x;
        placeBot(0);
      });
      return;
    }
    walkTween = { start: null, duration: plan.ms, from: current.botX, to: target.x, hops: plan.hops };
  }

  function swapTo(next, direction) {
    finishSwap();
    walkTween = null;
    const mode = swapMode(direction, { reducedMotion, mounted: Boolean(current) });
    if (mode === 'mount') {
      carriers.mount(next);
      syncCarriers();
      paintCarrier(current);
      placeBot(0);
      return Promise.resolve();
    }
    if (mode === 'reuse') {
      return cutTo(() => {
        retarget(current, next);
        placeBot(0);
      });
    }
    carriers.slide(next);
    syncCarriers();
    paintCarrier(current);
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

  function hitsBotStation(event) {
    if (!current || zoomed > 0.01) return false;
    const box = el.getBoundingClientRect();
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects([current.stations[current.botStage], bot.root], true).length > 0;
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
    if (hitsBotStation(event)) el.dataset.hover = 'room';
    else delete el.dataset.hover;
    schedule();
  }

  function onPointerLeave() {
    bot.lookAt(0, 0);
    delete el.dataset.hover;
    schedule();
  }

  function onClick(event) {
    if (onOpen && hitsBotStation(event)) onOpen();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(el);
  document.addEventListener('visibilitychange', onVisibility);
  darkScheme.addEventListener('change', onTheme);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerleave', onPointerLeave);
  el.addEventListener('click', onClick);

  carriers.mount(model);
  syncCarriers();
  paintScene();
  bot.update(model);
  placeBot(0);
  width = el.clientWidth || 1;
  height = el.clientHeight || 1;
  renderer.setSize(width, height);
  render();
  schedule();

  return {
    update(next, { swap = false, direction = 0 } = {}) {
      let done = Promise.resolve();
      if (swap) done = swapTo(next, direction);
      else if (current) {
        current.statuses = statusMap(next);
        current.model = next;
        current.arc.visible = Boolean(returnPath(next));
        paintCarrier(current);
        if (ticketTarget(next).stage !== current.botStage) walkTo(next);
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
      root.querySelectorAll('.stage[data-stage], .ring-bot, .ring-centre, .bot-bubble, .kitchen-ticket, .kitchen-return, .guest, .diner-tag').forEach((node) => node.removeAttribute('style'));
      cutWaiters.splice(0).forEach((done) => done());
      bot.dispose();
      carriers.dispose();
      Object.values(textures).forEach((texture) => texture.dispose());
      if (environment) environment.dispose();
      key.shadow.map?.dispose();
      spot.shadow.map?.dispose();
      critic.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
  };
}
