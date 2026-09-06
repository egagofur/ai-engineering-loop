'use strict';

const fs = require('fs');
const path = require('path');

const VERDICTS = new Set(['PASS', 'ITERATE', 'ESCALATE']);

function evaluationError(message, details = []) {
  const err = new Error(message);
  err.code = 'EVALUATION_FAILED';
  err.details = details;
  return err;
}

function defaultCasesDir() {
  return path.join(__dirname, '..', 'evals', 'cases');
}

function validateCase(fixture) {
  const errors = [];
  if (fixture?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!/^[a-z0-9][a-z0-9-]+$/.test(String(fixture?.id || ''))) errors.push('id must be kebab-case');
  if (!String(fixture?.title || '').trim()) errors.push('title is required');
  if (!String(fixture?.category || '').trim()) errors.push('category is required');
  if (!['low', 'medium', 'high', 'critical'].includes(fixture?.risk)) errors.push('risk is invalid');
  if (!String(fixture?.task || '').trim()) errors.push('task is required');
  if (!Array.isArray(fixture?.files) || fixture.files.length === 0) errors.push('files must not be empty');
  for (const [index, file] of (fixture?.files || []).entries()) {
    if (!String(file?.path || '').trim()) errors.push(`files[${index}].path is required`);
    if (typeof file?.content !== 'string') errors.push(`files[${index}].content must be a string`);
  }
  if (!VERDICTS.has(fixture?.oracle?.verdict)) errors.push('oracle.verdict is invalid');
  if (!Array.isArray(fixture?.oracle?.requiredSignals)) errors.push('oracle.requiredSignals must be an array');
  if (!Array.isArray(fixture?.oracle?.forbiddenOutput)) errors.push('oracle.forbiddenOutput must be an array');
  return { valid: errors.length === 0, errors };
}

function loadEvaluationCases(casesDir = defaultCasesDir()) {
  const files = fs.readdirSync(casesDir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  const fixtures = [];
  const errors = [];
  const ids = new Set();
  for (const file of files) {
    let fixture;
    try {
      fixture = JSON.parse(fs.readFileSync(path.join(casesDir, file), 'utf8'));
    } catch (cause) {
      errors.push(`${file}: invalid JSON (${cause.message})`);
      continue;
    }
    const check = validateCase(fixture);
    for (const error of check.errors) errors.push(`${file}: ${error}`);
    if (ids.has(fixture.id)) errors.push(`${file}: duplicate id ${fixture.id}`);
    ids.add(fixture.id);
    fixtures.push(fixture);
  }
  if (fixtures.length === 0) errors.push('no evaluation cases found');
  if (errors.length) throw evaluationError('Evaluation catalog is invalid', errors);
  return fixtures;
}

function loadResults(resultsDir) {
  if (!resultsDir) return [];
  return fs.readdirSync(resultsDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf8')));
}

function scoreEvaluationResults(fixtures, results) {
  const resultByCase = new Map((results || []).map((result) => [result.caseId, result]));
  const cases = fixtures.map((fixture) => {
    const result = resultByCase.get(fixture.id);
    if (!result) {
      return {
        caseId: fixture.id,
        expected: fixture.oracle.verdict,
        actual: null,
        passed: false,
        missing: true,
        incorrectPass: false,
        missingSignals: fixture.oracle.requiredSignals,
        leakedCanaries: []
      };
    }
    const output = String(result.output || '');
    const signals = new Set(Array.isArray(result.signals) ? result.signals : []);
    const missingSignals = fixture.oracle.requiredSignals.filter((signal) => !signals.has(signal));
    const leakedCanaries = fixture.oracle.forbiddenOutput.filter((canary) => output.includes(canary));
    const verdictMatches = result.verdict === fixture.oracle.verdict;
    return {
      caseId: fixture.id,
      expected: fixture.oracle.verdict,
      actual: result.verdict || null,
      passed: verdictMatches && missingSignals.length === 0 && leakedCanaries.length === 0,
      missing: false,
      incorrectPass: fixture.oracle.verdict !== 'PASS' && result.verdict === 'PASS',
      missingSignals,
      leakedCanaries
    };
  });

  const completed = cases.filter((item) => !item.missing).length;
  const passed = cases.filter((item) => item.passed).length;
  return {
    total: fixtures.length,
    completed,
    passed,
    failed: cases.length - passed,
    incorrectPasses: cases.filter((item) => item.incorrectPass).length,
    secretLeaks: cases.reduce((sum, item) => sum + item.leakedCanaries.length, 0),
    passRate: fixtures.length ? passed / fixtures.length : 0,
    cases
  };
}

function catalogSummary(fixtures) {
  const categories = {};
  const verdicts = {};
  for (const fixture of fixtures) {
    categories[fixture.category] = (categories[fixture.category] || 0) + 1;
    verdicts[fixture.oracle.verdict] = (verdicts[fixture.oracle.verdict] || 0) + 1;
  }
  return { total: fixtures.length, categories, verdicts };
}

module.exports = {
  VERDICTS,
  defaultCasesDir,
  validateCase,
  loadEvaluationCases,
  loadResults,
  scoreEvaluationResults,
  catalogSummary
};
