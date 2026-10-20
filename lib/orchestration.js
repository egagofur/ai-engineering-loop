/**
 * AI Engineering Loop — Runtime Capability Registry & Orchestration Core
 * 
 * Invariants:
 * 1. AI Engineering Loop must NEVER claim independent agent execution without runtime
 *    evidence of an actual separate LLM execution.
 * 2. Distinction between CONFIGURATION_SUPPORTED, INVOCATION_AVAILABLE, and EXECUTION_PROVEN:
 *    - CONFIGURATION_SUPPORTED: The platform understands subagent configuration (e.g. AGENT.md, subagent: true).
 *    - INVOCATION_AVAILABLE: An invocation tool or authenticated CLI is callable in the active runtime.
 *    - EXECUTION_PROVEN: A separate child session produced an actual model response with independent context.
 * 3. Artifact isolation is strictly reported as CONTEXT_ISOLATION_ONLY (Independent LLM execution: NOT PROVEN).
 * 4. browser_subagent is browser automation and must NOT be classified as an LLM subagent.
 * 5. agentapi send-message is an IPC communication capability and must NEVER activate agent execution.
 * 6. grok spawn_subagent is a true independent child session (own context, no parent transcript)
 *    when a child id and model response are captured. GROK_SUBAGENTS=0 disables invocation.
 * 7. caveman:cavecrew-reviewer is a compressed code-review preset with a different output schema
 *    and must NEVER be used as the Devil's Advocate or Judge.
 */

const fs = require('fs');
const path = require('path');

// 1. Standard 5 Execution Modes
const EXECUTION_MODES = {
  TRUE_INDEPENDENT_AGENT: {
    id: 'TRUE_INDEPENDENT_AGENT',
    label: 'True Independent Agent',
    isIndependentExecutionProven: true,
    description: 'Separate child conversation/process exists, actual LLM execution occurs, and child has independent conversational context'
  },
  ISOLATED_AGENT_INSTANCE: {
    id: 'ISOLATED_AGENT_INSTANCE',
    label: 'Isolated Agent Instance',
    isIndependentExecutionProven: true,
    description: 'Separate conversation or agent instance exists with verified independent model execution'
  },
  FRESH_PROCESS_AGENT: {
    id: 'FRESH_PROCESS_AGENT',
    label: 'Fresh Process Agent',
    isIndependentExecutionProven: true,
    description: 'Separate OS process successfully executes an LLM agent with fresh context'
  },
  CONTEXT_ISOLATION_ONLY: {
    id: 'CONTEXT_ISOLATION_ONLY',
    label: 'Context Isolation Only',
    isIndependentExecutionProven: false,
    description: 'Isolated review context within the same LLM session; independent agent execution is NOT proven'
  },
  UNAVAILABLE: {
    id: 'UNAVAILABLE',
    label: 'Unavailable',
    isIndependentExecutionProven: false,
    description: 'No review execution mechanism is available'
  }
};

/**
 * Skill / agent-spec aliases. The skill historically used NATIVE_SUBAGENT etc.
 * Canonical runtime IDs remain the 5 EXECUTION_MODES keys.
 */
const EXECUTION_MODE_ALIASES = {
  NATIVE_SUBAGENT: 'TRUE_INDEPENDENT_AGENT',
  SDK_AGENT: 'ISOLATED_AGENT_INSTANCE',
  HEADLESS_SUBPROCESS: 'FRESH_PROCESS_AGENT',
  ARTIFACT_ISOLATED_REVIEW: 'CONTEXT_ISOLATION_ONLY'
};

function resolveExecutionModeId(modeId) {
  if (!modeId) return 'UNAVAILABLE';
  return EXECUTION_MODE_ALIASES[modeId] || modeId;
}
/**
 * 2. Validate Verification Evidence Contract
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
 * 3. Validate Finding Ledger Schema
 */
function validateFindingLedger(ledger) {
  if (!ledger || !Array.isArray(ledger.findings)) {
    return { valid: false, reason: 'Finding ledger must contain an array of findings' };
  }

  const validSeverities = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'];
  const validValidities = ['VALID', 'INVALID'];
  const validDispositions = ['STRONG', 'ACCEPTABLE', 'WEAK'];
  const validAxes = ['spec', 'standards'];

  for (let i = 0; i < ledger.findings.length; i++) {
    const f = ledger.findings[i];
    if (!f.id || !f.location || !f.failureScenario || !f.evidence) {
      return { valid: false, reason: `Finding at index ${i} missing required id, location, failureScenario, or evidence` };
    }

    if (f.axis != null && !validAxes.includes(f.axis)) {
      return { valid: false, reason: `Invalid axis at index ${i}: ${f.axis}. Must be spec or standards` };
    }

    if (!validSeverities.includes(f.severity)) {
      return { valid: false, reason: `Invalid severity at index ${i}: ${f.severity}. Must be: ${validSeverities.join(', ')}` };
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
 * Spec VALID BLOCKER/HIGH blocks. Missing axis is spec.
 * Standards VALID BLOCKER/HIGH blocks only when hardConvention is true.
 */
function isBlockingFinding(finding) {
  if (!finding || finding.validity !== 'VALID') return false;
  if (finding.severity !== 'BLOCKER' && finding.severity !== 'HIGH') return false;
  const axis = finding.axis || 'spec';
  if (axis === 'standards' && finding.hardConvention !== true) return false;
  return true;
}

/**
 * 4. Compute Judge Verdict based primarily on Validity + Severity, then review axis
 */
function computeJudgeVerdict({
  goalContract,
  verificationEvidence,
  findingLedger,
  activeIteration = 1,
  maxIterations = 3
}) {
  const verifCheck = validateVerificationEvidence(verificationEvidence);
  if (!verifCheck.valid) {
    return {
      verdict: 'ITERATE',
      reason: `Deterministic verification failed: ${verifCheck.reason}`,
      action: 'Maker must rerun deterministic test suite and obtain clean exit code 0.'
    };
  }

  const findings = findingLedger?.findings || [];
  const blockingFindings = [];
  const acceptableFindings = [];
  const dismissedFindings = [];

  for (const f of findings) {
    if (f.validity === 'INVALID') {
      dismissedFindings.push({
        id: f.id,
        reason: `Dismissed invalid finding: ${f.failureScenario} (Evidence disproved)`
      });
      continue;
    }

    if (isBlockingFinding(f)) {
      blockingFindings.push(f);
    } else {
      acceptableFindings.push(f);
    }
  }

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

  return {
    verdict: 'PASS',
    reason: `All acceptance criteria verified; 0 open blocking findings; ${dismissedFindings.length} invalid findings dismissed; ${acceptableFindings.length} acceptable tradeoffs documented.`,
    acceptableTradeoffs: acceptableFindings,
    dismissedFindings,
    action: 'Proceed to Context Impact Assessment and Delivery Adapter.'
  };
}

/**
 * 5. Detect Grok CLI as a host runtime.
 * Presence of the grok binary is CONFIGURATION_SUPPORTED.
 * GROK_SUBAGENTS=0 means invocation is disabled even if grok is installed.
 * Execution is never proven from detection alone.
 */
function detectGrokRuntime(env = process.env, fsApi = fs) {
  const grokHome = env.GROK_HOME || path.join(env.HOME || env.USERPROFILE || '', '.grok');
  const grokBinCandidates = [
    env.GROK_BIN,
    path.join(grokHome, 'bin', 'grok'),
    path.join(grokHome, 'bin', 'grok.exe'),
    path.join(grokHome, 'bin', 'grok.cmd'),
    path.join(grokHome, 'bin', 'agent'),
    path.join(grokHome, 'bin', 'agent.exe'),
    path.join(grokHome, 'bin', 'agent.cmd')
  ].filter(Boolean);

  const grokBin = grokBinCandidates.find((candidate) => {
    try {
      return fsApi.existsSync(candidate);
    } catch (e) {
      return false;
    }
  }) || null;

  const grokPresent = Boolean(grokBin);
  const subagentsDisabled = env.GROK_SUBAGENTS === '0';
  const invocationAvailable = grokPresent && !subagentsDisabled;

  let reason;
  if (!grokPresent) {
    reason = 'Grok CLI binary not found under GROK_HOME/bin';
  } else if (subagentsDisabled) {
    reason = 'GROK_SUBAGENTS=0 disables spawn_subagent; fall back to CONTEXT_ISOLATION_ONLY or grok -p';
  } else {
    reason = 'Grok CLI present; spawn_subagent is the native independent-agent tool (enabled by default)';
  }

  return {
    host: grokPresent ? 'grok-cli' : 'unknown',
    grokHome,
    grokBin,
    configurationSupported: grokPresent,
    invocationAvailable,
    executionProven: false,
    subagentsDisabled,
    commandOrApi: 'spawn_subagent',
    headlessCommand: 'grok -p',
    reason
  };
}

module.exports = {
  EXECUTION_MODES,
  EXECUTION_MODE_ALIASES,
  resolveExecutionModeId,
  validateVerificationEvidence,
  validateFindingLedger,
  isBlockingFinding,
  computeJudgeVerdict,
  detectGrokRuntime
};
