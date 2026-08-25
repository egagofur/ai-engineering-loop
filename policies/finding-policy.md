# Finding Policy Specification

## 1. Purpose & Core Philosophy

The **Finding Policy** defines the standardized schema, severity definitions, validity rules, and lifecycle states for all issues identified by review agents (such as the [Devil's Advocate](file:///Users/egagofur/Development/work/ai-engineering-loop/agents/devil-advocate.md) or external review bots).

A standardized finding schema ensures that:
1. Every criticism is actionable, localized, and backed by factual code evidence.
2. Review findings can be parsed, hashed, and tracked across autonomous iterations.
3. The [Judge Agent](file:///Users/egagofur/Development/work/ai-engineering-loop/agents/judge.md) can evaluate findings deterministically based on **Validity + Severity** without subjective bias.

---

## 2. Standardized Dual-Axis Finding Schema

Every finding MUST be structured according to the following dual-axis specification:

```yaml
id: "<CATEGORY_PREFIX>-<3_DIGIT_NUMBER>" # e.g. COR-001, SEC-002, PERF-001
title: "<Short, descriptive summary of the problem>"
topic: "<correctness | error_handling | security | concurrency | performance | maintainability | testing_gaps>"

# Axis 1: Factual Validity
validity: "<VALID | INVALID>" # VALID: Real technical flaw | INVALID: Reviewer hallucination or misunderstanding

# Axis 2: Objective Severity
severity: "<BLOCKER | HIGH | MEDIUM | LOW>"

# Reviewer Disposition / Recommendation
disposition: "<STRONG | ACCEPTABLE | WEAK>"

location:
  file: "<Relative file path>"
  startLine: <Integer>
  endLine: <Integer>

acceptanceCriteria: "<AC-1..N impacted, or 'GENERAL_REGRESSION'>"
evidence: "<Exact code snippet, command output, or trace exhibiting the flaw>"
failureScenario: "<Concrete step-by-step failure trace describing what breaks at runtime>"
reproduction: "<Executable test case or sequence demonstrating the bug>"
concreteAlternativeDiff: |
  ```diff
  - old_flawed_code()
  + new_verified_fix()
  ```
```

---

## 3. Severity Matrix & Decision Impact

| Severity Level | Definition | Impact on Verdict |
|---|---|---|
| **`BLOCKER`** | System crash, severe data corruption, auth bypass, or direct violation of an explicit Acceptance Criterion. | **BLOCKING**: Forces `ITERATE` verdict. Cannot pass DoD. |
| **`HIGH`** | Core business logic defect, unhandled null exception on primary user path, or critical performance regression. | **BLOCKING**: Forces `ITERATE` verdict. Must be fixed with regression test. |
| **`MEDIUM`** | Edge-case logic failure, missing error telemetry, or suboptimal query with limited dataset. | **TRADE-OFF**: Merged if ACs are met; documented as acceptable tradeoff in MR. |
| **`LOW`** | Minor maintainability issue, non-critical testing gap, minor code duplication, or naming ambiguity. | **TRADE-OFF**: Merged; documented in MR notes. |

---

## 4. Validity Rules & Falsification Principle

Review findings are hypotheses, not absolute truths.

- **`VALID`**: The defect exists in the code and produces an unhandled failure or contract breach under realistic conditions.
- **`INVALID` (Dismissed)**: The reviewer made an assumption disproved by the codebase, referenced a non-existent API, or flagged intentional behavior.

> [!IMPORTANT]
> **Decision Rule**: The Judge Agent evaluates findings primarily on **Validity + Severity**.
> A reviewer's subjective disposition (`STRONG`, `ACCEPTABLE`, `WEAK`) **never overrides evidence**. An `INVALID` finding cannot block delivery, even if the reviewer labeled it `STRONG` or `BLOCKER`.
