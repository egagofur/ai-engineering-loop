'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  cloneRecipe,
  diffRecipes,
  inspectRecipe,
  installRecipe,
  recipeCatalog
} = require('../lib/recipe-builder.js');
const { loadRecipe } = require('../lib/recipe.js');

function project() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-builder-'));
}

test('clone scaffolds a valid project recipe without mutating the preset', () => {
  const root = project();
  const result = cloneRecipe(root, 'bugfix', 'api-bugfix');
  assert.equal(result.recipe.id, 'api-bugfix');
  assert.equal(result.recipe.version, 1);
  assert.equal(loadRecipe(root, 'api-bugfix').source, 'project');
  assert.equal(loadRecipe(root, 'bugfix').source, 'builtin');
  assert.throws(() => cloneRecipe(root, 'audit', 'api-bugfix'), { code: 'RECIPE_EXISTS' });
  assert.throws(() => cloneRecipe(root, 'audit', 'default'), { code: 'RESERVED_RECIPE_ID' });
});

test('install validates, requires explicit replacement, increments version, and saves history', () => {
  const root = project();
  cloneRecipe(root, 'audit', 'security-audit');
  const candidate = loadRecipe(root, 'security-audit').recipe;
  candidate.version = 2;
  candidate.description = 'Versioned security audit.';
  const candidatePath = path.join(root, 'candidate.json');
  fs.writeFileSync(candidatePath, JSON.stringify(candidate));
  assert.throws(() => installRecipe(root, 'candidate.json'), { code: 'RECIPE_EXISTS' });
  const installed = installRecipe(root, 'candidate.json', { replace: true });
  assert.equal(installed.replacedVersion, 1);
  assert.equal(loadRecipe(root, 'security-audit').recipe.version, 2);
  assert.equal(
    fs.existsSync(path.join(root, '.ai-engineering-loop/recipes/.history/security-audit/1.json')),
    true
  );
  assert.throws(
    () => installRecipe(root, 'candidate.json', { replace: true }),
    { code: 'RECIPE_VERSION_NOT_INCREMENTED' }
  );
});

test('install rejects candidates outside repository and invalid safety graphs', () => {
  const root = project();
  const outside = path.join(project(), 'outside.json');
  fs.writeFileSync(outside, '{}');
  assert.throws(() => installRecipe(root, outside), { code: 'UNSAFE_RECIPE_PATH' });
  const invalid = loadRecipe(root, 'default').recipe;
  invalid.id = 'unsafe-flow';
  invalid.nodes = invalid.nodes.filter((node) => node.type !== 'judge');
  const candidate = path.join(root, 'unsafe.json');
  fs.writeFileSync(candidate, JSON.stringify(invalid));
  assert.throws(() => installRecipe(root, 'unsafe.json'), { code: 'INVALID_RECIPE' });
});

test('catalog, inspect, and diff provide stable machine-readable authoring data', () => {
  const root = project();
  cloneRecipe(root, 'bugfix', 'custom-bugfix');
  const catalog = recipeCatalog();
  assert.ok(catalog.some((node) => node.type === 'command' && node.executable === false));
  const inspection = inspectRecipe(root, 'custom-bugfix');
  assert.equal(inspection.source, 'project');
  assert.ok(inspection.modes.every((mode) => /^[a-f0-9]{64}$/.test(mode.graphHash)));
  const diff = diffRecipes(root, 'bugfix', 'custom-bugfix');
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.changed, []);
  assert.equal(diff.metadataChanged, true);
});
