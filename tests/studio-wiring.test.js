'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createStudioServer } = require('../lib/studio-server.js');
const { validateRecipe } = require('../lib/recipe.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-wiring-'));
}

async function withServer(operation) {
  const root = tempRepo();
  const instance = createStudioServer(root, { token: 'wiring-token', watch: false, pollMs: 10_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = instance.server.address();
    await operation(`http://127.0.0.1:${port}`, instance.token, root);
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
}

function stripDependsOn(recipe) {
  const next = structuredClone(recipe);
  next.nodes.forEach((node) => delete node.dependsOn);
  return next;
}

function dropEdge(recipe, from, to) {
  const next = stripDependsOn(recipe);
  next.edges = next.edges.filter((edge) => !(edge.from === from && edge.to === to));
  return next;
}

function addEdge(recipe, from, to) {
  const next = stripDependsOn(recipe);
  next.edges = [
    ...next.edges,
    { id: `edge-${from}-${to}-extra`, from, to }
  ];
  return next;
}

test('AC9 Wiring changes call /api/validate; backbone breaks are named compiler errors and cannot be saved', async () => {
  await withServer(async (base, token) => {
    const headers = { 'x-ael-studio-token': token, 'content-type': 'application/json' };
    const loaded = await (await fetch(`${base}/api/recipe?id=default`, { headers })).json();
    const recipe = loaded.recipe;
    const rows = [
      ['delivery-approval', 'delivery', 'delivery must depend on ASSISTED approval'],
      ['judge', 'delivery-approval', 'ASSISTED requires a human approval node'],
      ['maker', 'verification', 'verification must depend on maker'],
      ['goal', 'maker', 'maker must depend on goal-contract'],
      ['verification', 'review', 'devil-advocate must depend on verification'],
      ['review', 'judge', 'judge must depend on devil-advocate']
    ];
    for (const [from, to, named] of rows) {
      const broken = dropEdge(recipe, from, to);
      const compiler = validateRecipe(broken);
      assert.equal(compiler.valid, false, named);
      assert.ok(compiler.errors.includes(named), `${named} — got ${compiler.errors.join('; ')}`);
      const validated = await fetch(`${base}/api/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ recipe: broken, baseRecipeId: 'default' })
      });
      assert.equal(validated.status, 422);
      const body = await validated.json();
      assert.equal(body.ok, false);
      assert.ok(body.validation.errors.includes(named), `${named} missing from ${body.validation.errors.join('; ')}`);
      const installed = await fetch(`${base}/api/install`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ recipe: { ...broken, id: 'broken-local' }, baseRecipeId: 'default' })
      });
      assert.equal(installed.status, 400);
      const failure = await installed.json();
      assert.equal(failure.code, 'INVALID_RECIPE');
      assert.ok(
        (failure.details || []).includes(named) || String(failure.error).includes('invalid'),
        `install must reject ${named}`
      );
    }

    const valid = addEdge(recipe, 'maker', 'review');
    valid.id = 'wired-local';
    valid.version = 1;
    const ok = await fetch(`${base}/api/validate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ recipe: valid, baseRecipeId: 'default' })
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);
    const saved = await fetch(`${base}/api/install`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ recipe: valid, baseRecipeId: 'default' })
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).id, 'wired-local');
  });
});

test('AC8/AC9 Studio install rejects node-set changes with STUDIO_STRUCTURE_READ_ONLY', async () => {
  await withServer(async (base, token) => {
    const headers = { 'x-ael-studio-token': token, 'content-type': 'application/json' };
    const loaded = await (await fetch(`${base}/api/recipe?id=default`, { headers })).json();
    const recipe = stripDependsOn(loaded.recipe);

    async function post(pathname, candidate) {
      return fetch(`${base}${pathname}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          recipe: candidate,
          baseRecipeId: 'default'
        })
      });
    }

    async function assertStructureRejected(candidate, field, nodeId) {
      for (const pathname of ['/api/install', '/api/validate']) {
        const response = await post(pathname, candidate);
        assert.equal(response.status, 400, `${pathname} ${field} ${nodeId}`);
        const body = await response.json();
        assert.equal(body.code, 'STUDIO_STRUCTURE_READ_ONLY');
        assert.ok(
          (body[field] || []).includes(nodeId) || (body.details?.[field] || []).includes(nodeId),
          `${pathname} ${field} should list ${nodeId}: ${JSON.stringify(body)}`
        );
      }
    }

    const added = structuredClone(recipe);
    added.id = 'default-local';
    added.version = 1;
    added.nodes.push({ id: 'extra-agent', type: 'agent', role: 'maker', prompt: 'do extra work' });
    await assertStructureRejected(added, 'added', 'extra-agent');

    const removed = structuredClone(recipe);
    removed.id = 'default-local';
    removed.version = 1;
    removed.nodes = removed.nodes.filter((node) => node.id !== 'review');
    await assertStructureRejected(removed, 'removed', 'review');

    const typed = structuredClone(recipe);
    typed.id = 'default-local';
    typed.version = 1;
    typed.nodes.find((node) => node.id === 'maker').type = 'agent';
    await assertStructureRejected(typed, 'changed', 'maker');

    const prompted = structuredClone(recipe);
    prompted.id = 'default-local';
    prompted.version = 1;
    prompted.nodes.find((node) => node.id === 'maker').prompt = 'rewritten maker prompt';
    await assertStructureRejected(prompted, 'changed', 'maker');

    const roled = structuredClone(recipe);
    roled.id = 'default-local';
    roled.version = 1;
    roled.nodes.find((node) => node.id === 'maker').role = 'custom';
    await assertStructureRejected(roled, 'changed', 'maker');

    const valid = addEdge(recipe, 'maker', 'review');
    valid.id = 'default-local';
    valid.version = 1;
    valid.nodes.forEach((node) => { node.displayName = node.id; });
    const validated = await post('/api/validate', valid);
    assert.equal(validated.status, 200);
    assert.equal((await validated.json()).ok, true);
    const saved = await post('/api/install', valid);
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).id, 'default-local');
  });
});
