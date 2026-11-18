'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyGate, artifactPath, hashFile } = require('../lib/gates.js');
const { RUN_STATES, createRun, getGitRevision } = require('../lib/run-state.js');
const { recordMeasurement, measurementProblems } = require('../lib/measurements.js');
const { recordSafetyFact, safetyFactProblem } = require('../lib/safety-fact.js');

const RUN = 'run-001';
function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-proof-gates-'));
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
const goal = (ac = {}) => ({ schemaVersion: 1, runId: RUN, objective: 'o', acceptanceCriteria: [{ id: 'AC-1', statement: 'fast', evidenceRequired: 'bench', failureCases: ['slower'], ...ac }] });
const blocker = (id) => ({ id, location: `a.js:${id.length}`, failureScenario: 'x breaks', evidence: 'a.js:1', severity: 'BLOCKER', validity: 'VALID', disposition: 'STRONG', concreteAlternativeDiff: '- a\n+ b' });
function iterate(root, diff, findings) {
  const diffHash = hashFile(write(root, 'diff.patch', diff));
  applyGate(root, 'maker');
  write(root, 'verification.json', { schemaVersion: 1, runId: RUN, gitRevision: getGitRevision(root), diffHash, commands: [{ command: 'node --test', executionIdentity: 'p', startTime: '2026-01-01T00:00:00.000Z', endTime: '2026-01-01T00:00:01.000Z', exitCode: 0, stdout: '1 test passed', timeoutStatus: 'COMPLETED', testCounts: { passed: 1, failed: 0 } }] });
  applyGate(root, 'verification');
  write(root, 'findings.json', { schemaVersion: 1, runId: RUN, diffHash, findings });
  applyGate(root, 'review');
}
const verdict = (v, extra = {}) => ({ schemaVersion: 1, runId: RUN, verdict: v, reason: 'r', action: 'a', ...extra });

test('C-32 a second ITERATE with the same explicit cause needs a stated and tested premise', () => {
  const root = tempRepo();
  write(root, 'goal-contract.json', goal());
  applyGate(root, 'goal');
  iterate(root, 'diff --git a/a.js b/a.js\n+one\n', [blocker('F-1')]);
  write(root, 'verdict.json', verdict('ITERATE', { cause: 'verification' }));
  applyGate(root, 'judge');
  iterate(root, 'diff --git a/a.js b/a.js\n+two\n', [blocker('F-22')]);
  write(root, 'verdict.json', verdict('ITERATE', { cause: 'verification' }));
  assert.throws(() => applyGate(root, 'judge'), /PREMISE_REQUIRED/);
  write(root, 'verdict.json', verdict('ITERATE', { cause: 'verification', premise: { statement: 'the cache is cold on each run', test: 'logged hit rate: 0/40, so the premise held' } }));
  assert.strictEqual(applyGate(root, 'judge').state, RUN_STATES.GOAL_FROZEN);
});

test('C-33 a measured AC needs at least 3 runs and noise smaller than the effect', () => {
  const root = tempRepo();
  const run = { runId: RUN };
  const g = goal({ measure: true });
  assert.deepStrictEqual(measurementProblems(root, run, g), ['AC-1: no measurement recorded']);
  recordMeasurement(root, RUN, { ac: 'AC-1', runs: 1, spread: 2, effect: 20, limiter: 'disk read' });
  assert.match(measurementProblems(root, run, g)[0], /1 run/);
  recordMeasurement(root, RUN, { ac: 'AC-1', runs: 5, spread: '25%', effect: '20%', limiter: 'disk read' });
  assert.match(measurementProblems(root, run, g)[0], /spread 25% is not smaller than the effect 20%/);
  recordMeasurement(root, RUN, { ac: 'AC-1', runs: 5, spread: 3, effect: 20, limiter: 'disk read' });
  assert.deepStrictEqual(measurementProblems(root, run, g), []);
  assert.deepStrictEqual(measurementProblems(root, run, goal()), []);
  assert.throws(() => recordMeasurement(root, RUN, { ac: 'AC-1', runs: 5, spread: 3, effect: 20, limiter: '' }), /--limiter/);
});

test('C-30 a safety fact reaches level 4 only through a passing proof run', () => {
  const root = tempRepo();
  const run = { runId: RUN };
  assert.strictEqual(safetyFactProblem(root, run), 'no safety fact recorded');
  recordSafetyFact(root, RUN, { fact: 'only dead cache entries are dropped', level: 3 });
  assert.match(safetyFactProblem(root, run), /level 3/);
  assert.throws(() => recordSafetyFact(root, RUN, { fact: 'f', level: 4 }), /levels 4 and 5 need a proof command/);
  assert.throws(() => recordSafetyFact(root, RUN, { fact: 'f', command: `${JSON.stringify(process.execPath)} -e "process.exit(1)"` }), /SAFETY_FACT_NOT_PROVEN|did not pass/);
  assert.throws(() => recordSafetyFact(root, RUN, { fact: 'f', command: 'rm -rf build' }), /destructive/);
  const value = recordSafetyFact(root, RUN, { fact: 'only dead cache entries are dropped', command: `${JSON.stringify(process.execPath)} -e "process.exit(0)"`, live: true });
  assert.strictEqual(value.level, 5);
  assert.strictEqual(safetyFactProblem(root, run), null);
});
