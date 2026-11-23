'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const studio = path.join(__dirname, '..', 'studio');
const load = (file) => import(pathToFileURL(path.join(studio, 'js', file)).href);
const read = (file) => fs.readFileSync(path.join(studio, file), 'utf8');

test('the tilted ring puts Goal at the back top, Review at the front bottom, and keeps stages clockwise', async () => {
  const { tiltedPoint, ringView } = await load('ring2d.js');
  const flat = { tilt: 64, roll: 0 };
  const goal = tiltedPoint(0, 1, flat);
  const maker = tiltedPoint(60, 1, flat);
  const review = tiltedPoint(180, 1, flat);
  const deliver = tiltedPoint(300, 1, flat);
  assert.ok(goal.y > 0 && goal.z < 0, 'Goal is up and away from the viewer');
  assert.ok(review.y < 0 && review.z > 0, 'Review is down and toward the viewer');
  assert.ok(maker.x > 0 && deliver.x < 0, 'Maker right, Deliver left');
  assert.ok(Math.abs(goal.y - Math.cos((64 * Math.PI) / 180)) < 1e-9, 'foreshortened by the tilt');
  assert.ok(Math.abs(Math.hypot(goal.x, goal.y, goal.z) - 1) < 1e-9, 'stays on the ring radius');
  const rolled = tiltedPoint(90, 1, { tilt: 64, roll: -7 });
  assert.ok(rolled.y < 0, 'a negative roll dips the right side');
  const wide = ringView(900);
  const narrow = ringView(343);
  assert.ok(wide.tilt >= 60 && wide.tilt <= 70, 'Saturn-like tilt on wide screens');
  assert.ok(narrow.tilt < wide.tilt, 'less tilt at narrow widths so the ring stays readable');
});

test('projectPoint matches a perspective camera and the camera distance keeps the whole ring in view', async () => {
  const { projectPoint, cameraDistance, ringView, tiltedPoint, RING_BANDS } = await load('ring2d.js');
  const origin = projectPoint({ x: 0, y: 0, z: 0 }, { fov: 30, distance: 5 }, 400, 300);
  assert.deepStrictEqual([origin.x, origin.y], [200, 150]);
  const right = projectPoint({ x: 1, y: 0, z: 0 }, { fov: 90, distance: 2 }, 300, 300);
  assert.ok(Math.abs(right.x - 225) < 1e-9, 'x = w/2 + (x·f/aspect/depth)·w/2');
  const nearer = projectPoint({ x: 1, y: 0, z: 1 }, { fov: 90, distance: 2 }, 300, 300);
  assert.ok(nearer.x > right.x, 'closer points spread out');
  const outer = RING_BANDS.at(-1)[1];
  for (const [width, height] of [[560, 340], [343, 300], [900, 360]]) {
    const view = ringView(width);
    const camera = { fov: view.fov, distance: cameraDistance(view, width / height) };
    for (let angle = 0; angle < 360; angle += 15) {
      const { x, y } = projectPoint(tiltedPoint(angle, outer, view), camera, width, height);
      assert.ok(x > 0 && x < width && y > 0 && y < height, `${width}x${height} angle ${angle} in view`);
    }
  }
});

test('ring bands have Cassini-like gaps and the markers sit on a band', async () => {
  const { RING_BANDS, RING_MARK_RADIUS } = await load('ring2d.js');
  assert.ok(RING_BANDS.length >= 4);
  for (let index = 1; index < RING_BANDS.length; index += 1) {
    assert.ok(RING_BANDS[index][0] > RING_BANDS[index - 1][1], `gap before band ${index}`);
  }
  assert.ok(new Set(RING_BANDS.map((band) => band[2])).size > 1, 'varying opacity');
  assert.ok(RING_BANDS.some(([inner, outer]) => RING_MARK_RADIUS >= inner && RING_MARK_RADIUS <= outer));
  const tokens = read('tokens.css');
  for (const token of new Set(RING_BANDS.map((band) => band[3]).concat(['--ring-dust', '--ring-glow']))) {
    assert.equal((tokens.match(new RegExp(`${token}: #`, 'g')) || []).length, 3, `${token} light, dark and dark media`);
  }
});

test('labels never cover the centre text: they move above or below it', async () => {
  const { nudgeLabel } = await load('ring2d.js');
  const centre = { left: 100, right: 200, top: 100, bottom: 140 };
  const clear = { left: 10, top: 10, width: 40, height: 12 };
  assert.deepStrictEqual(nudgeLabel(clear, centre), clear);
  assert.equal(nudgeLabel({ left: 120, top: 110, width: 40, height: 12 }, centre, 'down').top, 142);
  assert.equal(nudgeLabel({ left: 120, top: 110, width: 40, height: 12 }, centre, 'up').top, 86);
  assert.deepStrictEqual(nudgeLabel(clear, null), clear);
});

test('the 3D ring is used with WebGL; the flat option C ring is the fallback', async () => {
  const { ringMode } = await load('ring2d.js');
  assert.equal(ringMode({ webgl: true }), '3d');
  assert.equal(ringMode({ webgl: false }), 'flat');
  assert.equal(ringMode({ webgl: true, threeFailed: true }), 'flat');
  const main = read('js/main.js');
  assert.match(main, /ringMode\(\{ webgl: HAS_WEBGL, threeFailed: ringView\.threeFailed \}\)/);
  assert.match(main, /dataset\.ring = /);
  const css = read('styles.css');
  assert.match(css, /#ring\[data-ring="3d"\] \.loop::before\{display:none\}/, 'the flat circle hides when the 3D ring draws');
  assert.match(css, /#ring\[data-ring="3d"\] \.stage i\{display:none\}/, 'markers are drawn in 3D, labels stay DOM');
});

test('the 3D ring scene: tokens, perspective, dust, one render loop that stops when hidden, a bigger bot', () => {
  const ring = read('js/ring.js');
  assert.match(ring, /new PerspectiveCamera\(/);
  assert.match(ring, /new RingGeometry\(/);
  assert.match(ring, /new Points\(/);
  assert.match(ring, /getComputedStyle\(document\.documentElement\)\.getPropertyValue\(/);
  assert.equal((ring.match(/requestAnimationFrame\(/g) || []).length, 1);
  assert.match(ring, /document\.hidden/);
  assert.match(ring, /if \(reducedMotion\) return false;/, 'reduced motion: no drift or pulse');
  assert.match(ring, /projectPoint\(/, 'labels use the shared projection');
  assert.doesNotMatch(ring, /#[0-9a-fA-F]{3,8}\b|0x[0-9a-fA-F]{6}\b|rgba?\(/);
  assert.match(read('js/bot.js'), /export function createBot\(/);
  const server = fs.readFileSync(path.join(__dirname, '..', 'lib', 'studio-server.js'), 'utf8');
  for (const file of ['bot.js', 'sheet.js', 'ring.js', 'ring2d.js']) assert.ok(server.includes(`['/js/${file}', 'js/${file}']`), `${file} is served`);
});
