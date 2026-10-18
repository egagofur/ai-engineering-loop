'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createStudioServer } = require('../lib/studio-server.js');
const { studioContext, waitFor } = require('./helpers/studio-dom.js');

const rootDir = path.join(__dirname, '..');

test('issue 91 acceptance criteria are covered by tests, docs, and the changelog', () => {
  const evidence = fs.readFileSync(path.join(rootDir, 'tests', 'node-evidence.test.js'), 'utf8');
  const detail = fs.readFileSync(path.join(rootDir, 'tests', 'studio-detail.test.js'), 'utf8');
  const gestures = fs.readFileSync(path.join(rootDir, 'tests', 'studio-gestures.test.js'), 'utf8');
  const app = fs.readFileSync(path.join(rootDir, 'studio', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(rootDir, 'studio', 'styles.css'), 'utf8');
  const server = fs.readFileSync(path.join(rootDir, 'lib', 'studio-server.js'), 'utf8');
  const doc = fs.readFileSync(path.join(rootDir, 'core', 'local-workflow-studio.md'), 'utf8');
  const changelog = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');

  for (const phrase of [
    'goal-contract',
    'fileCount',
    'npm test',
    'bySeverity',
    'verdict',
    'approvedBy',
    'no receipt: run predates receipts',
    'artifact changed',
    'SECRET-OUTSIDE-SENTINEL',
    'durationMs > 0'
  ]) {
    assert.ok(evidence.includes(phrase), `evidence tests missing ${phrase}`);
  }
  assert.match(detail, /5 min ago/);
  assert.match(detail, /2 days ago/);
  assert.match(detail, /<time datetime=/);
  assert.ok(detail.includes('unknown \\/ 1000'));
  assert.match(detail, /Answer in Studio/);
  assert.match(detail, /Compliance &amp; budget/);
  assert.ok(detail.includes('scheduleLiveRender'));
  assert.match(gestures, /deltaX: 30/);
  assert.match(gestures, /ctrlKey: true/);
  assert.match(gestures, /overscroll-behavior:none/);
  assert.match(gestures, /selection-marquee/);
  assert.match(gestures, /#node-panel/);
  assert.equal(app.includes('style="'), false);
  assert.equal(app.includes('m ago'), false);
  assert.equal(app.includes('No artifact'), false);
  assert.match(server, /style-src 'self'/);
  assert.match(css, /html\{overscroll-behavior:none\}/);
  assert.match(doc, /Overview, Output, Evidence, and Timeline/);
  assert.match(doc, /upstream input/);
  assert.match(doc, /artifact changed/);
  assert.match(doc, /two-finger scroll pans/);
  assert.match(doc, /unknown/);
  assert.match(doc, /GET \/api\/events/);

  const unreleased = changelog.split(/^## /m).find((part) => part.startsWith('Unreleased'));
  assert.ok(unreleased, 'CHANGELOG has an Unreleased section');
  assert.match(unreleased, /### Studio: richer node detail, Live tab, times, and trackpad gestures \(#91\)/);
  assert.match(unreleased, /artifact changed/);
  assert.match(unreleased, /no receipt: run predates receipts/);
  assert.match(unreleased, /\*\*Added:\*\*/);
  assert.match(unreleased, /\*\*Changed:\*\*/);
  const released = changelog.split(/^## /m).find((part) => part.includes('### Studio: n8n-style Wiring canvas (#88)'));
  assert.match(released, /^2\.1\.0 - 2026-10-18/);
});

test('a lifecycle event over SSE refreshes the live rail and compliance chips', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-v22-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements } = studioContext(base, instance.token);
    vm.runInContext(
      fs.readFileSync(path.join(rootDir, 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => vm.runInContext('validationState.status', context) === 'valid');
    const run = (code) => vm.runInContext(code, context);
    run(`catalog.currentRunId = null; pinnedRunId = null; catalog.live = {
      run: { runId: 'run-91', displayName: 'Pagination', state: 'RUNNING', mode: 'ASSISTED', iteration: 1, tier: { current: 'CHEAP_MODEL' } },
      plan: { nodes: draft.nodes, edges: draft.edges },
      nodes: { goal: { status: 'PASSED', updatedAt: new Date(Date.now() - 60000).toISOString() } },
      artifacts: {},
      budget: { spentThisRun: 0, perRunTokenLimit: 1000 },
      journey: { steps: [], degradedSources: [] },
      events: [],
      presence: {}
    }; renderLive()`);
    assert.match(elements.get('live-meta').innerHTML, /unknown \/ 1000/);
    assert.match(elements.get('stage-rail').innerHTML, /class="pending"/);
    const seq = run('lastEventSeq + 4');
    run(`applyEvent({
      type: 'lifecycle',
      runId: 'run-91',
      seq: ${seq},
      payload: { events: [{ nodeId: 'review', status: 'RUNNING', at: new Date().toISOString() }] }
    })`);
    await waitFor(() => elements.get('stage-rail').innerHTML.includes('class="active"'));
    assert.match(elements.get('stage-rail').innerHTML, /<li class="active"><strong>review<\/strong>/);
    assert.match(elements.get('live-current').innerHTML, /review · devil-advocate/);
    run(`applyEvent({
      type: 'artifact.guard',
      runId: 'run-91',
      seq: ${seq + 1},
      payload: { warn: 2, block: 1 }
    })`);
    await waitFor(() => elements.get('live-meta').innerHTML.includes('2 warn · 1 block'));
    assert.equal(run('lastEventSeq'), seq + 1);
    assert.equal(elements.get('live-meta').innerHTML.includes('style='), false);
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});
