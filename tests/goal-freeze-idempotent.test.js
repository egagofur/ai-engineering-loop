'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { freezeGoal, saveGoalDraft, loadGoalDraft } = require('../lib/goal-runtime.js');
const { createRun, loadRun } = require('../lib/run-state.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function contract(runId) {
  return {
    schemaVersion: 1,
    runId,
    objective: 'Implement safe local runtime',
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'The local transition is authenticated',
      evidenceRequired: 'API test',
      failureCases: ['unauthenticated requests are rejected']
    }]
  };
}

function draft(root, runId) {
  createRun(root, { runId, task: 'runtime' });
  saveGoalDraft(root, runId, contract(runId), { actor: 'agent', expectedRevision: 0 });
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-freeze-idem-'));
}

test('freezes once, then a second freeze of the same draft returns alreadyFrozen with the first actor and approval', () => {
  const root = tempRoot();
  draft(root, 'run-a');
  freezeGoal(root, 'run-a', { actor: 'Ega', studioSession: true });
  const historyBefore = loadRun(root, 'run-a').history.length;
  const second = freezeGoal(root, 'run-a', { actor: 'pengguna', env: {} });
  assert.equal(second.alreadyFrozen, true);
  assert.equal(second.goal.actor, 'Ega');
  assert.equal(second.goal.approval, 'studio');
  assert.equal(loadRun(root, 'run-a').history.length, historyBefore);
  assert.equal(loadRun(root, 'run-a').alreadyFrozen, undefined);
});

test('a second freeze with a different expected hash still refuses', () => {
  const root = tempRoot();
  draft(root, 'run-b');
  freezeGoal(root, 'run-b', { actor: 'Ega', studioSession: true });
  assert.ok(loadGoalDraft(root, 'run-b'));
  assert.throws(
    () => freezeGoal(root, 'run-b', { actor: 'pengguna', env: {}, expectedHash: 'other' }),
    (error) => error.code === 'GOAL_DRAFT_CONFLICT'
  );
  assert.equal(loadRun(root, 'run-b').goal.actor, 'Ega');
});

test('goal freeze --json twice: the second call reports alreadyFrozen', () => {
  const root = tempRoot();
  draft(root, 'run-c');
  const args = ['goal', 'freeze', '--json', '--latest', '--run', 'run-c', '--by', 'AEL Round3 Tester'];
  const first = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const second = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const parsed = JSON.parse(second.stdout);
  assert.equal(parsed.alreadyFrozen, true);
  assert.equal(parsed.result.goal.actor, 'AEL Round3 Tester');
});
