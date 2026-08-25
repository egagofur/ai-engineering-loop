# Finding Policy Specification

## 1. Purpose

The **Finding Policy** defines the standardized schema, severity definitions, categories, and lifecycle states for all issues identified by review agents (such as the [Devil's Advocate](file:///Users/egagofur/Development/work/ai-engineering-loop/agents/devil-advocate.md) or external review bots).

A standardized finding schema ensures that:
1. Every criticism is actionable, localized, and backed by evidence.
2. Review findings can be parsed, hashed, and tracked across autonomous iterations.
3. The [Judge Agent](file:///Users/egagofur/Development/work/ai-engineering-loop/agents/judge.md) can evaluate findings objectively without subjective ambiguity.

---

## 2. Standardized Finding Schema

Every finding MUST be structured according to the following specification:

```yaml
id: "<CATEGORY_PREFIX>-<3_DIGIT_NUMBER>" # e.g. COR-001, SEC-002, PERF-001
title: "<Short, descriptive summary of the problem>"
severity: "<CRITICAL | HIGH | MEDIUM | LOW | INFO>"
category: "<Correctness | ErrorHandling | Security | Concurrency | Performance | Maintainability | TestingGaps>"
location:
  file: "<Relative file path>"
  startLine: <Integer>
  endLine: <Integer>
evidence: "<Exact code snippet, command output, or trace exhibiting the flaw>"
problem: "<Detailed technical explanation of what is wrong>"
impact: "<Concrete operational, business, or runtime consequence>"
recommendation: "<Actionable suggestion and concrete code diff showing the fix>"
confidence: "<HIGH | MEDIUM | LOW>"
status: "<NEW | TRIAGED_VALID | TRIAGED_INVALID | TRIAGED_UNCERTAIN | RESOLVED | VERIFIED>"
triageReason: "<Required when status is TRIAGED_INVALID or TRIAGED_UNCERTAIN>"
```

---

## 3. Severity Matrix & Definitions

| Severity Level | Definition | Impact on Build / Loop |
|---|---|---|
| **`CRITICAL` (SEV-1)** | Complete system crash, remote code execution, severe data corruption, authentication bypass, or massive data loss. | **BLOCKING**: Hard block. Must be resolved immediately; cannot pass DoD. |
| **`HIGH` (SEV-2)** | Core business logic defect, unhandled null exception on primary user path, IDOR/authorization gap, or significant performance regression. | **BLOCKING**: Must be resolved before `PASS` verdict. |
| **`MEDIUM` (SEV-3)** | Edge-case logic failure, missing error telemetry, suboptimal query with limited dataset, or unhandled rare boundary condition. | **NON-BLOCKING**: Can pass DoD if documented in backlog, unless directly violating an Acceptance Criterion. |
| **`LOW` (SEV-4)** | Minor maintainability issue, non-critical testing gap, minor code duplication, or naming ambiguity. | **ADVISORY**: Does not block completion. |
| **`INFO` (SEV-5)** | Informational observation, architectural note, or praise for a well-designed pattern. | **INFORMATIONAL**: No action required. |

---

## 4. Review Categories

Findings are categorized under one of the 7 standard domains:

1. **`Correctness` (`COR`)**: Functional bugs, logic errors, type mismatches, inverted conditionals, timezone bugs, calculation errors.
2. **`ErrorHandling` (`ERR`)**: Swallowed errors, unhandled rejections, missing fallbacks, crashing async boundaries.
3. **`Security` (`SEC`)**: Injection, broken auth/access control, secret exposure, sensitive data logging, unsanitized inputs.
4. **`Concurrency` (`CONC`)**: Race conditions, un-synchronized shared memory, non-atomic database operations, thread safety issues.
5. **`Performance` (`PERF`)**: N+1 queries, memory leaks, unbounded array loops, unindexed filters, heavy synchronous blocking operations.
6. **`Maintainability` (`MAINT`)**: High coupling, breaking existing architecture, anti-patterns, dead code, circular dependencies.
7. **`TestingGaps` (`TEST`)**: Untested boundary conditions, weak/tautological assertions, missing negative test cases.

---

## 5. Finding Status & Validity Rules

Review findings are hypotheses, not absolute truths. Every finding exists in one of the following states:

- **`NEW`**: Initial discovery by reviewer.
- **`TRIAGED_VALID`**: Author and Judge confirm that the defect is real and violates technical or contract requirements. Must be fixed by Maker.
- **`TRIAGED_INVALID` (False Positive / "Halu")**: Author demonstrates with evidence that the reviewer's concern is factually incorrect, based on an API that does not exist, or flags intentional/designed behavior.
- **`TRIAGED_UNCERTAIN`**: Ambiguous requirement where the codebase documentation is silent or contradictory. Triggers escalation.
- **`RESOLVED`**: Maker has applied code fix and passing test suite.
- **`VERIFIED`**: Devil's Advocate and Judge re-evaluated and confirmed the issue is fully solved.

---

## 6. Concrete Example

```yaml
id: "COR-001"
title: "Unsafe timezone conversion in attendance clock-in calculation"
severity: "HIGH"
category: "Correctness"
location:
  file: "src/server/attendance/utils/calculate-duration.ts"
  startLine: 28
  endLine: 34
evidence: |
  const checkInHour = new Date(record.clockIn).getHours();
problem: |
  Using Date.prototype.getHours() extracts the local server timezone hour instead of converting to the employee's designated timezone (e.g. Asia/Jakarta).
impact: |
  Employees clocking in between 00:00 and 07:00 UTC will be marked as late or absent depending on the server hosting region.
recommendation: |
  Use timezone-aware date parsing with dayjs/date-fns-tz:
  ```diff
  - const checkInHour = new Date(record.clockIn).getHours();
  + const checkInHour = dayjs(record.clockIn).tz(userTimezone).hour();
  ```
confidence: "HIGH"
status: "TRIAGED_VALID"
```
