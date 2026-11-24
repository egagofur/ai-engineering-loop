'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createRun, loadRun } = require('../lib/run-state.js');
const { saveGoalDraft, loadGoalDraft } = require('../lib/goal-runtime.js');
const { createStudioServer } = require('../lib/studio-server.js');
const { projectId } = require('../lib/studio/instance.js');

const TOKEN = 'fixed-test-token';

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function repo(parent, name) {
  const dir = path.join(parent, name);
  fs.mkdirSync(path.join(dir, '.ai-engineering-loop', 'runs'), { recursive: true });
  return dir;
}

function writeRegistry(home, paths) {
  fs.mkdirSync(path.join(home, '.ai-engineering-loop'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.ai-engineering-loop', 'projects.json'),
    JSON.stringify({ schemaVersion: 1, projects: paths.map((p) => ({ path: p })) })
  );
}

function writeConfig(home, config) {
  fs.mkdirSync(path.join(home, '.ai-engineering-loop'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ai-engineering-loop', 'config.json'), JSON.stringify(config));
}

function readConfig(home) {
  return JSON.parse(fs.readFileSync(path.join(home, '.ai-engineering-loop', 'config.json'), 'utf8'));
}

function contract(runId, objective = 'Show the run') {
  return {
    schemaVersion: 1,
    runId,
    objective,
    acceptanceCriteria: [{ id: 'AC-1', statement: 'It shows', evidenceRequired: 'test', failureCases: ['hidden'] }]
  };
}

function drafted(root, runId) {
  createRun(root, { runId, task: 'show the run' });
  saveGoalDraft(root, runId, contract(runId), { actor: 'agent', expectedRevision: 0 });
  return loadGoalDraft(root, runId).metadata.contentHash;
}

function fixture({ projects = 1, config = { studioActor: 'Ega' } } = {}) {
  const home = tempDir('ael-studio-home-');
  const work = tempDir('ael-studio-work-');
  const roots = Array.from({ length: projects }, (_, index) => repo(work, `repo-${index}`));
  writeRegistry(home, roots);
  if (config) writeConfig(home, config);
  return { home, roots };
}

async function withStudio(options, operation) {
  const studio = createStudioServer({ token: TOKEN, pollMs: 60_000, ...options });
  await new Promise((resolve, reject) => {
    studio.server.once('error', reject);
    studio.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = studio.server.address();
    await operation({ base: `http://127.0.0.1:${port}`, port, studio });
  } finally {
    await studio.close();
  }
}

function api(base, route, { method = 'GET', body, headers = {} } = {}) {
  return fetch(`${base}${route}`, {
    method,
    headers: { 'x-ael-studio-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
}

function rawGet(port, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: route, headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    request.on('error', reject);
    request.end();
  });
}

function openEvents(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: '/api/events',
      headers: { 'x-ael-studio-token': TOKEN }
    }, (response) => {
      const events = [];
      let buffer = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const type = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          events.push({ type, data: data ? JSON.parse(data) : null, at: Date.now() });
        }
      });
      response.on('error', () => {});
      resolve({
        response,
        events,
        close: () => request.destroy(),
        async waitFor(predicate, timeoutMs) {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const found = events.find(predicate);
            if (found) return found;
            await new Promise((done) => setTimeout(done, 10));
          }
          return null;
        }
      });
    });
    request.on('error', (error) => { if (error.code !== 'ECONNRESET') reject(error); });
  });
}

test('requests without the session cookie or token header get 401', async () => {
  const { home } = fixture();
  await withStudio({ home }, async ({ base }) => {
    assert.equal((await fetch(`${base}/api/projects`)).status, 401);
    assert.equal((await fetch(`${base}/`)).status, 401);
    assert.equal((await fetch(`${base}/api/projects`, { headers: { cookie: 'ael_studio=wrong' } })).status, 401);
  });
});

test('the token is exchanged for an HttpOnly SameSite=Strict cookie that then authorises reads', async () => {
  const { home } = fixture();
  await withStudio({ home }, async ({ base }) => {
    const login = await fetch(`${base}/?token=${TOKEN}&project=abc123`, { redirect: 'manual' });
    assert.equal(login.status, 302);
    assert.equal(login.headers.get('location'), '/?project=abc123');
    assert.match(login.headers.get('set-cookie'), /^ael_studio=fixed-test-token; HttpOnly; SameSite=Strict; Path=\//);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const read = await fetch(`${base}/api/projects`, { headers: { cookie } });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal(
      read.headers.get('content-security-policy'),
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    );
  });
});

test('/healthz answers identity without a session and still enforces the Host check', async () => {
  const { home } = fixture();
  await withStudio({ home }, async ({ base, port }) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { app: 'ael-studio', pid: process.pid });
    const evil = await rawGet(port, '/healthz', { host: 'evil.test' });
    assert.equal(evil.status, 403);
  });
});

test('a non-local Host header is refused with 403 even with the token', async () => {
  const { home } = fixture();
  await withStudio({ home }, async ({ port }) => {
    const evil = await rawGet(port, '/api/projects', { host: 'evil.test', 'x-ael-studio-token': TOKEN });
    assert.equal(evil.status, 403);
    const local = await rawGet(port, '/api/projects', { host: `localhost:${port}`, 'x-ael-studio-token': TOKEN });
    assert.equal(local.status, 200);
  });
});

function rawRequest(port, text) {
  return new Promise((resolve, reject) => {
    const socket = require('node:net').connect(port, '127.0.0.1', () => socket.end(text));
    let reply = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { reply += chunk; });
    socket.on('close', () => resolve(reply));
    socket.on('error', reject);
  });
}

test('a request target that is not a URL gets 400 before auth and the server keeps answering', async () => {
  const { home } = fixture();
  await withStudio({ home }, async ({ base, port }) => {
    const reply = await rawRequest(port, 'GET http://[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
    assert.match(reply, /^HTTP\/1\.1 400 /);
    assert.match(reply, /\r\nBad request\r\n/);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  });
});

test('/api/projects lists every registry project with its summary', async () => {
  const { home, roots } = fixture({ projects: 2 });
  drafted(roots[0], 'run-1');
  await withStudio({ home }, async ({ base }) => {
    const response = await api(base, '/api/projects');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    const byId = Object.fromEntries(body.projects.map((p) => [p.id, p]));
    assert.deepEqual(Object.keys(byId).sort(), roots.map(projectId).sort());
    assert.equal(byId[projectId(roots[0])].state, 'waiting');
    assert.equal(byId[projectId(roots[0])].run.waiting.kind, 'freeze');
    assert.equal(byId[projectId(roots[1])].state, 'idle');
    assert.equal(JSON.stringify(body).includes(roots[0]), false, 'raw paths never reach the browser');
  });
});

test('run detail resolves by project id and carries the draft hash; unknown ids are 404', async () => {
  const { home, roots } = fixture();
  const hash = drafted(roots[0], 'run-1');
  const id = projectId(roots[0]);
  await withStudio({ home }, async ({ base }) => {
    const ok = await api(base, `/api/projects/${id}/runs/run-1`);
    assert.equal(ok.status, 200);
    const { detail } = await ok.json();
    assert.equal(detail.summary.runId, 'run-1');
    assert.equal(detail.goalHash, hash);
    const unknownProject = await api(base, '/api/projects/ffffffffffff/runs/run-1');
    assert.equal(unknownProject.status, 404);
    assert.equal((await unknownProject.json()).code, 'PROJECT_NOT_FOUND');
    const unknownRun = await api(base, `/api/projects/${id}/runs/run-404`);
    assert.equal(unknownRun.status, 404);
    assert.equal((await unknownRun.json()).code, 'RUN_NOT_FOUND');
    const badRun = await api(base, `/api/projects/${id}/runs/..%2F..`);
    assert.equal(badRun.status, 400);
    const malformed = await api(base, `/api/projects/${id}/runs/%E0%A4%A`);
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, 'INVALID_PATH');
  });
});

test('freeze twice: the first freezes as the Studio actor, the second answers alreadyFrozen', async () => {
  const { home, roots } = fixture();
  const hash = drafted(roots[0], 'run-1');
  const route = `/api/projects/${projectId(roots[0])}/runs/run-1/goal/freeze`;
  await withStudio({ home }, async ({ base }) => {
    const first = await api(base, route, { method: 'POST', body: { expectedHash: hash } });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.ok, true);
    assert.equal(firstBody.alreadyFrozen, false);
    assert.equal(firstBody.run.state, 'GOAL_FROZEN');
    assert.equal(loadRun(roots[0], 'run-1').goal.actor, 'Ega');
    assert.equal(loadRun(roots[0], 'run-1').goal.approval, 'studio');
    const second = await api(base, route, { method: 'POST', body: { expectedHash: hash } });
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.alreadyFrozen, true);
    assert.equal(secondBody.run.alreadyFrozen, undefined);
  });
});

test('a Studio freeze records one GOAL_FROZEN lifecycle event and drafts the impact map, like the CLI', async () => {
  const { listRunLifecycle } = require('../lib/run-lifecycle.js');
  const { loadImpactMap } = require('../lib/impact-map.js');
  const { home, roots } = fixture();
  const hash = drafted(roots[0], 'run-1');
  const route = `/api/projects/${projectId(roots[0])}/runs/run-1/goal/freeze`;
  await withStudio({ home }, async ({ base }) => {
    assert.equal((await api(base, route, { method: 'POST', body: { expectedHash: hash } })).status, 200);
    assert.equal((await api(base, route, { method: 'POST', body: { expectedHash: hash } })).status, 200);
  });
  const frozen = listRunLifecycle(roots[0], 'run-1').events.filter((event) => event.type === 'GOAL_FROZEN');
  assert.equal(frozen.length, 1);
  assert.equal(frozen[0].phase, 'goal');
  assert.equal(frozen[0].actor, 'Ega');
  assert.match(frozen[0].message, /Studio/);
  assert.ok(loadImpactMap(roots[0], 'run-1'));
});

test('freeze with a stale expectedHash is 409 GOAL_DRAFT_CONFLICT and leaves the Run unfrozen', async () => {
  const { home, roots } = fixture();
  drafted(roots[0], 'run-1');
  const route = `/api/projects/${projectId(roots[0])}/runs/run-1/goal/freeze`;
  await withStudio({ home }, async ({ base }) => {
    const response = await api(base, route, { method: 'POST', body: { expectedHash: 'stale' } });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'GOAL_DRAFT_CONFLICT');
    assert.equal(loadRun(roots[0], 'run-1').state, 'STARTED');
    const missing = await api(base, route, { method: 'POST', body: {} });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).code, 'EXPECTED_HASH_REQUIRED');
  });
});

test('freeze refuses an agent-like Studio actor and freezes a worktree Run in the worktree root', async () => {
  const { home, roots } = fixture({ config: { studioActor: 'claude' } });
  const hash = drafted(roots[0], 'run-1');
  await withStudio({ home }, async ({ base }) => {
    const refused = await api(base, `/api/projects/${projectId(roots[0])}/runs/run-1/goal/freeze`, {
      method: 'POST',
      body: { expectedHash: hash }
    });
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).code, 'GOAL_FREEZE_NOT_HUMAN');
    assert.equal(loadRun(roots[0], 'run-1').state, 'STARTED');
  });

  const second = fixture();
  const worktree = repo(path.dirname(second.roots[0]), 'wt');
  fs.writeFileSync(
    path.join(second.roots[0], '.ai-engineering-loop', 'worktrees.json'),
    JSON.stringify({ schemaVersion: 1, worktrees: [{ runId: 'run-w', path: worktree, branch: 'ael/w' }] })
  );
  const worktreeHash = drafted(worktree, 'run-w');
  await withStudio({ home: second.home }, async ({ base }) => {
    const response = await api(base, `/api/projects/${projectId(worktree)}/runs/run-w/goal/freeze`, {
      method: 'POST',
      body: { expectedHash: worktreeHash }
    });
    assert.equal(response.status, 200);
    assert.equal(loadRun(worktree, 'run-w').state, 'GOAL_FROZEN');
  });
});

test('mutations need JSON and same origin or the token header', async () => {
  const { home, roots } = fixture();
  const hash = drafted(roots[0], 'run-1');
  const route = `/api/projects/${projectId(roots[0])}/runs/run-1/goal/freeze`;
  await withStudio({ home }, async ({ base }) => {
    const cookie = `ael_studio=${TOKEN}`;
    const body = JSON.stringify({ expectedHash: hash });
    const crossOrigin = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body
    });
    assert.equal(crossOrigin.status, 403);
    const textBody = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'text/plain', origin: base },
      body
    });
    assert.equal(textBody.status, 415);
    assert.equal(loadRun(roots[0], 'run-1').state, 'STARTED');
  });
});

test('/api/me resolves the actor from config, then git user.name, and PUT saves a human name only', async () => {
  const { home } = fixture({ config: { hostPacks: ['core'] } });
  fs.writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = Fixture Person\n');
  await withStudio({ home }, async ({ base }) => {
    const fromGit = await (await api(base, '/api/me')).json();
    const { diners, customDiners, ...me } = fromGit;
    assert.deepEqual(me, { ok: true, actor: 'Fixture Person', actorValid: true });
    assert.deepEqual(diners.map((diner) => diner.name), ['Matt Pocock', 'Claude'], 'default diners');
    assert.equal(customDiners, false);

    const refused = await api(base, '/api/me', { method: 'PUT', body: { actor: 'gpt-5' } });
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).code, 'GOAL_FREEZE_NOT_HUMAN');
    assert.equal(readConfig(home).studioActor, undefined);

    const saved = await api(base, '/api/me', { method: 'PUT', body: { actor: 'Ega Gofur' } });
    assert.equal(saved.status, 200);
    const { diners: _savedDiners, customDiners: _savedCustom, ...savedMe } = await saved.json();
    assert.deepEqual(savedMe, { ok: true, actor: 'Ega Gofur', actorValid: true });
    assert.deepEqual(readConfig(home), { hostPacks: ['core'], studioActor: 'Ega Gofur' });
    assert.equal((await (await api(base, '/api/me')).json()).actor, 'Ega Gofur');
  });
  const agentConfigured = fixture({ config: { studioActor: 'assistant', studio: { diners: [{ name: '<i>Night owl</i>', note: 'x' }, { name: '' }] } } });
  await withStudio({ home: agentConfigured.home }, async ({ base }) => {
    assert.deepEqual(await (await api(base, '/api/me')).json(), { ok: true, actor: 'assistant', actorValid: false, diners: [{ name: '<i>Night owl</i>', note: 'x' }], customDiners: true });
  });
});

test('static files come only from the allowlist; traversal and app.js are 404', async () => {
  const { home } = fixture();
  await withStudio({ home }, async ({ port }) => {
    const headers = { 'x-ael-studio-token': TOKEN };
    const tokens = await rawGet(port, '/tokens.css', headers);
    assert.equal(tokens.status, 200);
    assert.match(tokens.headers['content-type'], /^text\/css/);
    assert.equal((await rawGet(port, '/', headers)).status, 200);
    assert.equal((await rawGet(port, '/js/../../package.json', headers)).status, 404);
    assert.equal((await rawGet(port, '/js/..%2F..%2Fpackage.json', headers)).status, 404);
    assert.equal((await rawGet(port, '/app.js', headers)).status, 404);
    assert.equal((await rawGet(port, '/api/bootstrap', headers)).status, 404);
  });
});

test('the ring modules and vendored three.js are served as JavaScript; other vendor files are 404', async () => {
  const { home } = fixture();
  await withStudio({ home }, async ({ port }) => {
    const headers = { 'x-ael-studio-token': TOKEN };
    for (const file of ['/js/restaurant.js', '/js/ring2d.js', '/js/kitchen.js', '/js/stations.js', '/vendor/three.module.min.js', '/vendor/three.core.min.js']) {
      const response = await rawGet(port, file, headers);
      assert.equal(response.status, 200, file);
      assert.match(response.headers['content-type'], /^text\/javascript/, file);
    }
    for (const file of ['/vendor/three.LICENSE', '/vendor/three.webgpu.min.js', '/vendor/']) {
      assert.equal((await rawGet(port, file, headers)).status, 404, file);
    }
  });
});

function rawBytes(port, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: route, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('static files carry an ETag, revalidate with no-cache and answer 304 when unchanged', async () => {
  const { home } = fixture();
  await withStudio({ home }, async ({ port }) => {
    const headers = { 'x-ael-studio-token': TOKEN };
    const first = await rawBytes(port, '/vendor/three.core.min.js', headers);
    assert.equal(first.status, 200);
    assert.equal(first.headers['cache-control'], 'no-cache');
    assert.match(first.headers.etag, /^"[A-Za-z0-9_-]{27}"$/);
    const again = await rawBytes(port, '/vendor/three.core.min.js', { ...headers, 'if-none-match': first.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    assert.equal(again.headers.etag, first.headers.etag);
    assert.equal((await rawBytes(port, '/vendor/three.core.min.js', { ...headers, 'if-none-match': '"stale"' })).status, 200);
    assert.equal((await rawBytes(port, '/vendor/three.core.min.js', { 'if-none-match': first.headers.etag })).status, 401, 'a cached copy never skips the session check');
  });
});

test('static files are brotli or gzip encoded when the browser accepts it and identical once decoded', async () => {
  const { home } = fixture();
  const zlib = require('node:zlib');
  const original = fs.readFileSync(path.join(__dirname, '..', 'studio', 'vendor', 'three.module.min.js'));
  await withStudio({ home }, async ({ port }) => {
    const headers = { 'x-ael-studio-token': TOKEN };
    const br = await rawBytes(port, '/vendor/three.module.min.js', { ...headers, 'accept-encoding': 'gzip, deflate, br' });
    assert.equal(br.headers['content-encoding'], 'br');
    assert.equal(br.headers.vary, 'accept-encoding');
    assert.ok(br.body.length < original.length / 3, `brotli body ${br.body.length} bytes`);
    assert.ok(zlib.brotliDecompressSync(br.body).equals(original));
    const gzip = await rawBytes(port, '/vendor/three.module.min.js', { ...headers, 'accept-encoding': 'gzip' });
    assert.equal(gzip.headers['content-encoding'], 'gzip');
    assert.ok(zlib.gunzipSync(gzip.body).equals(original));
    const plain = await rawBytes(port, '/vendor/three.module.min.js', headers);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.ok(plain.body.equals(original));
    const tiny = await rawBytes(port, '/diners.json', { ...headers, 'accept-encoding': 'br' });
    assert.equal(tiny.headers['content-encoding'], undefined, 'files under 1 KiB are sent as is');
  });
});

test('SSE sends projects on connect and again within pollMs after a fixture Run changes', async () => {
  const { home, roots } = fixture();
  const pollMs = 150;
  await withStudio({ home, pollMs }, async ({ port }) => {
    const stream = await openEvents(port);
    try {
      assert.match(stream.response.headers['content-type'], /^text\/event-stream/);
      const initial = await stream.waitFor((event) => event.type === 'projects', 1_000);
      assert.ok(initial, 'initial projects event');
      assert.equal(initial.data.projects[0].state, 'idle');
      await new Promise((done) => setTimeout(done, pollMs * 2));
      assert.equal(stream.events.filter((event) => event.type === 'projects').length, 1, 'no push without a change');
      const changedAt = Date.now();
      drafted(roots[0], 'run-1');
      const update = await stream.waitFor((event) => event.type === 'projects' && event.data.projects[0].state === 'waiting', pollMs + 400);
      assert.ok(update, 'projects event after the change');
      assert.ok(update.at - changedAt <= pollMs + 400, `pushed after ${update.at - changedAt} ms`);
    } finally {
      stream.close();
    }
  });
});

test('with 25 fixture projects one poll completes under 500 ms (1500 ms on Windows)', async () => {
  const { home, roots } = fixture({ projects: 25 });
  roots.forEach((root, index) => drafted(root, `run-${index}`));
  await withStudio({ home }, async ({ base }) => {
    await api(base, '/api/projects');
    const started = process.hrtime.bigint();
    const response = await api(base, '/api/projects');
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal((await response.json()).projects.length, 25);
    const budgetMs = process.platform === 'win32' ? 1500 : 500;
    assert.ok(elapsedMs < budgetMs, `poll took ${elapsedMs} ms`);
  });
});

test('the notifier gets exactly one call for a new freeze wait across polls', async () => {
  const { home, roots } = fixture();
  const calls = [];
  const pollMs = 50;
  await withStudio({ home, pollMs, notifier: (title, body) => calls.push({ title, body }) }, async () => {
    await new Promise((done) => setTimeout(done, pollMs * 2));
    assert.equal(calls.length, 0);
    drafted(roots[0], 'run-1');
    await new Promise((done) => setTimeout(done, pollMs * 6));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body, 'Goal waiting for Freeze');
    assert.match(calls[0].title, /^AEL: /);
  });
});

test('close() stops the poll loop', async () => {
  const { home, roots } = fixture();
  const calls = [];
  const studio = createStudioServer({ home, token: TOKEN, pollMs: 30, notifier: () => calls.push(1) });
  await new Promise((resolve) => studio.server.listen(0, '127.0.0.1', resolve));
  await studio.close();
  drafted(roots[0], 'run-1');
  await new Promise((done) => setTimeout(done, 120));
  assert.equal(calls.length, 0);
});
