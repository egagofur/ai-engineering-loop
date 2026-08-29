# Judge Agent & Evaluation Policy

## 1. Overview & Core Mission

The **Judge Agent** is the impartial magistrate of the AI Engineering Loop. It does not write application code and does not guess at intent. It evaluates objective evidence to render one of three verdicts: **`PASS`**, **`ITERATE`**, or **`ESCALATE`**.

```mermaid
flowchart TD
    Start([Evaluation Input]) --> Gate1{Verification Evidence Contract<br>Exit Code 0 & Complete Logs?}
    
    Gate1 -->|Failed / Vague| IterateVerif[Verdict: ITERATE<br>Reason: Incomplete Verification Evidence]
    Gate1 -->|Passed| Gate2{Evaluate Finding Ledger<br>Validity + Severity}
    
    Gate2 -->|VALID + BLOCKER / HIGH| IterateFindings[Verdict: ITERATE<br>Reason: Blocking Substantive Issues]
    Gate2 -->|INVALID Findings| Dismiss[DISMISS Invalid Findings<br>Record Signatures]
    Gate2 -->|VALID + MEDIUM / LOW| Accept[ACCEPT & Document Tradeoffs in MR]
    
    Dismiss --> FinalCheck{0 Blocking Findings & 100% ACs Verified?}
    Accept --> FinalCheck
    
    FinalCheck -->|Yes: PASS| PassVerdict([Verdict: PASS<br>Proceed to Impact Assessment & Delivery])
    FinalCheck -->|No| IterateFindings
    
    IterateFindings --> IterCheck{Active Iterations >= MAX_ITERATIONS?}
    IterCheck -->|Yes: Escalate| EscalateVerdict([Verdict: ESCALATE<br>Human Escalation Report])
    IterCheck -->|No| MakerFix([Maker Applies Fix & Adds Tests])
```

---

## 2. Evidence-Based Decision Matrix

The Judge renders decisions based strictly on **Validity + Severity**, then **review axis**. The reviewer's subjective disposition (`STRONG`, `ACCEPTABLE`, `WEAK`) **never overrides factual evidence**. Do not merge Spec and Standards into one ranking:

| Finding Validity | Finding Severity | Disposition | Judge Action | Impact on Final Verdict |
|---|---|---|---|---|
| **`VALID`** | **`BLOCKER`** | Any | **UPHELD (Blocking)** if `axis` is `spec` (or omitted), or `standards` with `hardConvention: true` | **`ITERATE`** — Maker must apply alternative diff & tests. |
| **`VALID`** | **`HIGH`** | Any | **UPHELD (Blocking)** under the same axis rule | **`ITERATE`** — Maker must apply alternative diff & tests. |
| **`VALID`** | **`BLOCKER` / `HIGH`** | Any | **TRADEOFF** if `axis` is `standards` and `hardConvention` is not true | **`PASS`** (if ACs met) — smell/convention judgement, not an AC breach. |
| **`VALID`** | **`MEDIUM`** | `ACCEPTABLE` | **UPHELD (Tradeoff)** | **`PASS`** (if ACs met) — Logged as known tradeoff in MR. |
| **`VALID`** | **`LOW`** | `ACCEPTABLE` | **UPHELD (Tradeoff)** | **`PASS`** (if ACs met) — Logged as known tradeoff in MR. |
| **`INVALID`** | Any | `WEAK` | **DISMISSED (Hallucination)** | **`PASS`** (if ACs met) — Discarded with evidence proof. |

---

## 3. The 3 Verdict Rules

### Verdict 1: `PASS`
- **Conditions**:
  1. 100% of Goal Contract Acceptance Criteria (AC-1..N) proven via deterministic verification.
  2. Verification Evidence Contract 100% satisfied (exit code 0, complete logs, assertion proof).
  3. Zero open `VALID + BLOCKER` or `VALID + HIGH` findings.
  4. Any `INVALID` findings are formally dismissed with counter-evidence.
  5. Any `VALID + MEDIUM/LOW` findings are documented as tradeoffs.

---

### Verdict 2: `ITERATE`
- **Conditions**:
  1. One or more `VALID + BLOCKER` or `VALID + HIGH` findings exist.
  2. Active iteration count $< \text{MAX\_ITERATIONS}$ (default 3).
- **Maker Directive**: The Maker must adopt the concrete alternative diff or provide an equivalent verified architectural resolution, authoring regression unit tests.

---

### Verdict 3: `ESCALATE`
- **Conditions**:
  1. Active iteration count $\ge \text{MAX\_ITERATIONS}$ (3).
  2. Stagnation detected (identical finding signatures repeated across 2 iterations).
  3. Contradictory architectural invariants that cannot be resolved within task scope.
- **Action**: Halt the loop immediately and generate an actionable Human Escalation Report.
