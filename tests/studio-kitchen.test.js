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
  assert.ok(stationConfig('judge').props.includes('bell') && stationConfig('judge').props.includes('stamp'));
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
  assert.match(bot, /costume === 'chef'/);
  const tokens = read('tokens.css');
  for (const token of new Set([...stations.matchAll(/'(--kitchen-[a-z-]+)'/g)].map((m) => m[1]))) assert.match(tokens, new RegExp(`${token}:`), token);
});
