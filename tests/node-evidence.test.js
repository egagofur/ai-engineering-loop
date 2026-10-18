'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { artifactPath, hashFile } = require('../lib/gates.js');
const { computeJudgeVerdict } = require('../lib/orchestration.js');
const { nodeTiming, resolveNodeEvidence } = require('../lib/node-evidence.js');
const { runNodeIo } = require('../lib/run-checkout.js');
const { getGitRevision, loadRun } = require('../lib/run-state.js');
const { createStudioRun } = require('../lib/studio-runtime.js');
const { approveWorkflowNode, applyWorkflowGate, workflowStatus } = require('../lib/workflow-runtime.js');

function writeArtifact(root, runId, name, value) {
  const filePath = artifactPath(root, runId, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function goalContract(runId) {
  return {
    schemaVersion: 1,
    runId,
    objective: 'Add pagination to the list endpoint',
    acceptanceCriteria: [
      {
        id: 'AC-1',
        statement: 'page and limit return a bounded page',
        evidenceRequired: 'node --test',
        failureCases: ['an unbounded query is accepted']
      }
    ]
  };
}

function verificationBundle(root, runId, diffHash) {
  return {
    schemaVersion: 1,
    runId,
    gitRevision: getGitRevision(root),
    diffHash,
    commands: [
      {
        command: 'npm test',
        executionIdentity: 'pid-91',
        startTime: '2026-10-16T10:07:00.000Z',
        endTime: '2026-10-16T10:07:48.000Z',
        exitCode: 0,
        stdout: 'tests 3\npassed 3\nfailed 0\n',
        stderr: '',
        timeoutStatus: 'COMPLETED'
      }
    ]
  };
}

function findingsDoc(runId, diffHash) {
  return {
    schemaVersion: 1,
    runId,
    diffHash,
    findings: [
      {
        id: 'DA-1',
        axis: 'spec',
        location: 'src/routes/list.js',
        failureScenario: 'The empty page does not explain the next step',
        evidence: 'Observed an empty list with no message',
        severity: 'LOW',
        validity: 'VALID',
        disposition: 'ACCEPTABLE'
      }
    ]
  };
}

const DIFF = [
  'diff --git a/src/routes/list.js b/src/routes/list.js',
  '--- a/src/routes/list.js',
  '+++ b/src/routes/list.js',
  '@@ -1 +1,3 @@',
  '-old',
  '+new',
  '+line',
  'diff --git a/src/lib/paginate.js b/src/lib/paginate.js',
  '--- a/src/lib/paginate.js',
  '+++ b/src/lib/paginate.js',
  '@@ -0,0 +1 @@',
  '+exports.page = true;',
  ''
].join('\n');

function deliverClassicRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-node-evidence-'));
  const run = createStudioRun(root, {
    task: 'Add pagination to the list endpoint',
    recipeId: 'default',
    now: new Date('2026-10-16T10:00:00.000Z')
  });
  const runId = run.runId;
  writeArtifact(root, runId, 'goal-contract.json', goalContract(runId));
  applyWorkflowGate(root, 'goal', { runId, now: new Date('2026-10-16T10:01:12.000Z') });
  const diffPath = writeArtifact(root, runId, 'diff.patch', DIFF);
  applyWorkflowGate(root, 'maker', { runId, now: new Date('2026-10-16T10:05:23.000Z') });
  const diffHash = hashFile(diffPath);
  writeArtifact(root, runId, 'verification.json', verificationBundle(root, runId, diffHash));
  applyWorkflowGate(root, 'verification', { runId, now: new Date('2026-10-16T10:07:43.000Z') });
  const findings = findingsDoc(runId, diffHash);
  writeArtifact(root, runId, 'findings.json', findings);
  writeArtifact(root, runId, 'impact-drift.json', {
    schemaVersion: 1,
    runId,
    mapStatus: 'CONFIRMED',
    changedFiles: ['src/lib/paginate.js', 'src/routes/list.js'],
    outOfMap: []
  });
  applyWorkflowGate(root, 'review', { runId, now: new Date('2026-10-16T10:11:51.000Z') });
  const expected = computeJudgeVerdict({
    goalContract: goalContract(runId),
    verificationEvidence: {
      ...verificationBundle(root, runId, diffHash).commands[0],
      summary: 'npm test'
    },
    findingLedger: findings,
    activeIteration: 1,
    maxIterations: 3
  });
  writeArtifact(root, runId, 'verdict.json', {
    schemaVersion: 1,
    runId,
    verdict: expected.verdict,
    reason: expected.reason,
    action: expected.action,
    modelTier: 'CHEAP_MODEL'
  });
  applyWorkflowGate(root, 'judge', { runId, now: new Date('2026-10-16T10:12:04.000Z') });
  approveWorkflowNode(root, 'delivery-approval', {
    runId,
    approvedBy: 'ega',
    now: new Date('2026-10-16T10:22:04.000Z')
  });
  writeArtifact(root, runId, 'delivery.json', {
    schemaVersion: 1,
    runId,
    destination: 'https://example.test/pull/91',
    summary: 'Opened the pagination pull request',
    humanApproved: true,
    approvedBy: 'ega'
  });
  applyWorkflowGate(root, 'delivery', { runId, now: new Date('2026-10-16T10:22:05.000Z') });
  return { root, runId };
}

test('built-in nodes resolve evidence from run files when node.artifact is absent', () => {
  const { root, runId } = deliverClassicRun();
  const workflow = workflowStatus(root, { runId });
  for (const node of workflow.plan.nodes) {
    assert.equal(workflow.state.nodes[node.id].artifact, undefined);
  }
  const loaded = loadRun(root, runId);
  assert.equal(loaded.artifacts.goalContract.sha256.length, 64);
  assert.equal(loaded.artifacts.receipt, undefined);

  const byType = Object.fromEntries(workflow.plan.nodes.map((node) => [node.type, runNodeIo(root, runId, node.id)]));
  const goal = byType['goal-contract'];
  assert.equal(goal.output.artifact, null);
  assert.equal(goal.evidence, null);
  assert.equal(goal.nodeEvidence.status, 'present');
  assert.equal(goal.nodeEvidence.goal.acceptanceCriteria, 1);
  assert.equal(goal.nodeEvidence.goal.version, 1);
  assert.match(goal.nodeEvidence.summary, /1 acceptance criteria/);
  assert.ok(goal.durationMs > 0);
  assert.equal(goal.finishedAt, '2026-10-16T10:01:12.000Z');

  const maker = byType.maker;
  assert.equal(maker.nodeEvidence.diff.fileCount, 2);
  assert.equal(maker.nodeEvidence.diff.plus, 3);
  assert.equal(maker.nodeEvidence.diff.minus, 1);
  assert.deepEqual(maker.nodeEvidence.diff.files, ['src/routes/list.js', 'src/lib/paginate.js']);
  assert.equal(maker.nodeEvidence.diff.drift, 'none');
  assert.ok(maker.durationMs > 0);
  assert.match(maker.timelineGroups.flatMap((group) => group.events).map((event) => event.label).join('\n'), /Maker gate passed · 2 files/);

  const verification = byType.verification;
  const command = verification.nodeEvidence.verification.commands[0];
  assert.equal(command.command, 'npm test');
  assert.equal(command.exitCode, 0);
  assert.equal(command.passed, 3);
  assert.equal(command.failed, 0);
  assert.equal(command.durationMs, 48000);
  assert.equal(command.outputSha256.length, 64);
  assert.ok(verification.nodeEvidence.cards.some((card) => card.id === 'diff'));
  assert.ok(verification.nodeEvidence.cards.some((card) => card.id === 'claimed'));
  assert.ok(verification.durationMs > 0);

  const review = byType['devil-advocate'];
  assert.equal(review.nodeEvidence.findings.count, 1);
  assert.equal(review.nodeEvidence.findings.blocking, 0);
  assert.equal(review.nodeEvidence.findings.bySeverity.LOW, 1);
  assert.match(review.nodeEvidence.findings.top[0].failureScenario, /empty page/);
  assert.ok(review.durationMs > 0);

  const judge = byType.judge;
  assert.equal(judge.nodeEvidence.verdict.verdict, 'PASS');
  assert.equal(judge.nodeEvidence.verdict.criteria[0].id, 'AC-1');
  assert.match(judge.nodeEvidence.summary, /PASS/);
  assert.ok(judge.durationMs > 0);

  const approval = byType.approval;
  assert.equal(approval.nodeEvidence.approval.approvedBy, 'ega');
  assert.equal(approval.nodeEvidence.approval.at, '2026-10-16T10:22:04.000Z');
  assert.ok(approval.durationMs > 0);

  const delivery = byType.delivery;
  assert.equal(delivery.nodeEvidence.receipt.destination, 'https://example.test/pull/91');
  assert.equal(delivery.nodeEvidence.receipt.message, 'no receipt: run predates receipts');
  assert.match(delivery.nodeEvidence.summary, /no receipt: run predates receipts/);
  assert.ok(delivery.durationMs > 0);
  assert.equal(delivery.nodeEvidence.files.some((file) => file.state === 'verified'), true);

  for (const io of Object.values(byType)) {
    assert.equal(JSON.stringify(io).includes('No artifact'), false);
    assert.ok(io.timelineGroups.every((group) => !/^\d+\./.test(group.label)));
  }
});

test('a sha256 mismatch reports artifact changed and does not trust the new bytes', () => {
  const { root, runId } = deliverClassicRun();
  const filePath = artifactPath(root, runId, 'verification.json');
  const tampered = `${fs.readFileSync(filePath, 'utf8')}\nTAMPERED-OUTPUT-SENTINEL\n`;
  fs.writeFileSync(filePath, tampered);
  const io = runNodeIo(root, runId, 'verification');
  assert.equal(io.nodeEvidence.status, 'changed');
  assert.equal(io.nodeEvidence.message, 'artifact changed');
  assert.equal(JSON.stringify(io.nodeEvidence).includes('TAMPERED-OUTPUT-SENTINEL'), false);
  assert.equal(io.nodeEvidence.verification, undefined);
});

test('evidence reads stay inside the run directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-node-evidence-path-'));
  const run = createStudioRun(root, { task: 'Confine evidence', recipeId: 'default' });
  const outside = path.join(root, 'secret.txt');
  fs.writeFileSync(outside, 'SECRET-OUTSIDE-SENTINEL');
  const runDir = path.join(root, '.ai-engineering-loop', 'runs', run.runId);
  fs.symlinkSync(outside, path.join(runDir, 'diff.patch'));
  const linked = resolveNodeEvidence({
    rootDir: root,
    run: {
      runId: run.runId,
      artifacts: {
        diff: {
          path: `.ai-engineering-loop/runs/${run.runId}/diff.patch`,
          sha256: hashFile(outside)
        }
      }
    },
    node: { id: 'maker', type: 'maker', legacyGate: 'maker' },
    runtime: {}
  });
  assert.equal(linked.status, 'rejected');
  assert.equal(JSON.stringify(linked).includes('SECRET-OUTSIDE-SENTINEL'), false);

  const escaped = resolveNodeEvidence({
    rootDir: root,
    run: {
      runId: run.runId,
      artifacts: {
        diff: {
          path: `.ai-engineering-loop/runs/${run.runId}/../../secret.txt`,
          sha256: crypto.createHash('sha256').update('x').digest('hex')
        }
      }
    },
    node: { id: 'maker', type: 'maker' },
    runtime: {}
  });
  assert.equal(escaped.status, 'rejected');
  assert.equal(JSON.stringify(escaped).includes('SECRET-OUTSIDE-SENTINEL'), false);
});

test('a node artifact stays authoritative over built-in run files', () => {
  const { root, runId } = deliverClassicRun();
  const customPath = artifactPath(root, runId, 'custom.txt');
  fs.writeFileSync(customPath, 'custom agent artifact\n');
  const evidence = resolveNodeEvidence({
    rootDir: root,
    run: loadRun(root, runId),
    node: { id: 'maker', type: 'maker', legacyGate: 'maker' },
    runtime: {
      artifact: {
        path: `.ai-engineering-loop/runs/${runId}/custom.txt`,
        sha256: hashFile(customPath)
      }
    }
  });
  assert.equal(evidence.source, 'node');
  assert.match(evidence.summary, /custom\.txt/);
  assert.equal(evidence.diff, undefined);
  assert.equal(evidence.cards.some((card) => card.id === 'diff'), false);
});

test('node duration uses lifecycle NODE_COMPLETED when the workflow log has no NODE_COMPLETED', () => {
  const duration = nodeTiming({
    nodeId: 'maker',
    status: 'PASSED',
    workflowEvents: [
      { type: 'WORKFLOW_CREATED', at: '2026-10-16T10:00:00.000Z' },
      { type: 'GATE_PASSED', nodeId: 'goal', gate: 'goal', at: '2026-10-16T10:01:00.000Z' }
    ],
    lifecycleEvents: [
      { type: 'NODE_STARTED', nodeId: 'maker', at: '2026-10-16T10:01:00.000Z' },
      { type: 'NODE_COMPLETED', nodeId: 'maker', at: '2026-10-16T10:05:11.000Z' }
    ]
  });
  assert.equal(duration.durationMs, 251000);
  assert.equal(duration.finishedAt, '2026-10-16T10:05:11.000Z');

  const fromGate = nodeTiming({
    nodeId: 'verification',
    status: 'PASSED',
    workflowEvents: [
      { type: 'GATE_PASSED', nodeId: 'maker', gate: 'maker', at: '2026-10-16T10:05:23.000Z' },
      { type: 'GATE_PASSED', nodeId: 'verification', gate: 'verification', at: '2026-10-16T10:07:43.000Z' }
    ],
    lifecycleEvents: []
  });
  assert.equal(fromGate.durationMs, 140000);
  assert.notEqual(fromGate.durationMs, 0);
});
