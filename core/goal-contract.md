# Goal Contract Specification

## 1. Purpose & Core Philosophy

The **Goal Contract** is the immutable anchor of the AI Engineering Loop. An autonomous coding agent must never begin implementation on ambiguous prompts, loose descriptions, or conversational requests without first formalizing an explicit contract.

The Goal Contract establishes:
- **What** problem is being solved.
- **Why** it matters to the business or user lifecycle.
- **How** success is measured deterministically.
- **Where** the boundaries are set (preventing scope creep).
- **When** the work is strictly considered complete.

Alignment before freeze follows [Grill Policy](./grill-policy.md). Terms come from `.ai-engineering-loop/glossary.md`.

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
Each AC is one row that can **fail**. Happy path alone is not a contract (`policies/tdd-policy.md`).

| AC | Input / actor | Expected at seam | Must fail if missing |
|---|---|---|---|
| AC-1 | Happy path | [observable] | [what would still look green] |
| AC-2 | Empty / omitted field | [observable] | [what would still look green] |
| AC-3 | Boundary | [observable] | [what would still look green] |
| AC-4 | Sibling / isolation (if domain has siblings) | [observable] | [what would still look green] |
| AC-5 | Error / denied / locked | [observable] | [what would still look green] |

## 4. Technical Constraints
- [Architecture]: [Preserve existing patterns, layer boundaries, dependency conventions]
- [API / Schema]: [No breaking changes to existing contracts or database schemas]
- [Scope of Diff]: [Smallest coherent change; zero speculative abstractions; zero dead code]
- [Dependencies]: [Do not introduce external packages without explicit justification]

## 5. Out of Scope
- [Explicitly list what the agent MUST NOT touch or refactor during this task]

## 6. Ubiquitous Language
- Terms used in this contract (must match `.ai-engineering-loop/glossary.md`): [term, ...]
- New terms coined in Stage 1 grill: [add to glossary before freeze]

## 7. Test Seams
- [Public interface under test. Prefer existing seams. No test at an unconfirmed seam.]
- [What a passing test at this seam proves for AC-1..N]

## 8. Verification Requirements
- **Unit Tests**: [Target files, boundary cases, and minimum expected coverage]
- **Static Analysis**: [Typecheck command, linter command, schema validation command]
- **Build / Packaging**: [Build command or bundling check]
- **Runtime / Integration**: [Manual smoke test steps or integration test command]
- **TDD**: Red then green at the seams above (`policies/tdd-policy.md`)

## 9. Definition of Done (DoD)
- [ ] All Acceptance Criteria (AC-1 through AC-N) verified with automated tests.
- [ ] 100% pass on all deterministic verification commands (0 errors, 0 warnings where enforced).
- [ ] Independent Devil's Advocate review completed with 0 unresolved blocking findings (VALID BLOCKER / HIGH).
- [ ] All review findings triaged with evidence (VALID, INVALID, UNCERTAIN).
- [ ] Judge Agent issues a formal PASS verdict.
```

---

## 3. Contract Lifecycle & Immutability Rules

1. **Pre-Implementation Freezing**:
   - The Goal Contract is authored and frozen *before* any production code edits.
   - If the task is ambiguous and a human is present, run the [Grill Policy](./grill-policy.md) until the design-tree frontier is empty, then freeze.
   - If the task is unambiguous, waived, or headless with testable AC, skip grill and freeze immediately.
2. **Immutability During Iteration**:
   - Neither the Maker Agent nor the Devil's Advocate Agent may alter Acceptance Criteria during an iteration loop to make tests pass or bypass critique.
3. **Contract Amendments**:
   - If during implementation a fundamental contradiction or impossible requirement is discovered, the agent must trigger **Human Escalation**. Only a human user may amend the Goal Contract.
4. **Chat is not the contract**:
   - Parent-transcript `setuju` does not freeze AC.
   - Every user-visible grill decision (order of pages, enable flags, layout) MUST appear as AC-1..N in the contract file before Maker starts.

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

- **The Vague Contract**: "Make authentication work better." (Invalid: lacks testable acceptance criteria). Grill or refuse to freeze.
- **The Missing Seam**: Acceptance criteria with no public interface to test against.
- **The Parallel Glossary**: Using 20 words for a concept that already has a term in `glossary.md`.
- **The Missing Constraint**: Failing to declare out-of-scope files, leading to arbitrary refactoring of adjacent legacy modules.
- **The Self-Serving Goal**: Modifying acceptance criteria post-hoc when tests fail rather than fixing the underlying implementation.
- **The Chat Contract**: Treating "setuju" in the parent transcript as AC. The file is the contract.
- **The Wrong Artifact**: Tests pass on a `/tmp` build while the sample the user opens omits the feature.
- **The Happy-Path Contract**: Only the sunny case is an AC. Coverage % is not a substitute for a failure table.
- **The Sloppy Ship**: Implementing from a vague prompt without a drafted failure table in the Goal Contract file.

## Per-AC verify command (C-07)

An AC may name the command that proves it:

```json
{ "id": "AC-2", "statement": "page 0 is rejected", "evidenceRequired": "unit test", "failureCases": ["page 0 returns items"],
  "verify": { "command": "npm test -- list.test.js", "layer": "L2" } }
```

The harness owns the status: `proven` when that exact command passed on the gated diff (`verification.json` or `final-verification.json`), `failed` when it ran and failed, `pending` when it never ran. `verify` prints each status, and `gate judge` refuses PASS while any AC with a verify command is `pending` or `failed` (`AC_NOT_PROVEN`). ACs without `verify` keep the existing evidence rules.

## Rubric for subjective ACs (C-09)

For ACs that are judged rather than computed (layout, copy, visual design), add a rubric:

```json
{ "id": "AC-3", "statement": "The empty state guides the user", "evidenceRequired": "screenshot", "failureCases": ["blank panel"],
  "rubric": [ { "criterion": "contrast", "pass": ">= 4.5:1 (WCAG AA)" }, { "criterion": "guidance", "pass": "explains how to import a document" } ] }
```

The Devil's Advocate scores every criterion in the ledger as `rubricScores: [{ac, criterion, pass, evidence}]` with observed evidence (screenshot path, DOM snapshot, measured value). `gate judge` refuses PASS while any criterion is unscored or `pass: false` (`AC_RUBRIC`).

## Project feature ledger (C-15)

Optional `.ai-engineering-loop/features.json` lists what the project must do, one triple per feature:

```json
{ "schemaVersion": 1, "features": [
  { "id": "F-1", "title": "Import", "behavior": "user imports a .md file and sees it in the list", "verify": "npm run e2e -- import", "status": "not_started", "priority": 1, "dependsOn": [] }
] }
```

Status moves only through Runs: a Goal Contract with `"featureId": "F-1"` makes it `active` at the Goal gate, and delivery makes it `passing` with the Run as evidence (passing is final). `ael next` prints the highest-priority unblocked feature, VCR (verified / activated), and flags any `passing` feature without a delivered Run behind it. `run --new` warns when an unfinished Run exists and VCR is below 1 (WIP=1).

## Intended flow (C-21)

For UI or multi-step work, add the flow the user should experience as transitions:

```json
"flow": [
  { "from": "List", "event": "click Export", "to": "Exporting" },
  { "from": "Exporting", "event": "file ready", "to": "Done" },
  { "from": "Exporting", "event": "disk full", "to": "Error" }
]
```

`goal draft` returns it as a `From | Event | To` table and a Mermaid `stateDiagram-v2` (`flow.mermaid`), with warnings (a state nothing reaches, a state with no way out that is not Done/Error), so the human checks the intent before freeze. A malformed `flow` fails the Goal gate. The PR receipt shows the same diagram (GitHub renders it) and table under "Intended flow", after "Verification artifacts" and before the acceptance criteria.

## Performance ACs (C-33)

Mark an AC that claims a number (faster, smaller, more throughput) with `"measure": true`. Judge PASS then needs `measurement record` for it with at least 3 runs, a limiter and spread below the effect (`docs verification-loop`, section 3e).

## Look before you freeze: diagrams (C-27)

Steps may carry more than `from`, `event`, `to`, so the human can see what else a change touches before freezing:

```json
"flowSubject": "order",
"flow": [
  { "from": "Processing", "event": "cancel", "to": "Cancelled", "actor": "user", "guard": "not shipped",
    "effects": [ { "text": "refund to wallet", "ac": "AC-2" }, { "text": "loyalty points revoked?" } ] },
  { "from": "Shipped", "event": "cancel", "to": "Cancelled", "hotspot": "allowed after shipping?" }
],
"forbiddenTransitions": [ { "from": "Delivered", "event": "cancel" } ]
```

- `actor`: who performs the step (user, app, service, db, cron); missing means `user`.
- `effects[]`: what else changes. An effect with `ac` is covered by that AC; one without `ac` is a **side effect** no AC covers.
- `hotspot`: an open question (string) or `true`.
- `flowSubject`: the entity whose status the flow describes.
- `forbiddenTransitions`: state/event pairs the human decided are invalid.
- `plainSummary`: one sentence for non-technical readers (used by `recap --for client`, at most 240 characters).

The Goal gate rejects an `ac` that is not an AC id, more than 40 steps or 12 effects per step, and forbidden pairs naming an unknown state or event.

`goal draft` returns `diagramOptions` (recommended first) and counts in `flow`: `undecided` (state × event pairs nobody decided), `hotspots` (plus conflicting transitions) and `sideEffects`. No file is written. Recommendations: `state` when `flowSubject` is set, `lanes` when steps run across a non-user actor, `storyboard` when every step is a user action. A project sets its default with `- **freeze_diagram**: auto | state | storyboard | lanes | off` in `.ai-engineering-loop/workflow.md` (`off` stops the offer; the command still works).

Render only the view the human picks:

```bash
npx ai-engineering-loop goal diagram --view state|storyboard|lanes [--run <id>] [--lang <tag>] [--open]
```

It writes `runs/<id>/diagrams/<view>-r<revision>.html` (`<view>-frozen.html` after freeze): one offline page, light and dark.
- **state**: a top-to-bottom state machine (`event [guard]`, effect counts, dashed red hotspots) and a transition table over every state × event. A cell is the target, several guarded targets, `conflict`, `invalid` (forbidden) or `?` (undecided).
- **storyboard**: one card per state in flow order, effects under the action that causes them.
- **lanes**: one column per actor, steps from top to bottom, so jobs and cron that run later stand out, followed by the same steps as a full-text list.

Then ask the human: freeze, another view, or turn `?` cells, hotspots and side effects into AC, non-goals or `forbiddenTransitions` (a new draft revision). A diagram never freezes or changes the Run.

## Verification artifacts in the receipt (C-21)

The receipt lists `--evidence AC-N=<https-url>` links first, typed as video, screenshot or diagram from the URL. An AC with `crossComponent: true` or a `rubric` is `MISSING` (❌) until it has at least one such link, because a reviewer should be able to look at the behaviour rather than read the diff.

