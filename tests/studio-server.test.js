'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { appendRunLifecycle } = require('../lib/run-lifecycle.js');
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

test('Studio exposes ordered lifecycle updates with a reconnect cursor', async () => {
  await withServer(async (base, token, root) => {
    const headers = { 'x-ael-studio-token': token, 'content-type': 'application/json' };
    const created = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        task: 'Show Agent progress',
        recipeId: 'default',
        mode: 'ASSISTED'
      })
    });
    const run = (await created.json()).run;
    appendRunLifecycle(root, run.runId, {
      type: 'AGENT_HEARTBEAT',
      actor: 'agent',
      phase: 'goal',
      message: 'Drafting the Goal'
    });
    appendRunLifecycle(root, run.runId, {
      type: 'GOAL_DRAFTING',
      actor: 'agent',
      phase: 'goal',
      message: 'Writing acceptance criteria'
    });

    const first = await fetch(
      `${base}/api/runs/${run.runId}/lifecycle?after=0&limit=1`,
      { headers }
    );
    const firstBody = await first.json();
    assert.equal(firstBody.lifecycle.events.length, 1);
    assert.equal(firstBody.lifecycle.nextSequence, 1);
    assert.equal(firstBody.presence.status, 'WORKING');

    const second = await fetch(
      `${base}/api/runs/${run.runId}/lifecycle?after=1&limit=100`,
      { headers }
    );
    const secondBody = await second.json();
    assert.deepEqual(secondBody.lifecycle.events.map((event) => event.sequence), [2]);
    assert.equal(secondBody.lifecycle.nextSequence, 2);

    const stream = await fetch(
      `${base}/api/runs/${run.runId}/lifecycle/stream?after=1`,
      { headers }
    );
    assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
    const reader = stream.body.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value);
    assert.match(chunk, /"sequence":2/);
    await reader.cancel();
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

test('Studio creates, freezes, executes, and inspects a named local run through run-scoped APIs', async () => {
  await withServer(async (base, token, root) => {
    const headers = { 'x-ael-studio-token': token, 'content-type': 'application/json' };
    const created = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        task: 'Improve workflow canvas interactions',
        displayName: 'Canvas interaction upgrade',
        recipeId: 'default',
        mode: 'ASSISTED'
      })
    });
    assert.equal(created.status, 201);
    const run = (await created.json()).run;
    assert.equal(run.displayName, 'Canvas interaction upgrade');
    assert.match(run.runId, /^\d{8}T\d{6}Z-[a-f0-9]{8}$/);

    const blocked = await fetch(`${base}/api/runs/${run.runId}/execute`, {
      method: 'POST',
      headers,
      body: '{}'
    });
    assert.equal(blocked.status, 400);
    assert.equal((await blocked.json()).code, 'GOAL_NOT_FROZEN');

    const contract = {
      schemaVersion: 1,
      runId: run.runId,
      objective: 'Improve workflow canvas interactions.',
      acceptanceCriteria: [{
        id: 'AC-1',
        statement: 'Canvas interaction is observable.',
        evidenceRequired: 'Studio integration test passes.',
        failureCases: ['The interaction remains unavailable.']
      }]
    };
    const saved = await fetch(`${base}/api/runs/${run.runId}/goal`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ goal: contract, actor: 'agent', expectedRevision: 0 })
    });
    assert.equal(saved.status, 200);
    const draft = (await saved.json()).draft;
    assert.equal(draft.metadata.revision, 1);
    assert.equal(draft.metadata.actor, 'agent');

    const visibleDraft = await fetch(`${base}/api/runs/${run.runId}/goal`, { headers });
    assert.equal(visibleDraft.status, 200);
    assert.deepEqual((await visibleDraft.json()).draft, draft);

    const staleSave = await fetch(`${base}/api/runs/${run.runId}/goal`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ goal: contract, expectedRevision: 0 })
    });
    assert.equal(staleSave.status, 400);
    assert.equal((await staleSave.json()).code, 'GOAL_DRAFT_CONFLICT');

    const frozen = await fetch(`${base}/api/runs/${run.runId}/goal/freeze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        actor: 'studio-user',
        expectedRevision: draft.metadata.revision,
        expectedHash: draft.metadata.contentHash
      })
    });
    assert.equal(frozen.status, 200);
    assert.equal((await frozen.json()).run.goal.frozen, true);

    const unfrozen = await fetch(`${base}/api/runs/${run.runId}/goal/unfreeze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ actor: 'studio-user', reason: 'Add an isolation case' })
    });
    assert.equal(unfrozen.status, 200);
    assert.equal((await unfrozen.json()).run.goal.version, 2);

    contract.objective = 'Improve workflow canvas interactions with isolation.';
    const resaved = await fetch(`${base}/api/runs/${run.runId}/goal`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ goal: contract })
    });
    assert.equal(resaved.status, 200);
    const refrozen = await fetch(`${base}/api/runs/${run.runId}/goal/freeze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ actor: 'studio-user' })
    });
    assert.equal(refrozen.status, 200);
    assert.equal((await refrozen.json()).run.goal.version, 2);

    const executed = await fetch(`${base}/api/runs/${run.runId}/execute`, {
      method: 'POST',
      headers,
      body: '{}'
    });
    assert.equal(executed.status, 200);
    const execution = await executed.json();
    assert.equal(execution.execution.dispatch, 'LOCAL_RUNTIME_ONLY');
    assert.equal(execution.execution.externalDispatch, false);

    const reopened = await fetch(`${base}/api/runs/${run.runId}/goal/unfreeze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ actor: 'studio-user', reason: 'Revise after the first local execution' })
    });
    assert.equal(reopened.status, 200);
    contract.objective = 'Improve workflow canvas interactions after first execution.';
    assert.equal((await fetch(`${base}/api/runs/${run.runId}/goal`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ goal: contract })
    })).status, 200);
    assert.equal((await fetch(`${base}/api/runs/${run.runId}/goal/freeze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ actor: 'studio-user' })
    })).status, 200);
    const reexecuted = await fetch(`${base}/api/runs/${run.runId}/execute`, {
      method: 'POST',
      headers,
      body: '{}'
    });
    assert.equal(reexecuted.status, 200);

    const detail = await fetch(`${base}/api/runs/${run.runId}`, { headers });
    assert.equal(detail.status, 200);
    const inspectedRun = (await detail.json()).run;
    assert.equal(inspectedRun.runId, run.runId);
    assert.equal(inspectedRun.events.filter((event) => event.type === 'WORKFLOW_EXECUTION_STARTED').length, 2);
    const statePath = path.join(root, '.ai-engineering-loop', 'runs', run.runId, 'state.json');
    const stateBeforeInspection = fs.readFileSync(statePath, 'utf8');
    const goalArtifact = inspectedRun.artifacts.goalContract.path;
    const artifact = await fetch(
      `${base}/api/runs/${run.runId}/artifacts?path=${encodeURIComponent(goalArtifact)}`,
      { headers }
    );
    assert.equal(artifact.status, 200);
    assert.match((await artifact.json()).artifact.content, /Improve workflow canvas/);
    assert.equal(fs.readFileSync(statePath, 'utf8'), stateBeforeInspection);
    const traversal = await fetch(
      `${base}/api/runs/${run.runId}/artifacts?path=${encodeURIComponent('../outside')}`,
      { headers }
    );
    assert.equal(traversal.status, 400);
    assert.equal((await traversal.json()).code, 'UNSAFE_HISTORY_PATH');
    const renamed = await fetch(`${base}/api/run/name`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        runId: run.runId,
        displayName: 'Canvas workflow console',
        actor: 'studio-user'
      })
    });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).run.runId, run.runId);

    const history = await fetch(`${base}/api/runs?q=canvas`, { headers });
    assert.equal(history.status, 200);
    assert.equal((await history.json()).runs[0].displayName, 'Canvas workflow console');
  });
});

test('Studio exposes the active Run and requires explicit cancellation before replacing its Goal', async () => {
  await withServer(async (base, token) => {
    const headers = { 'x-ael-studio-token': token, 'content-type': 'application/json' };
    const create = (task) => fetch(`${base}/api/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ task, recipeId: 'default', mode: 'ASSISTED' })
    });
    const firstResponse = await create('Keep the current Goal');
    assert.equal(firstResponse.status, 201);
    const first = (await firstResponse.json()).run;

    const conflictResponse = await create('Start a different Goal');
    assert.equal(conflictResponse.status, 400);
    const conflict = await conflictResponse.json();
    assert.equal(conflict.code, 'ACTIVE_RUN');
    assert.equal(conflict.activeRun.runId, first.runId);
    assert.equal(conflict.activeRun.task, 'Keep the current Goal');

    const cancelledResponse = await fetch(`${base}/api/runs/${first.runId}/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        actor: 'studio-user',
        reason: 'Confirmed replacement from Studio'
      })
    });
    assert.equal(cancelledResponse.status, 200);
    assert.equal((await cancelledResponse.json()).run.state, 'CANCELLED');

    const replacementResponse = await create('Start a different Goal');
    assert.equal(replacementResponse.status, 201);
    const replacement = (await replacementResponse.json()).run;
    assert.notEqual(replacement.runId, first.runId);
    assert.equal(replacement.task, 'Start a different Goal');

    const oldDetail = await fetch(`${base}/api/runs/${first.runId}`, { headers });
    assert.equal((await oldDetail.json()).run.status, 'CANCELLED');
  });
});

test('Studio checks out a Run and exchanges agent questions without changing history', async () => {
  await withServer(async (base, token, root) => {
    const headers = { 'x-ael-studio-token': token, 'content-type': 'application/json' };
    const created = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        task: 'Add Run replay',
        constraints: 'Never mutate historical evidence',
        recipeId: 'default'
      })
    });
    const run = (await created.json()).run;
    const statePath = path.join(root, '.ai-engineering-loop', 'runs', run.runId, 'state.json');
    const before = fs.readFileSync(statePath, 'utf8');

    const checkoutResponse = await fetch(`${base}/api/runs/${run.runId}/checkout`, { headers });
    assert.equal(checkoutResponse.status, 200);
    const checkout = (await checkoutResponse.json()).checkout;
    assert.equal(checkout.readOnly, true);
    assert.ok(checkout.edges.length > 0);

    const nodeResponse = await fetch(
      `${base}/api/runs/${run.runId}/nodes/${encodeURIComponent(checkout.nodes[0].id)}`,
      { headers }
    );
    assert.equal(nodeResponse.status, 200);
    assert.equal((await nodeResponse.json()).io.runId, run.runId);

    const questionResponse = await fetch(`${base}/api/runs/${run.runId}/questions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'Q1: Which UX should I use?', actor: 'maker' })
    });
    assert.equal(questionResponse.status, 201);
    const question = (await questionResponse.json()).question;
    const answerResponse = await fetch(
      `${base}/api/runs/${run.runId}/questions/${question.questionId}/answer`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: 'Use the focused view.', actor: 'studio-user' })
      }
    );
    assert.equal(answerResponse.status, 201);
    const interactions = await fetch(`${base}/api/runs/${run.runId}/interactions`, { headers });
    assert.equal((await interactions.json()).interactions.questions[0].answer.message, 'Use the focused view.');

    const duplicate = await fetch(`${base}/api/runs/${run.runId}/duplicate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ recipeId: 'run-replay-copy' })
    });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).preview.recipe.id, 'run-replay-copy');
    const handoff = await fetch(`${base}/api/runs/${run.runId}/agent-handoff`, { headers });
    assert.equal((await handoff.json()).handoff.externalDispatch, false);
    assert.equal(fs.readFileSync(statePath, 'utf8'), before);
  });
});

test('Studio previews and applies recipe imports without installing them', async () => {
  await withServer(async (base, token) => {
    const headers = { 'x-ael-studio-token': token, 'content-type': 'application/json' };
    const existing = (await (await fetch(`${base}/api/recipe?id=default`, { headers })).json()).recipe;
    const imported = structuredClone(existing);
    imported.id = 'imported';

    const preview = await fetch(`${base}/api/import/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ existingRecipe: existing, importedRecipe: imported, operation: 'merge' })
    });
    assert.equal(preview.status, 200);
    const plan = (await preview.json()).plan;
    assert.equal(plan.operation, 'merge');
    assert.ok(Object.keys(plan.nodeIdMap).length > 0);

    const applied = await fetch(`${base}/api/import/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        existingRecipe: existing,
        importedRecipe: imported,
        plan: { operation: 'replace', nodeIdMap: {}, edgeIdMap: {} }
      })
    });
    assert.equal(applied.status, 200);
    const candidate = (await applied.json()).recipe;
    assert.equal(candidate.id, 'imported');
    assert.equal(candidate.nodes.length, existing.nodes.length);

    const cancelled = await fetch(`${base}/api/import/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        existingRecipe: existing,
        importedRecipe: imported,
        plan: { operation: 'cancel', nodeIdMap: {}, edgeIdMap: {} }
      })
    });
    assert.equal(cancelled.status, 200);
    assert.deepEqual((await cancelled.json()).recipe, existing);
  });
});
