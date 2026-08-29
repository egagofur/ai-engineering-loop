---
name: task-impact-inquiry
description: Map business blast radius before code. Use for impact, side effects, sibling data, approval, queues, or when a new developer must learn the current flow. Triggers: cek impactnya, blast radius, analisa pengaruh, brainstorming impact. Not a substitute for ai-engineering-loop.
---

# Task Impact Inquiry

Map the **current business flow** and the **blast radius** of a change before any production edit.

This skill fills AI Engineering Loop Stage 1 grill. It is not a parallel engineering OS.

If Stage 1 grill already produced this matrix and the user confirmed it, stop. Do not interview again. On commit-bound work, continue in `ai-engineering-loop` (freeze the Goal Contract, then Maker). Do not start `dot-dev-workflow` Phases 1-6.

## Hard gate

Do not create a branch or edit production code until:

1. The current lifecycle is drawn from evidence (not guessed).
2. The impact matrix is on screen.
3. The user has answered the probing questions (or waived them).

Green unit tests later are not proof that siblings, approvals, or downstream jobs survived. A 100% passing suite can still reset approved history or fire the wrong downstream job.

## When to use

- "cek impactnya", "blast radius", "analisa pengaruh", "brainstorming impact"
- Bug, edge case, or business-logic change
- Shared service, status transition, calculation, validation, authorization, schema
- The user is new to the domain and does not know the flow

Impact-only (no implementation): run this skill and stop after the report.

Commit-bound work: run this inside AEL Stage 1, then freeze. Do not run it a second time after grill.

## Host notes

Claude Code / Kiro: no mermaid, no LaTeX, no extra tool keys. ASCII diagrams only.

Grok: do not spawn children for this skill. Stay in the parent.

Look up facts (files, enums, jobs). Grill only **decisions**.

## Steps

### 1. Look up (do not ask)

Read in this order. Skip a source if it is missing. Do not invent statuses.

1. `.ai-engineering-loop/glossary.md`
2. Existing FSD if present (`docs/fsd/`, `specs-book/fsd/`, especially `impact-matrix.md`). Read only. Do not generate an FSD.
3. Status enums, services, validators, listeners, BullMQ / cron / queue processors
4. Matching FE pages, routes, and permission guards when both FE and BE are in the workspace

Cite the path for each claim. If FE or BE is missing, say so.

### 2. New-dev briefing + lifecycle picture

Explain the current flow in plain language for someone new to the app: who acts, what status changes, when a period locks.

Then draw the lifecycle in ASCII. Do not ask the user what the code already shows.

```text
Author submit    -> DRAFT
Author send      -> NEED_APPROVAL
Reviewer approve -> APPROVED
period lock      -> CONFIRMED --> billing / aggregate job
```

If the flow cannot be determined from the repo, say what is missing.

### 3. Four-pillar scan

**State and conditions.** Does the rule apply the same in normal vs special cases (rush vs standard, holiday, locked vs open period)? What happens in DRAFT, SUBMITTED, NEED_APPROVAL, APPROVED, REJECTED, CONFIRMED, UNCONFIRMED?

**Sibling / historical isolation.** If entity A in parent P changes, do B and C in the same parent, period, or cart change? Can already-approved history reset?

**Actor and approval.** Who creates, who may edit, who must re-approve? When is an existing approval void, and when must it be kept?

**Downstream.** BullMQ, cron, listeners, billing, dashboard totals.

### 4. Where it hits (hit map + blast picture)

List the surfaces a naive edit would touch. Empty rows mean you have not finished looking.

```text
Surface          Path / job                         Naive risk
FE page          <route or page>                    <what the user would see>
BE service       <service / status write>           <what the row would become>
Sibling rows     <same parent / period / cart>      isolate | also-update
Approval         <who, void vs keep>                <approval lost or kept>
Queue / billing  <job name>                         rerun | skip
```

Then the blast-radius picture (ASCII only):

```text
edit(A in period P)
  |- sibling B in P     : isolate | also-update
  |- approval on A      : void | keep
  |- billing / queue    : rerun | skip
```

### 5. Impact matrix (failure table)

| Scenario | Current logic (cite path) | Side effect if we ship naive | Proposed treatment |
|---|---|---|---|
| Happy path | | | |
| Empty / omitted field | | | |
| Boundary (min/max, locked vs open) | | | |
| Sibling in the same parent | | | |
| Error / denied / unauthorized | | | |

A matrix with only the sunny path is not done.

### 6. Probing questions

Ask 2-3 decisions. Number them. Give a recommended answer. Wait.

```text
Q1 - <title>: <choices>
Recommended: <your answer>
```

Typical decisions: void vs keep approval; isolate vs also-update siblings; rerun vs skip the downstream job.

### 7. Contract rows

Each accepted matrix row becomes a numbered AC in the Goal Contract **file** (failure table). Name the seam or artifact.

If this session is AEL: freeze after those ACs are in the file. Chat `setuju` is not freeze.

If this session is impact-only: print the report and stop. Do not implement.

## Output

```text
Task impact inquiry
Briefing: <plain-language current flow>
Lifecycle: <ASCII>
Hit map: <surfaces + paths>
Blast radius: <ASCII>
Matrix: <table>
Questions: Q1..Qn with Recommended
Proposed AC: AC-1..N (happy, empty/omit, boundary, sibling, error)
Next: freeze Goal Contract | stop (impact-only)
```

## Forbidden

- Implementing, branching, or "small fix while we discuss"
- Second interview after AEL grill already captured the matrix
- Mermaid or LaTeX
- Claiming isolation because unit tests passed
- Inventing business rules the repo and the user did not supply
- Generating an FSD or starting `dot-dev-workflow` as a second loop
