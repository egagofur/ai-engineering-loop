'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { budgetStatus, recordTokenUsage } = require('../lib/budget.js');
const { hashFile } = require('../lib/gates.js');
const { compileRecipe, loadRecipe } = require('../lib/recipe.js');
const { createRun, getGitRevision } = require('../lib/run-state.js');
const {
  NODE_STATES,
  applyWorkflowGate,
  approveWorkflowNode,
  assertSupportedSchema,
  completeWorkflowNode,
  createWorkflowBundle,
  failWorkflowNode,
  loadWorkflow,
  recordWorkflowActivity,
  retryWorkflowNode,
  startWorkflowNode
} = require('../lib/workflow-runtime.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-workflow-'));
}

function createRecipeRun(root, recipeId, mode, runId = 'run-001') {
  const recipe = loadRecipe(root, recipeId).recipe;
  const plan = compileRecipe(recipe, { mode });
  const workflow = createWorkflowBundle(plan, runId, {
    now: new Date('2025-01-01T00:00:00.000Z'),
    run: { runId, mode, state: 'STARTED', iteration: 1, task: 'test workflow' }
  });
  return createRun(root, {
    runId,
    mode,
    task: 'test workflow',
    workflow,
    now: new Date('2025-01-01T00:00:00.000Z')
  });
}

function writeJson(root, runId, name, value) {
  const file = path.join(root, '.ai-engineering-loop', 'runs', runId, name);
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  return path.relative(root, file);
}

function passGoal(root, runId = 'run-001') {
  writeJson(root, runId, 'goal-contract.json', {
    schemaVersion: 1,
    runId,
    objective: 'Verify the controlled workflow runtime.',
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'The graph advances deterministically.',
      evidenceRequired: 'Runtime state assertions.',
      failureCases: ['A dependency is bypassed.']
    }]
  });
  return applyWorkflowGate(root, 'goal', { runId });
}

function advanceDefaultToJudge(root, findings = []) {
  passGoal(root);
  const diffPath = path.join(root, writeJson(
    root,
    'run-001',
    'diff.patch',
    'diff --git a/a.js b/a.js\n+const value = 1;\n'
  ));
  applyWorkflowGate(root, 'maker', { runId: 'run-001' });
  const diffHash = hashFile(diffPath);
  writeJson(root, 'run-001', 'verification.json', {
    schemaVersion: 1,
    runId: 'run-001',
    gitRevision: getGitRevision(root),
    diffHash,
    commands: [{
      command: 'node --test',
      executionIdentity: 'pid-123',
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-01-01T00:00:01.000Z',
      exitCode: 0,
      stdout: '1 test passed',
      timeoutStatus: 'COMPLETED',
      testCounts: { passed: 1, failed: 0 }
    }]
  });
  applyWorkflowGate(root, 'verification', { runId: 'run-001' });
  writeJson(root, 'run-001', 'findings.json', {
    schemaVersion: 1,
    runId: 'run-001',
    diffHash,
    findings
  });
  applyWorkflowGate(root, 'review', { runId: 'run-001' });
}

test('recipe-bound runs persist an immutable plan and initial READY node', () => {
  const root = tempRepo();
  const run = createRecipeRun(root, 'default', 'ASSISTED');
  const workflow = loadWorkflow(root, run.runId);
  assert.equal(run.workflow.recipeId, 'default');
  assert.equal(workflow.state.nodes.goal.status, NODE_STATES.READY);
  assert.equal(workflow.state.nodes.maker.status, NODE_STATES.PENDING);
  assert.throws(
    () => applyWorkflowGate(root, 'maker', { runId: run.runId }),
    { code: 'NODE_NOT_READY' }
  );
});

test('audit workflow advances through gate, validated agent artifact, and report', () => {
  const root = tempRepo();
  createRecipeRun(root, 'audit', 'REPORT_ONLY');
  passGoal(root);
  assert.equal(loadWorkflow(root, 'run-001').state.nodes['repository-analysis'].status, NODE_STATES.READY);

  const analysis = writeJson(root, 'run-001', 'repository-analysis.json', {
    schemaVersion: 1,
    runId: 'run-001',
    summary: 'No unsafe mutation was performed.',
    recommendations: ['Keep REPORT_ONLY fail-closed.']
  });
  completeWorkflowNode(root, 'repository-analysis', { runId: 'run-001', artifact: analysis });
  assert.equal(loadWorkflow(root, 'run-001').state.nodes.report.status, NODE_STATES.READY);

  writeJson(root, 'run-001', 'report.json', {
    schemaVersion: 1,
    runId: 'run-001',
    summary: 'Audit complete.',
    recommendations: []
  });
  const result = applyWorkflowGate(root, 'report', { runId: 'run-001' });
  assert.equal(result.run.state, 'REPORTED');
  assert.equal(result.workflow.state.nodes.report.status, NODE_STATES.PASSED);
});

test('agent artifacts are bound to run id and validated against their declared schema', () => {
  const root = tempRepo();
  createRecipeRun(root, 'audit', 'REPORT_ONLY');
  passGoal(root);
  const artifact = writeJson(root, 'run-001', 'invalid-analysis.json', {
    schemaVersion: 1,
    runId: 'another-run',
    recommendations: []
  });
  assert.throws(
    () => completeWorkflowNode(root, 'repository-analysis', { runId: 'run-001', artifact }),
    { code: 'INVALID_NODE_ARTIFACT' }
  );
  assert.equal(loadWorkflow(root, 'run-001').state.nodes['repository-analysis'].status, NODE_STATES.READY);
});

test('artifact schema validation rejects unsupported keywords instead of ignoring them', () => {
  assert.throws(
    () => assertSupportedSchema({ type: 'object', oneOf: [{ required: ['result'] }] }),
    { code: 'UNSUPPORTED_ARTIFACT_SCHEMA' }
  );
});

test('agent node token budgets are enforced and provider usage is attributed', () => {
  const root = tempRepo();
  createRecipeRun(root, 'audit', 'REPORT_ONLY');
  passGoal(root);
  const blocked = budgetStatus(root, {
    runId: 'run-001',
    nodeId: 'repository-analysis',
    estimatedTokens: 12001
  });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.reasons.some((reason) => reason.includes('node repository-analysis token limit')));
  const recorded = recordTokenUsage(root, {
    runId: 'run-001',
    nodeId: 'repository-analysis',
    inputTokens: 80,
    outputTokens: 20,
    model: 'provider/cheap-model'
  });
  assert.equal(recorded.entry.nodeId, 'repository-analysis');
  assert.equal(recorded.status.spentThisNode, 100);
  assert.equal(recorded.status.remainingThisNode, 11900);
});

test('custom nodes support explicit start, failure blocking, and retry recovery', () => {
  const root = tempRepo();
  createRecipeRun(root, 'audit', 'REPORT_ONLY');
  passGoal(root);
  const started = startWorkflowNode(root, 'repository-analysis', { runId: 'run-001' });
  assert.equal(started.state.nodes['repository-analysis'].status, NODE_STATES.RUNNING);
  assert.equal(started.state.nodes['repository-analysis'].attempts, 1);
  const failed = failWorkflowNode(root, 'repository-analysis', {
    runId: 'run-001',
    reason: 'provider timeout'
  });
  assert.equal(failed.state.nodes['repository-analysis'].status, NODE_STATES.FAILED);
  assert.equal(failed.state.nodes.report.status, NODE_STATES.BLOCKED);
  const retried = retryWorkflowNode(root, 'repository-analysis', { runId: 'run-001' });
  assert.equal(retried.state.nodes['repository-analysis'].status, NODE_STATES.READY);
  assert.equal(retried.state.nodes.report.status, NODE_STATES.PENDING);
});

test('running nodes record redacted activity in the integrity-bound event log', () => {
  const root = tempRepo();
  createRecipeRun(root, 'audit', 'REPORT_ONLY');
  passGoal(root);
  startWorkflowNode(root, 'repository-analysis', { runId: 'run-001' });
  const updated = recordWorkflowActivity(root, 'repository-analysis', {
    runId: 'run-001',
    message: 'Reading evidence with token sk-live-secretvalue123456'
  });
  assert.equal(updated.state.nodes['repository-analysis'].status, NODE_STATES.RUNNING);
  assert.match(updated.state.nodes['repository-analysis'].activity, /\[REDACTED API TOKEN\]/);
  assert.equal(updated.events.at(-1).type, 'NODE_ACTIVITY');
  assert.throws(
    () => recordWorkflowActivity(root, 'report', { runId: 'run-001', message: 'not running' }),
    { code: 'INVALID_NODE_TRANSITION' }
  );
});

test('approval nodes require the dedicated explicit executor', () => {
  const root = tempRepo();
  createRecipeRun(root, 'high-risk', 'ASSISTED');
  passGoal(root);
  const risk = writeJson(root, 'run-001', 'risk.json', {
    schemaVersion: 1,
    runId: 'run-001',
    summary: 'Risk is bounded.',
    recommendations: []
  });
  completeWorkflowNode(root, 'risk-analysis', { runId: 'run-001', artifact: risk });
  assert.equal(loadWorkflow(root, 'run-001').state.nodes['plan-approval'].status, NODE_STATES.READY);
  assert.throws(
    () => completeWorkflowNode(root, 'plan-approval', { runId: 'run-001' }),
    { code: 'WRONG_NODE_EXECUTOR' }
  );
  const approved = approveWorkflowNode(root, 'plan-approval', {
    runId: 'run-001',
    approvedBy: 'reviewer'
  });
  assert.equal(approved.state.nodes['plan-approval'].approvedBy, 'reviewer');
  assert.equal(approved.state.nodes.maker.status, NODE_STATES.READY);
});

test('UNATTENDED condition skips delivery approval after Judge dependency resolves', () => {
  const root = tempRepo();
  createRecipeRun(root, 'default', 'UNATTENDED');
  const workflow = loadWorkflow(root, 'run-001');
  assert.equal(workflow.state.nodes['delivery-approval'].status, NODE_STATES.PENDING);
  assert.equal(workflow.plan.nodes.find((node) => node.id === 'delivery-approval').when.value, 'ASSISTED');
});

test('default workflow exits its Engineering Loop only after Judge passes', () => {
  const root = tempRepo();
  createRecipeRun(root, 'default', 'ASSISTED');
  advanceDefaultToJudge(root);
  writeJson(root, 'run-001', 'verdict.json', {
    schemaVersion: 1,
    runId: 'run-001',
    verdict: 'PASS',
    reason: 'All acceptance criteria have current evidence.',
    action: 'Continue to delivery approval.'
  });

  const result = applyWorkflowGate(root, 'judge', { runId: 'run-001' });

  assert.equal(result.workflow.state.loopGroups['engineering-loop'].status, 'EXITED');
  assert.equal(result.workflow.state.loopGroups['engineering-loop'].lastOutcome, 'PASS');
  assert.equal(result.workflow.state.nodes['delivery-approval'].status, NODE_STATES.READY);
  assert.equal(result.workflow.state.nodes.delivery.status, NODE_STATES.PENDING);
});

test('default workflow repeats only its Engineering Loop when Judge requests rework', () => {
  const root = tempRepo();
  createRecipeRun(root, 'default', 'ASSISTED');
  advanceDefaultToJudge(root, [{
    id: 'DA-01',
    axis: 'spec',
    location: 'a.js#L1',
    failureScenario: 'The required boundary is not handled.',
    evidence: 'Observed missing branch.',
    severity: 'HIGH',
    validity: 'VALID',
    disposition: 'STRONG',
    concreteAlternativeDiff: '+ handleBoundary();'
  }]);
  writeJson(root, 'run-001', 'verdict.json', {
    schemaVersion: 1,
    runId: 'run-001',
    verdict: 'ITERATE',
    reason: 'A valid HIGH finding remains.',
    action: 'Maker applies the alternative.'
  });

  const result = applyWorkflowGate(root, 'judge', { runId: 'run-001' });

  assert.equal(result.workflow.state.loopGroups['engineering-loop'].status, 'RUNNING');
  assert.equal(result.workflow.state.loopGroups['engineering-loop'].iteration, 2);
  assert.equal(result.workflow.state.loopGroups['engineering-loop'].lastOutcome, 'ITERATE');
  assert.equal(result.workflow.state.nodes.maker.status, NODE_STATES.READY);
  assert.equal(result.workflow.state.nodes.verification.status, NODE_STATES.PENDING);
  assert.equal(result.workflow.state.nodes['delivery-approval'].status, NODE_STATES.PENDING);
});

test('event log reconstructs a tampered or stale workflow state cache', () => {
  const root = tempRepo();
  createRecipeRun(root, 'audit', 'REPORT_ONLY');
  passGoal(root);
  const statePath = path.join(root, '.ai-engineering-loop/runs/run-001/workflow-state.json');
  const tampered = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  tampered.nodes.goal.status = NODE_STATES.FAILED;
  tampered.sequence = 1;
  fs.writeFileSync(statePath, JSON.stringify(tampered));
  const recovered = loadWorkflow(root, 'run-001');
  assert.equal(recovered.state.nodes.goal.status, NODE_STATES.PASSED);
  assert.equal(recovered.state.sequence, 2);
});

test('plan and event tampering fail closed', () => {
  const root = tempRepo();
  createRecipeRun(root, 'default', 'ASSISTED');
  const planPath = path.join(root, '.ai-engineering-loop/runs/run-001/plan.json');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  plan.nodes[0].type = 'delivery';
  fs.writeFileSync(planPath, JSON.stringify(plan));
  assert.throws(() => loadWorkflow(root, 'run-001'), { code: 'WORKFLOW_PLAN_TAMPERED' });

  const eventRoot = tempRepo();
  createRecipeRun(eventRoot, 'default', 'ASSISTED');
  const eventsPath = path.join(eventRoot, '.ai-engineering-loop/runs/run-001/events.jsonl');
  const event = JSON.parse(fs.readFileSync(eventsPath, 'utf8').trim());
  event.initialNodes.goal.status = NODE_STATES.PASSED;
  fs.writeFileSync(eventsPath, `${JSON.stringify(event)}\n`);
  assert.throws(() => loadWorkflow(eventRoot, 'run-001'), { code: 'INVALID_WORKFLOW_EVENTS' });
});
