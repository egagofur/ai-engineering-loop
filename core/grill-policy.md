# Grill Policy (Stage 1 Alignment)

The Goal Contract is frozen only after alignment is real. When the task is ambiguous and a human can answer, the orchestrator **grills** before any production edit. This is Stage 1, not a separate product.

## When to grill

Grill when **all** of these are true:

1. No frozen Goal Contract exists for this task.
2. The request is ambiguous, multi-way, or missing acceptance criteria, seams, or out-of-scope.
3. A human is present in this session (interactive TUI / chat).

## When to skip

Skip grill (write the Goal Contract from what is already known) when any of these is true:

1. The user waived it ("just do it", "skip grill", contract already pasted).
2. A Goal Contract for this task is already frozen on disk.
3. The session is headless / autonomous and the prompt already has testable AC-1..N.
4. The change is a one-line mechanical fix with an obvious AC (typo, lint, version bump).

Do not interview the user for **facts** you can look up (files, scripts, types, git). Look them up. Grill only **decisions**.

## Idea and menu requests

If the user asks for ideas, a feature catalog, or "what should we add" without naming one task:

1. Do not implement.
2. Do not freeze a Goal Contract.
3. List at most five options. Mark one recommended. Wait for a pick.
4. After they pick, grill that one task, then freeze.

`/ai-engineering-loop` on an idea request still stays this loop: menu, then grill. Do not switch to a parallel brainstorm product.

## Freeze gate

Chat `setuju`, `lanjut`, `ok`, or "looks good" is **not** a freeze.

Before Maker starts:

1. Every accepted grill decision that changes user-visible output is a numbered AC in the Goal Contract **file** (page order, enable flags, layout, copy, numbering).
2. Each of those ACs names the artifact to inspect (sample path, command, seam).
3. Write `.ai-engineering-loop/tasks/goal-contract.md` (or the path this repo uses). Show the AC list.
4. Freeze only after that file exists and contains those ACs.

If a decision was agreed in chat and is missing from the file, the contract is not frozen. Do not start Maker.

## DOT adapter (`adapter_type: dot`)

On DOT repositories, grill is **one** session that includes the four-pillar blast radius from Antigravity skill `task-impact-inquiry` (`~/.gemini/config/skills/task-impact-inquiry/SKILL.md`). Do not run that skill as a second interview after grill.

The four pillars must appear in the grill (and then in the Goal Contract) whenever the change can touch:

1. State and condition permutations (status, overtime vs normal hours, locked vs open periods)
2. Sibling / historical isolation (other entities in the same parent, period, or cart)
3. Actor and approval authority (who edits, when an existing approval is void vs kept)
4. Downstream jobs and queues (BullMQ, cron, payroll/aggregates)

**Do not skip grill** for those four cases, even if AC look obvious or the user said "just do it". Typo, lint, and version-bump skips still apply.

If the skill file is missing on this host, still ask the four pillars from this section. Do not claim the Gemini skill ran.

Present the impact matrix and 2–3 probing questions in the same grill round as other Stage 1 decisions. Recommended answers required. After the frontier is empty, freeze the Goal Contract once.

## Design tree

Map the work as a design tree. The **frontier** is every undecided question whose prerequisites are settled.

Work in **rounds**. Each round asks the whole current frontier. Number the questions. Give a recommended answer for each. Wait for the user's answers before the next round.

```text
Q1 - <title>: <body, including choices>
Recommended: <your answer>
```

A question that depends on an unanswered question in this round belongs to a later round.

The grill is done when the frontier is empty: every branch visited, nothing silently assumed. Confirm shared understanding, then freeze the Goal Contract (`core/goal-contract.md`).

## What the grill must settle

- Objective and business outcome
- Acceptance criteria that can fail a test
- Out of scope
- Test **seams** (public interfaces to observe; prefer existing seams; fewer is better)
- Glossary terms to use (read and update `.ai-engineering-loop/glossary.md`)
- Hard decisions that belong in an ADR under `.ai-engineering-loop/adrs/`

## Invariants

- No production code edits during grill.
- Neither Maker nor Devil's Advocate may amend AC after freeze. Only a human amends the contract (`core/goal-contract.md`).
- Use glossary terms in the contract, ticket, and later code names.
- Do not own the user's process outside this loop. Grill exists to freeze Stage 1, then the 8-stage OS continues.
