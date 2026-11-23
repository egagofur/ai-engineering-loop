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

test('the turntable turns the now stage to face the camera, the short way round', async () => {
  const { roomAngle, shortestTurn, turntableTarget, facing } = await load('diorama.js');
  assert.deepStrictEqual(STAGES.map(roomAngle), [0, 60, 120, 180, 240, 300]);
  assert.equal(shortestTurn(0, 60), 60);
  assert.equal(shortestTurn(0, -300), 60);
  assert.equal(shortestTurn(10, 350), -20);
  assert.equal(turntableTarget(0, 'maker'), -60);
  assert.equal(turntableTarget(-300, 'goal'), -360, 'Deliver to Goal keeps turning forward one step');
  assert.equal(turntableTarget(-60, 'goal'), 0);
  for (const stage of STAGES) {
    for (const start of [0, -60, -300, 720]) assert.equal(facing(stage, turntableTarget(start, stage)), 0, `${stage} faces the camera from ${start}`);
  }
  assert.equal(facing('maker', 0), 60, 'the next stage waits on the right');
});

test('turn plans: about a second per step, capped, and reduced motion cuts with a fade', async () => {
  const { turnPlan, TURN_STEP_MS, TURN_MAX_MS, CUT_FADE_MS } = await load('diorama.js');
  assert.ok(TURN_STEP_MS >= 800 && TURN_STEP_MS <= 1200);
  assert.deepStrictEqual(turnPlan(0, 'maker'), { from: 0, to: -60, delta: -60, steps: 1, ms: TURN_STEP_MS, fade: false });
  assert.equal(turnPlan(0, 'review').steps, 3);
  assert.equal(turnPlan(0, 'review').ms, TURN_MAX_MS);
  assert.equal(turnPlan(-60, 'maker').steps, 0, 'no turn when the room already faces the camera');
  assert.deepStrictEqual(turnPlan(0, 'verify', { reducedMotion: true }), { from: 0, to: -120, delta: -120, steps: 2, ms: 0, fade: true });
  assert.ok(CUT_FADE_MS <= 200);
  const css = read('styles.css');
  assert.match(css, /\.ring-gl\[data-cut="out"\] canvas\{opacity:0\}/);
});

test('rooms show status: done green plaque, now warm and spot lit, pending dim, skipped grey', async () => {
  const { roomLighting } = await load('diorama.js');
  assert.equal(roomLighting('done').plaque, '--ok-fill');
  assert.ok(roomLighting('done').glow > 0);
  assert.equal(roomLighting('now').plaque, '--brand');
  assert.equal(roomLighting('now').spot, 1);
  assert.ok(roomLighting('pending').tone < 1 && roomLighting('pending').glow === 0);
  assert.ok(roomLighting('skipped').saturation < 0.2, 'skipped rooms are greyed');
  assert.equal(roomLighting('weird'), roomLighting('pending'));
});

test('labels: front three readable, the rest faded; projection maps NDC to pixels', async () => {
  const { labelVisibility, screenPoint, hopHeight } = await load('diorama.js');
  assert.deepStrictEqual(labelVisibility(0), { depth: 'front', readable: true, opacity: 1 });
  assert.equal(labelVisibility(60).readable, true);
  assert.equal(labelVisibility(-60).depth, 'side');
  assert.equal(labelVisibility(120).readable, false);
  assert.ok(labelVisibility(180).opacity < 0.3 && labelVisibility(180).opacity > 0);
  assert.ok(labelVisibility(100).opacity > labelVisibility(150).opacity, 'fades with distance from the front');
  assert.deepStrictEqual(screenPoint({ x: 0, y: 0, z: 0.5 }, 400, 200), { x: 200, y: 100, visible: true });
  assert.deepStrictEqual(screenPoint({ x: 1, y: 1, z: 0.5 }, 400, 200), { x: 400, y: 0, visible: true });
  assert.equal(screenPoint({ x: 0, y: 0, z: 1.2 }, 400, 200).visible, false);
  assert.equal(hopHeight(0.5, 1), 1, 'the bot hops over the divider mid-turn');
  assert.ok(hopHeight(0, 2) < 1e-9 && hopHeight(1, 2) < 1e-9);
  assert.equal(hopHeight(0.5, 0), 0);
});

test('camera: rest frames the turntable, zoom dollies into the front room with a narrower FOV, phones step back', async () => {
  const { cameraPose, CAMERA_POSES } = await load('diorama.js');
  const rest = cameraPose(0, 1.8);
  const room = cameraPose(1, 1.8);
  assert.deepStrictEqual(rest.position, CAMERA_POSES.rest.position);
  assert.ok(room.fov < rest.fov);
  const distance = (pose) => Math.hypot(...pose.position.map((value, index) => value - pose.target[index]));
  assert.ok(distance(room) < distance(rest) / 2);
  assert.ok(distance(cameraPose(0, 0.5)) > distance(rest), 'a phone keeps the whole turntable in frame');
});

test('project switch: Previous/Next slide the turntables, a list pick drops one in', async () => {
  const { swapOffset } = await load('diorama.js');
  assert.deepStrictEqual(swapOffset(1, 0).inX > 0 && swapOffset(1, 1).inX === 0 && swapOffset(1, 1).outX < 0, true);
  assert.ok(swapOffset(-1, 1).outX > 0);
  assert.equal(swapOffset(0, 1).inY, 0);
  assert.ok(swapOffset(0, 0).inY > 0);
});

test('premium rendering: sRGB, ACES, soft shadows, a procedural studio environment, capped pixel ratio', () => {
  const turntable = read('js/turntable.js');
  assert.match(turntable, /outputColorSpace = SRGBColorSpace/);
  assert.match(turntable, /toneMapping = ACESFilmicToneMapping/);
  assert.match(turntable, /shadowMap\.type = PCFShadowMap/);
  assert.match(turntable, /shadow\.radius = /);
  assert.match(turntable, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/);
  assert.match(turntable, /antialias: true/);
  assert.match(read('js/forms.js'), /new PMREMGenerator\(renderer\)/);
  assert.match(read('js/forms.js'), /new ExtrudeGeometry\(/, 'rounded, bevelled forms');
  assert.match(read('js/bot.js'), /clearcoat: 1/);
});
