'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const studio = path.join(__dirname, '..', 'studio');
const load = (file) => import(pathToFileURL(path.join(studio, 'js', file)).href);
const { renderComponent } = require('./helpers/svelte.js');
const renderRing = ({ summary = null, findings = null, actor = null, diners = [] } = {}) => renderComponent('components/Ring.svelte', { summary, findings, actor, diners, freeze: { source: null, phase: 'idle' } });
const source = (file) => fs.readFileSync(path.join(studio, 'src', file), 'utf8');
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

const summary = (statuses, overrides = {}) => ({ runId: 'r', state: 'VERIFIED', tier: 'T2', iteration: 2, maxIterations: 3, ring: ring(statuses), waiting: null, ...overrides });

test('the ring face is option C: six labelled stages on the circle, status classes and angles', async () => {
  const { stagePosition } = await load('ring2d.js');
  const html = await renderRing({ summary: summary(['done', 'done', 'done', 'now', 'pending', 'skipped']), findings: { total: 3, blocking: 1 }, projectName: 'socialcrab/orch' });
  assert.doesNotMatch(html, /ring-eyebrow/, 'the eyebrow lives in the stage overlay now');
  const stages = [...html.matchAll(/<li class="stage ([a-z]+)" data-stage="([a-z]+)" data-status="\1" data-angle="(\d+)"><i aria-hidden="true"><\/i><b class="stage-station">([A-Za-z ]+)<\/b> <span class="stage-agent">([A-Za-z]+)<\/span><span class="visually-hidden">, ([a-z ]+)<\/span><\/li>/g)]
    .map((m) => `${m[2]}:${m[1]}:${m[3]}:${m[4]}:${m[5]}:${m[6]}`);
  assert.deepStrictEqual(stages, [
    'goal:done:0:Order:Goal:done',
    'maker:done:60:Cook:Maker:done',
    'verify:done:120:Taste:Verify:done',
    'review:now:180:Critic:Review:in progress',
    'judge:pending:240:Head chef:Judge:not started',
    'deliver:skipped:300:Serve:Deliver:skipped'
  ]);
  assert.match(html, /<ol class="stages" aria-label="Kitchen stations">/);
  assert.match(html, /<b class="ring-activity">Devil's Advocate<\/b><span class="eyebrow ring-note">3 findings · 1 blocking<\/span>/);
  assert.match(html, /<div class="ring-orbit" data-at="review"><button type="button" class="bot ring-bot" aria-label="Bot is reviewing: [^"]+"><\/button><p class="bot-bubble" aria-hidden="true" hidden=""><\/p><\/div>/);
  assert.match(html, /<div class="ring-gl" aria-hidden="true"><\/div>/);
  assert.doesNotMatch(html, /style=|#[0-9a-fA-F]{3,8}\b/, 'positions and colours come from styles.css');
  const css = fs.readFileSync(path.join(studio, 'styles.css'), 'utf8');
  STAGES.forEach((stage, index) => {
    const { left, top } = stagePosition(index * 60);
    assert.ok(css.includes(`.stage[data-stage="${stage}"]{left:${left}%;top:${top}%}`), `${stage} sits on the circle at ${left}%,${top}%`);
    assert.ok(css.includes(`.ring-orbit[data-at="${stage}"]{transform:rotate(${index * 60}deg)}`), `bot orbit for ${stage}`);
  });
  assert.deepStrictEqual(stagePosition(0), { left: 50, top: 0 });
  assert.deepStrictEqual(stagePosition(90), { left: 100, top: 50 });
  assert.deepStrictEqual(stagePosition(180), { left: 50, top: 100 });
});

test('ringActivity names the agent of the now stage, waits, settled and finished Runs', async () => {
  const { ringActivity } = await load('ring2d.js');
  const statuses = (now) => STAGES.map((stage, index) => (index < STAGES.indexOf(now) ? 'done' : stage === now ? 'now' : 'pending'));
  assert.deepStrictEqual(ringActivity(summary(statuses('review')), { total: 3, blocking: 1 }), { title: "Devil's Advocate", note: '3 findings · 1 blocking' });
  assert.deepStrictEqual(ringActivity(summary(statuses('judge')), { total: 1, blocking: 0 }), { title: 'Judge', note: '1 finding · 0 blocking' });
  assert.deepStrictEqual(ringActivity(summary(statuses('maker')), null), { title: 'Maker', note: 'in progress' });
  assert.deepStrictEqual(ringActivity(summary(statuses('deliver'), { waiting: { kind: 'approval' } }), null), { title: 'Waiting for approval', note: 'waiting for you' });
  assert.deepStrictEqual(ringActivity(summary(statuses('goal'), { waiting: { kind: 'freeze' } }), null), { title: 'Waiting for Freeze', note: 'waiting for you' });
  assert.deepStrictEqual(ringActivity(summary(['done', 'done', 'done', 'done', 'done', 'done'], { state: 'DELIVERED' }), null), { title: 'Delivered', note: 'done' });
  assert.deepStrictEqual(ringActivity(summary(['done', 'done', 'pending', 'pending', 'pending', 'pending'], { state: 'ESCALATED' }), null), { title: 'Escalated', note: 'done' });
});

test('a settled Run parks the bot at its last done stage', async () => {
  const html = await renderRing({ summary: summary(['done', 'done', 'skipped', 'skipped', 'pending', 'pending'], { state: 'REPORTED' }) });
  assert.match(html, /class="ring-orbit" data-at="maker"/);
  assert.doesNotMatch(html, /class="stage now"/);
});

test('the ring keeps its stage labels and bot orbit across updates so the 3D overlay and the glide survive', () => {
  const ring = source('components/Ring.svelte');
  assert.match(ring, /\{#each base\.stages as item \(item\.stage\)\}/, 'stage labels are keyed by stage, so updates patch them in place');
  assert.match(ring, /<div class="ring-orbit" data-at=\{base\.botStage\}>/, 'one orbit element; only data-at changes');
  assert.match(ring, /aria-label=\{botLabel\(summary, findings\)\}/);
  assert.doesNotMatch(ring, /innerHTML/);
  assert.match(ring, /if \(handle\) handle\.dispose\(\);/, 'the kitchen is disposed when the ring goes away');
});

test('kitchen modules: no raw colours, three imported by relative path, one paused render loop', () => {
  const read = (file) => fs.readFileSync(path.join(studio, 'js', file), 'utf8');
  const ring2d = read('ring2d.js');
  const kitchen = read('kitchen.js');
  assert.doesNotMatch(ring2d, /\b(document|window)\b/);
  assert.doesNotMatch(kitchen, /\b(document|window)\b|three\.module/, 'the pure helpers stay DOM and WebGL free');
  const scene = ['restaurant.js', 'stations.js', 'forms.js', 'bot.js'].map((file) => [file, read(file)]);
  for (const [name, source] of [['ring2d.js', ring2d], ['kitchen.js', kitchen], ...scene]) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|0x[0-9a-fA-F]{6}\b|rgba?\(|hsla?\(/, name);
    assert.doesNotMatch(source, /GLTFLoader|\.glb\b|\.gltf\b|https?:/, name);
  }
  for (const [name, source] of scene) assert.match(source, /from '\.\.\/vendor\/three\.module\.min\.js'/, name);
  assert.match(read('forms.js'), /getComputedStyle\(document\.documentElement\)\.getPropertyValue\(/);
  const restaurant = read('restaurant.js');
  assert.equal(scene.reduce((sum, [, source]) => sum + (source.match(/requestAnimationFrame\(/g) || []).length, 0), 1, 'one render loop');
  assert.match(restaurant, /document\.hidden/);
  assert.match(restaurant, /renderer\.dispose\(\)/);
  assert.match(restaurant, /dispose: \(target\) => disposeTree\(target\.carrier\)/, 'the old kitchen is disposed after a swap');
  for (const gone of ['turntable.js', 'diorama.js', 'rooms.js']) assert.ok(!fs.existsSync(path.join(studio, 'js', gone)), gone);
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

test('the ring draws the DOM face always and the WebGL kitchen only with WebGL and a working three.js', () => {
  const ring = source('components/Ring.svelte');
  const main = source('main.js');
  const app = source('App.svelte');
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(ring, /typeof window\.WebGL2RenderingContext === 'function'/, 'no throwaway probe context at boot');
  assert.doesNotMatch(ring + main, /getContext\('webgl/);
  assert.match(ring, /threeFailed = true/, 'a context three cannot create falls back to the flat ring');
  assert.match(ring, /import\('\.\.\/\.\.\/js\/restaurant\.js'\)/);
  assert.match(main, /if \(typeof window\.WebGL2RenderingContext === 'function'\) import\('\.\.\/js\/restaurant\.js'\)/, 'the kitchen module starts loading at boot, in parallel with the API calls');
  assert.match(ring, /ringMode\(\{ webgl: HAS_WEBGL, threeFailed \}\) === '3d'/);
  assert.match(ring, /data-bot=\{glReady \? '3d' : 'css'\}/);
  const css = fs.readFileSync(path.join(studio, 'styles.css'), 'utf8');
  assert.match(css, /#ring\[data-bot="3d"\] \.ring-bot\{background:transparent;box-shadow:none\}/, 'the CSS bot steps aside but its button keeps focus');
  assert.match(css, /@media \(max-width:899px\)\{[^@]*\.ringbox\{--loop:min\(220px,62vw\)\}/, 'the ring stays visible, scaled down, at narrow widths');
  assert.doesNotMatch(css, /stage-rail/);
});

test('the kitchen board names the step in kitchen words and keeps the AEL stage under it', async () => {
  const { kitchenActivity } = await load('ring2d.js');
  const ring = (now) => ['goal', 'maker', 'verify', 'review', 'judge', 'deliver'].map((stage, index, all) => ({ stage, status: index < all.indexOf(now) ? 'done' : stage === now ? 'now' : 'pending' }));
  assert.deepStrictEqual(kitchenActivity({ ring: ring('maker') }), { board: 'On the stove', title: 'Maker', note: 'in progress' });
  assert.equal(kitchenActivity({ ring: ring('deliver'), waiting: { kind: 'approval' } }).board, 'Ready at the pass');
  assert.equal(kitchenActivity({ ring: ring('deliver'), state: 'DELIVERED' }).board, 'Plating up');
  const html = await renderRing({ summary: { ring: ring('review') }, findings: { total: 3, blocking: 1 } });
  assert.match(html, /<b class="ring-board" aria-hidden="true">The critic tastes<\/b><b class="ring-activity">Devil's Advocate<\/b>/);
});
