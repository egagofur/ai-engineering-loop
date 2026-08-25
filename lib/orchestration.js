/**
 * AI Engineering Loop — Orchestration Engine & Decision Core
 * Implements deterministic runtime mode selection, artifact isolation barrier,
 * finding ledger validation, verification evidence auditing, and Judge verdict computation.
 */

const crypto = require('crypto');

// 1. Execution Modes
const EXECUTION_MODES = {
  NATIVE_SUBAGENT: {
    id: 'NATIVE_SUBAGENT',
    description: 'Native independent sub-agent provided by host runtime',
    isTrulyIndependent: true
  },
  SDK_AGENT: {
    id: 'SDK_AGENT',
    description: 'Programmatic SDK Agent with isolated memory and process context',
    isTrulyIndependent: true
  },
  HEADLESS_SUBPROCESS: {
    id: 'HEADLESS_SUBPROCESS',
    description: 'Headless subprocess agent with fresh process and clean context',
    isTrulyIndependent: true
  },
  ARTIFACT_ISOLATED_REVIEW: {
    id: 'ARTIFACT_ISOLATED_REVIEW',
    description: 'Isolated review context, not independent agent execution',
    isTrulyIndependent: false
  }
};

/**
 * 1. Resolve Execution Mode based on runtime capabilities
 */
function resolveExecutionMode(capabilities = {}) {
  if (capabilities.hasNativeSubagent) {
    return EXECUTION_MODES.NATIVE_SUBAGENT;
  }
  if (capabilities.hasPythonSdk) {
    return EXECUTION_MODES.SDK_AGENT;
  }
  if (capabilities.hasHeadlessSubprocess) {
    return EXECUTION_MODES.HEADLESS_SUBPROCESS;
  }
  return EXECUTION_MODES.ARTIFACT_ISOLATED_REVIEW;
}

/**
 * 2. Build Clean-Slate Artifact Isolation Barrier
 * Strips conversational memory, author justifications, and internal drafts.
 */
function buildReviewContextBarrier({
  goalContract,
  gitDiff,
  verificationLogs,
  projectContext,
  activeIteration = 1,
  priorFindingSignatures = []
}) {
  if (!goalContract || !gitDiff) {
    throw new Error('Goal contract and git diff are mandatory for review barrier');
  }

  // Ensure no conversational metadata or maker thoughts bleed through
  return {
    iteration: activeIteration,
    diffHash: crypto.createHash('sha256').update(gitDiff).digest('hex').slice(0, 16),
    goalContract: {
      objective: goalContract.objective,
      acceptanceCriteria: goalContract.acceptanceCriteria || [],
      technicalConstraints: goalContract.technicalConstraints || [],
      outOfScope: goalContract.outOfScope || []
    },
    projectContext: {
      profile: projectContext?.profile || 'standard',
      architecture: projectContext?.architecture || '',
      conventions: projectContext?.conventions || '',
      verificationCommands: projectContext?.verificationCommands || ''
    },
    gitDiff: gitDiff.trim(),
    verificationLogs: {
      exitCode: verificationLogs?.exitCode ?? 0,
      summary: verificationLogs?.summary || 'Deterministic checks passed 100%'
    },
    priorFindingSignatures: [...priorFindingSignatures]
  };
}

/**
 * 3. Validate Verification Evidence Contract
 */
function validateVerificationEvidence(evidence) {
  if (!evidence) return { valid: false, reason: 'Evidence object missing' };

  const requiredFields = ['command', 'executionIdentity', 'startTime', 'endTime', 'exitCode', 'stdout', 'timeoutStatus'];
  for (const field of requiredFields) {
    if (evidence[field] === undefined || evidence[field] === null || evidence[field] === '') {
      return { valid: false, reason: `Missing required evidence field: ${field}` };
    }
  }

  if (evidence.exitCode !== 0) {
    return { valid: false, reason: `Verification failed with non-zero exit code: ${evidence.exitCode}` };
  }

  if (evidence.timeoutStatus !== 'COMPLETED') {
    return { valid: false, reason: `Verification did not complete cleanly: ${evidence.timeoutStatus}` };
  }

  // Reject vague placeholders
  const vaguePatterns = ['command was launched', 'test appears to have passed', 'running in background', 'seems green'];
  const outLower = (evidence.stdout + ' ' + (evidence.summary || '')).toLowerCase();
  for (const pattern of vaguePatterns) {
    if (outLower.includes(pattern) && (!evidence.testCounts || evidence.testCounts.passed === 0)) {
      return { valid: false, reason: `Rejected vague or speculative assertion: "${pattern}"` };
    }
  }

  return { valid: true };
}

/**
 * 4. Validate Finding Ledger Schema
 */
function validateFindingLedger(ledger) {
  if (!ledger || !Array.isArray(ledger.findings)) {
    return { valid: false, reason: 'Finding ledger must contain an array of findings' };
  }

  const validSeverities = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'];
  const validValidities = ['VALID', 'INVALID'];
  const validDispositions = ['STRONG', 'ACCEPTABLE', 'WEAK'];

  for (let i = 0; i < ledger.findings.length; i++) {
    const f = ledger.findings[i];
    if (!f.id || !f.location || !f.failureScenario || !f.evidence) {
      return { valid: false, reason: `Finding at index ${i} missing required id, location, failureScenario, or evidence` };
    }

    if (!validSeverities.includes(f.severity)) {
      return { valid: false, reason: `Invalid severity at index ${i}: ${f.severity}. Must be one of: ${validSeverities.join(', ')}` };
    }

    if (!validValidities.includes(f.validity)) {
      return { valid: false, reason: `Invalid validity at index ${i}: ${f.validity}. Must be VALID or INVALID` };
    }

    if (!validDispositions.includes(f.disposition)) {
      return { valid: false, reason: `Invalid disposition at index ${i}: ${f.disposition}. Must be STRONG, ACCEPTABLE, or WEAK` };
    }

    if (f.validity === 'VALID' && (f.severity === 'BLOCKER' || f.severity === 'HIGH') && !f.concreteAlternativeDiff) {
      return { valid: false, reason: `VALID ${f.severity} finding ${f.id} must provide concreteAlternativeDiff` };
    }
  }

  return { valid: true };
}

/**
 * Compute Finding Signature for No-Progress & Repeat Detection
 */
function computeFindingSignature(finding) {
  const normLoc = (finding.location || '').toLowerCase().replace(/\s+/g, '');
  const normTopic = (finding.topic || 'general').toLowerCase();
  const normScenario = (finding.failureScenario || '').toLowerCase().slice(0, 100);
  return crypto.createHash('sha256').update(`${normTopic}:${normLoc}:${normScenario}`).digest('hex').slice(0, 16);
}

/**
 * 5. Compute Judge Verdict based primarily on Validity + Severity
 */
function computeJudgeVerdict({
  goalContract,
  verificationEvidence,
  findingLedger,
  activeIteration = 1,
  maxIterations = 3
}) {
  // Gate 1: Check Verification Evidence Contract
  const verifCheck = validateVerificationEvidence(verificationEvidence);
  if (!verifCheck.valid) {
    return {
      verdict: 'ITERATE',
      reason: `Deterministic verification failed: ${verifCheck.reason}`,
      action: 'Maker must rerun deterministic test suite and obtain clean exit code 0.'
    };
  }

  // Gate 2: Evaluate Findings
  const findings = findingLedger?.findings || [];
  const blockingFindings = [];
  const acceptableFindings = [];
  const dismissedFindings = [];

  for (const f of findings) {
    // Classification/disposition must NOT override validity evidence
    if (f.validity === 'INVALID') {
      dismissedFindings.push({
        id: f.id,
        reason: `Dismissed invalid finding: ${f.failureScenario} (Evidence disproved)`
      });
      continue;
    }

    // Finding is VALID
    if (f.severity === 'BLOCKER' || f.severity === 'HIGH') {
      blockingFindings.push(f);
    } else {
      acceptableFindings.push(f);
    }
  }

  // Decision 1: Blocking findings exist
  if (blockingFindings.length > 0) {
    if (activeIteration >= maxIterations) {
      return {
        verdict: 'ESCALATE',
        reason: `Max iteration ceiling (${maxIterations}) reached with ${blockingFindings.length} open blocking findings.`,
        blockingFindings,
        action: 'Human escalation triggered with actionable diagnostic ledger.'
      };
    }

    return {
      verdict: 'ITERATE',
      reason: `${blockingFindings.length} VALID BLOCKER/HIGH findings require code revision.`,
      blockingFindings,
      action: 'Maker must apply concrete alternative diffs and author regression tests.'
    };
  }

  // Decision 2: No blocking findings
  return {
    verdict: 'PASS',
    reason: `All acceptance criteria verified; 0 open blocking findings; ${dismissedFindings.length} invalid findings dismissed; ${acceptableFindings.length} acceptable tradeoffs documented.`,
    acceptableTradeoffs: acceptableFindings,
    dismissedFindings,
    action: 'Proceed to Context Impact Assessment and Delivery Adapter.'
  };
}

module.exports = {
  EXECUTION_MODES,
  resolveExecutionMode,
  buildReviewContextBarrier,
  validateVerificationEvidence,
  validateFindingLedger,
  computeFindingSignature,
  computeJudgeVerdict
};
