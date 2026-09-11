'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { compileRecipe, validateRecipe } = require('../lib/recipe.js');
const { migrateLegacyRecipe } = require('../lib/recipe-graph.js');
const {
  createLoopGroup,
  removeLoopGroup,
  validateLoopGroups
} = require('../lib/loop-groups.js');

function recipeFixture() {
  const recipe = migrateLegacyRecipe(JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'recipes', 'default.json'),
    'utf8'
  )));
  recipe.id = 'loop-fixture';
  recipe.edges = recipe.edges.filter((edge) => !(edge.from === 'judge' && edge.to === 'delivery'));
  recipe.loopGroups = [{
    id: 'build-loop',
    displayName: 'Build quality',
    nodeIds: ['maker', 'verification', 'review', 'judge'],
    entryNodeId: 'maker',
    decisionNodeId: 'judge',
    repeatTargetId: 'maker',
    exitTargetId: 'delivery-approval',
    maxIterations: 3,
    repeatOutcome: 'ITERATE',
    exitOutcome: 'PASS',
    repeatLabel: 'NO · REVISE',
    exitLabel: 'YES · CONTINUE'
  }];
  return recipe;
}

test('AC-1/2 creates a stable, complete Loop Group from selected nodes', () => {
  const recipe = { ...recipeFixture(), loopGroups: [] };
  const next = createLoopGroup(recipe, recipeFixture().loopGroups[0]);
  assert.equal(next.loopGroups[0].id, 'build-loop');
  assert.equal(recipe.loopGroups.length, 0);
});

test('AC-3 supports multiple independent Loop Groups', () => {
  const recipe = recipeFixture();
  recipe.nodes.splice(5, 0,
    { id: 'review-decision', type: 'decision' },
    { id: 'review-exit', type: 'approval', message: 'Continue?' }
  );
  recipe.edges = recipe.edges.filter((edge) => edge.from !== 'judge');
  recipe.edges.push(
    { id: 'edge-judge-review-decision', from: 'judge', to: 'review-decision' },
    { id: 'edge-review-decision-review-exit', from: 'review-decision', to: 'review-exit' },
    { id: 'edge-review-exit-delivery-approval', from: 'review-exit', to: 'delivery-approval' }
  );
  recipe.loopGroups[0].exitTargetId = 'review-decision';
  recipe.loopGroups.push({
    id: 'review-loop',
    displayName: 'Review loop',
    nodeIds: ['review-decision', 'review-exit'],
    entryNodeId: 'review-decision',
    decisionNodeId: 'review-exit',
    repeatTargetId: 'review-decision',
    exitTargetId: 'delivery-approval',
    maxIterations: 2,
    repeatOutcome: 'NO',
    exitOutcome: 'YES',
    repeatLabel: 'NO · RETRY',
    exitLabel: 'YES · PASS'
  });
  assert.equal(validateLoopGroups(recipe).errors.filter((error) => /belongs to multiple/.test(error)).length, 0);
});

test('AC-4 rejects overlapping membership', () => {
  const recipe = recipeFixture();
  recipe.loopGroups.push({ ...recipe.loopGroups[0], id: 'other-loop' });
  assert.match(validateLoopGroups(recipe).errors.join('\n'), /belongs to multiple Loop Groups/);
});

test('AC-5/6 rejects invalid entry, decision, and boundary paths', () => {
  const recipe = recipeFixture();
  recipe.loopGroups[0].exitTargetId = 'missing';
  recipe.edges.push({ id: 'edge-goal-verification', from: 'goal', to: 'verification' });
  const errors = validateLoopGroups(recipe).errors.join('\n');
  assert.match(errors, /exitTargetId references unknown node/);
  assert.match(errors, /may enter only through maker/);
});

test('AC-7 rejects empty, one-node, and incomplete group definitions', () => {
  const recipe = recipeFixture();
  recipe.loopGroups[0] = { id: 'empty-loop', nodeIds: ['maker'] };
  assert.ok(validateLoopGroups(recipe).errors.length >= 5);
});

test('AC-8 enforces iteration boundaries', () => {
  const recipe = recipeFixture();
  recipe.loopGroups[0].maxIterations = 0;
  assert.match(validateLoopGroups(recipe).errors.join('\n'), /maxIterations/);
  recipe.loopGroups[0].maxIterations = 101;
  assert.match(validateLoopGroups(recipe).errors.join('\n'), /maxIterations/);
});

test('AC-9 keeps outcome polarity explicit', () => {
  const recipe = recipeFixture();
  recipe.loopGroups[0].repeatOutcome = 'YES';
  recipe.loopGroups[0].exitOutcome = 'YES';
  assert.match(validateLoopGroups(recipe).errors.join('\n'), /outcomes must be different/);
});

test('AC-10 bounds connector labels', () => {
  const recipe = recipeFixture();
  recipe.loopGroups[0].repeatLabel = '<script>'.repeat(10);
  assert.match(validateLoopGroups(recipe).errors.join('\n'), /repeatLabel/);
});

test('AC-11 compiles return transitions outside acyclic dependency Edges', () => {
  const plan = compileRecipe(recipeFixture(), { mode: 'ASSISTED' });
  assert.equal(plan.loopGroups[0].repeatTargetId, 'maker');
  assert.ok(plan.nodes.find((node) => node.id === 'maker').dependsOn.includes('goal'));
  assert.ok(!plan.nodes.find((node) => node.id === 'maker').dependsOn.includes('judge'));
});

test('AC-14 removes group semantics without deleting nodes or Edges', () => {
  const recipe = recipeFixture();
  const next = removeLoopGroup(recipe, 'build-loop');
  assert.equal(next.loopGroups.length, 0);
  assert.equal(next.nodes.length, recipe.nodes.length);
  assert.deepEqual(next.edges, recipe.edges);
});

test('AC-24/25 validates custom and built-in Loop Groups', () => {
  assert.equal(validateRecipe(recipeFixture(), { mode: 'ASSISTED' }).valid, true);
  const builtIn = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'recipes', 'default.json'), 'utf8'));
  assert.equal(validateRecipe(builtIn, { mode: 'ASSISTED' }).valid, true);
  assert.equal(compileRecipe(builtIn, { mode: 'ASSISTED' }).loopGroups[0].id, 'engineering-loop');
});
