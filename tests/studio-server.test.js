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
  const instance = createStudioServer(tempRepo(), { token: 'fixed-test-token' });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = instance.server.address();
    await operation(`http://127.0.0.1:${port}`, instance.token);
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
