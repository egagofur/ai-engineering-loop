const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

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
