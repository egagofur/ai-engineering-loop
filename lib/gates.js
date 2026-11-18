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
const { checkClaimedVsReality, loadFrozenGoal } = require('./claimed-vs-reality.js');
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

// C-04: every gate failure says what failed (message), why the gate cares
// (why), and the next concrete step (fix), so an agent can self-correct.
function gateError(message, details = [], { why = null, fix = null } = {}) {
  const err = new Error(message);
  err.code = 'GATE_FAILED';
  err.details = details;
  if (why) err.why = why;
  if (fix) err.fix = fix;
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
    throw gateError(`Missing or invalid ${fileName}: ${cause.message}`, [], { why: 'Every gate reads its artifact from the Run directory; without it there is nothing to check.', fix: `Write ${fileName} in the Run directory (\`scaffold\` can create a template), then retry the gate.` });
  }
  return { filePath, value };
}

function hashFile(filePath) {
  try {
    return hashContent(fs.readFileSync(filePath));
  } catch (cause) {
    throw gateError(`Unable to hash ${filePath}: ${cause.message}`, [], { why: 'Gates bind artifacts by sha256 so later edits are detected.', fix: `Check that ${filePath} exists and is readable, then retry.` });
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
    throw gateError(`Required ${name} artifact has not passed its gate`, [], { why: 'Stages run in order; a later gate cannot trust an earlier artifact that never passed.', fix: `Pass the ${name} gate first (\`gate <stage> --run <id>\`).` });
  }
  const filePath = path.join(rootDir, artifact.path);
  if (hashFile(filePath) !== artifact.sha256) {
    throw gateError(`${name} artifact changed after its gate; rerun the owning stage`, [], { why: 'Gated artifacts are frozen by hash; a silent edit would invalidate later evidence.', fix: `Re-run the stage that owns ${name}, or restore the gated version.` });
  }
}

function requireRunMetadata(document, run, label) {
  const errors = [];
  if (document.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (document.runId !== run.runId) errors.push(`runId must be ${run.runId}`);
  if (errors.length) throw gateError(`${label} metadata is invalid`, errors, { why: 'Artifacts must name the Run they belong to so evidence cannot be copied across Runs.', fix: 'Set schemaVersion, runId and the other listed fields to this Run\'s values.' });
}

function validateGoalContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object') return { valid: false, errors: ['contract must be an object'] };
  if (!String(contract.objective || '').trim()) errors.push('objective is required');
  errors.push(...require('./flow.js').flowProblems(contract.flow, {
    acIds: Array.isArray(contract.acceptanceCriteria) ? contract.acceptanceCriteria.map((criterion) => criterion?.id) : [],
    forbidden: contract.forbiddenTransitions
  }));
  if (contract.plainSummary !== undefined && (typeof contract.plainSummary !== 'string' || !contract.plainSummary.trim() || contract.plainSummary.length > 240)) {
    errors.push('plainSummary must be one sentence of at most 240 characters');
  }
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
  errors.push(...require('./design-ref.js').validateDesignRef(contract.designRef));
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

// C-12 (learn-harness-engineering L01/L02): which harness layer a failed
// iteration points at. `model` = an implementation defect the harness could
// not have prevented.
const FAILURE_CAUSES = Object.freeze(['task_spec', 'context', 'environment', 'verification', 'state', 'model']);

function inferCause(verdict, blockingFindings = []) {
  if (verdict === 'PASS') return null;
  if (blockingFindings.some((finding) => finding.source === 'verification-integrity')) return 'verification';
  if (verdict === 'ESCALATE') return 'task_spec';
  return 'model';
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
  if (verdict.cause != null && !FAILURE_CAUSES.includes(verdict.cause)) {
    errors.push(`cause must be one of ${FAILURE_CAUSES.join(', ')}`);
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
  if (!current) throw gateError('No current run. Start one with `ai-engineering-loop run <task>`.', [], { why: 'Gates act on a Run.', fix: 'Start a Run with `run <task>` or pass --run <id>.' });
  return current;
}

// C-02: at T1/T2, when the project configures typecheck or lint, the gated
// bundle must contain at least one L1 (static) command. Unit tests alone do
// not prove the change compiles or passes lint.
function missingStaticLayer(rootDir, run, bundle) {
  const tier = tierOf(run);
  if (tier !== 'T1' && tier !== 'T2') return null;
  if (require('./ablation.js').ablated(rootDir, 'l1', run.runId)) return null;
  const lanes = require('./verification-lanes.js');
  const configured = lanes.verificationCommands(rootDir);
  const staticKeys = ['typecheck', 'lint'].filter((key) => configured[key] && !lanes.isMutatingCommand(configured[key]));
  if (!staticKeys.length) return null;
  // The related lane is the iteration fast path; `verify --final` runs the full plan.
  if ((bundle.commands || []).length && bundle.commands.every((record) => record.scope === 'related')) return null;
  const hasStatic = (bundle.commands || []).some((record) =>
    (record.layer || lanes.layerOfCommand(rootDir, record.command)) === 'L1');
  if (hasStatic) return null;
  return `No L1 static check in the verification bundle, but verification.md configures ${staticKeys.join(' and ')}. FIX: run \`verify --run ${run.runId}\` without --cmd (it runs L1 first), or add --cmd "${configured[staticKeys[0]]}".`;
}

// C-03: when verification.md configures `smoke` and the diff touches
// startup-risky files, a passing smoke record must be in the bundle.
function missingSmoke(rootDir, run, bundle) {
  const lanes = require('./verification-lanes.js');
  const smokeText = lanes.verificationCommands(rootDir).smoke;
  if (!smokeText) return null;
  if (require('./ablation.js').ablated(rootDir, 'smoke', run.runId)) return null;
  const risky = lanes.startupRiskFiles(rootDir, run);
  if (!risky.length) return null;
  const base = smokeText.trim();
  if ((bundle.commands || []).some((record) => String(record.command || '').trim() === base)) return null;
  return `The diff touches startup-risky files (${risky.slice(0, 3).join(', ')}${risky.length > 3 ? ', ...' : ''}) but the smoke check did not run. FIX: run \`verify --run ${run.runId}\` without --cmd, or add --cmd "${base}".`;
}

function rubricGaps(rootDir, run) {
  let goal;
  try {
    goal = loadFrozenGoal(rootDir, run);
  } catch {
    return [];
  }
  let ledger = null;
  try {
    ledger = readJsonArtifact(rootDir, run.runId, GATE_FILES.review).value;
  } catch {
    ledger = null;
  }
  return require('./ac-status.js').rubricProblems(goal, ledger);
}

// C-07: ACs with verify.command must be proven by a passing record.
function unprovenCriteria(rootDir, run) {
  let goal;
  try {
    goal = loadFrozenGoal(rootDir, run);
  } catch {
    return [];
  }
  return require('./ac-status.js').runAcStatuses(rootDir, run, goal)
    .filter((ac) => ac.status === 'pending' || ac.status === 'failed');
}

function tierOf(run) {
  return run?.tier?.current || null;
}

// Layers proven by recorded verification (gated bundle + final run). A
// command not mapped in verification.md counts as L2 (a test run).
function recordedLayers(rootDir, run) {
  if (!run) return null;
  const lanes = require('./verification-lanes.js');
  const layers = new Set();
  for (const file of ['verification.json', 'final-verification.json']) {
    let bundle;
    try {
      bundle = JSON.parse(fs.readFileSync(artifactPath(rootDir, run.runId, file), 'utf8'));
    } catch {
      continue;
    }
    for (const record of bundle.commands || []) {
      if (record.exitCode !== 0) continue;
      layers.add(record.layer || lanes.layerOfCommand(rootDir, record.command) || 'L2');
    }
  }
  return layers.size ? layers : null;
}

// Status of claimed-vs-reality.md for this run, including the three-layer
// (L1/L2/L3) requirement from the frozen Goal Contract and the run tier.
function claimedVsRealityStatus(rootDir, run) {
  let markdown;
  try {
    markdown = fs.readFileSync(path.join(rootDir, CLAIMED_VS_REALITY_PATH), 'utf8');
  } catch {
    return { ready: false, problems: [`${CLAIMED_VS_REALITY_PATH} is missing. FIX: scaffold it with \`context claimed-vs-reality --run ${run?.runId || '<id>'}\` after \`gate verification\`, then fill every row.`] };
  }
  let goal = null;
  try {
    goal = run ? loadFrozenGoal(rootDir, run) : null;
  } catch {
    goal = null;
  }
  if (require('./ablation.js').ablated(rootDir, 'l3', run?.runId)) return checkClaimedVsReality(markdown, {});
  return checkClaimedVsReality(markdown, { goal, tier: tierOf(run), layers: recordedLayers(rootDir, run) });
}

function claimedVsRealityReady(rootDir, run) {
  return claimedVsRealityStatus(rootDir, run).ready;
}

// T0 has no Devil's Advocate. The CLI writes an explicit empty, diff-bound
// ledger so the review and Judge gates stay in place, but only after
// claimed-vs-reality has a Reality cell for every Claimed row.
function writeT0FindingLedger(rootDir, run) {
  const filePath = artifactPath(rootDir, run.runId, GATE_FILES.review);
  if (fs.existsSync(filePath)) return false;
  const status = claimedVsRealityStatus(rootDir, run);
  if (!status.ready) {
    throw gateError('T0 review needs a completed claimed-vs-reality file', status.problems, { why: 'T0 has no Devil\'s Advocate, so claimed-vs-reality is the only check that claims match evidence.', fix: 'Fill every Claimed and Reality cell (scaffold: `context claimed-vs-reality`), then retry `gate review`.' });
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
  if (!claimedVsRealityReady(rootDir, run)) reasons.push('CLAIMED_VS_REALITY_INCOMPLETE');
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
  if (!Array.isArray(value)) throw gateError('Judge gate failed', ['judgeFindings must be an array'], { why: 'Judge-added findings use the Finding Ledger shape so the gate can recompute the verdict.', fix: 'Make judgeFindings an array of ledger findings (or remove it).' });
  const check = validateFindingLedger({ findings: value });
  if (!check.valid) throw gateError('Judge gate failed', [`judgeFindings: ${check.reason}`], { why: 'Judge-added findings must be complete enough to act on.', fix: 'Give each judgeFinding location, failureScenario, evidence, severity, validity and (for VALID BLOCKER/HIGH) concreteAlternativeDiff.' });
  return value.map((finding) => ({ ...finding, source: 'judge' }));
}

function writeDeterministicVerdictIfEligible(rootDir, run) {
  const filePath = artifactPath(rootDir, run.runId, GATE_FILES.judge);
  if (fs.existsSync(filePath)) return false;
  const tier = tierOf(run);
  if (!tier) return false;
  const requirement = judgeRequirement(rootDir, run);
  if (requirement.required) {
    throw gateError(`Judge subagent required for tier ${tier}; write ${GATE_FILES.judge} from its verdict`, requirement.reasons, { why: 'This Run has signals (tier, serious findings, escalation, incomplete evidence) that a deterministic verdict must not decide alone.', fix: `Spawn the Judge subagent with the ledger and Goal, write its verdict to ${GATE_FILES.judge}, then retry \`gate judge\`.` });
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

// C-11: weakened proof in the gated diff (skips, deleted tests, dropped
// assertions, edited verification config) becomes VALID ledger findings.
function mergeVerificationIntegrity(rootDir, run) {
  if (require('./ablation.js').ablated(rootDir, 'integrity', run.runId)) return 0;
  const { scanRun, mergeIntegrityIntoLedger } = require('./verification-integrity.js');
  const filePath = artifactPath(rootDir, run.runId, GATE_FILES.review);
  if (!fs.existsSync(filePath)) return 0;
  const findings = scanRun(rootDir, run);
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return 0;
  }
  const merged = mergeIntegrityIntoLedger(ledger, findings);
  if (merged.errors.length) throw gateError('Review gate failed (VERIFICATION_WEAKENED finding dropped)', merged.errors, { why: 'Weakened tests make a green gate meaningless, so only a human may excuse them.', fix: 'Restore the integrity finding, or record a human dismissal {by, evidence}.' });
  if (merged.added) fs.writeFileSync(filePath, `${JSON.stringify(merged.ledger, null, 2)}\n`, { mode: 0o600 });
  return merged.added;
}

// C-18: suppressions and justification comments added by the change.
function mergeCommentJustifications(rootDir, run) {
  if (require('./ablation.js').ablated(rootDir, 'comments', run.runId)) return 0;
  const { scanRunComments, mergeCommentFindings } = require('./comment-findings.js');
  const filePath = artifactPath(rootDir, run.runId, GATE_FILES.review);
  if (!fs.existsSync(filePath)) return 0;
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return 0;
  }
  const merged = mergeCommentFindings(ledger, scanRunComments(rootDir, run));
  if (merged.errors.length) {
    throw gateError('Review gate failed (comment or no-comments finding dropped)', merged.errors,
      { why: 'Comments and suppressions are how agents justify skipping the root cause, and new comments in product code are banned by default (C-26); dropping the finding silently hides that decision.', fix: 'Restore the finding, or record dismissal: {by, evidence} for each one.' });
  }
  if (merged.added) fs.writeFileSync(filePath, `${JSON.stringify(merged.ledger, null, 2)}\n`, { mode: 0o600 });
  return merged.added;
}

const ITERATION_EVIDENCE = ['verification.json', 'verification-summary.json', 'final-verification.json'];

function archiveIterationEvidence(rootDir, run) {
  const runDir = path.dirname(artifactPath(rootDir, run.runId, 'verification.json'));
  const target = path.join(runDir, 'iterations', String(run.iteration || 1));
  for (const name of ITERATION_EVIDENCE) {
    const from = path.join(runDir, name);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    fs.renameSync(from, path.join(target, name));
  }
}

function applyGate(rootDir, gate, { runId, transitionOptions = {} } = {}) {
  if (!Object.hasOwn(GATE_FILES, gate)) {
    throw gateError(`Unknown gate: ${gate}. Use ${Object.keys(GATE_FILES).join('|')}`, [], { why: 'Only the listed stages exist.', fix: `Use one of: ${Object.keys(GATE_FILES).join(', ')}.` });
  }
  const run = resolveRun(rootDir, runId);
  const mode = run.mode || RUN_MODES.ASSISTED;
  const policy = assertModeAllowed(rootDir, mode);

  if (gate === 'goal') {
    const { filePath, value } = readJsonArtifact(rootDir, run.runId, GATE_FILES.goal);
    requireRunMetadata(value, run, 'goal contract');
    const check = validateGoalContract(value);
    if (!check.valid) throw gateError('Goal Contract gate failed', check.errors, { why: 'Work may not start until acceptance criteria, evidence and failure cases are explicit.', fix: 'Fix the listed Goal Contract fields (every AC needs statement, evidenceRequired, failureCases), then retry `gate goal`.' });
    const frozen = transitionRun(rootDir, run.runId, RUN_STATES.GOAL_FROZEN, {
      gate,
      artifacts: { goalContract: descriptor(rootDir, filePath) },
      ...transitionOptions
    });
    try {
      require('./features.js').onGoalFrozen(rootDir, run, value);
    } catch {
      // The feature ledger is optional; never block the Goal gate on it.
    }
    return frozen;
  }

  if (gate === 'report') {
    if (mode !== RUN_MODES.REPORT_ONLY) {
      throw gateError('Report gate is only available in REPORT_ONLY mode', [], { why: 'Delivery runs must go through Maker, verification and review.', fix: 'Use the Maker gate for this Run, or start a REPORT_ONLY Run for a report.' });
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
    if (reportErrors.length) throw gateError('Report gate failed', reportErrors, { why: 'A report must stand on cited evidence.', fix: 'Fix the listed report fields, then retry `gate report`.' });
    return transitionRun(rootDir, run.runId, RUN_STATES.REPORTED, {
      gate,
      artifacts: { report: descriptor(rootDir, filePath) }
    });
  }

  if (gate === 'maker') {
    if (mode === RUN_MODES.REPORT_ONLY) {
      throw gateError('REPORT_ONLY mode cannot enter the Maker stage; finish with the report gate', [], { why: 'REPORT_ONLY Runs never change code.', fix: 'Finish with `gate report`, or start a normal Run to make changes.' });
    }
    const filePath = artifactPath(rootDir, run.runId, GATE_FILES.maker);
    let diff;
    try {
      diff = fs.readFileSync(filePath, 'utf8');
    } catch (cause) {
      throw gateError(`Missing ${GATE_FILES.maker}: ${cause.message}`, [], { why: 'The Maker gate binds review to an exact diff.', fix: `Run \`gate maker --from-git --run <id>\` to capture the diff, or write ${GATE_FILES.maker}.` });
    }
    if (!diff.trim()) throw gateError('Maker gate failed: diff.patch is empty', [], { why: 'There is no change to verify or review.', fix: 'Make the change first, then run `gate maker --from-git`.' });
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
      if (sandboxErrors.length) throw gateError('Unattended Maker sandbox evidence failed', sandboxErrors, { why: 'UNATTENDED Runs must prove the Maker ran inside the sandbox.', fix: 'Re-run the Maker inside the configured sandbox so its evidence is recorded, then retry.' });
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
      throw gateError('Maker diff changed after its gate; run the Maker gate again', [], { why: 'Verification evidence is bound to the gated diff hash; a new diff needs new evidence.', fix: 'Run `gate maker --from-git --run <id>`, then `verify` again.' });
    }
    const { filePath, value } = readJsonArtifact(rootDir, run.runId, GATE_FILES.verification);
    const check = validateVerificationBundle(value, run, diffHash, getGitRevision(rootDir));
    if (!check.valid) throw gateError('Verification gate failed', check.errors, { why: 'Review only starts on green, diff-bound, complete command evidence.', fix: 'Fix the listed problems (re-run `verify` on the current diff), then retry.' });
    const layerProblem = missingStaticLayer(rootDir, run, value);
    if (layerProblem) throw gateError('Verification gate failed (L1_MISSING)', [layerProblem], { why: 'Unit tests do not prove the change compiles or passes lint.', fix: 'Run `verify` without --cmd so L1 runs first.' });
    const missingRuleChecks = require('./ablation.js').ablated(rootDir, 'rules', run.runId) ? [] : require('./rules.js').missingRules(rootDir, value);
    if (missingRuleChecks.length) {
      throw gateError('Verification gate failed (RULES_MISSING)', missingRuleChecks.map((rule) => `${rule.id}: \`${rule.check}\` has no passing record`),
        { why: 'Promoted rules encode review feedback that kept recurring; skipping them lets the same defect back in.', fix: `Run \`verify --run ${run.runId}\` without --cmd so every rule runs, and fix any violation it reports.` });
    }
    const smokeProblem = missingSmoke(rootDir, run, value);
    if (smokeProblem) throw gateError('Verification gate failed (SMOKE_MISSING)', [smokeProblem], { why: 'Migrations, config, env and entrypoint changes can break startup while unit tests stay green.', fix: 'Run `verify` without --cmd so the smoke check runs.' });
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
    else if (tierOf(run)) {
      // T1/T2: the Devil's Advocate must have reviewed against completed,
      // layer-tagged evidence (three-layer termination check).
      const status = claimedVsRealityStatus(rootDir, run);
      if (!status.ready) {
        throw gateError(`${tierOf(run)} review needs a completed claimed-vs-reality file (CLAIMED_VS_REALITY_INCOMPLETE)`, status.problems, { why: 'The Devil\'s Advocate reviews claims against evidence; missing or untagged evidence hides what was really proven.', fix: 'Fix each listed row (Reality from command output, Layer backed by a recorded command), then retry `gate review`.' });
      }
    }
    mergeImpactDrift(rootDir, run);
    mergeVerificationIntegrity(rootDir, run);
    mergeCommentJustifications(rootDir, run);
    if (!require('./ablation.js').ablated(rootDir, 'proofs', run.runId)) require('./finding-proofs.js').runFindingProofs(rootDir, run);
    const { filePath, value } = readJsonArtifact(rootDir, run.runId, GATE_FILES.review);
    requireRunMetadata(value, run, 'Finding Ledger');
    if (value.diffHash !== run.artifacts.diff?.sha256) {
      throw gateError('Finding Ledger diffHash does not match the gated Maker diff', [], { why: 'A review of a different diff says nothing about this one.', fix: 'Re-run the Devil\'s Advocate on the current review pack, then `review ingest`.' });
    }
    const check = validateFindingLedger(value);
    if (!check.valid) throw gateError('Review gate failed', [check.reason], { why: 'The Judge recomputes the verdict from the ledger, so every finding must be well-formed.', fix: 'Fix the listed ledger field, then retry `gate review`.' });
    const binding = checkLedgerBinding(rootDir, run, value);
    if (binding.errors.length) {
      throw gateError('Finding Ledger does not match the reviewer output (LEDGER_TAMPERED)', binding.errors, { why: 'Findings may not be dropped or silently downgraded between the reviewer and the gate.', fix: 'Restore the reviewer\'s findings, or add dismissal {by, evidence} for each downgrade.' });
    }
    if (binding.binding === 'UNBOUND' && mode === RUN_MODES.UNATTENDED) {
      throw gateError('UNATTENDED review needs a ledger bound to the reviewer output', [
        'Run `review ingest --run <id> --child-id <id> --file <child-output>` instead of writing findings.json'
      ], { why: 'Without a human watching, the ledger must be provably the reviewer\'s own output.', fix: 'Use `review ingest --run <id> --child-id <id> --file <child-output>`.' });
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
    if (!verdictCheck.valid) throw gateError('Judge gate failed', verdictCheck.errors, { why: 'The verdict must name its decision, reason and action.', fix: 'Fix the listed verdict fields, then retry `gate judge`.' });
    if (tierOf(run) === 'T2' && value.verdict === 'PASS'
      && ![MODEL_TIERS.STRONG_MODEL, MODEL_TIERS.HUMAN].includes(value.modelTier)) {
      throw gateError('T2 Judge PASS requires modelTier STRONG_MODEL or HUMAN', ['TIER_T2_STRONG_JUDGE'], { why: 'T2 changes (auth, money, data, security) need the strongest judgment.', fix: 'Re-run the Judge on STRONG_MODEL (or a human) and set modelTier accordingly.' });
    }
    try {
      enforceVerdictTier(rootDir, run, value);
    } catch (cause) {
      throw gateError(cause.message, [cause.code], { why: 'The verdict contradicts the escalation policy.', fix: 'Follow the escalation output (`escalation --json`) and re-issue the verdict.' });
    }
    const judgeFindings = validateJudgeFindings(value.judgeFindings);
    const expected = expectedJudgeVerdict(rootDir, run, { judgeFindings });
    if (value.verdict !== expected.verdict) {
      throw gateError(`Judge verdict is unsupported: expected ${expected.verdict}, received ${value.verdict}`, [expected.reason], { why: 'The gate recomputes the verdict from Validity and Severity; prose cannot override it.', fix: `Issue ${expected.verdict}, or add the blocking problem as a judgeFinding so the ledger supports your verdict.` });
    }
    const blocking = expected.blockingFindings || [];
    const cause = value.cause || inferCause(expected.verdict, blocking);
    if (expected.verdict === 'ITERATE' && value.cause) {
      const previous = require('./no-progress.js').readIterations(rootDir, run.runId).filter((entry) => entry.verdict === 'ITERATE').pop();
      const premise = value.premise || {};
      if (previous && !previous.causeInferred && previous.cause === cause && !(String(premise.statement || '').trim() && String(premise.test || '').trim())) {
        throw gateError(`Judge ITERATE repeats cause "${cause}": state and test the shared premise first (PREMISE_REQUIRED)`, [`iteration ${previous.iteration || run.iteration - 1} also failed on ${cause}`],
          { why: 'When two fixes that share one premise fail the same gate, the premise is the likely bug; a third fix on the same premise usually fails too.', fix: 'Add premise: { statement: "<the one sentence every failed fix assumed>", test: "<the observation that would differ if it were false, and what it showed>" } to verdict.json, then retry `gate judge`.' });
      }
    }
    recordIteration(rootDir, run, {
      verdict: expected.verdict,
      diffHash: run.artifacts?.diff?.sha256,
      blockingFindings: blocking,
      cause,
      causeInferred: Boolean(cause && !value.cause)
    });
    const artifacts = { verdict: descriptor(rootDir, filePath) };
    if (expected.verdict === 'PASS') {
      const rubric = rubricGaps(rootDir, run);
      if (rubric.length) {
        throw gateError('Judge PASS refused: rubric criteria are not scored or failed (AC_RUBRIC)', rubric,
          { why: 'Subjective ACs are judged generously by default; a rubric scored with evidence per criterion makes the judgment reproducible.', fix: 'Have the Devil\'s Advocate add rubricScores [{ac, criterion, pass, evidence}] for every criterion (screenshot path, DOM snapshot, measured value), re-ingest, then retry; or issue ITERATE for failed criteria.' });
      }
      if (tierOf(run) === 'T2') {
        const safety = require('./safety-fact.js').safetyFactProblem(rootDir, run);
        if (safety) {
          throw gateError('Judge PASS refused: T2 needs a proven safety fact (SAFETY_FACT_UNPROVEN)', [safety],
            { why: 'A high-risk change is safe because of one fact; a writeup that sounds right proves nothing until real code runs.', fix: `Run \`safety record --run ${run.runId} --fact "<the one fact>" --cmd "<script or test that passes only if the fact holds>"\`, then retry \`gate judge\`.` });
        }
      }
      const measured = require('./measurements.js').measurementProblems(rootDir, run, loadFrozenGoal(rootDir, run));
      if (measured.length) {
        throw gateError('Judge PASS refused: a performance number is not explained (MEASUREMENT_UNEXPLAINED)', measured,
          { why: 'A single run or a gap smaller than the noise says nothing; the limiter tells you whether the number measured the change at all.', fix: `Measure at least 3 runs, find what bounds the result, then \`measurement record --run ${run.runId} --ac <AC-n> --runs <n> --spread <pct> --effect <pct> --limiter "<what bounds it>"\` and retry.` });
      }
      const unproven = unprovenCriteria(rootDir, run);
      if (unproven.length) {
        throw gateError('Judge PASS refused: acceptance criteria are not proven (AC_NOT_PROVEN)',
          unproven.map((ac) => `${ac.id}: verify command \`${ac.command}\` is ${ac.status}`),
          { why: 'An AC that names its verify command is proven only when that command passed on the gated diff.', fix: `Run \`verify --run ${run.runId} --cmd "<the AC's command>"\` for each listed AC (or fix the change), then retry \`gate judge\`.` });
      }
      return transitionRun(rootDir, run.runId, RUN_STATES.JUDGED_PASS, { gate, artifacts });
    }
    if (expected.verdict === 'ESCALATE') {
      return transitionRun(rootDir, run.runId, RUN_STATES.ESCALATED, {
        gate,
        artifacts,
        reason: expected.reason
      });
    }
    archiveIterationEvidence(rootDir, run);
    return transitionRun(rootDir, run.runId, RUN_STATES.GOAL_FROZEN, {
      gate,
      artifacts,
      dropArtifacts: ['verification'],
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
  const cleanState = require('./clean-state.js').checkCleanState(rootDir, run, { mode });
  deliveryErrors.push(...cleanState.errors);
  if (deliveryErrors.length) throw gateError('Delivery gate failed', deliveryErrors, { why: 'Delivery is the last point where missing evidence can be caught before people rely on the change.', fix: 'Fix each listed delivery problem, then retry `gate delivery`.' });
  // C-15: the linked feature becomes passing with this Run as evidence.
  try {
    require('./features.js').onDelivered(rootDir, run, loadFrozenGoal(rootDir, run));
  } catch {
    // Optional ledger.
  }
  // C-14: accepted trade-offs and L3 waivers outlive the Run.
  let debtAdded = 0;
  try {
    debtAdded = require('./debt.js').recordRunDebt(rootDir, run.runId).added;
  } catch {
    debtAdded = 0;
  }
  return transitionRun(rootDir, run.runId, RUN_STATES.DELIVERED, {
    gate,
    artifacts: { delivery: descriptor(rootDir, filePath) },
    ...(debtAdded ? { reason: `${debtAdded} debt item(s) recorded in .ai-engineering-loop/debt.json` } : {}),
    ...(cleanState.warnings.length ? { historyMetadata: { cleanStateWarnings: cleanState.warnings } } : {})
  });
}

module.exports = {
  FAILURE_CAUSES,
  inferCause,
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
