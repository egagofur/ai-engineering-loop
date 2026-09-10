'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  compileRecipe,
  listRecipes,
  loadRecipe,
  validateRecipe
} = require('../lib/recipe.js');

function temporaryProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-recipe-'));
}

function defaultRecipe() {
  return loadRecipe(temporaryProject(), 'default').recipe;
}

test('all built-in recipes validate in every declared mode', () => {
  const root = temporaryProject();
  const recipes = listRecipes(root);
  assert.deepEqual(
    recipes,
    ['audit', 'bugfix', 'default', 'docs-light', 'high-risk', 'refactor']
      .map((id) => ({ id, source: 'builtin' }))
  );
  for (const { id } of recipes) {
    const { recipe } = loadRecipe(root, id);
    for (const mode of recipe.compatibleModes) {
      assert.deepEqual(validateRecipe(recipe, { mode }).errors, [], `${id} (${mode})`);
    }
  }
});

test('default recipe compiles to the legacy safety gates deterministically', () => {
  const recipe = defaultRecipe();
  const first = compileRecipe(recipe, { mode: 'ASSISTED' });
  const second = compileRecipe(JSON.parse(JSON.stringify(recipe)), { mode: 'ASSISTED' });
  assert.equal(first.graphHash, second.graphHash);
  assert.deepEqual(
    first.nodes.filter((node) => node.legacyGate).map((node) => node.legacyGate),
    ['goal', 'maker', 'verification', 'review', 'judge', 'delivery']
  );
});

test('recipe validation rejects cycles and unknown dependencies', () => {
  const recipe = defaultRecipe();
  recipe.nodes.find((node) => node.id === 'goal').dependsOn = ['delivery'];
  recipe.nodes.find((node) => node.id === 'maker').dependsOn.push('missing');
  const result = validateRecipe(recipe, { mode: 'ASSISTED' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('recipe graph contains a dependency cycle'));
  assert.ok(result.errors.includes('maker depends on unknown node missing'));
});

test('REPORT_ONLY rejects mutation and side-effect nodes', () => {
  const recipe = loadRecipe(temporaryProject(), 'audit').recipe;
  recipe.nodes.splice(-1, 0, {
    id: 'maker',
    type: 'maker',
    dependsOn: ['repository-analysis']
  });
  recipe.nodes.find((node) => node.id === 'report').dependsOn = ['maker'];
  const result = validateRecipe(recipe, { mode: 'REPORT_ONLY' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('REPORT_ONLY cannot contain mutation nodes'));
});

test('mutation recipes require the complete ordered safety backbone', () => {
  const recipe = defaultRecipe();
  recipe.nodes = recipe.nodes.filter((node) => node.type !== 'devil-advocate');
  recipe.nodes.find((node) => node.id === 'judge').dependsOn = ['verification'];
  const result = validateRecipe(recipe, { mode: 'UNATTENDED' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('devil-advocate node is required for UNATTENDED'));
});

test('ASSISTED requires approval between judge and delivery', () => {
  const recipe = defaultRecipe();
  recipe.nodes = recipe.nodes.filter((node) => node.type !== 'approval');
  recipe.nodes.find((node) => node.id === 'delivery').dependsOn = ['judge'];
  const result = validateRecipe(recipe, { mode: 'ASSISTED' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('ASSISTED requires a human approval node'));
});

test('command and agent nodes reject unsafe execution and schema paths', () => {
  const recipe = defaultRecipe();
  recipe.nodes.splice(1, 0, {
    id: 'unsafe-command',
    type: 'command',
    dependsOn: ['goal'],
    command: { executable: 'bash', args: ['-c', 'rm -rf .'] },
    timeoutMs: 1000,
    expectedExitCodes: [0]
  });
  recipe.nodes.find((node) => node.id === 'maker').dependsOn = ['unsafe-command'];
  recipe.nodes.splice(1, 0, {
    id: 'unsafe-agent',
    type: 'agent',
    dependsOn: ['goal'],
    role: 'analyst',
    context: { maxFiles: 1, maxTokens: 100 },
    output: { artifact: 'analysis', schema: '../private.json' }
  });
  recipe.nodes.find((node) => node.id === 'unsafe-command').dependsOn.push('unsafe-agent');
  const result = validateRecipe(recipe, { mode: 'UNATTENDED' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('cannot be a shell or interpreter')));
  assert.ok(result.errors.some((error) => error.includes('must be repository-relative')));
});

test('terminal nodes must be graph sinks and all nodes must reach one', () => {
  const recipe = defaultRecipe();
  recipe.nodes.push({
    id: 'after-delivery',
    type: 'artifact-check',
    dependsOn: ['delivery']
  });
  const result = validateRecipe(recipe, { mode: 'UNATTENDED' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('delivery must be a terminal node'));
  assert.ok(result.errors.includes('after-delivery must lead to a report or delivery terminal'));
});

test('built-in recipes cannot be shadowed by project recipes', () => {
  const root = temporaryProject();
  const directory = path.join(root, '.ai-engineering-loop', 'recipes');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'default.json'), '{"id":"shadow"}');
  const loaded = loadRecipe(root, 'default');
  assert.equal(loaded.source, 'builtin');
  assert.equal(loaded.recipe.schemaVersion, 1);
});

test('project recipe directories and files cannot be symlinks', { skip: process.platform === 'win32' }, () => {
  const root = temporaryProject();
  const outside = temporaryProject();
  const parent = path.join(root, '.ai-engineering-loop');
  fs.mkdirSync(parent, { recursive: true });
  fs.symlinkSync(outside, path.join(parent, 'recipes'));
  assert.throws(() => listRecipes(root), { code: 'UNSAFE_RECIPE_PATH' });
  assert.throws(() => loadRecipe(root, 'outside'), { code: 'UNSAFE_RECIPE_PATH' });
});
