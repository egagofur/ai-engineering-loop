'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  appendRunLifecycle,
  listRunLifecycle,
  runAgentPresence
} = require('../lib/run-lifecycle.js');
const { createRun } = require('../lib/run-state.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-lifecycle-'));
}

test('Run lifecycle is ordered, cursor-based, bounded, and redacted', () => {
  const root = tempRepo();
  createRun(root, { runId: 'run-one', task: 'runtime' });
  appendRunLifecycle(root, 'run-one', {
    type: 'GOAL_DRAFTING',
    phase: 'goal',
    actor: 'agent',
    message: 'Reading token sk-live-secretvalue123456'
  }, { now: new Date('2025-01-01T00:00:00.000Z') });
  appendRunLifecycle(root, 'run-one', {
    type: 'AGENT_HEARTBEAT',
    phase: 'goal',
    actor: 'agent',
    message: 'Drafting success checks'
  }, { now: new Date('2025-01-01T00:00:05.000Z') });

  const firstPage = listRunLifecycle(root, 'run-one', { after: 0, limit: 1 });
  assert.equal(firstPage.events.length, 1);
  assert.equal(firstPage.nextSequence, 1);
  assert.match(firstPage.events[0].message, /REDACTED/);
  const secondPage = listRunLifecycle(root, 'run-one', { after: 1, limit: 10 });
  assert.deepEqual(secondPage.events.map((event) => event.sequence), [2]);
});

test('Agent presence becomes idle and disconnected without changing Run state', () => {
  const root = tempRepo();
  createRun(root, { runId: 'run-one', task: 'runtime' });
  appendRunLifecycle(root, 'run-one', {
    type: 'AGENT_HEARTBEAT',
    phase: 'maker',
    actor: 'agent',
    message: 'Implementing'
  }, { now: new Date('2025-01-01T00:00:00.000Z') });
  assert.equal(runAgentPresence(root, 'run-one', {
    now: new Date('2025-01-01T00:00:08.000Z')
  }).status, 'WORKING');
  assert.equal(runAgentPresence(root, 'run-one', {
    now: new Date('2025-01-01T00:00:20.000Z')
  }).status, 'IDLE');
  assert.equal(runAgentPresence(root, 'run-one', {
    now: new Date('2025-01-01T00:00:31.000Z')
  }).status, 'DISCONNECTED');
});

test('Run lifecycle rejects unknown types, cross-Run access, and corrupt ledgers', () => {
  const root = tempRepo();
  createRun(root, { runId: 'run-one', task: 'runtime' });
  assert.throws(
    () => appendRunLifecycle(root, 'run-one', {
      type: 'PRIVATE_REASONING',
      actor: 'agent',
      message: 'hidden'
    }),
    { code: 'INVALID_LIFECYCLE_TYPE' }
  );
  assert.throws(() => listRunLifecycle(root, 'run-two'), { code: 'INVALID_RUN_STATE' });
  appendRunLifecycle(root, 'run-one', {
    type: 'AGENT_HEARTBEAT',
    actor: 'agent',
    message: 'Working'
  });
  const ledger = path.join(root, '.ai-engineering-loop', 'runs', 'run-one', 'lifecycle.jsonl');
  fs.appendFileSync(ledger, '{bad json}\n');
  assert.throws(() => listRunLifecycle(root, 'run-one'), { code: 'INVALID_RUN_LIFECYCLE' });
});
