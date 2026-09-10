'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  validateVerificationEvidence,
  validateFindingLedger,
  computeJudgeVerdict
} = require('./orchestration.js');
const {
  RUN_STATES,
  RUN_MODES,
  getCurrentRun,
  getGitRevision,
  loadRun,
  runsDir,
  transitionRun
} = require('./run-state.js');
const {
  assertModeAllowed
} = require('./runtime-policy.js');
const {
  enforceVerdictTier
} = require('./escalation.js');

const GATE_FILES = Object.freeze({
  goal: 'goal-contract.json',
  report: 'report.json',
  maker: 'diff.patch',
  verification: 'verification.json',
  review: 'findings.json',
  judge: 'verdict.json',
  delivery: 'delivery.json'
});

function gateError(message, details = []) {
  const err = new Error(message);
  err.code = 'GATE_FAILED';
  err.details = details;
  return err;
}

function artifactPath(rootDir, runId, fileName) {
  return path.join(runsDir(rootDir), runId, fileName);
}

function readJsonArtifact(rootDir, runId, fileName) {
  const filePath = artifactPath(rootDir, runId, fileName);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw gateError(`Missing or invalid ${fileName}: ${cause.message}`);
  }
  return { filePath, value };
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashFile(filePath) {
  try {
    return hashContent(fs.readFileSync(filePath));
  } catch (cause) {
    throw gateError(`Unable to hash ${filePath}: ${cause.message}`);
  }
}

function descriptor(rootDir, filePath) {
  return {
    path: path.relative(rootDir, filePath).split(path.sep).join('/'),
    sha256: hashFile(filePath)
  };
}

function assertArtifactCurrent(rootDir, run, name) {
  const artifact = run.artifacts[name];
  if (!artifact?.path || !artifact.sha256) {
    throw gateError(`Required ${name} artifact has not passed its gate`);
  }
  const filePath = path.join(rootDir, artifact.path);
  if (hashFile(filePath) !== artifact.sha256) {
    throw gateError(`${name} artifact changed after its gate; rerun the owning stage`);
  }
}

function requireRunMetadata(document, run, label) {
  const errors = [];
  if (document.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (document.runId !== run.runId) errors.push(`runId must be ${run.runId}`);
  if (errors.length) throw gateError(`${label} metadata is invalid`, errors);
}

function validateGoalContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object') return { valid: false, errors: ['contract must be an object'] };
  if (!String(contract.objective || '').trim()) errors.push('objective is required');
  if (!Array.isArray(contract.acceptanceCriteria) || contract.acceptanceCriteria.length === 0) {
    errors.push('acceptanceCriteria must contain at least one item');
  } else {
    const ids = new Set();
    contract.acceptanceCriteria.forEach((criterion, index) => {
      if (!criterion || typeof criterion !== 'object') {
        errors.push(`acceptanceCriteria[${index}] must be an object`);
        return;
      }
      if (!/^AC-\d+$/.test(String(criterion.id || ''))) {
        errors.push(`acceptanceCriteria[${index}].id must match AC-N`);
      } else if (ids.has(criterion.id)) {
        errors.push(`duplicate acceptance criterion: ${criterion.id}`);
      } else {
        ids.add(criterion.id);
      }
      if (!String(criterion.statement || '').trim()) {
        errors.push(`acceptanceCriteria[${index}].statement is required`);
      }
      if (!String(criterion.evidenceRequired || '').trim()) {
        errors.push(`acceptanceCriteria[${index}].evidenceRequired is required`);
      }
      if (!Array.isArray(criterion.failureCases) || criterion.failureCases.length === 0) {
        errors.push(`acceptanceCriteria[${index}].failureCases must not be empty`);
      } else if (criterion.failureCases.some((failureCase) => !String(failureCase || '').trim())) {
        errors.push(`acceptanceCriteria[${index}].failureCases must contain non-empty strings`);
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

function validateVerificationBundle(bundle, run, diffHash, currentRevision) {
  const errors = [];
  requireRunMetadata(bundle, run, 'verification');
  if (bundle.gitRevision !== currentRevision) {
    errors.push(`gitRevision is stale: expected ${currentRevision}, received ${bundle.gitRevision || '(missing)'}`);
  }
  if (bundle.diffHash !== diffHash) {
    errors.push('diffHash does not match the gated Maker diff');
  }
  if (!Array.isArray(bundle.commands) || bundle.commands.length === 0) {
    errors.push('commands must contain at least one verification result');
  } else {
    bundle.commands.forEach((command, index) => {
      const result = validateVerificationEvidence(command);
      if (!result.valid) errors.push(`commands[${index}]: ${result.reason}`);
    });
  }
  return { valid: errors.length === 0, errors };
}

function validateVerdictDocument(verdict, run) {
  const errors = [];
  requireRunMetadata(verdict, run, 'verdict');
  if (!['PASS', 'ITERATE', 'ESCALATE'].includes(verdict.verdict)) {
    errors.push('verdict must be PASS, ITERATE, or ESCALATE');
  }
  if (!String(verdict.reason || '').trim()) errors.push('reason is required');
  if (!String(verdict.action || '').trim()) errors.push('action is required');
  if (verdict.modelTier != null && !['CHEAP_MODEL', 'STRONG_MODEL', 'HUMAN'].includes(verdict.modelTier)) {
    errors.push('modelTier must be CHEAP_MODEL, STRONG_MODEL, or HUMAN');
  }
  if (verdict.humanApproved != null && typeof verdict.humanApproved !== 'boolean') {
    errors.push('humanApproved must be a boolean');
  }
  return { valid: errors.length === 0, errors };
}

function verificationForJudge(bundle) {
  const first = bundle.commands[0];
  return {
    ...first,
    summary: bundle.commands.map((command) => command.summary || command.command).join('; ')
  };
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, runId);
  const current = getCurrentRun(rootDir);
  if (!current) throw gateError('No current run. Start one with `ai-engineering-loop run <task>`.');
  return current;
}

function applyGate(rootDir, gate, { runId, transitionOptions = {} } = {}) {
  if (!Object.hasOwn(GATE_FILES, gate)) {
    throw gateError(`Unknown gate: ${gate}. Use ${Object.keys(GATE_FILES).join('|')}`);
  }
  const run = resolveRun(rootDir, runId);
  const mode = run.mode || RUN_MODES.ASSISTED;
  const policy = assertModeAllowed(rootDir, mode);

  if (gate === 'goal') {
    const { filePath, value } = readJsonArtifact(rootDir, run.runId, GATE_FILES.goal);
    requireRunMetadata(value, run, 'goal contract');
    const check = validateGoalContract(value);
    if (!check.valid) throw gateError('Goal Contract gate failed', check.errors);
    return transitionRun(rootDir, run.runId, RUN_STATES.GOAL_FROZEN, {
      gate,
      artifacts: { goalContract: descriptor(rootDir, filePath) },
      ...transitionOptions
    });
  }

  if (gate === 'report') {
    if (mode !== RUN_MODES.REPORT_ONLY) {
      throw gateError('Report gate is only available in REPORT_ONLY mode');
    }
    const { filePath, value } = readJsonArtifact(rootDir, run.runId, GATE_FILES.report);
    requireRunMetadata(value, run, 'report');
    const reportErrors = [];
    if (!String(value.summary || '').trim()) reportErrors.push('summary is required');
    if (!Array.isArray(value.recommendations)) reportErrors.push('recommendations must be an array');
    else if (value.recommendations.some((item) => !String(item || '').trim())) {
      reportErrors.push('recommendations must contain non-empty strings');
    }
    if (reportErrors.length) throw gateError('Report gate failed', reportErrors);
    return transitionRun(rootDir, run.runId, RUN_STATES.REPORTED, {
      gate,
      artifacts: { report: descriptor(rootDir, filePath) }
    });
  }

  if (gate === 'maker') {
    if (mode === RUN_MODES.REPORT_ONLY) {
      throw gateError('REPORT_ONLY mode cannot enter the Maker stage; finish with the report gate');
    }
    const filePath = artifactPath(rootDir, run.runId, GATE_FILES.maker);
    let diff;
    try {
      diff = fs.readFileSync(filePath, 'utf8');
    } catch (cause) {
      throw gateError(`Missing ${GATE_FILES.maker}: ${cause.message}`);
    }
    if (!diff.trim()) throw gateError('Maker gate failed: diff.patch is empty');
    const artifacts = { diff: descriptor(rootDir, filePath) };
    if (mode === RUN_MODES.UNATTENDED && policy.requireSandboxForUnattended) {
      const { filePath: sandboxFile, value: evidence } = readJsonArtifact(
        rootDir,
        run.runId,
        'sandbox-evidence.json'
      );
      const sandboxErrors = [];
      requireRunMetadata(evidence, run, 'sandbox evidence');
      if (evidence.sandboxed !== true) sandboxErrors.push('sandboxed must be true');
      if (!/^[a-f0-9]{40,64}$/.test(String(evidence.baseRevision || ''))) {
        sandboxErrors.push('baseRevision must be a Git revision');
      }
      if (evidence.baseRevision !== run.startedRevision) {
        sandboxErrors.push('baseRevision does not match the run starting revision');
      }
      if (evidence.diffSha256 !== hashFile(filePath)) {
        sandboxErrors.push('diffSha256 does not match the captured Maker diff');
      }
      if (sandboxErrors.length) throw gateError('Unattended Maker sandbox evidence failed', sandboxErrors);
      artifacts.sandboxEvidence = descriptor(rootDir, sandboxFile);
    }
    return transitionRun(rootDir, run.runId, RUN_STATES.MAKER_COMPLETE, {
      gate,
      artifacts
    });
  }

  if (gate === 'verification') {
    const diffPath = artifactPath(rootDir, run.runId, GATE_FILES.maker);
    const diffHash = hashFile(diffPath);
    if (run.artifacts.diff?.sha256 !== diffHash) {
      throw gateError('Maker diff changed after its gate; run the Maker gate again');
    }
    const { filePath, value } = readJsonArtifact(rootDir, run.runId, GATE_FILES.verification);
    const check = validateVerificationBundle(value, run, diffHash, getGitRevision(rootDir));
    if (!check.valid) throw gateError('Verification gate failed', check.errors);
    return transitionRun(rootDir, run.runId, RUN_STATES.VERIFIED, {
      gate,
      artifacts: { verification: descriptor(rootDir, filePath) }
    });
  }

  if (gate === 'review') {
    assertArtifactCurrent(rootDir, run, 'goalContract');
    assertArtifactCurrent(rootDir, run, 'diff');
    assertArtifactCurrent(rootDir, run, 'verification');
    const { filePath, value } = readJsonArtifact(rootDir, run.runId, GATE_FILES.review);
    requireRunMetadata(value, run, 'Finding Ledger');
    if (value.diffHash !== run.artifacts.diff?.sha256) {
      throw gateError('Finding Ledger diffHash does not match the gated Maker diff');
    }
    const check = validateFindingLedger(value);
    if (!check.valid) throw gateError('Review gate failed', [check.reason]);
    return transitionRun(rootDir, run.runId, RUN_STATES.REVIEWED, {
      gate,
      artifacts: { findings: descriptor(rootDir, filePath) }
    });
  }

  if (gate === 'judge') {
    assertArtifactCurrent(rootDir, run, 'goalContract');
    assertArtifactCurrent(rootDir, run, 'diff');
    assertArtifactCurrent(rootDir, run, 'verification');
    assertArtifactCurrent(rootDir, run, 'findings');
    const { filePath, value } = readJsonArtifact(rootDir, run.runId, GATE_FILES.judge);
    const verdictCheck = validateVerdictDocument(value, run);
    if (!verdictCheck.valid) throw gateError('Judge gate failed', verdictCheck.errors);
    try {
      enforceVerdictTier(rootDir, run, value);
    } catch (cause) {
      throw gateError(cause.message, [cause.code]);
    }
    const verification = readJsonArtifact(rootDir, run.runId, GATE_FILES.verification).value;
    const findings = readJsonArtifact(rootDir, run.runId, GATE_FILES.review).value;
    const goalContract = readJsonArtifact(rootDir, run.runId, GATE_FILES.goal).value;
    const expected = computeJudgeVerdict({
      goalContract,
      verificationEvidence: verificationForJudge(verification),
      findingLedger: findings,
      activeIteration: run.iteration,
      maxIterations: 3
    });
    if (value.verdict !== expected.verdict) {
      throw gateError(`Judge verdict is unsupported: expected ${expected.verdict}, received ${value.verdict}`);
    }
    const artifacts = { verdict: descriptor(rootDir, filePath) };
    if (expected.verdict === 'PASS') {
      return transitionRun(rootDir, run.runId, RUN_STATES.JUDGED_PASS, { gate, artifacts });
    }
    if (expected.verdict === 'ESCALATE') {
      return transitionRun(rootDir, run.runId, RUN_STATES.ESCALATED, {
        gate,
        artifacts,
        reason: expected.reason
      });
    }
    return transitionRun(rootDir, run.runId, RUN_STATES.GOAL_FROZEN, {
      gate,
      artifacts,
      reason: expected.reason,
      incrementIteration: true
    });
  }

  assertArtifactCurrent(rootDir, run, 'goalContract');
  assertArtifactCurrent(rootDir, run, 'diff');
  assertArtifactCurrent(rootDir, run, 'verification');
  assertArtifactCurrent(rootDir, run, 'findings');
  assertArtifactCurrent(rootDir, run, 'verdict');
  const { filePath, value } = readJsonArtifact(rootDir, run.runId, GATE_FILES.delivery);
  requireRunMetadata(value, run, 'delivery');
  const deliveryErrors = [];
  if (!String(value.destination || '').trim()) deliveryErrors.push('destination is required');
  if (!String(value.summary || '').trim()) deliveryErrors.push('summary is required');
  if (mode === RUN_MODES.ASSISTED && value.humanApproved !== true) {
    deliveryErrors.push('humanApproved must be true for ASSISTED delivery');
  }
  if (deliveryErrors.length) throw gateError('Delivery gate failed', deliveryErrors);
  return transitionRun(rootDir, run.runId, RUN_STATES.DELIVERED, {
    gate,
    artifacts: { delivery: descriptor(rootDir, filePath) }
  });
}

module.exports = {
  GATE_FILES,
  artifactPath,
  hashContent,
  hashFile,
  assertArtifactCurrent,
  validateGoalContract,
  validateVerificationBundle,
  validateVerdictDocument,
  applyGate
};
