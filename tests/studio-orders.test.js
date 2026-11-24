'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const studio = path.join(__dirname, '..', 'studio');
const load = (name) => import(pathToFileURL(path.join(studio, 'js', name)).href);
const { renderComponent } = require('./helpers/svelte.js');
const renderOrders = (runs, { projectName = '', loading = false, error = null } = {}) => renderComponent('components/OrderBook.svelte', { runs, projectName, loading, error });

test('order outcomes read the last Judge verdict before the Run state', async () => {
  const { orderOutcome, orderSummary } = await load('orders.js');
  assert.equal(orderOutcome({ state: 'JUDGED_PASS', verdict: 'PASS' }), 'passed');
  assert.equal(orderOutcome({ state: 'REPORTED', verdict: null }), 'done');
  assert.equal(orderOutcome({ state: 'MAKER_DONE', verdict: 'ITERATE' }), 'back');
  assert.equal(orderOutcome({ state: 'STARTED', verdict: null }), 'cooking');
  assert.equal(orderOutcome({ state: 'ESCALATED', verdict: 'ITERATE' }), 'escalated');
  assert.equal(orderOutcome({ state: 'CANCELLED', verdict: 'PASS' }), 'cancelled');
  assert.equal(orderSummary([{ state: 'STARTED' }, { verdict: 'PASS' }, { verdict: 'PASS' }]), '1 cooking · 2 passed');
});

test('the order book escapes tasks, marks the current Run and shows empty, loading and error states', async () => {
  const html = await renderOrders([
    { runId: 'b', task: '<img src=x>', state: 'STARTED', verdict: null, current: true, iteration: 2, elapsedMs: 3 * 60_000 },
    { runId: 'a', task: 'old', state: 'REPORTED', verdict: 'PASS', current: false, iteration: 1, elapsedMs: 0 }
  ], { projectName: 'shop' });
  assert.match(html, /&lt;img src=x>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<li class="order" data-outcome="cooking" aria-current="true">/);
  assert.match(html, /<span class="order-now">On the pass now<\/span> · iteration 2 · 3m ago/);
  assert.match(html, /<span class="order-no" aria-hidden="true">No. 2<\/span>/);
  assert.match(html, /<span class="order-stamp" title="Cooking">Cooking<\/span>/);
  assert.match(html, /class="page page-left"[\s\S]*class="page page-right"/);
  assert.match(html, /data-outcome="passed"/);
  assert.match(html, /1 cooking · 1 passed/);
  assert.match(await renderOrders([]), /No orders written yet/);
  assert.match(await renderOrders([], { loading: true }), /Leafing through the pages/);
  assert.match(await renderOrders([], { error: '<b>' }), /&lt;b>/);
});

test('crew are the other unfinished Runs of the selected project, worktrees included', async () => {
  const { crewRuns, crewLabel } = await load('orders.js');
  const projects = [{
    id: 'p1',
    run: { state: 'STARTED', stage: 'maker', task: 'main' },
    worktreeRuns: [
      { worktreeId: 'w1', state: 'MAKER_DONE', stage: 'review', task: 'wt one' },
      { worktreeId: 'w2', state: 'REPORTED', stage: null, task: 'finished' },
      { worktreeId: 'w3', state: 'STARTED', stage: 'goal', task: '', waiting: { kind: 'freeze' } }
    ]
  }, { id: 'p2', run: { state: 'STARTED' }, worktreeRuns: [] }];
  assert.deepEqual(crewRuns(projects, 'p1').map((entry) => entry.id), ['w1', 'w3']);
  assert.deepEqual(crewRuns(projects, 'w1').map((entry) => entry.id), ['p1', 'w3']);
  assert.deepEqual(crewRuns(projects, 'nope'), []);
  assert.equal(crewLabel(projects[0].worktreeRuns[0]), 'wt one · Review');
  assert.equal(crewLabel(projects[0].worktreeRuns[2]), 'Another order · Freeze?');
});

test('each extra chef gets its own spot on the back line behind its station, up to five', async () => {
  const { crewSlots, stationCrowd, stationX, MAX_CREW, BACK_LINE_OFFSETS } = await load('kitchen.js');
  assert.equal(MAX_CREW, 5);
  const slots = crewSlots(['maker', 'maker', 'maker', 'review', 'goal', 'judge']);
  assert.equal(slots.length, 5);
  assert.deepEqual(slots.slice(0, 3).map((slot) => slot.x), BACK_LINE_OFFSETS.slice(0, 3).map((offset) => stationX('maker') + offset));
  assert.equal(slots[3].x, stationX('review') + BACK_LINE_OFFSETS[0]);
  assert.equal(new Set(slots.map((slot) => slot.x)).size, 5, 'no two chefs share a spot');
  assert.ok(BACK_LINE_OFFSETS.slice(0, 3).every((offset) => Math.abs(offset) < 1.05), 'spots stay inside the station');
  assert.deepEqual(stationCrowd('maker', ['maker', 'maker', 'review']), { maker: 3, review: 1 });
});

test('the order book lists live worktree Runs first, without repeating Runs already in the history', async () => {
  const { withLiveOrders } = await load('orders.js');
  const merged = withLiveOrders([{ runId: 'main', task: 'main', state: 'STARTED' }], [
    { id: 'w1', run: { runId: 'wt', worktreeId: 'w1', task: 'wt task', state: 'VERIFIED', iteration: 2 } },
    { id: 'p1', run: { runId: 'main', task: 'main', state: 'STARTED' } }
  ]);
  assert.deepEqual(merged.map((run) => run.runId), ['wt', 'main']);
  assert.equal(merged[0].worktree, true);
  assert.match(await renderOrders(merged), /worktree · iteration 2/);
  assert.deepEqual(withLiveOrders(null, null), []);
});

test('the brigade works inside: each extra chef has its own steel island in the back kitchen, seen through the pass window', async () => {
  const { WORKSTATION, workstationTop } = await load('workstation.js');
  const { BACK_LINE_OFFSETS, stationX } = await load('kitchen.js');
  const { PASS_WINDOW, BACKROOM_Z, WALL_Z } = await load('stations.js');
  const spots = BACK_LINE_OFFSETS.slice(0, 3).sort((a, b) => a - b);
  assert.ok(spots[1] - spots[0] >= WORKSTATION.width, 'islands never overlap');
  assert.ok(WORKSTATION.z < WALL_Z && WORKSTATION.z > BACKROOM_Z, 'islands stand in the back kitchen');
  for (const stage of ['goal', 'deliver']) {
    for (const offset of BACK_LINE_OFFSETS) {
      const x = stationX(stage) + offset;
      assert.ok(x - WORKSTATION.width / 2 > PASS_WINDOW.left - 0.4 && x + WORKSTATION.width / 2 < PASS_WINDOW.right + 0.4, 'every island shows through the window');
    }
  }
  assert.ok(WORKSTATION.top < PASS_WINDOW.bottom, 'the chef stands low enough to be seen through the opening');
  assert.equal(workstationTop('maker'), 'hob');
  assert.equal(workstationTop('verify'), 'board');
});
