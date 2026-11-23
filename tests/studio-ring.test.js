'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const studio = path.join(__dirname, '..', 'studio');
const load = (file) => import(pathToFileURL(path.join(studio, 'js', file)).href);
const STAGES = ['goal', 'maker', 'verify', 'review', 'judge', 'deliver'];

const ring = (statuses) => STAGES.map((stage, index) => ({ stage, status: statuses[index] }));

test('ringModel spaces the six stages 60 degrees apart, clockwise from the top', async () => {
  const { ringModel } = await load('ring2d.js');
  const model = ringModel(ring(['done', 'done', 'done', 'now', 'pending', 'pending']), { iteration: 2, maxIterations: 3 });
  assert.deepStrictEqual(model.stages.map((item) => item.angle), [0, 60, 120, 180, 240, 300]);
  assert.deepStrictEqual(model.stages.map((item) => item.stage), STAGES);
  assert.equal(model.stages[3].status, 'now');
  assert.equal(model.botAngle, 180);
  assert.equal(model.iteration, 2);
  assert.equal(model.maxIterations, 3);
});

test('ringModel parks the bot on the last done stage when nothing is in progress', async () => {
  const { ringModel } = await load('ring2d.js');
  assert.equal(ringModel(ring(['done', 'done', 'done', 'done', 'done', 'done'])).botAngle, 300);
  assert.equal(ringModel(ring(['done', 'done', 'skipped', 'skipped', 'pending', 'pending'])).botAngle, 60);
  assert.equal(ringModel(ring(['pending', 'pending', 'pending', 'pending', 'pending', 'pending'])).botAngle, 0);
});

test('ringModel fills missing stages as pending and ignores unknown statuses', async () => {
  const { ringModel } = await load('ring2d.js');
  const model = ringModel([{ stage: 'maker', status: 'now' }, { stage: 'judge', status: 'weird' }]);
  assert.deepStrictEqual(model.stages.map((item) => item.status), ['pending', 'now', 'pending', 'pending', 'pending', 'pending']);
  assert.equal(model.botAngle, 60);
  assert.deepStrictEqual(ringModel(undefined).stages.length, 6);
});

test('ring2d renders six labelled stages as text, readable without 3D', async () => {
  const { ringModel, renderRing2d } = await load('ring2d.js');
  const svg = renderRing2d(ringModel(ring(['done', 'done', 'now', 'pending', 'skipped', 'pending']), { iteration: 1, maxIterations: 3 }));
  assert.match(svg, /^<svg [^>]*role="img"/);
  for (const label of ['Goal', 'Maker', 'Verify', 'Review', 'Judge', 'Deliver']) {
    assert.match(svg, new RegExp(`<text[^>]*>${label}</text>`), label);
  }
  assert.equal((svg.match(/<g class="ring-stage"/g) || []).length, 6);
  assert.match(svg, /data-stage="verify" data-status="now"/);
  assert.match(svg, /data-stage="judge" data-status="skipped"/);
  assert.match(svg, /iteration 1 of 3/);
  assert.match(svg, /class="ring-bot"/);
  assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,8}\b/, 'colours come from tokens via CSS classes');
});

test('mountRing2d writes the SVG into its element, updates and disposes', async () => {
  const { ringModel, mountRing2d } = await load('ring2d.js');
  const el = { innerHTML: '' };
  const handle = mountRing2d(el, ringModel(ring(['now', 'pending', 'pending', 'pending', 'pending', 'pending'])));
  assert.match(el.innerHTML, /data-stage="goal" data-status="now"/);
  handle.update(ringModel(ring(['done', 'now', 'pending', 'pending', 'pending', 'pending'])));
  assert.match(el.innerHTML, /data-stage="maker" data-status="now"/);
  handle.dispose();
  assert.equal(el.innerHTML, '');
});

test('ring modules: no hex colours, three imported by relative path, one paused render loop', () => {
  const ring2d = fs.readFileSync(path.join(studio, 'js', 'ring2d.js'), 'utf8');
  const ring3d = fs.readFileSync(path.join(studio, 'js', 'ring.js'), 'utf8');
  assert.doesNotMatch(ring2d, /\b(document|window)\b/);
  for (const [name, source] of [['ring2d.js', ring2d], ['ring.js', ring3d]]) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|0x[0-9a-fA-F]{6}\b/, name);
  }
  assert.match(ring3d, /from '\.\.\/vendor\/three\.module\.min\.js'/);
  assert.match(ring3d, /getComputedStyle\(document\.documentElement\)\.getPropertyValue\(/);
  assert.match(ring3d, /done: '--ok', now: '--brand'/);
  assert.equal((ring3d.match(/requestAnimationFrame\(/g) || []).length, 1);
  assert.match(ring3d, /document\.hidden/);
  assert.match(ring3d, /renderer\.dispose\(\)/);
});

test('vendored three.js is pinned, licensed and its core import is vendored too', () => {
  const vendor = path.join(studio, 'vendor');
  const module = fs.readFileSync(path.join(vendor, 'three.module.min.js'), 'utf8');
  const imports = [...module.matchAll(/from"(\.\/[^"]+)"/g)].map((match) => match[1]);
  for (const file of imports) assert.ok(fs.existsSync(path.join(vendor, file)), file);
  assert.match(fs.readFileSync(path.join(vendor, 'three.LICENSE'), 'utf8'), /MIT License/);
  const notices = fs.readFileSync(path.join(__dirname, '..', 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(notices, /three\.js[\s\S]*0\.185\.1[\s\S]*MIT/);
});

test('main.js falls back to the 2D ring without WebGL, with reduced motion or at narrow width', () => {
  const main = fs.readFileSync(path.join(studio, 'js', 'main.js'), 'utf8');
  assert.match(main, /prefers-reduced-motion: reduce/);
  assert.match(main, /\(max-width: 899px\)/);
  assert.match(main, /getContext\('webgl2'\)/);
  assert.match(main, /import\('\.\/ring\.js'\)/);
  assert.match(fs.readFileSync(path.join(studio, 'styles.css'), 'utf8'), /@media \(max-width:899px\)/);
});
