'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const studio = path.join(__dirname, '..', 'studio');
const load = (file) => import(pathToFileURL(path.join(studio, 'js', file)).href);
const read = (file) => fs.readFileSync(path.join(studio, file), 'utf8');
const { renderComponent } = require('./helpers/svelte.js');
const IDLE = { source: null, phase: 'idle' };
const roomCard = async (summary, { projectName = '', actor = null } = {}) => {
  const html = await renderComponent('components/Room.svelte', { visible: true, opened: true, summary, projectName, actor, freeze: IDLE });
  return html.match(/<div class="room-card">([\s\S]*?)<\/div> <div class="room-nav">/)[1];
};
const STAGES = ['goal', 'maker', 'verify', 'review', 'judge', 'deliver'];
const ring = (now) => STAGES.map((stage, index) => ({ stage, status: index < STAGES.indexOf(now) ? 'done' : stage === now ? 'now' : 'pending' }));

test('wait levels escalate at 30 s, 2 min and 5 min from one constant', async () => {
  const { WAIT_LEVEL_SECONDS, waitLevel, waitSeconds } = await load('mood.js');
  assert.deepStrictEqual(WAIT_LEVEL_SECONDS, [30, 120, 300]);
  assert.deepStrictEqual([0, 29, 30, 119, 120, 299, 300, 7200].map(waitLevel), [1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(waitSeconds({ since: '2026-11-23T10:00:00Z' }, Date.parse('2026-11-23T10:02:30Z')), 150);
  assert.equal(waitSeconds({ since: 'not a date' }, 0), 0);
  assert.equal(waitSeconds(null, 0), 0);
});

test('bubble copy is restaurant-flavoured, fixed per wait kind and level; only levels 3 and 4 rotate; reduced motion shows one line', async () => {
  const { WAIT_COPY, waitBubble } = await load('mood.js');
  assert.deepStrictEqual(Object.keys(WAIT_COPY).sort(), ['approval', 'freeze', 'question']);
  for (const kind of Object.keys(WAIT_COPY)) {
    assert.equal(WAIT_COPY[kind].length, 4, kind);
    for (const lines of WAIT_COPY[kind]) for (const line of lines) assert.ok(line.length <= 32, line);
  }
  assert.deepStrictEqual(waitBubble('freeze', 5), { level: 1, text: 'Your order, please?', rotates: false });
  assert.deepStrictEqual(waitBubble('freeze', 60, 1), { level: 2, text: '…', rotates: false });
  assert.deepStrictEqual(waitBubble('freeze', 200, 0), { level: 3, text: 'The kitchen is waiting…', rotates: true });
  assert.equal(waitBubble('approval', 200, 0).text, "The food's getting cold!");
  assert.equal(waitBubble('freeze', 400, 1).text, "I've been waiting ages!");
  assert.deepStrictEqual(waitBubble('freeze', 400, 3, { reducedMotion: true }), { level: 4, text: 'Confirm the order!', rotates: false });
  assert.equal(waitBubble('unknown', 5).text, 'A quick question?');
});

test('Next/Previous walk the projects with an active Run in list order and wrap', async () => {
  const { roomTargets, stepTarget } = await load('mood.js');
  const run = (state = 'GOAL_FROZEN', extra = {}) => ({ runId: 'r', state, ...extra });
  const projects = [
    { id: 'idle', name: 'a-idle', state: 'idle', run: run('DELIVERED'), worktreeRuns: [] },
    { id: 'busy', name: 'b-busy', state: 'working', run: run(), worktreeRuns: [run('MAKER_COMPLETE', { worktreeId: 'wt-1' }), run('DELIVERED', { worktreeId: 'wt-done' })] },
    { id: 'wait', name: 'c-wait', state: 'waiting', run: run('STARTED', { waiting: { kind: 'freeze' } }), worktreeRuns: [] },
    { id: 'gone', name: 'd-gone', state: 'missing', run: null, worktreeRuns: [] }
  ];
  const targets = roomTargets(projects);
  assert.deepStrictEqual(targets, ['wait', 'busy', 'wt-1']);
  assert.equal(stepTarget(targets, 'wait', 1), 'busy');
  assert.equal(stepTarget(targets, 'wt-1', 1), 'wait');
  assert.equal(stepTarget(targets, 'wait', -1), 'wt-1');
  assert.equal(stepTarget(targets, 'idle', 1), 'wait');
  assert.equal(stepTarget([], 'x', 1), null);
});

test('motion uses one ease-out curve: cubic-bezier(0.23, 1, 0.32, 1), zoom 600-900 ms', async () => {
  const { cubicBezier, EASE_OUT, ZOOM_MS, ROOM_SWITCH_MS } = await load('mood.js');
  assert.deepStrictEqual(EASE_OUT, [0.23, 1, 0.32, 1]);
  assert.ok(ZOOM_MS >= 600 && ZOOM_MS <= 900);
  assert.ok(ROOM_SWITCH_MS >= 400 && ROOM_SWITCH_MS <= 900);
  const ease = cubicBezier(...EASE_OUT);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.ok(ease(0.5) > 0.85, 'fast start, soft landing');
  let previous = 0;
  for (let x = 0.05; x <= 1; x += 0.05) {
    assert.ok(ease(x) >= previous - 1e-9, 'monotone');
    previous = ease(x);
  }
  const linear = cubicBezier(0, 0, 1, 1);
  assert.ok(Math.abs(linear(0.3) - 0.3) < 1e-4);
});

test('bot waiting moods: calm look-around, foot tap, grumble, angry hops with steam', async () => {
  const { buildClips } = await load('bot.js');
  const waiting = buildClips().waiting;
  assert.equal(waiting.length, 4);
  const names = waiting.map((clip) => clip.tracks.map((track) => track.name));
  assert.ok(names[0].includes('face.rotation[y]'));
  assert.ok(names[1].includes('body.rotation[z]'));
  assert.ok(names[2].includes('face.rotation[y]') && names[2].includes('body.rotation[z]'), 'level 3 grumbles, shaking its face');
  assert.ok(names[3].includes('steam.scale') && names[3].includes('puff1.position[y]'), 'steam puffs');
  assert.ok(!names[2].includes('steam.scale'));
  const { botFace } = await load('kitchen.js');
  const wait = (waitLevel) => botFace({ mode: 'waiting', botStage: 'goal', waitLevel });
  assert.deepStrictEqual([1, 2, 3, 4].map(wait), ['question', 'open', 'annoyed', 'angry']);
  assert.equal(botFace({ mode: 'working', botStage: 'review' }), 'squint');
  assert.equal(botFace({ mode: 'working', botStage: 'maker' }), 'stern', 'Maker cooks with a serious face');
  assert.equal(botFace({ mode: 'working', botStage: 'goal' }), 'focus');
  assert.equal(botFace({ mode: 'settled', botStage: 'deliver' }), 'happy');
  assert.equal(botFace({ mode: 'working', botStage: 'maker' }, { reacting: true }), 'happy');
});

test('the ring renders a bubble near the bot and a polite live region for the wait level', async () => {
  const html = await renderComponent('components/Ring.svelte', { summary: { state: 'STARTED', ring: ring('goal'), waiting: { kind: 'freeze' } }, freeze: IDLE });
  assert.match(html, /<p class="bot-bubble" aria-hidden="true" data-level="1">Your order, please\?<\/p>/);
  assert.match(html, /<p class="visually-hidden bot-mood" aria-live="polite"><\/p>/);
  const quiet = await renderComponent('components/Ring.svelte', { summary: { state: 'STARTED', ring: ring('maker'), waiting: null }, freeze: IDLE });
  assert.match(quiet, /<p class="bot-bubble" aria-hidden="true" hidden=""><\/p>/);
  const source = read('src/components/Ring.svelte');
  assert.match(source, /const level = \$derived\(bubble \? bubble\.level : 0\);/);
  assert.match(source, /const now = level;\n\s+untrack\(\(\) => \{\n\s+moodText = /, 'announce only when the level changes');
});

test('room card: project, title, activity, stage, iteration, wait and the same Freeze action', async () => {
  const summary = { runId: 'r1', task: 'Add <login>', tier: 'T2', iteration: 2, maxIterations: 3, state: 'STARTED', ring: ring('goal'), waiting: { kind: 'freeze', since: 'x' } };
  const html = await roomCard(summary, { projectName: 'team/app', actor: 'Ega' });
  assert.match(html, /^<p class="eyebrow">team\/app<\/p> <h2 id="room-title" class="room-title">Add &lt;login><\/h2>/);
  assert.match(html, /<p class="room-activity"><strong>Waiting for Freeze<\/strong> · waiting for you<\/p>/);
  assert.match(html, /<span class="chip">Goal<\/span><span class="chip">T2<\/span><span class="chip">Iteration 2 of 3<\/span>/);
  assert.match(html, /<span class="chip chip-waiting">Freeze\?<\/span> <button type="button" class="primary" data-action="freeze">Freeze as Ega<\/button>/);
  assert.match(await roomCard(summary, { projectName: 'p' }), /data-action="room-freeze-name">Freeze…<\/button>/);
  assert.doesNotMatch(await roomCard({ ...summary, waiting: { kind: 'approval' } }, { actor: 'Ega' }), /data-action="freeze"/);
});

test('the room is a labelled modal dialog over the zoomed kitchen with Previous, Next and Close, arrow keys and Esc', async () => {
  const html = await renderComponent('App.svelte');
  assert.match(html, /<div id="room" class="room" role="dialog" aria-modal="true" aria-labelledby="room-title" hidden="">/);
  assert.doesNotMatch(html, /room-scene/, 'no separate room scene: the kitchen camera zooms in');
  assert.ok(html.indexOf('id="room"') > html.indexOf('id="run"') && html.indexOf('id="room"') < html.indexOf('id="details-sheet"'), 'the room overlays the stage');
  assert.match(html, /<button type="button" data-action="room-prev" aria-keyshortcuts="ArrowLeft">← Previous<\/button>/);
  assert.match(html, /<button type="button" data-action="room-next" aria-keyshortcuts="ArrowRight">Next →<\/button>/);
  assert.match(html, /<button type="button" data-action="room-close" aria-keyshortcuts="Escape">Close<\/button>/);
  const room = read('src/components/Room.svelte');
  assert.match(room, /event\.key === 'ArrowRight'/);
  assert.match(room, /event\.key === 'ArrowLeft'/);
  assert.match(room, /trapFocus\(event, root\)/);
  const app = read('src/App.svelte');
  assert.match(app, /stepTarget\(roomTargets\(projects\), selectedId, direction\)/);
  assert.match(app, /await ring\.zoom\('in'\)/);
  const ring = read('src/components/Ring.svelte');
  assert.match(ring, /gl\.update\(next, \{ swap, direction: swap \? direction : 0 \}\)/, 'Previous/Next swap the kitchen');
  assert.match(app, /select\(id, \{ direction \}\)/);
});
