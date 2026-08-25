const test = require('node:test');
const assert = require('node:assert');
const {
  EXECUTION_MODES,
  createCapabilityEvidence,
  selectExecutionMode,
  buildReviewContextBarrier,
  validateVerificationEvidence,
  validateFindingLedger,
  computeJudgeVerdict
} = require('../lib/orchestration.js');

// Test A: Independent execution mode selection priority using capability registry
test('A. Independent execution mode selection priority using capability registry', () => {
  // Priority 1: Native subagent with full execution proof
  assert.strictEqual(
    selectExecutionMode({
      nativeSubagent: createCapabilityEvidence({
        mechanism: 'native-subagent',
        classification: 'TRUE_INDEPENDENT_AGENT',
        available: true,
        executionProven: true,
        childConversationId: 'child-101',
        executionIdentity: 'exec-101',
        modelExecutionProven: true,
        independentContextProven: true
      }),
      sdkAgent: createCapabilityEvidence({
        mechanism: 'sdk-agent',
        classification: 'ISOLATED_AGENT_INSTANCE',
        available: true,
        executionProven: true,
        childConversationId: 'child-102',
        executionIdentity: 'exec-102',
        modelExecutionProven: true
      })
    }).id,
    EXECUTION_MODES.TRUE_INDEPENDENT_AGENT.id
  );

  // Priority 2: SDK Agent Instance
  assert.strictEqual(
    selectExecutionMode({
      nativeSubagent: createCapabilityEvidence({
        mechanism: 'native-subagent',
        classification: 'UNAVAILABLE',
        available: false
      }),
      sdkAgent: createCapabilityEvidence({
        mechanism: 'sdk-agent',
        classification: 'ISOLATED_AGENT_INSTANCE',
        available: true,
        executionProven: true,
        childConversationId: 'child-102',
        executionIdentity: 'exec-102',
        modelExecutionProven: true
      })
    }).id,
    EXECUTION_MODES.ISOLATED_AGENT_INSTANCE.id
  );

  // Priority 3: Headless Subprocess
  assert.strictEqual(
    selectExecutionMode({
      headlessProcessAgent: createCapabilityEvidence({
        mechanism: 'cli-agent',
        classification: 'FRESH_PROCESS_AGENT',
        available: true,
        executionProven: true,
        executionIdentity: 'pid-8821',
        modelExecutionProven: true
      })
    }).id,
    EXECUTION_MODES.FRESH_PROCESS_AGENT.id
  );

  // Priority 4: Fallback to Artifact Isolated Review
  const fallback = selectExecutionMode({
    artifactIsolation: createCapabilityEvidence({
      mechanism: 'artifact-barrier',
      classification: 'CONTEXT_ISOLATION_ONLY',
      available: true
    })
  });
  assert.strictEqual(fallback.id, EXECUTION_MODES.CONTEXT_ISOLATION_ONLY.id);
  assert.strictEqual(fallback.isIndependentExecutionProven, false);
  assert.strictEqual(fallback.description, 'Isolated review context within the same LLM session; independent agent execution is NOT proven');
});

// Test B & H: Artifact isolation strictly bounds review context without conversational history
test('B & H. Artifact isolation strictly bounds review context without conversational history', () => {
  const goalContract = {
    objective: 'Fix race condition in payment queue',
    acceptanceCriteria: ['AC-1: Lock payment row before update'],
    technicalConstraints: ['Zero schema migrations'],
    outOfScope: ['Refund system']
  };

  const rawDiff = `
diff --git a/src/pay.ts b/src/pay.ts
+ const lock = await db.query('SELECT FOR UPDATE');
  `;

  const verificationLogs = {
    exitCode: 0,
    summary: '10 passed, 0 failed'
  };

  const payload = buildReviewContextBarrier({
    goalContract,
    gitDiff: rawDiff,
    verificationLogs,
    projectContext: { profile: 'backend-api' }
  });

  // Verify only objective fields exist
  assert.ok(payload.diffHash);
  assert.strictEqual(payload.goalContract.objective, 'Fix race condition in payment queue');
  assert.strictEqual(payload.gitDiff.includes('SELECT FOR UPDATE'), true);
  assert.strictEqual(payload.verificationLogs.exitCode, 0);

  // Verify conversational scratchpad / thoughts are NOT in payload
  assert.strictEqual(payload.makerThoughts, undefined);
  assert.strictEqual(payload.chatHistory, undefined);
  assert.strictEqual(payload.intermediateDrafts, undefined);
});

// Test C: Finding Ledger schema validation
test('C. Finding Ledger schema validation', () => {
  const validLedger = {
    findings: [
      {
        id: 'DA-1',
        topic: 'correctness',
        severity: 'BLOCKER',
        validity: 'VALID',
        disposition: 'STRONG',
        location: 'src/pay.ts#L20-L30',
        failureScenario: 'Deadlock under concurrent traffic',
        evidence: 'Race condition reproduced in load test',
        concreteAlternativeDiff: '- lock()\n+ lockWithTimeout()'
      }
    ]
  };

  const check = validateFindingLedger(validLedger);
  assert.strictEqual(check.valid, true);

  // Invalid severity test
  const invalidLedger = {
    findings: [
      {
        id: 'DA-2',
        severity: 'SUPER_CRITICAL', // invalid
        validity: 'VALID',
        disposition: 'STRONG',
        location: 'src/pay.ts#L10',
        failureScenario: 'Crash',
        evidence: 'Log trace'
      }
    ]
  };
  const invalidCheck = validateFindingLedger(invalidLedger);
  assert.strictEqual(invalidCheck.valid, false);
});

// Test E: Verification Evidence Contract
test('E. Verification Evidence Contract strictly enforces execution proof', () => {
  // 1. Valid execution evidence
  const validEvidence = {
    command: 'npm test',
    executionIdentity: 'pid-12345',
    startTime: '2026-08-25T10:00:00Z',
    endTime: '2026-08-25T10:00:05Z',
    exitCode: 0,
    stdout: 'PASS: 12 tests passed',
    stderr: '',
    timeoutStatus: 'COMPLETED',
    testCounts: { passed: 12, failed: 0, skipped: 0 }
  };
  assert.strictEqual(validateVerificationEvidence(validEvidence).valid, true);

  // 2. Reject non-zero exit code
  const failingEvidence = { ...validEvidence, exitCode: 1 };
  assert.strictEqual(validateVerificationEvidence(failingEvidence).valid, false);

  // 3. Reject vague speculative statements without test counts
  const vagueEvidence = {
    command: 'npm test',
    executionIdentity: 'pid-12345',
    startTime: '2026-08-25T10:00:00Z',
    endTime: '2026-08-25T10:00:05Z',
    exitCode: 0,
    stdout: 'command was launched in background',
    stderr: '',
    timeoutStatus: 'COMPLETED',
    testCounts: { passed: 0, failed: 0 }
  };
  assert.strictEqual(validateVerificationEvidence(vagueEvidence).valid, false);
});

// Test D, F, G: Judge Decision Matrix: VALID BLOCKER forces ITERATE; INVALID does not block delivery
test('D, F, G. Judge Decision Matrix: VALID BLOCKER forces ITERATE; INVALID does not block delivery', () => {
  const goalContract = { objective: 'Test' };
  const verificationEvidence = {
    command: 'npm test',
    executionIdentity: 'exec-1',
    startTime: '2026-08-25T10:00:00Z',
    endTime: '2026-08-25T10:00:02Z',
    exitCode: 0,
    stdout: '10 passed',
    timeoutStatus: 'COMPLETED',
    testCounts: { passed: 10, failed: 0 }
  };

  // Scenario G: VALID + BLOCKER/HIGH forces ITERATE
  const blockerLedger = {
    findings: [
      {
        id: 'DA-1',
        severity: 'BLOCKER',
        validity: 'VALID',
        disposition: 'STRONG',
        location: 'src/auth.ts#L10',
        failureScenario: 'Auth token unsigned',
        evidence: 'JWT verify missing secret',
        concreteAlternativeDiff: '+ jwt.verify(token, SECRET)'
      }
    ]
  };

  const verdictBlocker = computeJudgeVerdict({
    goalContract,
    verificationEvidence,
    findingLedger: blockerLedger,
    activeIteration: 1
  });
  assert.strictEqual(verdictBlocker.verdict, 'ITERATE');
  assert.strictEqual(verdictBlocker.blockingFindings.length, 1);

  // Scenario F: INVALID is DISMISSED and does NOT block delivery
  const invalidLedger = {
    findings: [
      {
        id: 'DA-2',
        severity: 'BLOCKER',
        validity: 'INVALID', // Hallucinated by reviewer
        disposition: 'WEAK',
        location: 'src/auth.ts#L20',
        failureScenario: 'Reviewer claims function does not exist, but it exists in import',
        evidence: 'Import checked and exists'
      }
    ]
  };

  const verdictDismissed = computeJudgeVerdict({
    goalContract,
    verificationEvidence,
    findingLedger: invalidLedger,
    activeIteration: 1
  });
  assert.strictEqual(verdictDismissed.verdict, 'PASS');
  assert.strictEqual(verdictDismissed.dismissedFindings.length, 1);

  // Scenario: VALID + LOW/ACCEPTABLE tradeoff passes and documents tradeoff
  const tradeoffLedger = {
    findings: [
      {
        id: 'DA-3',
        severity: 'LOW',
        validity: 'VALID',
        disposition: 'ACCEPTABLE',
        location: 'src/logger.ts#L5',
        failureScenario: 'Log message could be more verbose',
        evidence: 'Verbose flag not checked'
      }
    ]
  };

  const verdictTradeoff = computeJudgeVerdict({
    goalContract,
    verificationEvidence,
    findingLedger: tradeoffLedger,
    activeIteration: 1
  });
  assert.strictEqual(verdictTradeoff.verdict, 'PASS');
  assert.strictEqual(verdictTradeoff.acceptableTradeoffs.length, 1);
});
