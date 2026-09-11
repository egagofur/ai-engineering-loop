const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { listRunLifecycle } = require('../lib/run-lifecycle.js');
const { createRun } = require('../lib/run-state.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function runCli(root, args) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

test('CLI policy and budget commands provide machine-readable controls', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-cli-runtime-'));
  createRun(root, { runId: 'run-001' });
  const policy = JSON.parse(runCli(root, [
    'policy',
    'set',
    '--allow-unattended',
    'true',
    '--per-run-token-limit',
    '1000',
    '--json'
  ]));
  assert.strictEqual(policy.allowUnattended, true);
  assert.strictEqual(policy.perRunTokenLimit, 1000);

  const recorded = JSON.parse(runCli(root, [
    'budget',
    'record',
    '--run',
    'run-001',
    '--input',
    '10',
    '--output',
    '5',
    '--model',
    'provider/model',
    '--json'
  ]));
  assert.strictEqual(recorded.entry.totalTokens, 15);
  assert.strictEqual(recorded.status.remainingThisRun, 985);

  JSON.parse(runCli(root, ['budget', 'pause', '--json']));
  const paused = JSON.parse(runCli(root, ['budget', 'status', '--run', 'run-001', '--json']));
  assert.strictEqual(paused.allowed, false);
  assert.ok(paused.reasons.includes('kill switch is active'));
});

test('CLI publishes revision-bound Goal drafts and lifecycle activity for Studio', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-cli-runtime-'));
  createRun(root, { runId: 'run-001', task: 'Observe Goal drafting' });
  const input = path.join(root, 'goal-input.json');
  fs.writeFileSync(input, JSON.stringify({
    schemaVersion: 1,
    runId: 'run-001',
    objective: 'Show the terminal-authored Goal in Studio.',
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'Studio can read the exact Goal revision.',
      evidenceRequired: 'CLI and lifecycle assertions pass.',
      failureCases: ['The draft is not visible.']
    }]
  }));

  const result = JSON.parse(runCli(root, [
    'goal',
    'draft',
    '--run',
    'run-001',
    '--file',
    'goal-input.json',
    '--revision',
    '0'
  ]));
  assert.strictEqual(result.result.metadata.revision, 1);
  assert.match(result.result.metadata.contentHash, /^[a-f0-9]{64}$/);

  const shown = JSON.parse(runCli(root, ['goal', 'show', '--run', 'run-001']));
  assert.deepStrictEqual(shown.draft, result.result);
  assert.deepStrictEqual(
    listRunLifecycle(root, 'run-001').events.map((event) => event.type),
    ['GOAL_DRAFTING', 'GOAL_DRAFT_UPDATED', 'GOAL_READY']
  );
});
