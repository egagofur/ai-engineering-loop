const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyGate, artifactPath, hashFile } = require('../lib/gates.js');
const { RUN_STATES, createRun, getGitRevision, loadRun } = require('../lib/run-state.js');

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-gates-'));
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

function goal() {
  return {
    schemaVersion: 1,
    runId: 'run-001',
    objective: 'Implement deterministic gates',
    acceptanceCriteria: [
      {
        id: 'AC-1',
        statement: 'Valid evidence advances the run',
        evidenceRequired: 'gate tests pass',
        failureCases: ['missing evidence is rejected']
      }
    ]
  };
}

function verification(root, diffHash) {
  return {
    schemaVersion: 1,
    runId: 'run-001',
    gitRevision: getGitRevision(root),
    diffHash,
    commands: [
      {
        command: 'node --test',
        executionIdentity: 'pid-123',
        startTime: '2025-01-01T00:00:00.000Z',
        endTime: '2025-01-01T00:00:01.000Z',
        exitCode: 0,
        stdout: '1 test passed',
        timeoutStatus: 'COMPLETED',
        testCounts: { passed: 1, failed: 0 }
      }
    ]
  };
}

function advanceToReviewed(root, findings = []) {
  writeArtifact(root, 'goal-contract.json', goal());
  applyGate(root, 'goal');
  const diffPath = writeArtifact(root, 'diff.patch', 'diff --git a/a.js b/a.js\n+const value = 1;\n');
  applyGate(root, 'maker');
  const diffHash = hashFile(diffPath);
  writeArtifact(root, 'verification.json', verification(root, diffHash));
  applyGate(root, 'verification');
  writeArtifact(root, 'findings.json', {
    schemaVersion: 1,
    runId: 'run-001',
    diffHash,
    findings
  });
  applyGate(root, 'review');
  return diffHash;
}

test('all valid gates advance a run to delivered', () => {
  const root = tempRepo();
  advanceToReviewed(root);
  writeArtifact(root, 'verdict.json', {
    schemaVersion: 1,
    runId: 'run-001',
    verdict: 'PASS',
    reason: 'All acceptance criteria have current evidence',
    action: 'Proceed to delivery'
  });
  assert.strictEqual(applyGate(root, 'judge').state, RUN_STATES.JUDGED_PASS);
  writeArtifact(root, 'delivery.json', {
    schemaVersion: 1,
    runId: 'run-001',
    destination: 'https://example.test/pull/1',
    summary: 'Opened pull request'
  });
  assert.strictEqual(applyGate(root, 'delivery').state, RUN_STATES.DELIVERED);
});

test('goal gate rejects contracts without a failure table', () => {
  const root = tempRepo();
  const invalid = goal();
  invalid.acceptanceCriteria[0].failureCases = [];
  writeArtifact(root, 'goal-contract.json', invalid);
  assert.throws(
    () => applyGate(root, 'goal'),
    (err) => err.code === 'GATE_FAILED' && err.details.some((detail) => detail.includes('failureCases'))
  );
});

test('verification gate rejects stale diff evidence', () => {
  const root = tempRepo();
  writeArtifact(root, 'goal-contract.json', goal());
  applyGate(root, 'goal');
  writeArtifact(root, 'diff.patch', 'diff --git a/a b/a\n+first\n');
  applyGate(root, 'maker');
  writeArtifact(root, 'verification.json', verification(root, 'stale-hash'));
  assert.throws(
    () => applyGate(root, 'verification'),
    (err) => err.code === 'GATE_FAILED' && err.details.some((detail) => detail.includes('diffHash'))
  );
});

test('unsupported PASS is rejected and a blocking finding iterates', () => {
  const root = tempRepo();
  advanceToReviewed(root, [
    {
      id: 'DA-01',
      axis: 'spec',
      location: 'a.js#L1',
      failureScenario: 'The required boundary is not handled',
      evidence: 'Observed missing branch',
      severity: 'HIGH',
      validity: 'VALID',
      disposition: 'STRONG',
      concreteAlternativeDiff: '+ handleBoundary();'
    }
  ]);
  writeArtifact(root, 'verdict.json', {
    schemaVersion: 1,
    runId: 'run-001',
    verdict: 'PASS',
    reason: 'Looks good',
    action: 'Deliver'
  });
  assert.throws(() => applyGate(root, 'judge'), /expected ITERATE/);

  writeArtifact(root, 'verdict.json', {
    schemaVersion: 1,
    runId: 'run-001',
    verdict: 'ITERATE',
    reason: 'A valid HIGH finding remains',
    action: 'Maker applies the alternative'
  });
  const iterated = applyGate(root, 'judge');
  assert.strictEqual(iterated.state, RUN_STATES.GOAL_FROZEN);
  assert.strictEqual(iterated.iteration, 2);
  assert.strictEqual(loadRun(root, 'run-001').state, RUN_STATES.GOAL_FROZEN);
});
