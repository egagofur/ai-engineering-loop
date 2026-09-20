const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { compactRun } = require('../lib/run-compaction.js');
const { createRun } = require('../lib/run-state.js');

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-run-compact-'));
  createRun(root, { runId: 'run-001', task: 'Compact this run' });
  return root;
}

test('run compaction writes short reviewer artifacts without raw verification logs', () => {
  const root = tempRoot();
  const runDir = path.join(root, '.ai-engineering-loop', 'runs', 'run-001');
  fs.writeFileSync(path.join(runDir, 'goal-contract.json'), JSON.stringify({
    objective: 'Ship lean context artifacts',
    revision: 2,
    hash: 'abc123',
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'Reviewer reads summary first.',
      failureCases: ['Reviewer must read raw logs.']
    }]
  }));
  fs.writeFileSync(path.join(runDir, 'verification-summary.json'), JSON.stringify({
    passed: true,
    exitCode: 0,
    commandCount: 1,
    testCounts: { passed: 3, failed: 0, total: 3 },
    commands: [{ command: 'npm test', failureExcerpt: null }]
  }));
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify({
    findings: [
      { id: 'DA-01', validity: 'VALID', severity: 'HIGH', disposition: 'STRONG', axis: 'spec', title: 'Open issue' },
      { id: 'DA-02', validity: 'INVALID', severity: 'HIGH', disposition: 'DISMISSED', axis: 'spec', title: 'Closed issue' }
    ]
  }));

  const result = compactRun(root, { runId: 'run-001' });
  const summary = JSON.parse(fs.readFileSync(path.join(root, result.paths.summary), 'utf8'));
  const markdown = fs.readFileSync(path.join(root, result.paths.markdown), 'utf8');
  const openFindings = JSON.parse(fs.readFileSync(path.join(root, result.paths.openFindings), 'utf8'));

  assert.strictEqual(summary.goal.objective, 'Ship lean context artifacts');
  assert.strictEqual(summary.verification.passed, true);
  assert.deepStrictEqual(summary.openFindings.map((finding) => finding.id), ['DA-01']);
  assert.deepStrictEqual(openFindings.findings.map((finding) => finding.id), ['DA-01']);
  assert.match(markdown, /Reviewer read order/);
  assert.doesNotMatch(markdown, /commands/);
});
