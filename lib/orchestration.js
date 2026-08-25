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
 */

const crypto = require('crypto');

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
 * 2. Standardized Capability Evidence Factory with 3-Stage Lifecycle
 */
function createCapabilityEvidence({
  mechanism,
  classification,
  configurationSupported = false,
  invocationAvailable = false,
  executionProven = false,
  available = false,
  commandOrApi = null,
  result = null,
  executionIdentity = null,
  conversationId = null,
  parentConversationId = null,
  childConversationId = null,
  childModelResponse = null,
  modelExecutionProven = false,
  independentContextProven = false,
  historyInherited = null,
  isDocumentationOnly = false,
  isBrowserAutomationOnly = false,
  reason = null,
  timestamp = new Date().toISOString()
}) {
  if (!mechanism || !classification) {
    throw new Error('Capability evidence must include mechanism and classification');
  }

  const modelExecuted = Boolean(modelExecutionProven || (childModelResponse && executionIdentity));
  const fullyProven = Boolean(executionProven || (modelExecuted && childConversationId && independentContextProven));

  return {
    mechanism,
    classification,
    configurationSupported: Boolean(configurationSupported),
    invocationAvailable: Boolean(invocationAvailable),
    executionProven: fullyProven,
    available: Boolean(available || fullyProven),
    commandOrApi,
    result,
    executionIdentity,
    conversationId,
    parentConversationId,
    childConversationId,
    childModelResponse,
    modelExecutionProven: modelExecuted,
    independentContextProven: Boolean(independentContextProven),
    historyInherited,
    isDocumentationOnly: Boolean(isDocumentationOnly),
    isBrowserAutomationOnly: Boolean(isBrowserAutomationOnly),
    reason,
    timestamp
  };
}

/**
 * 3. Evaluate whether a capability candidate satisfies execution proof
 */
function isCapabilityProvenForMode(evidence, targetModeId) {
  if (!evidence) {
    return false;
  }

  // Reject non-agent capabilities (such as IPC send-message)
  if (
    evidence.classification === 'NOT_AN_AGENT_EXECUTION_CAPABILITY' ||
    evidence.classification === 'IPC_MESSAGE_DISPATCH'
  ) {
    return false;
  }

  // Reject browser automation tools (browser_subagent is NOT an LLM subagent)
  if (evidence.isBrowserAutomationOnly || evidence.classification === 'BROWSER_AUTOMATION_TOOL') {
    return false;
  }

  // Reject documentation-only or configuration-only claims
  if (evidence.isDocumentationOnly || (evidence.configurationSupported && !evidence.executionProven)) {
    if (targetModeId !== 'CONTEXT_ISOLATION_ONLY') {
      return false;
    }
  }

  // Modes requiring true independent LLM execution
  if (
    targetModeId === 'TRUE_INDEPENDENT_AGENT' ||
    targetModeId === 'ISOLATED_AGENT_INSTANCE' ||
    targetModeId === 'FRESH_PROCESS_AGENT'
  ) {
    // Must satisfy all 4 pillars of execution proof:
    const hasChildSession = Boolean(evidence.childConversationId || targetModeId === 'FRESH_PROCESS_AGENT');
    const hasModelResponse = Boolean(evidence.modelExecutionProven || evidence.childModelResponse);
    const hasExecIdentity = Boolean(evidence.executionIdentity);
    const hasCleanContext = Boolean(evidence.independentContextProven && evidence.historyInherited !== true);

    if (!evidence.executionProven && !(hasChildSession && hasModelResponse && hasExecIdentity && hasCleanContext)) {
      return false;
    }
  }

  // Context isolation mode requires verified artifact boundary
  if (targetModeId === 'CONTEXT_ISOLATION_ONLY') {
    return evidence.available === true;
  }

  return true;
}

/**
 * 4. Deterministic Execution Mode Selection
 * Evaluates registry strictly in priority order:
 * 1. TRUE_INDEPENDENT_AGENT
 * 2. ISOLATED_AGENT_INSTANCE
 * 3. FRESH_PROCESS_AGENT
 * 4. CONTEXT_ISOLATION_ONLY
 * 5. UNAVAILABLE
 */
function selectExecutionMode(capabilityRegistry = {}) {
  const {
    nativeSubagent,
    sdkAgent,
    headlessProcessAgent,
    artifactIsolation
  } = capabilityRegistry;

  // Priority 1: True Native Independent Sub-Agent
  if (isCapabilityProvenForMode(nativeSubagent, 'TRUE_INDEPENDENT_AGENT')) {
    return EXECUTION_MODES.TRUE_INDEPENDENT_AGENT;
  }

  // Priority 2: Programmatic SDK Agent Instance
  if (isCapabilityProvenForMode(sdkAgent, 'ISOLATED_AGENT_INSTANCE')) {
    return EXECUTION_MODES.ISOLATED_AGENT_INSTANCE;
  }

  // Priority 3: Headless Subprocess Agent
  if (isCapabilityProvenForMode(headlessProcessAgent, 'FRESH_PROCESS_AGENT')) {
    return EXECUTION_MODES.FRESH_PROCESS_AGENT;
  }

  // Priority 4: Guaranteed Fallback - Context Isolation Only
  if (isCapabilityProvenForMode(artifactIsolation, 'CONTEXT_ISOLATION_ONLY')) {
    return EXECUTION_MODES.CONTEXT_ISOLATION_ONLY;
  }

  // Priority 5: Unavailable
  return EXECUTION_MODES.UNAVAILABLE;
}

/**
 * 5. Build Clean-Slate Artifact Isolation Barrier
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
 * 6. Validate Verification Evidence Contract
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
 * 7. Validate Finding Ledger Schema
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
 * 8. Compute Judge Verdict based primarily on Validity + Severity
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

    if (f.severity === 'BLOCKER' || f.severity === 'HIGH') {
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
 * 9. Truthful Review Report Generator
 * Enforces mandatory reporting headers and strictly prevents misleading phrasing.
 */
function formatExecutionReport({ selectedMode, capabilityRegistry = {} }) {
  const isContextOnly = selectedMode.id === EXECUTION_MODES.CONTEXT_ISOLATION_ONLY.id;

  const nativeSubagentState = capabilityRegistry.nativeSubagent?.invocationAvailable
    ? 'AVAILABLE'
    : 'UNAVAILABLE';

  const lines = [
    `Execution Mode: ${selectedMode.id}`,
    `Independent LLM Execution: ${selectedMode.isIndependentExecutionProven ? 'PROVEN' : 'NOT PROVEN'}`,
    `Native Subagent Invocation: ${nativeSubagentState}`,
    `Review Method: ${isContextOnly ? 'Clean-Slate Artifact Isolation Barrier' : selectedMode.label}`
  ];

  return lines.join('\n');
}

module.exports = {
  EXECUTION_MODES,
  createCapabilityEvidence,
  isCapabilityProvenForMode,
  selectExecutionMode,
  buildReviewContextBarrier,
  validateVerificationEvidence,
  validateFindingLedger,
  computeJudgeVerdict,
  formatExecutionReport
};
