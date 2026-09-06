const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MODEL_TIERS,
  extractChangedPaths,
  assessEscalation,
  assessRunEscalation,
  enforceVerdictTier,
  tierSatisfies
} = require('../lib/escalation.js');
const { createRun } = require('../lib/run-state.js');

test('cheap model remains the default without escalation signals', () => {
  const assessment = assessEscalation({ changedPaths: ['src/ui/button.js'] });
  assert.strictEqual(assessment.requiredTier, MODEL_TIERS.CHEAP_MODEL);
  assert.strictEqual(assessment.escalate, false);
});

test('high-risk paths and repeated invalid artifacts require a strong model', () => {
  const assessment = assessEscalation({
    changedPaths: ['src/payment/charge.js'],
    schemaFailures: 2
  });
  assert.strictEqual(assessment.requiredTier, MODEL_TIERS.STRONG_MODEL);
  assert.deepStrictEqual(
    assessment.reasons.map((reason) => reason.code),
    ['HIGH_RISK_PATH', 'REPEATED_SCHEMA_FAILURE']
  );
  assert.strictEqual(tierSatisfies(MODEL_TIERS.CHEAP_MODEL, assessment.requiredTier), false);
  assert.strictEqual(tierSatisfies(MODEL_TIERS.STRONG_MODEL, assessment.requiredTier), true);
});

test('iteration ceiling and secret leaks require a human', () => {
  const assessment = assessEscalation({ iteration: 3, secretLeakDetected: true });
  assert.strictEqual(assessment.requiredTier, MODEL_TIERS.HUMAN);
  assert.strictEqual(tierSatisfies(MODEL_TIERS.STRONG_MODEL, MODEL_TIERS.HUMAN), false);
});

test('changed paths are extracted from unified diffs', () => {
  const paths = extractChangedPaths([
    '--- a/src/auth.js',
    '+++ b/src/auth.js',
    '--- /dev/null',
    '+++ b/migrations/001.sql'
  ].join('\n'));
  assert.deepStrictEqual(paths, ['src/auth.js', 'migrations/001.sql']);
});

test('run assessment combines diff and risk sidecar signals', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-escalation-'));
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  createRun(root, { runId: 'run-001' });
  const runDir = path.join(root, '.ai-engineering-loop/runs/run-001');
  fs.writeFileSync(path.join(runDir, 'diff.patch'), '+++ b/src/auth/session.js\n');
  fs.writeFileSync(path.join(runDir, 'risk.json'), JSON.stringify({
    schemaVersion: 1,
    runId: 'run-001',
    hallucinatedCitations: 1
  }));

  const assessment = assessRunEscalation(root);
  assert.strictEqual(assessment.requiredTier, MODEL_TIERS.STRONG_MODEL);
  assert.deepStrictEqual(
    assessment.reasons.map((reason) => reason.code),
    ['HIGH_RISK_PATH', 'HALLUCINATED_CITATION']
  );
  assert.ok(fs.existsSync(path.join(runDir, 'escalation.json')));
});

test('a cheap verdict cannot pass a run that requires stronger review', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-tier-gate-'));
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  const run = createRun(root, { runId: 'run-001' });
  const runDir = path.join(root, '.ai-engineering-loop/runs/run-001');
  fs.writeFileSync(path.join(runDir, 'diff.patch'), '+++ b/src/payment/charge.js\n');

  assert.throws(
    () => enforceVerdictTier(root, run, { verdict: 'PASS', modelTier: MODEL_TIERS.CHEAP_MODEL }),
    (err) => err.code === 'ESCALATION_REQUIRED'
  );
  assert.doesNotThrow(
    () => enforceVerdictTier(root, run, { verdict: 'PASS', modelTier: MODEL_TIERS.STRONG_MODEL })
  );
  assert.doesNotThrow(
    () => enforceVerdictTier(root, run, { verdict: 'ITERATE', modelTier: MODEL_TIERS.CHEAP_MODEL })
  );
});
