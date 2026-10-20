'use strict';

const fs = require('fs');
const path = require('path');
const { sha256: hashContent } = require('./fsutil.js');
const {
  validateVerificationEvidence,
  validateFindingLedger,
  computeJudgeVerdict,
  EXECUTION_MODES,
  resolveExecutionModeId
} = require('./orchestration.js');

// Optional `review` block in REPORT_ONLY report.json (#57). Absent = legacy
// report, accepted. Present = must be truthful and non-contradictory.
function validateReportReview(review) {
  const errors = [];
  if (review === undefined) return errors;
  if (!review || typeof review !== 'object' || Array.isArray(review)) return ['review must be an object'];
  const modeId = resolveExecutionModeId(review.executionMode);
  const mode = EXECUTION_MODES[modeId];
  if (!review.executionMode || !mode) {
    errors.push(`review.executionMode must be one of ${Object.keys(EXECUTION_MODES).join(', ')}`);
    return errors;
  }
  const native = String(review.nativeSubagent || '').toUpperCase();
  if (native && !['AVAILABLE', 'UNAVAILABLE'].includes(native)) errors.push('review.nativeSubagent must be AVAILABLE or UNAVAILABLE');
  if (mode.isIndependentExecutionProven) {
    if (review.reviewer !== 'devil-advocate') errors.push('review.reviewer must be devil-advocate for an independent report review');
    if (!String(review.childId || '').trim()) errors.push(`review.childId (the reviewer's own subagent/result id) is required for ${modeId}`);
  } else if (native === 'AVAILABLE' && !String(review.reason || '').trim()) {
    errors.push(`review.reason is required: ${modeId} was used although native subagent invocation is AVAILABLE`);
  }
  return errors;
}
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
  MODEL_TIERS,
  assessRunEscalation,
  enforceVerdictTier
} = require('./escalation.js');
const { raiseTierFromDiff } = require('./tier.js');
const { readyForDa } = require('./claimed-vs-reality.js');
const { runMaxIterations, detectNoProgress, recordIteration } = require('./no-progress.js');
const { finalVerificationStatus } = require('./verification-lanes.js');
const { checkLedgerBinding } = require('./review-ingest.js');

const CLAIMED_VS_REALITY_PATH = '.ai-engineering-loop/tasks/claimed-vs-reality.md';

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
  errors.push(...validateGoalScope(contract.scope));
  return { valid: errors.length === 0, errors };
}

// Optional Goal scope (#59): absent = no path enforcement.
function validateGoalScope(scope) {
  if (scope === undefined) return [];
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return ['scope must be an object'];
  const errors = [];
  for (const key of Object.keys(scope)) {
    if (!['allowedPaths', 'deniedPaths'].includes(key)) errors.push(`scope.${key} is not supported (use allowedPaths, deniedPaths)`);
  }
  for (const key of ['allowedPaths', 'deniedPaths']) {
    if (scope[key] === undefined) continue;
    if (!Array.isArray(scope[key]) || scope[key].some((item) => typeof item !== 'string' || !item.trim())) {
      errors.push(`scope.${key} must be an array of non-empty glob strings`);
    } else if (scope[key].some((item) => item.startsWith('/') || item.split('/').includes('..'))) {
      errors.push(`scope.${key} globs must be repository-relative`);
    }
  }
  return errors;
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

function tierOf(run) {
  return run?.tier?.current || null;
}

function claimedVsRealityReady(rootDir) {
  try {
    return readyForDa(fs.readFileSync(path.join(rootDir, CLAIMED_VS_REALITY_PATH), 'utf8'));
  } catch {
    return false;
  }
}

// T0 has no Devil's Advocate. The CLI writes an explicit empty, diff-bound
// ledger so the review and Judge gates stay in place, but only after
// claimed-vs-reality has a Reality cell for every Claimed row.
function writeT0FindingLedger(rootDir, run) {
  const filePath = artifactPath(rootDir, run.runId, GATE_FILES.review);
  if (fs.existsSync(filePath)) return false;
  if (!claimedVsRealityReady(rootDir)) {
    throw gateError('T0 review needs a completed claimed-vs-reality file', [
      `Fill every Claimed and Reality cell in ${CLAIMED_VS_REALITY_PATH} (scaffold: context claimed-vs-reality)`
    ]);
  }
  fs.writeFileSync(filePath, `${JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    diffHash: run.artifacts.diff.sha256,
    reviewer: 'none (tier T0: no Devil\'s Advocate)',
    tier: 'T0',
    findings: []
  }, null, 2)}\n`, { mode: 0o600 });
  return true;
}

// Whether the Judge subagent can be replaced by the deterministic verdict.
// Never for T2 or tierless (legacy) runs. T0/T1 qualify only with zero
// BLOCKER/HIGH findings of any validity, a clean escalation assessment,
// green diff-bound verification, a ready claimed-vs-reality file, and an
// iteration under the cap.
function judgeRequirement(rootDir, run) {
  const tier = tierOf(run);
  const reasons = [];
  if (!tier) return { required: true, tier: null, reasons: ['NO_TIER (legacy run): use the Judge subagent'] };
  if (tier === 'T2') return { required: true, tier, reasons: ['TIER_T2: Judge on STRONG_MODEL is mandatory'] };
  let findings = [];
  try {
    findings = readJsonArtifact(rootDir, run.runId, GATE_FILES.review).value.findings || [];
  } catch {
    reasons.push('FINDINGS_MISSING');
  }
  const serious = findings.filter((f) => f && (f.severity === 'BLOCKER' || f.severity === 'HIGH'));
  if (serious.length) reasons.push(`BLOCKER_OR_HIGH_FINDINGS: ${serious.map((f) => f.id).join(', ')}`);
  if (run.iteration >= runMaxIterations(rootDir, run)) reasons.push('ITERATION_CEILING');
  let escalation = null;
  try {
    escalation = assessRunEscalation(rootDir, { runId: run.runId });
    if (escalation.requiredTier !== MODEL_TIERS.CHEAP_MODEL) {
      reasons.push(`ESCALATION_${escalation.requiredTier}: ${escalation.reasons.map((r) => r.code).join(', ')}`);
    }
  } catch (cause) {
    reasons.push(`ESCALATION_UNAVAILABLE: ${cause.message}`);
  }
  if (!claimedVsRealityReady(rootDir)) reasons.push('CLAIMED_VS_REALITY_INCOMPLETE');
  return { required: reasons.length > 0, tier, reasons };
}

// The verdict the evidence supports. The Judge may add evidence-backed
// blocking findings (judgeFindings) that the Maker's ledger lacks; it can
// never PASS what the deterministic rules block. An ITERATE that repeats the
// previous iteration (same diff or same blocking findings) escalates.
function expectedJudgeVerdict(rootDir, run, { judgeFindings = [] } = {}) {
  const verification = readJsonArtifact(rootDir, run.runId, GATE_FILES.verification).value;
  const findings = readJsonArtifact(rootDir, run.runId, GATE_FILES.review).value;
  const goalContract = readJsonArtifact(rootDir, run.runId, GATE_FILES.goal).value;
  const ledger = judgeFindings.length
    ? { ...findings, findings: [...(findings.findings || []), ...judgeFindings] }
    : findings;
  const expected = computeJudgeVerdict({
    goalContract,
    verificationEvidence: verificationForJudge(verification),
    findingLedger: ledger,
    activeIteration: run.iteration,
    maxIterations: runMaxIterations(rootDir, run)
  });
  if (expected.verdict === 'ITERATE') {
    const noProgress = detectNoProgress(rootDir, run, {
      diffHash: run.artifacts?.diff?.sha256,
      blockingFindings: expected.blockingFindings || []
    });
    if (noProgress) {
      return {
        ...expected,
        verdict: 'ESCALATE',
        reason: noProgress,
        action: 'Human escalation: the loop stopped making progress.'
      };
    }
  }
  return expected;
}

function validateJudgeFindings(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw gateError('Judge gate failed', ['judgeFindings must be an array']);
  const check = validateFindingLedger({ findings: value });
  if (!check.valid) throw gateError('Judge gate failed', [`judgeFindings: ${check.reason}`]);
  return value.map((finding) => ({ ...finding, source: 'judge' }));
}

function writeDeterministicVerdictIfEligible(rootDir, run) {
  const filePath = artifactPath(rootDir, run.runId, GATE_FILES.judge);
  if (fs.existsSync(filePath)) return false;
  const tier = tierOf(run);
  if (!tier) return false;
  const requirement = judgeRequirement(rootDir, run);
  if (requirement.required) {
    throw gateError(`Judge subagent required for tier ${tier}; write ${GATE_FILES.judge} from its verdict`, requirement.reasons);
  }
  const expected = expectedJudgeVerdict(rootDir, run);
  fs.writeFileSync(filePath, `${JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    verdict: expected.verdict,
    reason: expected.reason,
    action: expected.action,
    modelTier: MODEL_TIERS.CHEAP_MODEL,
    decidedBy: 'deterministic-gate',
    tier
  }, null, 2)}\n`, { mode: 0o600 });
  return true;
}

// Out-of-map changes recorded by verify (#71) become LOW ledger warnings,
// so they reach the Judge and the receipt without blocking delivery.
function mergeImpactDrift(rootDir, run) {
  const { loadImpactDrift, mergeDriftIntoLedger } = require('./impact-map.js');
  const drift = loadImpactDrift(rootDir, run.runId);
  const filePath = artifactPath(rootDir, run.runId, GATE_FILES.review);
  if (!drift?.outOfMap?.length || !fs.existsSync(filePath)) return 0;
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return 0;
  }
  const merged = mergeDriftIntoLedger(ledger, drift);
  if (merged.added) fs.writeFileSync(filePath, `${JSON.stringify(merged.ledger, null, 2)}\n`, { mode: 0o600 });
  return merged.added;
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
    reportErrors.push(...validateReportReview(value.review));
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
    const raisedTier = raiseTierFromDiff(run.tier, { task: run.task, diff });
    return transitionRun(rootDir, run.runId, RUN_STATES.MAKER_COMPLETE, {
      gate,
      artifacts,
      ...(raisedTier ? { statePatch: { tier: raisedTier }, historyMetadata: { tier: raisedTier.current } } : {})
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
    if (tierOf(run) === 'T0') writeT0FindingLedger(rootDir, run);
    mergeImpactDrift(rootDir, run);
    const { filePath, value } = readJsonArtifact(rootDir, run.runId, GATE_FILES.review);
    requireRunMetadata(value, run, 'Finding Ledger');
    if (value.diffHash !== run.artifacts.diff?.sha256) {
      throw gateError('Finding Ledger diffHash does not match the gated Maker diff');
    }
    const check = validateFindingLedger(value);
    if (!check.valid) throw gateError('Review gate failed', [check.reason]);
    const binding = checkLedgerBinding(rootDir, run, value);
    if (binding.errors.length) {
      throw gateError('Finding Ledger does not match the reviewer output (LEDGER_TAMPERED)', binding.errors);
    }
    if (binding.binding === 'UNBOUND' && mode === RUN_MODES.UNATTENDED) {
      throw gateError('UNATTENDED review needs a ledger bound to the reviewer output', [
        'Run `review ingest --run <id> --child-id <id> --file <child-output>` instead of writing findings.json'
      ]);
    }
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
    writeDeterministicVerdictIfEligible(rootDir, run);
    const { filePath, value } = readJsonArtifact(rootDir, run.runId, GATE_FILES.judge);
    const verdictCheck = validateVerdictDocument(value, run);
    if (!verdictCheck.valid) throw gateError('Judge gate failed', verdictCheck.errors);
    if (tierOf(run) === 'T2' && value.verdict === 'PASS'
      && ![MODEL_TIERS.STRONG_MODEL, MODEL_TIERS.HUMAN].includes(value.modelTier)) {
      throw gateError('T2 Judge PASS requires modelTier STRONG_MODEL or HUMAN', ['TIER_T2_STRONG_JUDGE']);
    }
    try {
      enforceVerdictTier(rootDir, run, value);
    } catch (cause) {
      throw gateError(cause.message, [cause.code]);
    }
    const judgeFindings = validateJudgeFindings(value.judgeFindings);
    const expected = expectedJudgeVerdict(rootDir, run, { judgeFindings });
    if (value.verdict !== expected.verdict) {
      throw gateError(`Judge verdict is unsupported: expected ${expected.verdict}, received ${value.verdict}`, [expected.reason]);
    }
    recordIteration(rootDir, run, {
      verdict: expected.verdict,
      diffHash: run.artifacts?.diff?.sha256,
      blockingFindings: expected.blockingFindings || []
    });
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
  const finalCheck = finalVerificationStatus(rootDir, run);
  if (!finalCheck.satisfied) deliveryErrors.push(`Full verification required before delivery: ${finalCheck.reason}`);
  if (deliveryErrors.length) throw gateError('Delivery gate failed', deliveryErrors);
  return transitionRun(rootDir, run.runId, RUN_STATES.DELIVERED, {
    gate,
    artifacts: { delivery: descriptor(rootDir, filePath) }
  });
}

module.exports = {
  GATE_FILES,
  validateReportReview,
  artifactPath,
  hashContent,
  hashFile,
  assertArtifactCurrent,
  validateGoalContract,
  validateVerificationBundle,
  validateVerdictDocument,
  judgeRequirement,
  expectedJudgeVerdict,
  applyGate
};
