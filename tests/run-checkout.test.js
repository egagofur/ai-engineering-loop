'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createStudioRun } = require('../lib/studio-runtime.js');
const {
  duplicateRunAsRecipe,
  runCheckout,
  runNodeIo,
  studioAgentHandoff
} = require('../lib/run-checkout.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-checkout-'));
  const run = createStudioRun(root, {
    task: 'Improve the checkout experience',
    constraints: 'Keep historical runs immutable',
    recipeId: 'default',
    now: new Date('2026-09-10T19:00:00Z')
  });
  return { root, run };
}

test('Run checkout reconstructs immutable nodes, edges, honest states, and fallback positions', () => {
  const { root, run } = fixture();
  const statePath = path.join(root, '.ai-engineering-loop', 'runs', run.runId, 'state.json');
  const before = fs.readFileSync(statePath, 'utf8');
  const checkout = runCheckout(root, run.runId);
  assert.ok(checkout.nodes.length > 1);
  assert.ok(checkout.edges.length > 0);
  assert.ok(checkout.nodes.every((node) => node.status !== 'PASSED'));
  assert.ok(checkout.nodes.every((node) => Number.isFinite(node.position.x)));
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
});

test('Node I/O exposes root input and verified node timeline without manufacturing output', () => {
  const { root, run } = fixture();
  const checkout = runCheckout(root, run.runId);
  const rootNode = checkout.nodes.find((node) => checkout.edges.every((edge) => edge.to !== node.id));
  const io = runNodeIo(root, run.runId, rootNode.id);
  assert.equal(io.input.task, 'Improve the checkout experience');
  assert.equal(io.input.constraints, 'Keep historical runs immutable');
  assert.equal(io.output.status, rootNode.status);
  assert.equal(io.output.artifact, null);
  assert.ok(io.timeline.some((event) => event.type === 'WORKFLOW_CREATED'));
});

test('Run duplication and agent handoff keep technical Run identity separate', () => {
  const { root, run } = fixture();
  const preview = duplicateRunAsRecipe(root, run.runId, { recipeId: 'checkout-copy' });
  assert.equal(preview.recipe.id, 'checkout-copy');
  assert.ok(preview.recipe.edges.length > 0);
  assert.doesNotMatch(JSON.stringify(preview.recipe), new RegExp(run.runId));
  const handoff = studioAgentHandoff(root, run.runId);
  assert.equal(handoff.externalDispatch, false);
  assert.match(handoff.prompt, new RegExp(run.runId));
  assert.match(handoff.commands.question, /interaction question/);
});
