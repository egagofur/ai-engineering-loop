'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { flowProblems, transitionTable, flowCounts, diagramOptions, flowActors } = require('../lib/flow.js');
const { validateGoalContract } = require('../lib/gates.js');

const acIds = ['AC-1', 'AC-2'];
const goal = (extra = {}) => ({
  objective: 'Cancel orders',
  acceptanceCriteria: [{ id: 'AC-1' }, { id: 'AC-2' }],
  flow: [
    { from: 'Paid', event: 'process', to: 'Processing' },
    { from: 'Processing', event: 'cancel', to: 'Cancelled', guard: 'not shipped', effects: [{ text: 'refund', ac: 'AC-2' }, { text: 'points?' }] },
    { from: 'Processing', event: 'ship', to: 'Shipped' },
    { from: 'Shipped', event: 'cancel', to: 'Cancelled', hotspot: 'allowed after shipping?' }
  ],
  ...extra
});

test('C-27 plain three-field steps stay valid', () => {
  assert.deepStrictEqual(flowProblems([{ from: 'A', event: 'go', to: 'B' }]), []);
});

test('C-27 rejects unknown AC ids, oversize flows, bad hotspots and unknown forbidden pairs', () => {
  assert.match(flowProblems([{ from: 'A', event: 'go', to: 'B', effects: [{ text: 'x', ac: 'AC-9' }] }], { acIds }).join(), /AC-9/);
  const big = Array.from({ length: 41 }, (_, i) => ({ from: `S${i}`, event: 'go', to: `S${i + 1}` }));
  assert.match(flowProblems(big).join(), /at most 40/);
  const effects = Array.from({ length: 13 }, (_, i) => ({ text: `e${i}` }));
  assert.match(flowProblems([{ from: 'A', event: 'go', to: 'B', effects }]).join(), /at most 12/);
  assert.match(flowProblems([{ from: 'A', event: 'go', to: 'B', hotspot: 5 }]).join(), /hotspot/);
  assert.match(flowProblems([{ from: 'A', event: 'go', to: 'B', effects: [{}] }]).join(), /text/);
  assert.match(flowProblems([{ from: 'A', event: 'go', to: 'B' }], { forbidden: [{ from: 'Z', event: 'go' }] }).join(), /Z/);
  assert.match(flowProblems([{ from: 'A', event: 'go', to: 'B' }], { forbidden: [{ from: 'A', event: 'fly' }] }).join(), /fly/);
});

test('C-27 the Goal gate applies the AC and forbidden checks', () => {
  const contract = goal({ forbiddenTransitions: [{ from: 'Nowhere', event: 'cancel' }] });
  const result = validateGoalContract(contract);
  assert.strictEqual(result.valid, false);
  assert.match(result.errors.join(), /Nowhere/);
});

test('C-27 transition table marks target, guarded targets, conflict, invalid and undecided cells', () => {
  const g = goal({
    flow: [
      ...goal().flow,
      { from: 'Paid', event: 'cancel', to: 'Cancelled', guard: 'paid by card' },
      { from: 'Paid', event: 'cancel', to: 'Refunding', guard: 'paid by wallet' },
      { from: 'Processing', event: 'process', to: 'Processing' },
      { from: 'Processing', event: 'process', to: 'Paid' }
    ],
    forbiddenTransitions: [{ from: 'Shipped', event: 'ship' }]
  });
  const table = transitionTable(g);
  const row = (state) => table.rows.find((item) => item.state === state).cells;
  assert.deepStrictEqual(table.events, ['process', 'cancel', 'ship']);
  assert.strictEqual(row('Paid').process.kind, 'target');
  assert.strictEqual(row('Paid').cancel.kind, 'targets');
  assert.strictEqual(row('Paid').ship.kind, 'undecided');
  assert.strictEqual(row('Processing').process.kind, 'conflict');
  assert.strictEqual(row('Shipped').ship.kind, 'invalid');
  assert.deepStrictEqual(table.endStates.sort(), ['Cancelled', 'Refunding']);
});

test('C-27 counts undecided cells, hotspots and side effects', () => {
  assert.deepStrictEqual(flowCounts(goal()), { undecided: 5, hotspots: 1, sideEffects: 1 });
});

test('C-27 diagram options follow the flow and the project preference', () => {
  const recommended = (g, pref) => diagramOptions(g, { preference: pref }).filter((o) => o.recommended).map((o) => o.view);
  assert.deepStrictEqual(diagramOptions(goal()).map((o) => o.view).sort(), ['lanes', 'state', 'storyboard']);
  assert.deepStrictEqual(recommended(goal()), ['storyboard']);
  assert.deepStrictEqual(recommended(goal({ flowSubject: 'order' })), ['state', 'storyboard']);
  const lanes = goal({ flow: [{ from: 'A', event: 'tap', to: 'B', actor: 'user' }, { from: 'B', event: 'nightly', to: 'C', actor: 'cron' }] });
  assert.deepStrictEqual(recommended(lanes), ['lanes']);
  assert.deepStrictEqual(recommended(goal({ flowSubject: 'order' }), 'lanes'), ['lanes']);
  assert.deepStrictEqual(diagramOptions(goal(), { preference: 'off' }), []);
  assert.deepStrictEqual(diagramOptions({ objective: 'x' }), []);
  assert.strictEqual(diagramOptions(goal())[0].recommended, true);
});

test('C-27 actors default to user', () => {
  assert.deepStrictEqual(flowActors([{ from: 'A', event: 'x', to: 'B' }, { from: 'B', event: 'y', to: 'C', actor: 'db' }]), ['user', 'db']);
});
