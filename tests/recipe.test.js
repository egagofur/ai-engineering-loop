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
  migrateLegacyRecipe,
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

test('legacy dependencies migrate in memory to stable edges without changing execution semantics', () => {
  const root = temporaryProject();
  const sourcePath = path.join(__dirname, '..', 'recipes', 'default.json');
  const before = fs.readFileSync(sourcePath, 'utf8');
  const raw = JSON.parse(before);
  const first = loadRecipe(root, 'default').recipe;
  const second = migrateLegacyRecipe(raw);

  assert.ok(first.edges.length > 0);
  assert.deepEqual(first.edges, second.edges);
  assert.ok(first.nodes.every((node) => !Object.hasOwn(node, 'dependsOn')));
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), before);
  assert.deepEqual(
    compileRecipe(first, { mode: 'ASSISTED' }).nodes.map((node) => [node.id, node.dependsOn]),
    compileRecipe(raw, { mode: 'ASSISTED' }).nodes.map((node) => [node.id, node.dependsOn])
  );
  assert.equal(
    compileRecipe(first, { mode: 'ASSISTED' }).graphHash,
    compileRecipe(raw, { mode: 'ASSISTED' }).graphHash
  );
});

test('first-class edges validate ids, endpoints, duplicate connections, limits, and safety order', () => {
  const recipe = defaultRecipe();
  assert.equal(validateRecipe(recipe, { mode: 'ASSISTED' }).valid, true);
  recipe.edges.push({ id: recipe.edges[0].id, from: 'goal', to: 'maker' });
  recipe.edges.push({ id: 'unknown-edge', from: 'missing', to: 'maker' });
  const result = validateRecipe(recipe, { mode: 'ASSISTED' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('duplicate edge id')));
  assert.ok(result.errors.some((error) => error.includes('duplicate edge connection')));
  assert.ok(result.errors.some((error) => error.includes('unknown from node missing')));
});

test('custom prompt agents require bounded explicit authority and secret references only', () => {
  const recipe = defaultRecipe();
  recipe.nodes.splice(1, 0, {
    id: 'triage-agent',
    type: 'agent',
    displayName: 'Triage agent',
    prompt: 'Inspect the supplied artifacts and summarize the defect.',
    capabilityRefs: ['repository-read', 'artifact-read'],
    mcpRefs: ['issue-tracker'],
    inputArtifacts: ['goal-contract'],
    outputArtifacts: [{ artifact: 'triage', schema: 'schemas/triage.schema.json' }],
    tokenLimit: 2000,
    timeoutMs: 60000,
    retry: { maxAttempts: 2, backoffMs: 1000 }
  });
  recipe.edges.push({ id: 'edge-goal-triage', from: 'goal', to: 'triage-agent' });
  const makerEdge = recipe.edges.find((edge) => edge.to === 'maker');
  makerEdge.from = 'triage-agent';
  assert.equal(validateRecipe(recipe, { mode: 'ASSISTED' }).valid, true);
  const compiled = compileRecipe(recipe, { mode: 'ASSISTED' });
  const custom = compiled.nodes.find((node) => node.id === 'triage-agent');
  assert.deepEqual(custom.output, { artifact: 'triage', schema: 'schemas/triage.schema.json' });
  assert.equal(custom.context.maxTokens, 2000);

  recipe.nodes.find((node) => node.id === 'triage-agent').capabilityRefs = ['arbitrary-shell'];
  recipe.nodes.find((node) => node.id === 'triage-agent').configuration = {
    credentials: { secretValue: 'plaintext' }
  };
  const denied = validateRecipe(recipe, { mode: 'ASSISTED' });
  assert.equal(denied.valid, false);
  assert.ok(denied.errors.some((error) => error.includes('capabilityRefs')));
  assert.ok(denied.errors.some((error) => error.includes('secret values')));
});

test('recipe validation rejects cycles and unknown dependencies', () => {
  const recipe = defaultRecipe();
  recipe.edges.push({ id: 'cycle-edge', from: 'delivery', to: 'goal' });
  recipe.edges.push({ id: 'missing-edge', from: 'missing', to: 'maker' });
  const result = validateRecipe(recipe, { mode: 'ASSISTED' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('recipe graph contains a dependency cycle'));
  assert.ok(result.errors.includes('missing-edge references unknown from node missing'));
});

test('REPORT_ONLY rejects mutation and side-effect nodes', () => {
  const recipe = loadRecipe(temporaryProject(), 'audit').recipe;
  recipe.nodes.splice(-1, 0, {
    id: 'maker',
    type: 'maker'
  });
  recipe.edges.push({ id: 'analysis-maker', from: 'repository-analysis', to: 'maker' });
  recipe.edges.find((edge) => edge.to === 'report').from = 'maker';
  const result = validateRecipe(recipe, { mode: 'REPORT_ONLY' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('REPORT_ONLY cannot contain mutation nodes'));
});

test('REPORT_ONLY conservatively treats command nodes as mutation-capable', () => {
  const recipe = loadRecipe(temporaryProject(), 'audit').recipe;
  recipe.nodes.splice(-1, 0, {
    id: 'repository-command',
    type: 'command',
    command: { executable: 'npm', args: ['test'] },
    timeoutMs: 1000,
    expectedExitCodes: [0]
  });
  recipe.edges.push({ id: 'analysis-command', from: 'repository-analysis', to: 'repository-command' });
  recipe.edges.find((edge) => edge.to === 'report').from = 'repository-command';
  const result = validateRecipe(recipe, { mode: 'REPORT_ONLY' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('REPORT_ONLY cannot contain mutation nodes'));
});

test('mutation recipes require the complete ordered safety backbone', () => {
  const recipe = defaultRecipe();
  recipe.nodes = recipe.nodes.filter((node) => node.type !== 'devil-advocate');
  recipe.edges = recipe.edges.filter((edge) => edge.from !== 'review' && edge.to !== 'review');
  recipe.edges.push({ id: 'verification-judge', from: 'verification', to: 'judge' });
  const result = validateRecipe(recipe, { mode: 'UNATTENDED' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('devil-advocate node is required for UNATTENDED'));
});

test('ASSISTED requires approval between judge and delivery', () => {
  const recipe = defaultRecipe();
  recipe.nodes = recipe.nodes.filter((node) => node.type !== 'approval');
  recipe.edges = recipe.edges.filter((edge) => edge.from !== 'approval' && edge.to !== 'approval');
  recipe.edges.find((edge) => edge.to === 'delivery').from = 'judge';
  const result = validateRecipe(recipe, { mode: 'ASSISTED' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('ASSISTED requires a human approval node'));
});

test('command and agent nodes reject unsafe execution and schema paths', () => {
  const recipe = defaultRecipe();
  recipe.nodes.splice(1, 0, {
    id: 'unsafe-command',
    type: 'command',
    command: { executable: 'bash', args: ['-c', 'rm -rf .'] },
    timeoutMs: 1000,
    expectedExitCodes: [0]
  });
  recipe.edges.push({ id: 'goal-unsafe-command', from: 'goal', to: 'unsafe-command' });
  recipe.edges.find((edge) => edge.to === 'maker').from = 'unsafe-command';
  recipe.nodes.splice(1, 0, {
    id: 'unsafe-agent',
    type: 'agent',
    role: 'analyst',
    context: { maxFiles: 1, maxTokens: 100 },
    output: { artifact: 'analysis', schema: '../private.json' }
  });
  recipe.edges.push({ id: 'goal-unsafe-agent', from: 'goal', to: 'unsafe-agent' });
  recipe.edges.push({ id: 'agent-unsafe-command', from: 'unsafe-agent', to: 'unsafe-command' });
  const result = validateRecipe(recipe, { mode: 'UNATTENDED' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('cannot be a shell or interpreter')));
  assert.ok(result.errors.some((error) => error.includes('must be repository-relative')));
});

test('terminal nodes must be graph sinks and all nodes must reach one', () => {
  const recipe = defaultRecipe();
  recipe.nodes.push({
    id: 'after-delivery',
    type: 'artifact-check'
  });
  recipe.edges.push({ id: 'after-delivery-edge', from: 'delivery', to: 'after-delivery' });
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
