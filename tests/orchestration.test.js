const test = require('node:test');
const assert = require('node:assert');
const {
  validateVerificationEvidence,
  validateFindingLedger,
  computeJudgeVerdict
} = require('../lib/orchestration.js');

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

test('Standards axis BLOCKER does not iterate unless hardConvention is true', () => {
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

  const smellLedger = {
    findings: [
      {
        id: 'DA-S1',
        axis: 'standards',
        hardConvention: false,
        severity: 'HIGH',
        validity: 'VALID',
        disposition: 'STRONG',
        location: 'src/pay.ts#L4',
        failureScenario: 'Duplicated Code across two hunks',
        evidence: 'Same lock shape in two functions'
      }
    ]
  };

  const smellVerdict = computeJudgeVerdict({
    goalContract,
    verificationEvidence,
    findingLedger: smellLedger,
    activeIteration: 1
  });
  assert.strictEqual(smellVerdict.verdict, 'PASS');
  assert.strictEqual(smellVerdict.acceptableTradeoffs.length, 1);

  const hardLedger = {
    findings: [
      {
        id: 'DA-S2',
        axis: 'standards',
        hardConvention: true,
        severity: 'HIGH',
        validity: 'VALID',
        disposition: 'STRONG',
        location: 'src/pay.ts#L4',
        failureScenario: 'conventions.md forbids any',
        evidence: 'any used in public seam',
        concreteAlternativeDiff: '- x: any\n+ x: unknown'
      }
    ]
  };

  const hardVerdict = computeJudgeVerdict({
    goalContract,
    verificationEvidence,
    findingLedger: hardLedger,
    activeIteration: 1
  });
  assert.strictEqual(hardVerdict.verdict, 'ITERATE');
  assert.strictEqual(hardVerdict.blockingFindings.length, 1);
});

test('Finding ledger rejects unknown axis; missing axis remains valid', () => {
  const base = {
    id: 'DA-1',
    severity: 'LOW',
    validity: 'VALID',
    disposition: 'ACCEPTABLE',
    location: 'src/a.ts#L1',
    failureScenario: 'n',
    evidence: 'e'
  };
  assert.strictEqual(validateFindingLedger({ findings: [base] }).valid, true);
  assert.strictEqual(validateFindingLedger({ findings: [{ ...base, axis: 'spec' }] }).valid, true);
  assert.strictEqual(validateFindingLedger({ findings: [{ ...base, axis: 'style' }] }).valid, false);
});
