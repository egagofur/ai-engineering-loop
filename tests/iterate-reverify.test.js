'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyGate, artifactPath, hashFile } = require('../lib/gates.js');
const { RUN_STATES, createRun, loadRun } = require('../lib/run-state.js');
const { recordVerificationCommands } = require('../lib/verification-recorder.js');

const RUN = 'run-001';

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-reverify-'));
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  createRun(root, { runId: RUN, task: 'fixture' });
  return root;
}

function write(root, name, value) {
  const filePath = artifactPath(root, RUN, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

const goal = {
  schemaVersion: 1,
  runId: RUN,
  objective: 'Fixture objective',
  acceptanceCriteria: [{ id: 'AC-1', statement: 'Works', evidenceRequired: 'tests pass', failureCases: ['bad input rejected'] }]
};

const blocker = {
  id: 'F-1',
  location: 'a.js:1',
  failureScenario: 'null input crashes the handler',
  evidence: 'a.js:1 dereferences input without a check',
  severity: 'BLOCKER',
  validity: 'VALID',
  disposition: 'STRONG',
  concreteAlternativeDiff: '- input.x\n+ input?.x'
};

const passing = [{ command: process.execPath, args: ['-e', 'process.exit(0)'] }];

async function makerAndVerify(root, diff) {
  const diffHash = hashFile(write(root, 'diff.patch', diff));
  applyGate(root, 'maker');
  await recordVerificationCommands(root, { runId: RUN, commands: passing });
  applyGate(root, 'verification');
  return diffHash;
}

test('after a Judge ITERATE, verify records fresh evidence for the new diff and iteration 1 evidence is kept', async () => {
  const root = tempRepo();
  write(root, 'goal-contract.json', goal);
  applyGate(root, 'goal');
  const firstHash = await makerAndVerify(root, 'diff --git a/a.js b/a.js\n+one\n');
  write(root, 'findings.json', { schemaVersion: 1, runId: RUN, diffHash: firstHash, findings: [blocker] });
  applyGate(root, 'review');
  write(root, 'verdict.json', { schemaVersion: 1, runId: RUN, verdict: 'ITERATE', reason: 'r', action: 'a' });
  const iterated = applyGate(root, 'judge');
  assert.strictEqual(iterated.state, RUN_STATES.GOAL_FROZEN);
  assert.strictEqual(iterated.artifacts.verification, undefined);

  const archived = path.join(root, '.ai-engineering-loop', 'runs', RUN, 'iterations', '1', 'verification.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(archived, 'utf8')).diffHash, firstHash);

  const secondHash = await makerAndVerify(root, 'diff --git a/a.js b/a.js\n+two\n');
  const run = loadRun(root, RUN);
  assert.strictEqual(run.state, RUN_STATES.VERIFIED);
  assert.strictEqual(run.iteration, 2);
  const current = JSON.parse(fs.readFileSync(artifactPath(root, RUN, 'verification.json'), 'utf8'));
  assert.strictEqual(current.diffHash, secondHash);
  assert.notStrictEqual(secondHash, firstHash);
});

test('evidence of a gated iteration still cannot be mutated within that iteration', async () => {
  const root = tempRepo();
  write(root, 'goal-contract.json', goal);
  applyGate(root, 'goal');
  await makerAndVerify(root, 'diff --git a/a.js b/a.js\n+one\n');
  await assert.rejects(() => recordVerificationCommands(root, { runId: RUN, commands: passing }), /already passed its gate/);
});
