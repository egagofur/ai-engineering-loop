# Deterministic Verification Loop & Evidence Contract

## 1. Overview & Core Laws

The Verification Loop is the deterministic machine gate of the AI Engineering Loop:

> **"Code cannot enter Devil's Advocate review until it achieves 100% green machine verification backed by explicit, verifiable execution evidence."**

---

## 2. Verification Evidence Contract

A verification `PASS` is **strictly invalid** without concrete execution evidence. The system categorically rejects vague statements such as *"command was launched"* or *"test appears to have passed"*.

### Required Evidence Properties:
1. **`command`**: Exact shell string executed (e.g. `npm test -- --runInBand`).
2. **`executionIdentity`**: Process ID (PID), execution hash, or system execution identifier.
3. **`startTime` & `endTime`**: ISO timestamps documenting execution duration.
4. **`exitCode`**: Must be `0`. Any non-zero exit code immediately halts the gate.
5. **`stdout` & `stderr`**: Raw machine logs captured from execution.
6. **`timeoutStatus`**: Must be `"COMPLETED"` (not timed out or backgrounded without completion).
7. **`testCounts`**: Explicit counts of passed, failed, and skipped tests.
8. **`assertionEvidence`**: Specific assertion proof matching the active Goal Contract's Acceptance Criteria.

```json
{
  "command": "npm test",
  "executionIdentity": "exec-d4f1a2",
  "startTime": "2026-08-25T10:00:00.000Z",
  "endTime": "2026-08-25T10:00:04.500Z",
  "exitCode": 0,
  "stdout": "PASS src/services/payment.test.ts (14 tests passed, 0 failed)",
  "stderr": "",
  "timeoutStatus": "COMPLETED",
  "testCounts": {
    "passed": 14,
    "failed": 0,
    "skipped": 0
  },
  "assertionEvidence": "AC-1: Lock payment row before update verified in test_concurrent_payment_locking"
}
```

---

## 3. The 4 Verification Gates

1. **Gate 1: Unit & Integration Tests**: All unit and edge-case tests must pass with 0 failures.
2. **Gate 2: Static Type Analysis**: `tsc --noEmit` or compiler type checking must exit with code `0` (zero type errors).
3. **Gate 3: Linter Analysis**: Linter rules must pass cleanly with 0 errors on modified files.
4. **Gate 4: Production Build**: The build command (`npm run build`, `go build`, `cargo build`) must produce a clean compile.

---

## 4. Rejection Triggers

The Verification Gate immediately halts and returns to the Maker if:
- Any test suite fails or times out.
- Exit code is non-zero.
- The command was sent to the background and not verified to completion.
- Test logs contain zero passing assertions for new acceptance criteria.
