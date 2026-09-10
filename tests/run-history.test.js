'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createRun } = require('../lib/run-state.js');
const { inspectRunArtifact, listRunHistory, runHistoryDetail } = require('../lib/run-history.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-history-'));
}

test('run history searches human metadata and isolates corrupt siblings', () => {
  const root = tempRepo();
  createRun(root, {
    runId: 'run-one',
    task: 'Repair payment webhook api_key=super-secret-value',
    displayName: 'Webhook Recovery',
    now: new Date('2025-02-03T04:05:06.000Z')
  });
  fs.mkdirSync(path.join(root, '.ai-engineering-loop', 'runs', 'broken'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'runs', 'broken', 'state.json'), '{');

  const result = listRunHistory(root, { query: 'webhook' });
  assert.deepEqual(result.runs.map((run) => run.runId), ['run-one']);
  assert.equal(result.runs[0].displayName, 'Webhook Recovery');
  assert.doesNotMatch(result.runs[0].task, /super-secret-value/);
  assert.equal(result.corrupt[0].runId, 'broken');
  const detail = runHistoryDetail(root, 'run-one');
  assert.equal(detail.evidence.present, false);
  assert.doesNotMatch(detail.task, /super-secret-value/);
});

test('artifact inspection is bounded, redacted, and confined to its owning run', () => {
  const root = tempRepo();
  createRun(root, { runId: 'run-one', task: 'one' });
  createRun(root, { runId: 'run-two', task: 'two' });
  const one = path.join(root, '.ai-engineering-loop', 'runs', 'run-one');
  const two = path.join(root, '.ai-engineering-loop', 'runs', 'run-two');
  fs.writeFileSync(path.join(one, 'evidence.txt'), 'api_key=super-secret-value\n');
  fs.writeFileSync(path.join(two, 'private.txt'), 'sibling');

  const inspected = inspectRunArtifact(root, 'run-one', 'evidence.txt');
  assert.match(inspected.content, /\[REDACTED\]/);
  assert.doesNotMatch(inspected.content, /super-secret-value/);
  const descriptorPath = '.ai-engineering-loop/runs/run-one/evidence.txt';
  assert.equal(inspectRunArtifact(root, 'run-one', descriptorPath).path, 'evidence.txt');
  assert.throws(
    () => inspectRunArtifact(root, 'run-one', '../run-two/private.txt'),
    (error) => error.code === 'UNSAFE_HISTORY_PATH'
  );

  fs.symlinkSync(path.join(two, 'private.txt'), path.join(one, 'escape'));
  assert.throws(
    () => inspectRunArtifact(root, 'run-one', 'escape'),
    (error) => error.code === 'UNSAFE_HISTORY_PATH'
  );
});
