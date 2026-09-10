'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { freezeGoal, saveGoalDraft, unfreezeGoal } = require('../lib/goal-runtime.js');
const { createRun, loadRun, RUN_STATES } = require('../lib/run-state.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-goal-'));
}

function contract(runId, objective = 'Implement safe local runtime') {
  return {
    schemaVersion: 1,
    runId,
    objective,
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'The local transition is authenticated',
      evidenceRequired: 'API test',
      failureCases: ['unauthenticated requests are rejected']
    }]
  };
}

test('goal freeze and unfreeze preserve immutable versions and audited actors', () => {
  const root = tempRepo();
  createRun(root, { runId: 'run-one', task: 'runtime' });
  saveGoalDraft(root, 'run-one', contract('run-one'));
  const frozen = freezeGoal(root, 'run-one', { actor: 'alice' });
  assert.equal(frozen.state, RUN_STATES.GOAL_FROZEN);
  assert.equal(frozen.goal.version, 1);
  assert.equal(frozen.goal.frozen, true);

  const unfrozen = unfreezeGoal(root, 'run-one', {
    actor: 'alice',
    reason: 'Add the denied timeout case'
  });
  assert.equal(unfrozen.state, RUN_STATES.STARTED);
  assert.equal(unfrozen.goal.version, 2);
  assert.equal(unfrozen.goal.frozen, false);
  assert.equal(loadRun(root, 'run-one').history.at(-1).reason, 'Add the denied timeout case');

  saveGoalDraft(root, 'run-one', contract('run-one', 'Implement safe local runtime with timeouts'));
  freezeGoal(root, 'run-one', { actor: 'alice' });
  assert.ok(fs.existsSync(path.join(root, '.ai-engineering-loop', 'runs', 'run-one', 'goal-contract.v1.json')));
  assert.ok(fs.existsSync(path.join(root, '.ai-engineering-loop', 'runs', 'run-one', 'goal-contract.v2.json')));
});

test('goal freeze rejects invalid contracts and unfreeze requires a reason', () => {
  const root = tempRepo();
  createRun(root, { runId: 'run-one', task: 'runtime' });
  saveGoalDraft(root, 'run-one', { schemaVersion: 1, runId: 'run-one', objective: 'No failures', acceptanceCriteria: [] });
  assert.throws(() => freezeGoal(root, 'run-one', { actor: 'alice' }), /Goal Contract/);
  saveGoalDraft(root, 'run-one', contract('run-one'));
  freezeGoal(root, 'run-one', { actor: 'alice' });
  assert.throws(
    () => unfreezeGoal(root, 'run-one', { actor: 'alice', reason: '' }),
    (error) => error.code === 'INVALID_UNFREEZE_REASON'
  );
});
