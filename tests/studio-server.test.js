'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createStudioServer } = require('../lib/studio-server.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-'));
}

async function withServer(operation) {
  const root = tempRepo();
  const instance = createStudioServer(root, { token: 'fixed-test-token' });
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

test('Studio requires a token and establishes an HttpOnly localhost session', async () => {
  await withServer(async (base, token) => {
    const unauthorized = await fetch(`${base}/api/bootstrap`);
    assert.equal(unauthorized.status, 401);

    const login = await fetch(`${base}/?token=${token}`, { redirect: 'manual' });
    assert.equal(login.status, 302);
    assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);

    const cookie = login.headers.get('set-cookie').split(';')[0];
    const bootstrap = await fetch(`${base}/api/bootstrap`, { headers: { cookie } });
    assert.equal(bootstrap.status, 200);
    assert.match(bootstrap.headers.get('content-security-policy'), /default-src 'self'/);
    const body = await bootstrap.json();
    assert.equal(body.ok, true);
    assert.ok(body.recipes.some((recipe) => recipe.id === 'default'));
    assert.deepEqual(body.adapters.types, ['standard', 'github', 'gitlab', 'dot']);
  });
});

test('Studio rejects hostile Host headers before token authentication', async () => {
  await withServer(async (base, token) => {
    const target = new URL(base);
    const status = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: target.hostname,
        port: target.port,
        path: '/api/bootstrap',
        headers: { host: 'attacker.example', 'x-ael-studio-token': token }
      }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(status, 403);
  });
});

test('Studio stores private canvas layout separately from recipe semantics', async () => {
  await withServer(async (base, token, root) => {
    const headers = { 'x-ael-studio-token': token, 'content-type': 'application/json' };
    const before = await fetch(`${base}/api/layout?id=default`, { headers });
    assert.equal(before.status, 200);
    assert.equal((await before.json()).layout, null);

    const saved = await fetch(`${base}/api/layout`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        recipeId: 'default',
        layout: {
          viewport: { x: 40, y: -12, scale: 1.25 },
          positions: { goal: { x: 100, y: 200 } }
        }
      })
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).layout.positions.goal.x, 100);

    const stored = JSON.parse(fs.readFileSync(
      path.join(root, '.ai-engineering-loop', 'studio-layouts', 'default.json'),
      'utf8'
    ));
    assert.deepEqual(stored.viewport, { x: 40, y: -12, scale: 1.25 });
    assert.equal(stored.positions.goal.y, 200);
  });
});

test('Studio selects only a shipped Stage 8 delivery adapter', async () => {
  await withServer(async (base, token, root) => {
    const headers = { 'x-ael-studio-token': token, 'content-type': 'application/json' };
    const selected = await fetch(`${base}/api/adapter/select`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'github' })
    });
    assert.equal(selected.status, 200);
    assert.match(
      fs.readFileSync(path.join(root, '.ai-engineering-loop', 'adapter.md'), 'utf8'),
      /\*\*adapter_type\*\*: "github"/
    );

    const rejected = await fetch(`${base}/api/adapter/select`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: '../../shell' })
    });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).code, 'UNKNOWN_ADAPTER');
  });
});
