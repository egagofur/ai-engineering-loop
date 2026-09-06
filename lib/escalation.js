'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWriteJson, getCurrentRun, loadRun, runsDir } = require('./run-state.js');

const MODEL_TIERS = Object.freeze({
  CHEAP_MODEL: 'CHEAP_MODEL',
  STRONG_MODEL: 'STRONG_MODEL',
  HUMAN: 'HUMAN'
});

const TIER_RANK = Object.freeze({
  CHEAP_MODEL: 0,
  STRONG_MODEL: 1,
  HUMAN: 2
});

const HIGH_RISK_PATHS = [
  /(^|\/)(auth|authorization|permissions?|access-control)(\/|[._-])/i,
  /(^|\/)(payments?|billing|invoices?|ledger)(\/|[._-])/i,
  /(^|\/)(migrations?|schema)(\/|[._-])/i,
  /(^|\/)(infra|terraform|k8s|kubernetes|deploy)(\/|[._-])/i,
  /(^|\/)(crypto|encryption|secrets?)(\/|[._-])/i
];

function escalationError(message, code = 'ESCALATION_FAILED') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function extractChangedPaths(diff) {
  const paths = [];
  for (const line of String(diff || '').split('\n')) {
    const match = line.match(/^\+\+\+ b\/(.+)$/);
    if (match && match[1] !== '/dev/null' && !paths.includes(match[1])) paths.push(match[1]);
  }
  return paths;
}

function isHighRiskPath(filePath) {
  return HIGH_RISK_PATHS.some((pattern) => pattern.test(String(filePath || '')));
}

function assessEscalation({
  changedPaths = [],
  iteration = 1,
  maxIterations = 3,
  schemaFailures = 0,
  hallucinatedCitations = 0,
  reviewerJudgeDisagreement = false,
  verificationFlaky = false,
  contextTruncated = false,
  criticalUnknowns = 0,
  secretLeakDetected = false
} = {}) {
  const reasons = [];
  let requiredTier = MODEL_TIERS.CHEAP_MODEL;
  const requireTier = (tier, code, detail) => {
    if (TIER_RANK[tier] > TIER_RANK[requiredTier]) requiredTier = tier;
    if (!reasons.some((reason) => reason.code === code)) reasons.push({ code, detail, requiredTier: tier });
  };

  const riskyPaths = changedPaths.filter(isHighRiskPath);
  if (riskyPaths.length) {
    requireTier(MODEL_TIERS.STRONG_MODEL, 'HIGH_RISK_PATH', riskyPaths.join(', '));
  }
  if (schemaFailures >= 2) {
    requireTier(MODEL_TIERS.STRONG_MODEL, 'REPEATED_SCHEMA_FAILURE', `${schemaFailures} invalid model artifacts`);
  }
  if (hallucinatedCitations > 0) {
    requireTier(MODEL_TIERS.STRONG_MODEL, 'HALLUCINATED_CITATION', `${hallucinatedCitations} nonexistent citations`);
  }
  if (reviewerJudgeDisagreement) {
    requireTier(MODEL_TIERS.STRONG_MODEL, 'REVIEWER_JUDGE_DISAGREEMENT', 'Judge contradicts deterministic finding disposition');
  }
  if (verificationFlaky) {
    requireTier(MODEL_TIERS.STRONG_MODEL, 'FLAKY_VERIFICATION', 'Repeated verification produced inconsistent results');
  }
  if (contextTruncated) {
    requireTier(MODEL_TIERS.STRONG_MODEL, 'TRUNCATED_CONTEXT', 'A stage context pack omitted source bytes');
  }
  if (criticalUnknowns > 0) {
    requireTier(MODEL_TIERS.STRONG_MODEL, 'CRITICAL_UNKNOWN', `${criticalUnknowns} critical acceptance criteria remain unknown`);
  }
  if (iteration >= maxIterations) {
    requireTier(MODEL_TIERS.HUMAN, 'ITERATION_CEILING', `Iteration ${iteration} reached the ceiling ${maxIterations}`);
  }
  if (secretLeakDetected) {
    requireTier(MODEL_TIERS.HUMAN, 'SECRET_LEAK', 'A secret canary or credential reached model-visible output');
  }

  return {
    schemaVersion: 1,
    requiredTier,
    escalate: requiredTier !== MODEL_TIERS.CHEAP_MODEL,
    riskyPaths,
    reasons
  };
}

function tierSatisfies(actualTier, requiredTier) {
  return Object.hasOwn(TIER_RANK, actualTier) &&
    Object.hasOwn(TIER_RANK, requiredTier) &&
    TIER_RANK[actualTier] >= TIER_RANK[requiredTier];
}

function readOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw escalationError(`Invalid escalation signals: ${cause.message}`);
  }
}

function contextWasTruncated(rootDir, runId) {
  const contextDir = path.join(runsDir(rootDir), runId, 'context');
  if (!fs.existsSync(contextDir)) return false;
  return fs.readdirSync(contextDir)
    .filter((file) => file.endsWith('.json'))
    .some((file) => {
      const pack = readOptionalJson(path.join(contextDir, file));
      return (pack.entries || []).some((entry) => entry.truncated === true);
    });
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, runId);
  const current = getCurrentRun(rootDir);
  if (!current) throw escalationError('No current run. Start one before assessing escalation.', 'NO_CURRENT_RUN');
  return current;
}

function assessRunEscalation(rootDir, { runId } = {}) {
  const run = resolveRun(rootDir, runId);
  const runDir = path.join(runsDir(rootDir), run.runId);
  const diffPath = path.join(runDir, 'diff.patch');
  const diff = fs.existsSync(diffPath) ? fs.readFileSync(diffPath, 'utf8') : '';
  const signals = readOptionalJson(path.join(runDir, 'risk.json'));
  if (signals.runId && signals.runId !== run.runId) {
    throw escalationError(`risk.json runId must be ${run.runId}`);
  }
  const assessment = assessEscalation({
    changedPaths: extractChangedPaths(diff),
    iteration: run.iteration,
    maxIterations: signals.maxIterations || 3,
    schemaFailures: signals.schemaFailures || 0,
    hallucinatedCitations: signals.hallucinatedCitations || 0,
    reviewerJudgeDisagreement: signals.reviewerJudgeDisagreement === true,
    verificationFlaky: signals.verificationFlaky === true,
    contextTruncated: contextWasTruncated(rootDir, run.runId),
    criticalUnknowns: signals.criticalUnknowns || 0,
    secretLeakDetected: signals.secretLeakDetected === true
  });
  const document = {
    ...assessment,
    runId: run.runId,
    iteration: run.iteration,
    assessedAt: new Date().toISOString()
  };
  atomicWriteJson(path.join(runDir, 'escalation.json'), document);
  return document;
}

function enforceVerdictTier(rootDir, run, verdict) {
  const assessment = assessRunEscalation(rootDir, { runId: run.runId });
  if (verdict.verdict !== 'PASS') return assessment;
  const actualTier = verdict.modelTier || MODEL_TIERS.CHEAP_MODEL;
  if (!tierSatisfies(actualTier, assessment.requiredTier)) {
    throw escalationError(
      `Escalation required: ${assessment.requiredTier}; verdict used ${actualTier}`,
      'ESCALATION_REQUIRED'
    );
  }
  if (assessment.requiredTier === MODEL_TIERS.HUMAN && verdict.humanApproved !== true) {
    throw escalationError('Human approval is required for this verdict', 'HUMAN_APPROVAL_REQUIRED');
  }
  return assessment;
}

module.exports = {
  MODEL_TIERS,
  HIGH_RISK_PATHS,
  extractChangedPaths,
  isHighRiskPath,
  assessEscalation,
  tierSatisfies,
  assessRunEscalation,
  enforceVerdictTier
};
