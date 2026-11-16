'use strict';

// C-15: project feature ledger moved only by Run transitions; next + VCR.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createRun } = require('../lib/run-state.js');
const { applyGate } = require('../lib/gates.js');
const features = require('../lib/features.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function ledger(root, list) {
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'features.json'), JSON.stringify({ schemaVersion: 1, features: list }));
}

const base = [
  { id: 'F-1', title: 'import', behavior: 'import md', verify: 'npm test -- import', status: 'not_started', priority: 1, dependsOn: [] },
  { id: 'F-2', title: 'index', behavior: 'chunk docs', status: 'not_started', priority: 2, dependsOn: ['F-1'] },
  { id: 'F-3', title: 'qa', behavior: 'answer', status: 'not_started', priority: 3, dependsOn: [] }
];

test('AC-2 next picks the highest-priority unblocked feature; VCR counts verified over activated', () => {
  const doc = { features: JSON.parse(JSON.stringify(base)) };
  assert.strictEqual(features.nextFeature(doc).id, 'F-1');
  doc.features[0].status = 'active';
  assert.strictEqual(features.nextFeature(doc).id, 'F-3', 'F-2 waits for F-1');
  assert.deepStrictEqual(features.vcr(doc), { verified: 0, activated: 1, value: 0 });
  doc.features[0].status = 'passing';
  assert.strictEqual(features.nextFeature(doc).id, 'F-2');
  assert.strictEqual(features.vcr(doc).value, 1);
});

test('AC-1 the Goal gate activates the feature; status changes only through Run transitions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-feat-'));
  ledger(root, base);
  createRun(root, { runId: 'run-1', task: 'import' });
  const goalPath = path.join(root, '.ai-engineering-loop/runs/run-1/goal-contract.json');
  fs.writeFileSync(goalPath, JSON.stringify({
    schemaVersion: 1, runId: 'run-1', objective: 'import', featureId: 'F-1',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'x', evidenceRequired: 'y', failureCases: ['z'] }]
  }));
  applyGate(root, 'goal', { runId: 'run-1' });
  const after = features.loadFeatures(root).features[0];
  assert.strictEqual(after.status, 'active');
  assert.strictEqual(after.history[0].runId, 'run-1');
  const goal = JSON.parse(fs.readFileSync(goalPath, 'utf8'));
  features.onDelivered(root, { runId: 'run-1' }, goal);
  assert.strictEqual(features.loadFeatures(root).features[0].status, 'passing');
  assert.match(features.auditFeatures(root)[0], /F-1: marked passing without a delivered Run/, 'run-1 is not DELIVERED, so the claim is flagged');
});

test('next CLI flags a hand-edited passing feature', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-feat-cli-'));
  ledger(root, [{ ...base[0], status: 'passing' }, base[2]]);
  const res = spawnSync(process.execPath, [CLI, 'next', '--json'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(res.status, 1);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.next.id, 'F-3');
  assert.match(out.problems[0], /without a delivered Run/);
});
