const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyGate, artifactPath, hashFile } = require('../lib/gates.js');
const { RUN_STATES, createRun, getGitRevision, loadRun } = require('../lib/run-state.js');
const { runMaxIterations, readIterations } = require('../lib/no-progress.js');

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-judge-progress-'));
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  createRun(root, { runId: 'run-001', task: 'fixture' });
  return root;
}

function writeArtifact(root, name, value) {
  const filePath = artifactPath(root, 'run-001', name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

const goal = {
  schemaVersion: 1,
  runId: 'run-001',
  objective: 'Fixture objective',
  acceptanceCriteria: [{ id: 'AC-1', statement: 'Works', evidenceRequired: 'tests pass', failureCases: ['bad input rejected'] }]
};

function blocker(id = 'F-1', location = 'a.js:1') {
  return {
    id,
    location,
    failureScenario: 'null input crashes the handler',
    evidence: 'a.js:1 dereferences input without a check',
    severity: 'BLOCKER',
    validity: 'VALID',
    disposition: 'STRONG',
    concreteAlternativeDiff: '- input.x\n+ input?.x'
  };
}

function iterate(root, { diff, findings = [] }) {
  const diffPath = writeArtifact(root, 'diff.patch', diff);
  applyGate(root, 'maker');
  const diffHash = hashFile(diffPath);
  writeArtifact(root, 'verification.json', {
    schemaVersion: 1,
    runId: 'run-001',
    gitRevision: getGitRevision(root),
    diffHash,
    commands: [{
      command: 'node --test',
      executionIdentity: 'pid-1',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:00:01.000Z',
      exitCode: 0,
      stdout: '1 test passed',
      timeoutStatus: 'COMPLETED',
      testCounts: { passed: 1, failed: 0 }
    }]
  });
  applyGate(root, 'verification');
  writeArtifact(root, 'findings.json', { schemaVersion: 1, runId: 'run-001', diffHash, findings });
  applyGate(root, 'review');
}

function verdict(value, extra = {}) {
  return { schemaVersion: 1, runId: 'run-001', verdict: value, reason: 'r', action: 'a', ...extra };
}

test('Judge can block a clean ledger by adding an evidence-backed finding', () => {
  const root = tempRepo();
  writeArtifact(root, 'goal-contract.json', goal);
  applyGate(root, 'goal');
  iterate(root, { diff: 'diff --git a/a.js b/a.js\n+one\n' });
  writeArtifact(root, 'verdict.json', verdict('PASS', { judgeFindings: [blocker('J-1')] }));
  assert.throws(() => applyGate(root, 'judge'), /expected ITERATE, received PASS/);
  writeArtifact(root, 'verdict.json', verdict('ITERATE', { judgeFindings: [blocker('J-1')] }));
  const run = applyGate(root, 'judge');
  assert.strictEqual(run.state, RUN_STATES.GOAL_FROZEN);
  assert.strictEqual(run.iteration, 2);
});

test('judgeFindings must satisfy the Finding Ledger schema', () => {
  const root = tempRepo();
  writeArtifact(root, 'goal-contract.json', goal);
  applyGate(root, 'goal');
  iterate(root, { diff: 'diff --git a/a.js b/a.js\n+one\n' });
  const { concreteAlternativeDiff, ...noDiff } = blocker('J-1');
  writeArtifact(root, 'verdict.json', verdict('ITERATE', { judgeFindings: [noDiff] }));
  assert.throws(() => applyGate(root, 'judge'), (err) => /concreteAlternativeDiff/.test(err.details.join(' ')));
});

test('repeating the same blocking findings escalates as NO_PROGRESS', () => {
  const root = tempRepo();
  writeArtifact(root, 'goal-contract.json', goal);
  applyGate(root, 'goal');
  iterate(root, { diff: 'diff --git a/a.js b/a.js\n+one\n', findings: [blocker()] });
  writeArtifact(root, 'verdict.json', verdict('ITERATE'));
  applyGate(root, 'judge');
  iterate(root, { diff: 'diff --git a/a.js b/a.js\n+two\n', findings: [blocker('F-9')] });
  writeArtifact(root, 'verdict.json', verdict('ITERATE'));
  assert.throws(() => applyGate(root, 'judge'), (err) => /expected ESCALATE/.test(err.message)
    && /repeats the blocking findings/.test(err.details.join(' ')));
  writeArtifact(root, 'verdict.json', verdict('ESCALATE'));
  assert.strictEqual(applyGate(root, 'judge').state, RUN_STATES.ESCALATED);
  assert.deepStrictEqual(readIterations(root, 'run-001').map((e) => e.verdict), ['ITERATE', 'ESCALATE']);
});

test('an unchanged Maker diff after ITERATE escalates as NO_PROGRESS', () => {
  const root = tempRepo();
  writeArtifact(root, 'goal-contract.json', goal);
  applyGate(root, 'goal');
  const diff = 'diff --git a/a.js b/a.js\n+same\n';
  iterate(root, { diff, findings: [blocker('F-1', 'a.js:1')] });
  writeArtifact(root, 'verdict.json', verdict('ITERATE'));
  applyGate(root, 'judge');
  iterate(root, { diff, findings: [blocker('F-2', 'b.js:9')] });
  writeArtifact(root, 'verdict.json', verdict('ESCALATE'));
  const run = applyGate(root, 'judge');
  assert.strictEqual(run.state, RUN_STATES.ESCALATED);
});

test('different blocking findings with a new diff keep iterating', () => {
  const root = tempRepo();
  writeArtifact(root, 'goal-contract.json', goal);
  applyGate(root, 'goal');
  iterate(root, { diff: 'diff --git a/a.js b/a.js\n+one\n', findings: [blocker('F-1', 'a.js:1')] });
  writeArtifact(root, 'verdict.json', verdict('ITERATE'));
  applyGate(root, 'judge');
  iterate(root, { diff: 'diff --git a/a.js b/a.js\n+two\n', findings: [blocker('F-2', 'b.js:9')] });
  writeArtifact(root, 'verdict.json', verdict('ITERATE'));
  assert.strictEqual(applyGate(root, 'judge').iteration, 3);
});

test('runMaxIterations reads the Judge loop group and clamps to 1..5', () => {
  const root = tempRepo();
  const run = loadRun(root, 'run-001');
  assert.strictEqual(runMaxIterations(root, run), 3, 'legacy run without workflow keeps the default');
  const withWorkflow = { ...run, workflow: { recipeId: 'x' } };
  const plan = (max) => ({
    nodes: [{ id: 'maker', type: 'maker' }, { id: 'judge', type: 'judge', legacyGate: 'judge' }],
    loopGroups: [{ id: 'loop', nodeIds: ['maker', 'judge'], decisionNodeId: 'judge', maxIterations: max }]
  });
  writeArtifact(root, 'plan.json', plan(2));
  assert.strictEqual(runMaxIterations(root, withWorkflow), 2);
  writeArtifact(root, 'plan.json', plan(40));
  assert.strictEqual(runMaxIterations(root, withWorkflow), 5);
  writeArtifact(root, 'plan.json', '{not json');
  assert.strictEqual(runMaxIterations(root, withWorkflow), 3);
});
