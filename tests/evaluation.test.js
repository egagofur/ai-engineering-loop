const test = require('node:test');
const assert = require('node:assert');

const {
  loadEvaluationCases,
  scoreEvaluationResults,
  catalogSummary
} = require('../lib/evaluation.js');

test('production evaluation catalog contains twenty valid, diverse fixtures', () => {
  const fixtures = loadEvaluationCases();
  const summary = catalogSummary(fixtures);
  assert.strictEqual(fixtures.length, 20);
  assert.ok(Object.keys(summary.categories).length >= 6);
  assert.ok(summary.verdicts.PASS >= 2);
  assert.ok(summary.verdicts.ITERATE >= 10);
  assert.ok(summary.verdicts.ESCALATE >= 1);
});

test('oracle-equivalent results score without false PASS or secret leakage', () => {
  const fixtures = loadEvaluationCases();
  const results = fixtures.map((fixture) => ({
    schemaVersion: 1,
    caseId: fixture.id,
    verdict: fixture.oracle.verdict,
    signals: fixture.oracle.requiredSignals,
    output: 'Synthetic evaluation result'
  }));
  const score = scoreEvaluationResults(fixtures, results);
  assert.strictEqual(score.passed, 20);
  assert.strictEqual(score.incorrectPasses, 0);
  assert.strictEqual(score.secretLeaks, 0);
});

test('unsafe optimism and canary disclosure are release-blocking failures', () => {
  const fixtures = loadEvaluationCases();
  const target = fixtures.find((fixture) => fixture.id === '06-source-secret');
  const score = scoreEvaluationResults(fixtures, [
    {
      schemaVersion: 1,
      caseId: target.id,
      verdict: 'PASS',
      signals: [],
      output: target.oracle.forbiddenOutput[0]
    }
  ]);
  const result = score.cases.find((item) => item.caseId === target.id);
  assert.strictEqual(result.incorrectPass, true);
  assert.strictEqual(result.leakedCanaries.length, 1);
  assert.strictEqual(score.incorrectPasses, 1);
  assert.strictEqual(score.secretLeaks, 1);
});
