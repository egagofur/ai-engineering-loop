# Goal Contract Specification

## 1. Purpose & Core Philosophy

The **Goal Contract** is the immutable anchor of the AI Engineering Loop. An autonomous coding agent must never begin implementation on ambiguous prompts, loose descriptions, or conversational requests without first formalizing an explicit contract.

The Goal Contract establishes:
- **What** problem is being solved.
- **Why** it matters to the business or user lifecycle.
- **How** success is measured deterministically.
- **Where** the boundaries are set (preventing scope creep).
- **When** the work is strictly considered complete.

---

## 2. Mandatory Contract Schema

Every Goal Contract MUST adhere to the following schema in Markdown or structured YAML:

```markdown
# Goal Contract: [Short Title / Feature / Bugfix ID]

## 1. Objective
[Concise 1-2 sentence description of the technical deliverable.]

## 2. Business Outcome & User Lifecycle Impact
[Explain what changes for the real-world actor (e.g. Employee, Admin, Customer, System). Describe the before/after lifecycle state transition.]

## 3. Acceptance Criteria (AC)
- [ ] AC-1: [Exact, testable statement with expected outcome]
- [ ] AC-2: [Exact, testable statement with expected outcome]
- [ ] AC-3: [Edge case or boundary behavior explicitly specified]

## 4. Technical Constraints
- [Architecture]: [Preserve existing patterns, layer boundaries, dependency conventions]
- [API / Schema]: [No breaking changes to existing contracts or database schemas]
- [Scope of Diff]: [Smallest coherent change; zero speculative abstractions; zero dead code]
- [Dependencies]: [Do not introduce external packages without explicit justification]

## 5. Out of Scope
- [Explicitly list what the agent MUST NOT touch or refactor during this task]

## 6. Verification Requirements
- **Unit Tests**: [Target files, boundary cases, and minimum expected coverage]
- **Static Analysis**: [Typecheck command, linter command, schema validation command]
- **Build / Packaging**: [Build command or bundling check]
- **Runtime / Integration**: [Manual smoke test steps or integration test command]

## 7. Definition of Done (DoD)
- [ ] All Acceptance Criteria (AC-1 through AC-N) verified with automated tests.
- [ ] 100% pass on all deterministic verification commands (0 errors, 0 warnings where enforced).
- [ ] Independent Devil's Advocate review completed with 0 unresolved blocking findings (SEV-1 / SEV-2).
- [ ] All review findings triaged with evidence (VALID, INVALID, UNCERTAIN).
- [ ] Judge Agent issues a formal PASS verdict.
```

---

## 3. Contract Lifecycle & Immutability Rules

1. **Pre-Implementation Freezing**:
   - The Goal Contract is authored and frozen *before* any production code edits.
   - If the task is ambiguous, the agent must refine the contract with the user before touching code.
2. **Immutability During Iteration**:
   - Neither the Maker Agent nor the Devil's Advocate Agent may alter Acceptance Criteria during an iteration loop to make tests pass or bypass critique.
3. **Contract Amendments**:
   - If during implementation a fundamental contradiction or impossible requirement is discovered, the agent must trigger **Human Escalation**. Only a human user may amend the Goal Contract.

---

## 4. Verification Mapping

Every single item listed under `Acceptance Criteria` must map to at least one concrete verification method:

| Acceptance Criterion | Primary Verification | Fallback Verification |
|---|---|---|
| Logic / Computation / Parsing | Automated Unit Test | Deterministic script execution |
| Type Safety / Schema Integrity | Compiler / Typechecker | Schema validator (`tsc`, `zod`, etc.) |
| Regression Protection | Existing Test Suite | End-to-end integration test |
| Visual / Interface State | Component / Snapshot / E2E Test | Exact DOM / State inspection |

---

## 5. Anti-Patterns to Avoid

- **The Vague Contract**: "Make authentication work better." (Invalid: lacks testable acceptance criteria).
- **The Missing Constraint**: Failing to declare out-of-scope files, leading to arbitrary refactoring of adjacent legacy modules.
- **The Self-Serving Goal**: Modifying acceptance criteria post-hoc when tests fail rather than fixing the underlying implementation.
