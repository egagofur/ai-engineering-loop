'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const studio = path.join(__dirname, '..', 'studio');
const load = (file) => import(pathToFileURL(path.join(studio, 'js', file)).href);
const read = (file) => fs.readFileSync(path.join(studio, file), 'utf8');
const STAGES = ['goal', 'maker', 'verify', 'review', 'judge', 'deliver'];
const ring = (now) => STAGES.map((stage, index) => ({ stage, status: index < STAGES.indexOf(now) ? 'done' : stage === now ? 'now' : 'pending' }));

test('six stations along one counter, left to right, evenly spaced and centred', async () => {
  const { stationLayout, stationX, STATION_SPACING, stationConfig } = await load('kitchen.js');
  const layout = stationLayout();
  assert.deepStrictEqual(layout.map((item) => item.stage), STAGES);
  assert.deepStrictEqual(layout.map((item) => `${item.label}/${item.agent}`), ['Order/Goal', 'Cook/Maker', 'Taste/Verify', 'Critic/Review', 'Head chef/Judge', 'Serve/Deliver']);
  for (let index = 1; index < layout.length; index += 1) {
    assert.ok(Math.abs(layout[index].x - layout[index - 1].x - STATION_SPACING) < 1e-6, 'reads left to right');
  }
  assert.ok(Math.abs(layout[0].x + layout.at(-1).x) < 1e-6, 'centred on the counter');
  assert.equal(stationX('nope'), stationX('goal'));
  assert.equal(stationConfig('goal').costume, 'philosopher');
  assert.equal(stationConfig('review').costume, 'devil');
  assert.equal(stationConfig('review').mood, 'dim');
  for (const stage of ['maker', 'verify', 'judge', 'deliver']) assert.equal(stationConfig(stage).costume, 'chef', stage);
  assert.ok(stationConfig('maker').props.includes('steam'));
  assert.ok(stationConfig('judge').props.includes('bell') && stationConfig('judge').props.includes('plate'), 'the Head chef tastes a plated dish at the pass');
  assert.ok(stationConfig('maker').props.includes('flame'));
  assert.ok(stationConfig('deliver').props.includes('cloche'));
});

test('the orange ticket goes to the active station, or the last done one when settled', async () => {
  const { ticketTarget, stationX } = await load('kitchen.js');
  const { ringModel } = await load('ring2d.js');
  for (const stage of STAGES) {
    assert.deepStrictEqual(ticketTarget(ringModel(ring(stage))), { stage, x: stationX(stage) }, stage);
  }
  const settled = ringModel(STAGES.map((stage, index) => ({ stage, status: index < 2 ? 'done' : 'skipped' })));
  assert.equal(ticketTarget(settled).stage, 'maker');
  assert.equal(ticketTarget(null).stage, 'goal');
});

test('a Run sent back shows the dashed return path Head chef to Cook and the iteration on its ticket', async () => {
  const { returnPath, ticketLabel, stationX, RETURN_LABEL } = await load('kitchen.js');
  assert.equal(returnPath({ iteration: 1, maxIterations: 3 }), null);
  assert.equal(returnPath(null), null);
  assert.deepStrictEqual(returnPath({ iteration: 2, maxIterations: 3 }), { from: 'judge', to: 'maker', fromX: stationX('judge'), toX: stationX('maker'), label: RETURN_LABEL });
  assert.equal(ticketLabel({ iteration: 2, maxIterations: 3 }), 'Iteration 2 of 3');
  assert.equal(ticketLabel({ iteration: 1, maxIterations: 3 }), 'Your order');
  const { renderRing } = await load('ring2d.js');
  const back = renderRing({ summary: { state: 'REVIEWED', iteration: 2, maxIterations: 3, ring: ring('judge') } });
  assert.match(back, /<p class="kitchen-ticket" data-back="true">Iteration 2 of 3<\/p>/);
  assert.match(back, /<p class="kitchen-return">Sent back to the kitchen: Head chef → Cook<\/p>/);
  assert.doesNotMatch(renderRing({ summary: { state: 'REVIEWED', ring: ring('judge') } }), /kitchen-return/);
});

test('station lamps: done green, now warm orange with a soft pulse, pending dim, skipped grey; reduced motion holds still', async () => {
  const { stationLighting, lampGlow } = await load('kitchen.js');
  assert.equal(stationLighting('done').lamp, '--ok-fill');
  assert.equal(stationLighting('now').lamp, '--brand');
  assert.equal(stationLighting('now').spot, 1);
  assert.equal(stationLighting('pending').glow, 0);
  assert.ok(stationLighting('skipped').saturation < 0.2);
  assert.equal(stationLighting('weird'), stationLighting('pending'));
  const samples = [0, 0.2, 0.4, 0.6, 0.8, 1.2].map((t) => lampGlow('now', t));
  assert.ok(Math.max(...samples) - Math.min(...samples) > 0.2, 'now pulses');
  assert.ok(Math.max(...samples) <= stationLighting('now').glow + 1e-9, 'softly, never brighter than its glow');
  assert.equal(lampGlow('now', 0.4, { reducedMotion: true }), stationLighting('now').glow);
  assert.equal(lampGlow('done', 0.4), stationLighting('done').glow);
});

test('the chef walks between stations with eased hops; reduced motion cuts with a fade', async () => {
  const { walkPlan, hopHeight, stationX, WALK_MAX_MS, CUT_FADE_MS } = await load('kitchen.js');
  const one = walkPlan(stationX('goal'), stationX('maker'));
  assert.equal(one.steps, 1);
  assert.equal(one.hops, 2);
  assert.ok(one.ms >= 600 && one.ms <= WALK_MAX_MS);
  assert.equal(walkPlan(stationX('goal'), stationX('deliver')).ms, WALK_MAX_MS, 'long walks are capped');
  assert.equal(walkPlan(1, 1).steps, 0);
  assert.deepStrictEqual(walkPlan(stationX('judge'), stationX('maker'), { reducedMotion: true }).fade, true);
  assert.ok(CUT_FADE_MS <= 200);
  assert.equal(hopHeight(0.25, 2), 1, 'top of the first hop');
  assert.ok(hopHeight(0.5, 2) < 1e-9 && hopHeight(1, 2) < 1e-9, 'lands between hops and at the end');
  assert.equal(hopHeight(0.5, 0), 0);
});

test('camera: a phone frames the active station with its neighbours and follows the bot along the counter', async () => {
  const { cameraPose, compactRest, compactFocus, COMPACT_REACH, COMPACT_SPAN, CAMERA_POSES, stationX, STATION_SPACING } = await load('kitchen.js');
  const distance = (pose) => Math.hypot(...pose.position.map((value, index) => value - pose.target[index]));
  const halfWidth = (pose, aspect) => distance(pose) * Math.tan((pose.fov * Math.PI) / 360) * aspect;
  for (const aspect of [0.45, 0.55, 0.7]) {
    const pose = compactRest(aspect, stationX('verify'));
    assert.ok(Math.abs(halfWidth(pose, aspect) * 2 - COMPACT_SPAN) < 1e-3, `spans the station and neighbours at ${aspect}`);
    assert.ok(COMPACT_SPAN / 2 > STATION_SPACING, 'both neighbours are in frame');
    assert.ok(distance(pose) < distance(cameraPose(0, aspect)), 'closer than the whole-counter view');
  }
  assert.equal(compactRest(0.5, stationX('verify')).target[0], stationX('verify'));
  assert.equal(compactRest(0.5, stationX('goal')).target[0], -COMPACT_REACH, 'stops at the end of the counter');
  assert.equal(compactFocus(stationX('deliver')), COMPACT_REACH);
  assert.ok(stationX('deliver') - COMPACT_REACH < COMPACT_SPAN / 2, 'the end station stays in frame');
  const phone = cameraPose(0, 0.5, 99, { compact: true, restX: stationX('maker') });
  assert.equal(phone.target[0], stationX('maker'), 'rest follows the eased camera x, not the zoom focus');
  assert.deepStrictEqual(cameraPose(0, 2, 0, { compact: false }).position, CAMERA_POSES.rest.position, 'desktop rest is unchanged');
});

test('zoom: frames the whole bot, toque included, from its bounding box on desktop and phone', async () => {
  const { cameraPose, stationFrame, ZOOM_INSETS } = await load('kitchen.js');
  const bot = { bottom: 0.45, top: 2.13, half: 0.95, z: -0.38 };
  const screenY = (pose, aspect, y) => {
    const dir = pose.target.map((value, index) => value - pose.position[index]);
    const length = Math.hypot(...dir);
    const forward = dir.map((value) => value / length);
    const up = [0, 1, 0];
    const right = [forward[1] * up[2] - forward[2] * up[1], forward[2] * up[0] - forward[0] * up[2], forward[0] * up[1] - forward[1] * up[0]];
    const rl = Math.hypot(...right);
    const r = right.map((value) => value / rl);
    const u = [r[1] * forward[2] - r[2] * forward[1], r[2] * forward[0] - r[0] * forward[2], r[0] * forward[1] - r[1] * forward[0]];
    const rel = [0, y, bot.z].map((value, index) => value - pose.position[index]);
    const depth = rel.reduce((sum, value, index) => sum + value * forward[index], 0);
    const vertical = rel.reduce((sum, value, index) => sum + value * u[index], 0);
    const ndc = vertical / (depth * Math.tan((pose.fov * Math.PI) / 360));
    return (1 - ndc) / 2;
  };
  for (const [aspect, compact] of [[1.4, false], [2, false], [0.5, true], [0.6, true]]) {
    const pose = stationFrame(aspect, { ...bot, x: 0 }, { compact });
    const insets = compact ? ZOOM_INSETS.compact : ZOOM_INSETS.wide;
    const top = screenY(pose, aspect, bot.top);
    const foot = screenY(pose, aspect, bot.bottom);
    assert.ok(top > insets.top, `toque clears the top inset at ${aspect}: ${top}`);
    assert.ok(foot < 1 - insets.bottom, `feet clear the bottom inset at ${aspect}: ${foot}`);
    const halfWidth = Math.hypot(...pose.position.map((value, index) => value - pose.target[index])) * Math.tan((pose.fov * Math.PI) / 360) * aspect;
    assert.ok(halfWidth > bot.half, `bot fits across at ${aspect}`);
  }
  const zoomed = cameraPose(1, 1.4, 2.1, { bot });
  assert.equal(zoomed.target[0], 2.1);
  const frame = stationFrame(1.4, { ...bot, x: 2.1 });
  zoomed.position.forEach((value, index) => assert.ok(Math.abs(value - frame.position[index]) < 1e-6, 'a full zoom lands on the bot frame with no extra push'));
});

test('overlays: bubbles clamp inside the scene and the ticket label dodges a bubble or hides', async () => {
  const { clampBox, dodgeLabel } = await load('kitchen.js');
  const bounds = { width: 375, height: 600 };
  assert.deepStrictEqual(clampBox({ x: 330, y: -20, w: 120, h: 28 }, bounds), { x: 247, y: 8, w: 120, h: 28 });
  assert.deepStrictEqual(clampBox({ x: -40, y: 590, w: 120, h: 28 }, bounds), { x: 8, y: 564, w: 120, h: 28 });
  assert.deepStrictEqual(clampBox({ x: 100, y: 100, w: 120, h: 28 }, bounds), { x: 100, y: 100, w: 120, h: 28 });
  const label = { x: 140, y: 200, w: 90, h: 22 };
  assert.deepStrictEqual(dodgeLabel(label, null, bounds), { ...label, hidden: false }, 'no bubble, no change');
  assert.deepStrictEqual(dodgeLabel(label, { x: 300, y: 200, w: 60, h: 28 }, bounds), { ...label, hidden: false }, 'no overlap, no change');
  const moved = dodgeLabel(label, { x: 200, y: 196, w: 140, h: 30 }, bounds);
  assert.equal(moved.hidden, false);
  assert.ok(moved.x + moved.w <= 200 - 6, 'moves clear of the bubble');
  const cramped = dodgeLabel({ x: 8, y: 8, w: 90, h: 22 }, { x: 20, y: 8, w: 340, h: 30 }, { width: 375, height: 40 });
  assert.equal(cramped.hidden, true, 'hides when there is no room');
});

test('phone layout: strip, bottom sheet guest, compact header, and 44px tap targets under 600px', () => {
  const css = read('styles.css');
  const phone = css.slice(css.indexOf('@media (max-width:600px)'));
  assert.ok(phone.length > 30, 'has a phone breakpoint');
  assert.match(phone, /#ring\[data-ring="3d"\] \.stages\{[^}]*overflow-x:auto/);
  assert.match(phone, /#ring\[data-ring="3d"\] \.guest\{[^}]*right:8px;bottom:60px;left:8px;max-width:none/);
  assert.match(phone, /\.run-task\{[^}]*-webkit-line-clamp:2/);
  assert.match(phone, /\.details-button[^{]*\{min-height:44px\}/);
  assert.match(phone, /#ring\[data-ring="3d"\] \.ring-centre\{[^}]*clip-path:inset\(50%\)/, 'the waiting block stays for screen readers but merges into the header');
});

test('camera: rest shows the whole counter, zoom dollies to the station under the bot, narrow views step back', async () => {
  const { cameraPose, CAMERA_POSES, stationX } = await load('kitchen.js');
  const rest = cameraPose(0, 2);
  assert.deepStrictEqual(rest.position, CAMERA_POSES.rest.position);
  const zoomed = cameraPose(1, 2, stationX('verify'));
  assert.equal(zoomed.target[0], stationX('verify'));
  assert.ok(zoomed.fov < rest.fov);
  const distance = (pose) => Math.hypot(...pose.position.map((value, index) => value - pose.target[index]));
  assert.ok(distance(zoomed) < distance(rest) / 2);
  assert.ok(distance(cameraPose(0, 0.6)) > distance(rest), 'a phone keeps the counter in frame');
  const { swapOffset, KITCHEN_WIDTH } = await load('kitchen.js');
  assert.equal(swapOffset(1, 0).inX, KITCHEN_WIDTH);
  assert.equal(swapOffset(1, 1).inX, 0);
  assert.ok(swapOffset(-1, 1).outX > 0);
  assert.ok(swapOffset(0, 0).inY > 0);
});

test('the guest table asks: Confirm the order? with Freeze, Bring it out? and the waiter question stay in the agent host', async () => {
  const { renderGuest } = await load('ring2d.js');
  const freeze = renderGuest({ summary: { waiting: { kind: 'freeze' } }, actor: 'Ega' });
  assert.match(freeze, /<p class="eyebrow guest-name">You, the guest<\/p>/);
  assert.match(freeze, /<b>Confirm the order\?<\/b>/);
  assert.match(freeze, /<button type="button" class="primary" data-action="freeze">Freeze as Ega<\/button>/);
  assert.match(renderGuest({ summary: { waiting: { kind: 'freeze' } } }), /data-action="guest-freeze-name">Freeze…<\/button>/);
  const approval = renderGuest({ summary: { waiting: { kind: 'approval' } }, actor: 'Ega' });
  assert.match(approval, /<b>Bring it out\?<\/b> <span class="guest-note">Approve the delivery in your agent host\.<\/span>/);
  assert.doesNotMatch(approval, /data-action/, 'approval stays in the agent host');
  assert.match(renderGuest({ summary: { waiting: { kind: 'question' } } }), /The waiter asks you something\./);
  assert.match(renderGuest({ summary: {} }), /data-asking="false"/);
  const main = read('js/main.js');
  assert.match(main, /closest\('\.guest \[data-action\]'\)/);
});

test('fallback: without WebGL the flat ring stays text-complete with stations, ticket and the guest', async () => {
  const { ringMode, renderRing } = await load('ring2d.js');
  assert.equal(ringMode({ webgl: false }), 'flat');
  assert.equal(ringMode({ webgl: true, threeFailed: true }), 'flat');
  assert.equal(ringMode({ webgl: true }), '3d');
  const html = renderRing({ summary: { state: 'STARTED', ring: ring('goal'), waiting: { kind: 'freeze' } }, actor: 'Ega' });
  for (const text of ['Order', 'Goal', 'Cook', 'Taste', 'Critic', 'Head chef', 'Serve', 'Your order', 'You, the guest', 'Confirm the order?', 'Freeze as Ega']) {
    assert.ok(html.includes(text), text);
  }
});

test('premium rendering: sRGB, ACES, soft shadows, PMREM studio environment, bevelled forms, PBR, contact shadows', () => {
  const scene = read('js/restaurant.js');
  assert.match(scene, /outputColorSpace = SRGBColorSpace/);
  assert.match(scene, /toneMapping = ACESFilmicToneMapping/);
  assert.match(scene, /shadowMap\.type = PCFShadowMap/);
  assert.match(scene, /shadow\.radius = /);
  assert.match(scene, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/);
  assert.match(scene, /studioEnvironment\(renderer, read\)/);
  assert.match(read('js/forms.js'), /new PMREMGenerator\(renderer\)/);
  assert.match(read('js/forms.js'), /new ExtrudeGeometry\(/);
  const stations = read('js/stations.js');
  assert.match(stations, /MeshPhysicalMaterial/);
  assert.match(stations, /alphaMap: textures\.blob/, 'contact shadows under props');
  assert.match(stations, /mergeStatic\(group\)/, 'static station geometry is merged per material');
  assert.match(stations, /new InstancedMesh\(/);
  for (const stage of STAGES) assert.match(stations, new RegExp(`${stage}: [a-zA-Z]+Station`), stage);
  const bot = read('js/bot.js');
  assert.match(bot, /costume_chef_head/);
  assert.match(bot, /costume_devil_hat/);
  const tokens = read('tokens.css');
  for (const token of new Set([...stations.matchAll(/'(--kitchen-[a-z-]+)'/g)].map((m) => m[1]))) assert.match(tokens, new RegExp(`${token}:`), token);
});

test('kitchen art: warm tiled backsplash, bracketed shelf, hood over the Cook, pendant pools, tuned exposure in both themes', async () => {
  const stations = read('js/stations.js');
  const scene = read('js/restaurant.js');
  const forms = read('js/forms.js');
  for (const pattern of ['subway', 'checker', 'brushed', 'grain', 'plaster', 'marble']) assert.match(forms, new RegExp(`\\n  ${pattern}\\(u, v\\) \\{`), pattern);
  assert.match(stations, /map: textures\.subway/, 'tiled backsplash');
  assert.match(stations, /function bracket\(/, 'the back shelf hangs on brackets');
  assert.match(stations, /hood\.position\.set\(stationX\('maker'\)/, 'a hood over the Cook station');
  assert.match(stations, /function buildPendants\(/);
  assert.match(scene, /PENDANT_XS\.map\(\(x\) => \{\n\s+const light = new SpotLight\(/, 'pendants cast soft pools of light');
  assert.match(scene, /toneMappingExposure = Number\(read\('--kitchen-exposure'\)\) \|\| 1/);
  const tokens = read('tokens.css');
  const themes = tokens.split(/:root\[data-theme="dark"\]|@media \(prefers-color-scheme: dark\)/);
  assert.equal(themes.length, 3);
  for (const theme of themes) {
    for (const token of ['--kitchen-tile', '--kitchen-wall', '--kitchen-floor', '--kitchen-exposure', '--kitchen-ambient']) assert.match(theme, new RegExp(`${token}:`), token);
  }
  const { stationX } = await load('kitchen.js');
  const { BOT_Y, BOT_Z, COUNTER_TOP, COUNTER_FRONT } = await load('stations.js');
  assert.equal(BOT_Y, COUNTER_TOP, 'the bot stands on the counter, so its contact shadow lands on the marble');
  assert.ok(BOT_Z < 0 && BOT_Z > -COUNTER_FRONT, 'behind the props, on the counter');
  assert.ok(Math.abs(stationX('goal')) > 5, 'stations span the counter');
});

test('switching projects keeps one kitchen: the scene object count stays constant', async () => {
  const { Scene, Group } = await import(pathToFileURL(path.join(studio, 'vendor', 'three.module.min.js')).href);
  const { createCarriers, swapMode } = await load('carriers.js');
  const { buildKitchen } = await load('stations.js');
  const { patternTexture, radialTexture } = await load('forms.js');
  const textures = Object.fromEntries(['planks', 'marble', 'tiles', 'paper', 'panels', 'fabric'].map((name) => [name, patternTexture(name, { size: 8 })]));
  textures.blob = radialTexture(1.8, 8);
  assert.equal(swapMode(0, { mounted: false }), 'mount');
  assert.equal(swapMode(0), 'reuse', 'a project switch reuses the kitchen');
  assert.equal(swapMode(1, { reducedMotion: true }), 'reuse');
  assert.equal(swapMode(-1), 'slide', 'Previous/Next slides a second kitchen in');
  const scene = new Scene();
  const stage = new Group();
  scene.add(stage);
  let built = 0;
  let disposed = 0;
  const carriers = createCarriers(stage, {
    build: () => {
      built += 1;
      return buildKitchen({ registry: [], textures });
    },
    dispose: (target) => {
      disposed += 1;
      target.carrier.removeFromParent();
    }
  });
  const count = () => {
    let total = 0;
    scene.traverse(() => { total += 1; });
    return total;
  };
  carriers.mount({});
  const baseline = count();
  assert.equal(stage.children.length, 1);
  for (let index = 0; index < 4; index += 1) {
    carriers.slide({});
    assert.equal(stage.children.length, 2, 'two kitchens only while sliding');
    carriers.slide({});
    assert.equal(stage.children.length, 2, 'an interrupted slide drops the oldest kitchen');
    carriers.finish();
    assert.equal(count(), baseline, `switch ${index}`);
  }
  carriers.mount({});
  assert.equal(count(), baseline);
  assert.equal(built - disposed, 1, 'every replaced kitchen is disposed');
  carriers.dispose();
  assert.equal(stage.children.length, 0);
  const restaurant = read('js/restaurant.js');
  assert.match(restaurant, /const mode = swapMode\(direction, \{ reducedMotion, mounted: Boolean\(current\) \}\);/);
  assert.match(restaurant, /if \(mode === 'reuse'\) \{\n\s+return cutTo\(\(\) => \{\n\s+retarget\(current, next\);/, 'a project switch repaints the same kitchen behind a short fade');
});

test('lathe props face outward whichever way the profile is drawn, so domes and bells are not inside out', async () => {
  const { lathe, profileArea } = await load('forms.js');
  const dome = [[0, 0.3], [0.14, 0.27], [0.25, 0.1], [0.27, 0.022], [0, 0.022]];
  assert.ok(profileArea(dome) < 0, 'drawn top to bottom (clockwise)');
  for (const points of [dome, [...dome].reverse()]) {
    const geometry = lathe(points, 16);
    const position = geometry.attributes.position;
    const wall = [...Array(points.length).keys()].find((j) => Math.abs(position.getZ(j) - 0.25) < 1e-6 && Math.abs(position.getY(j) - 0.1) < 1e-6);
    assert.ok(wall !== undefined);
    assert.ok(geometry.attributes.normal.getZ(wall) > 0, 'the side wall normal points away from the axis');
  }
  const shade = lathe([[0, 0.28], [0.1, 0.18], [0.235, 0.005]], 8, { open: true });
  assert.ok(shade.attributes.normal.getY(1) < 0, 'an open shell keeps its drawn order, so a lamp lining faces down');
  const stations = read('js/stations.js');
  assert.doesNotMatch(stations, /stamp|gavel/, 'the Head chef pass holds a plate, not a stamp');
  assert.match(stations, /dynamic\.pass = pass;/);
  assert.match(stations, /dynamic\.flame = flame;/);
});

test('cooking: the flame bursts when the pan tosses, flickers in sync with a warm light and holds still for reduced motion', async () => {
  const { flameBurst } = await load('kitchen.js');
  assert.equal(flameBurst(null), 0);
  assert.equal(flameBurst(0.42), 1);
  assert.equal(flameBurst(0.05), 0);
  assert.ok(flameBurst(0.5) > 0 && flameBurst(0.5) < 1);
  const { TOSS_SECONDS } = await load('bot.js');
  assert.ok(TOSS_SECONDS > 1 && TOSS_SECONDS < 2);
  const restaurant = read('js/restaurant.js');
  assert.match(restaurant, /const burst = reducedMotion \? 0 : flameBurst\(bot\.cookPhase\(\)\);/);
  assert.match(restaurant, /fire\.intensity = FLAME_POWER \* \(1 \+ glow\) \+ FLAME_BURST_POWER \* burst;/);
  assert.match(restaurant, /new PointLight\(/);
});
