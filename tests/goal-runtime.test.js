'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { freezeGoal, loadGoalDraft, saveGoalDraft, unfreezeGoal } = require('../lib/goal-runtime.js');
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
  assert.throws(
    () => saveGoalDraft(root, 'run-one', {
      schemaVersion: 1,
      runId: 'run-one',
      objective: 'No failures',
      acceptanceCriteria: []
    }),
    /Goal Contract/
  );
  saveGoalDraft(root, 'run-one', contract('run-one'));
  freezeGoal(root, 'run-one', { actor: 'alice' });
  assert.throws(
    () => unfreezeGoal(root, 'run-one', { actor: 'alice', reason: '' }),
    (error) => error.code === 'INVALID_UNFREEZE_REASON'
  );
});

test('Run-scoped Goal drafts use revisions and reject stale or cross-Run writes', () => {
  const root = tempRepo();
  createRun(root, { runId: 'run-one', task: 'runtime' });
  createRun(root, { runId: 'run-two', task: 'sibling' });
  const first = saveGoalDraft(root, 'run-one', contract('run-one'), {
    actor: 'agent',
    expectedRevision: 0,
    now: new Date('2025-01-01T00:00:00.000Z')
  });
  assert.equal(first.metadata.revision, 1);
  assert.equal(first.metadata.actor, 'agent');
  assert.equal(loadGoalDraft(root, 'run-one').contract.objective, 'Implement safe local runtime');
  assert.match(
    fs.readFileSync(path.join(root, '.ai-engineering-loop', 'tasks', 'goal-contract.md'), 'utf8'),
    /Run:\*\* `run-one`/
  );

  const second = saveGoalDraft(
    root,
    'run-one',
    contract('run-one', 'Updated objective'),
    { actor: 'agent', expectedRevision: 1 }
  );
  assert.equal(second.metadata.revision, 2);
  assert.throws(
    () => saveGoalDraft(root, 'run-one', contract('run-one'), {
      actor: 'studio-user',
      expectedRevision: 1
    }),
    { code: 'GOAL_DRAFT_CONFLICT' }
  );
  assert.throws(
    () => saveGoalDraft(root, 'run-one', contract('run-two'), {
      actor: 'agent',
      expectedRevision: 2
    }),
    { code: 'GOAL_RUN_MISMATCH' }
  );
  assert.equal(loadGoalDraft(root, 'run-two'), null);
});

test('Goal Freeze binds the reviewed draft revision and hash', () => {
  const root = tempRepo();
  createRun(root, { runId: 'run-one', task: 'runtime' });
  const draft = saveGoalDraft(root, 'run-one', contract('run-one'), {
    actor: 'agent',
    expectedRevision: 0
  });
  assert.throws(
    () => freezeGoal(root, 'run-one', {
      actor: 'alice',
      expectedRevision: 2,
      expectedHash: draft.metadata.contentHash
    }),
    { code: 'GOAL_DRAFT_CONFLICT' }
  );
  const frozen = freezeGoal(root, 'run-one', {
    actor: 'alice',
    expectedRevision: 1,
    expectedHash: draft.metadata.contentHash
  });
  assert.equal(frozen.goal.draftRevision, 1);
  assert.equal(frozen.goal.hash, draft.metadata.contentHash);
});

test('tampered Goal draft hashes fail before any frozen artifact is written', () => {
  const root = tempRepo();
  createRun(root, { runId: 'run-one', task: 'runtime' });
  saveGoalDraft(root, 'run-one', contract('run-one'), {
    actor: 'agent',
    expectedRevision: 0
  });
  const runDir = path.join(root, '.ai-engineering-loop', 'runs', 'run-one');
  const draftPath = path.join(runDir, 'goal-draft.json');
  const tampered = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  tampered.contract.objective = 'Tampered after review.';
  fs.writeFileSync(draftPath, JSON.stringify(tampered));

  assert.throws(() => loadGoalDraft(root, 'run-one'), { code: 'INVALID_GOAL_DRAFT' });
  assert.equal(fs.existsSync(path.join(runDir, 'goal-contract.json')), false);
  assert.equal(fs.existsSync(path.join(runDir, 'goal-contract.v1.json')), false);
});
