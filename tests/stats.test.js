'use strict';

// C-12: failure cause per harness layer and false-victory rate.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { computeStats } = require('../lib/stats.js');
const { inferCause, FAILURE_CAUSES } = require('../lib/gates.js');

function seed(root, runId, entries) {
  const dir = path.join(root, '.ai-engineering-loop', 'runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'iterations.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

test('inferCause maps integrity findings to verification, escalations to task_spec, defects to model', () => {
  assert.strictEqual(inferCause('PASS', []), null);
  assert.strictEqual(inferCause('ITERATE', [{ source: 'verification-integrity' }]), 'verification');
  assert.strictEqual(inferCause('ESCALATE', []), 'task_spec');
  assert.strictEqual(inferCause('ITERATE', [{ id: 'F-1' }]), 'model');
  assert.deepStrictEqual(FAILURE_CAUSES, ['task_spec', 'context', 'environment', 'verification', 'state', 'model']);
});

test('AC-2 stats reports false-victory rate, top causes and the bottleneck', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-stats-'));
  seed(root, '20260101T000000Z-a', [
    { iteration: 1, verdict: 'ITERATE', blockingCount: 1, cause: 'context', tier: 'T1' },
    { iteration: 2, verdict: 'PASS', blockingCount: 0, tier: 'T1' }
  ]);
  seed(root, '20260102T000000Z-b', [
    { iteration: 1, verdict: 'ITERATE', blockingCount: 2, cause: 'context', tier: 'T2' },
    { iteration: 2, verdict: 'ITERATE', blockingCount: 1, cause: 'verification', tier: 'T2' },
    { iteration: 3, verdict: 'PASS', blockingCount: 0, tier: 'T2' }
  ]);
  const stats = computeStats(root);
  assert.strictEqual(stats.judged, 5);
  assert.strictEqual(stats.falseVictories, 3);
  assert.strictEqual(stats.falseVictoryRate, 0.6);
  assert.deepStrictEqual(stats.topCauses, [{ cause: 'context', count: 2 }, { cause: 'verification', count: 1 }]);
  assert.strictEqual(stats.bottleneck, 'context');
  assert.strictEqual(stats.iterationsToPass, 2.5);
  assert.strictEqual(stats.tiers.T2.falseVictoryRate, 0.667);
  assert.strictEqual(computeStats(root, { last: 1 }).judged, 3);

  const cli = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js'), 'stats', '--json', '--last', '20'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert.strictEqual(JSON.parse(cli.stdout).bottleneck, 'context');
});
