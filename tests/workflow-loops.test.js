'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { sha256 } = require('../lib/recipe.js');
const { createRun } = require('../lib/run-state.js');
const {
  NODE_STATES,
  createWorkflowBundle,
  resolveLoopLimit,
  resolveWorkflowDecision,
  workflowStatus
} = require('../lib/workflow-runtime.js');

function compiledPlan() {
  const nodes = [
    { id: 'trigger', type: 'trigger', dependsOn: [], order: 1 },
    { id: 'work', type: 'decision', dependsOn: ['trigger'], order: 2 },
    { id: 'check', type: 'decision', dependsOn: ['work'], order: 3 },
    { id: 'after', type: 'decision', dependsOn: ['check'], order: 4 }
  ];
  const loopGroups = [{
    id: 'quality-loop',
    displayName: 'Quality loop',
    nodeIds: ['work', 'check'],
    entryNodeId: 'work',
    decisionNodeId: 'check',
    repeatTargetId: 'work',
    exitTargetId: 'after',
    maxIterations: 2,
    repeatOutcome: 'NO',
    exitOutcome: 'YES',
    repeatLabel: 'NO · RETRY',
    exitLabel: 'YES · CONTINUE'
  }];
  const material = {
    schemaVersion: 1,
    compilerVersion: 1,
    recipe: { id: 'loop-runtime', version: 1, sourceHash: sha256('loop-runtime') },
    mode: 'ASSISTED',
    nodes,
    loopGroups
  };
  return { ...material, graphHash: sha256(material), warnings: [] };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-workflow-loop-'));
  const runId = '20260910T193000Z-aabbccdd';
  const plan = compiledPlan();
  createRun(root, {
    runId,
    task: 'Loop runtime',
    workflow: createWorkflowBundle(plan, runId, {
      run: { runId, mode: 'ASSISTED', state: 'STARTED', iteration: 1, task: 'Loop runtime' }
    })
  });
  resolveWorkflowDecision(root, 'trigger', { runId, outcome: 'START' });
  return { root, runId };
}

test('AC-15/17 repeats a group with an independent integrity-bound iteration counter', () => {
  const { root, runId } = fixture();
  resolveWorkflowDecision(root, 'work', { runId, outcome: 'DONE' });
  resolveWorkflowDecision(root, 'check', { runId, outcome: 'NO' });
  const workflow = workflowStatus(root, { runId });
  assert.equal(workflow.state.loopGroups['quality-loop'].iteration, 2);
  assert.equal(workflow.state.nodes.work.status, NODE_STATES.READY);
  assert.equal(workflow.state.nodes.after.status, NODE_STATES.PENDING);
  assert.equal(workflow.events.at(-1).type, 'LOOP_REPEATED');
});

test('AC-8/18 blocks exactly at the maximum instead of silently exiting', () => {
  const { root, runId } = fixture();
  resolveWorkflowDecision(root, 'work', { runId, outcome: 'DONE' });
  resolveWorkflowDecision(root, 'check', { runId, outcome: 'NO' });
  resolveWorkflowDecision(root, 'work', { runId, outcome: 'DONE' });
  resolveWorkflowDecision(root, 'check', { runId, outcome: 'NO' });
  const workflow = workflowStatus(root, { runId });
  assert.equal(workflow.state.loopGroups['quality-loop'].status, 'BLOCKED');
  assert.equal(workflow.state.nodes.check.status, NODE_STATES.BLOCKED);
  assert.equal(workflow.state.nodes.after.status, NODE_STATES.PENDING);
  assert.equal(workflow.events.at(-1).type, 'LOOP_LIMIT_REACHED');
});

test('AC-19 approves one extra iteration with actor and reason evidence', () => {
  const { root, runId } = fixture();
  resolveWorkflowDecision(root, 'work', { runId, outcome: 'DONE' });
  resolveWorkflowDecision(root, 'check', { runId, outcome: 'NO' });
  resolveWorkflowDecision(root, 'work', { runId, outcome: 'DONE' });
  resolveWorkflowDecision(root, 'check', { runId, outcome: 'NO' });
  resolveLoopLimit(root, 'quality-loop', {
    runId,
    action: 'EXTRA_ITERATION',
    expectedIteration: 2,
    actor: 'studio-user',
    reason: 'Apply the final focused fix'
  });
  const workflow = workflowStatus(root, { runId });
  assert.equal(workflow.state.loopGroups['quality-loop'].iteration, 3);
  assert.equal(workflow.events.at(-1).actor, 'studio-user');
  assert.equal(workflow.state.nodes.work.status, NODE_STATES.READY);
});

test('AC-19/28 exits at the limit once and rejects a stale duplicate approval', () => {
  const { root, runId } = fixture();
  resolveWorkflowDecision(root, 'work', { runId, outcome: 'DONE' });
  resolveWorkflowDecision(root, 'check', { runId, outcome: 'NO' });
  resolveWorkflowDecision(root, 'work', { runId, outcome: 'DONE' });
  resolveWorkflowDecision(root, 'check', { runId, outcome: 'NO' });
  resolveLoopLimit(root, 'quality-loop', {
    runId,
    action: 'EXIT',
    expectedIteration: 2,
    actor: 'studio-user',
    reason: 'Accept current evidence'
  });
  assert.equal(workflowStatus(root, { runId }).state.nodes.after.status, NODE_STATES.READY);
  assert.throws(() => resolveLoopLimit(root, 'quality-loop', {
    runId,
    action: 'EXIT',
    expectedIteration: 2,
    actor: 'studio-user',
    reason: 'Duplicate request'
  }), { code: 'LOOP_NOT_BLOCKED' });
});

test('AC-9 rejects an outcome that is not configured for the group', () => {
  const { root, runId } = fixture();
  resolveWorkflowDecision(root, 'work', { runId, outcome: 'DONE' });
  assert.throws(
    () => resolveWorkflowDecision(root, 'check', { runId, outcome: 'MAYBE' }),
    { code: 'INVALID_LOOP_OUTCOME' }
  );
});

test('AC-27 reconstructs Loop Group state from append-only events after cache tampering', () => {
  const { root, runId } = fixture();
  resolveWorkflowDecision(root, 'work', { runId, outcome: 'DONE' });
  resolveWorkflowDecision(root, 'check', { runId, outcome: 'NO' });
  const statePath = path.join(root, '.ai-engineering-loop', 'runs', runId, 'workflow-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.loopGroups['quality-loop'].iteration = 99;
  fs.writeFileSync(statePath, JSON.stringify(state));
  assert.equal(workflowStatus(root, { runId }).state.loopGroups['quality-loop'].iteration, 2);
});

test('AC-19 STOP ends the Run and records the accountable actor and reason', () => {
  const { root, runId } = fixture();
  resolveWorkflowDecision(root, 'work', { runId, outcome: 'DONE' });
  resolveWorkflowDecision(root, 'check', { runId, outcome: 'NO' });
  resolveWorkflowDecision(root, 'work', { runId, outcome: 'DONE' });
  resolveWorkflowDecision(root, 'check', { runId, outcome: 'NO' });
  resolveLoopLimit(root, 'quality-loop', {
    runId,
    action: 'STOP',
    expectedIteration: 2,
    actor: 'studio-user',
    reason: 'Evidence is insufficient to continue safely'
  });
  const workflow = workflowStatus(root, { runId });
  assert.equal(workflow.run.state, 'CANCELLED');
  assert.equal(workflow.state.loopGroups['quality-loop'].status, 'STOPPED');
  assert.equal(workflow.events.at(-1).type, 'LOOP_RUN_STOPPED');
  assert.equal(workflow.events.at(-1).actor, 'studio-user');
});
