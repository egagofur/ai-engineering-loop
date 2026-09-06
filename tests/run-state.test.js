const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  RUN_STATES,
  createRun,
  createOrResumeRun,
  getCurrentRun,
  loadRun,
  transitionRun
} = require('../lib/run-state.js');

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-run-state-'));
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  return root;
}

test('createRun persists a private current run ledger', () => {
  const root = tempRepo();
  const run = createRun(root, {
    task: 'repair payment retries',
    runId: 'run-001',
    now: new Date('2025-01-01T00:00:00.000Z')
  });

  assert.strictEqual(run.state, RUN_STATES.STARTED);
  assert.strictEqual(run.iteration, 1);
  assert.strictEqual(getCurrentRun(root).runId, 'run-001');
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(path.join(root, '.ai-engineering-loop/runs/run-001/state.json')).mode & 0o777, 0o600);
  }
});

test('createOrResumeRun resumes the active task and rejects silent task replacement', () => {
  const root = tempRepo();
  createRun(root, { task: 'task one', runId: 'run-001' });

  const resumed = createOrResumeRun(root, { task: 'task one' });
  assert.strictEqual(resumed.resumed, true);
  assert.strictEqual(resumed.run.runId, 'run-001');
  assert.throws(
    () => createOrResumeRun(root, { task: 'different task' }),
    (err) => err.code === 'ACTIVE_RUN'
  );
});

test('transitionRun enforces the workflow order', () => {
  const root = tempRepo();
  createRun(root, { runId: 'run-001' });

  assert.throws(
    () => transitionRun(root, 'run-001', RUN_STATES.VERIFIED, { gate: 'verification' }),
    (err) => err.code === 'INVALID_TRANSITION'
  );

  const frozen = transitionRun(root, 'run-001', RUN_STATES.GOAL_FROZEN, {
    gate: 'goal',
    artifacts: { goalContract: { path: 'goal-contract.json', sha256: 'abc' } }
  });
  assert.strictEqual(frozen.state, RUN_STATES.GOAL_FROZEN);
  assert.strictEqual(frozen.artifacts.goalContract.sha256, 'abc');
  assert.strictEqual(loadRun(root, 'run-001').history.length, 2);
});

test('review can iterate with an incremented iteration or pass', () => {
  const root = tempRepo();
  createRun(root, { runId: 'run-001' });
  transitionRun(root, 'run-001', RUN_STATES.GOAL_FROZEN, { gate: 'goal' });
  transitionRun(root, 'run-001', RUN_STATES.MAKER_COMPLETE, { gate: 'maker' });
  transitionRun(root, 'run-001', RUN_STATES.VERIFIED, { gate: 'verification' });
  transitionRun(root, 'run-001', RUN_STATES.REVIEWED, { gate: 'review' });
  const iterated = transitionRun(root, 'run-001', RUN_STATES.GOAL_FROZEN, {
    gate: 'judge',
    incrementIteration: true
  });
  assert.strictEqual(iterated.iteration, 2);
  assert.strictEqual(iterated.state, RUN_STATES.GOAL_FROZEN);
});
