---
name: ai-engineering-loop
description: Use when the user runs /ai-engineering-loop, asks to init or refresh living project context, or wants the Maker / Devil's Advocate / Judge engineering loop on Antigravity.
---

# AI Engineering Loop (Antigravity)

Canonical specs: if this workspace has `core/`, `agents/`, `policies/`, read those files. Otherwise run `npx ai-engineering-loop` and follow the published specs.

Follow `policies/review-budget.md` when that file exists. Parent is Maker plus orchestrator. Do not use `browser_subagent`.

## Host rule

If `invoke_subagent` (or Task) exists, spawn `devil-advocate` then `judge` as siblings. Wait for each child. Do not run them in the background. Use `general-purpose` only if the named type is rejected.

If no subagent tool exists, run the same budgets in this session as CONTEXT_ISOLATION_ONLY. Do not claim independent agent execution.

Canonical mode ids: `TRUE_INDEPENDENT_AGENT`, `ISOLATED_AGENT_INSTANCE`, `FRESH_PROCESS_AGENT`, `CONTEXT_ISOLATION_ONLY`, `UNAVAILABLE`.

## Commands

- `init` / `status` / `refresh` / `sync-hosts` / `generate-adapter` / `generate-workflow`: run `npx ai-engineering-loop <command>` in the repo. Do not commit unless asked.
- `generate-adapter`: load skill `generate-adapter` if present. Grill Q1-Q5. Then write `.ai-engineering-loop/adapter.md`. Do not start Maker.
- `generate-workflow`: load skill `generate-workflow` if present. Grill Q1-Q6. Then write `.ai-engineering-loop/workflow.md` and empty `lessons.md` if missing. Do not start Maker.
- Any other argument: full loop for that task.

## Loop

1. Stage 0: `npx ai-engineering-loop sync-hosts` then `npx ai-engineering-loop status` (init or refresh if missing or stale). Read `.ai-engineering-loop/glossary.md`. Read `.ai-engineering-loop/lessons.md` and `.ai-engineering-loop/workflow.md` if they exist. Follow workflow.md hooks (`before_grill`, `after_freeze`, `after_pass`). Do not skip Goal Contract, verification, Devil's Advocate, or Judge even if workflow.md asks. If workflow.md is missing, run the default 8-stage loop (no extra hooks). If sync-hosts copied files, tell the user a new session is needed for updated skill text; keep going with this session.
2. Stage 1: Goal Contract (`core/goal-contract.md`). If the user asks for ideas, list a short menu and wait; do not implement. If the task is ambiguous and the user can answer, grill first (`core/grill-policy.md`): design tree, recommended answers, do not ask look-up facts. Skip grill if the contract is already frozen or the user waived it. On business-logic change, and always on `adapter_type: dot`, grill includes blast radius: lifecycle sketch, four pillars (state, sibling, approval, queues), ASCII picture. Load `task-impact-inquiry` if present. Do not run a second interview. Passing unit tests are not isolation proof. Chat agreement is not freeze: every user-visible decision must be a numbered AC in the Goal Contract file. Freeze before any production edit. Name test seams. Use glossary terms. AC is a failure table (happy, empty/omit, boundary, sibling, error). One red test per AC row. Do not freeze sunny-path-only. If the user prompt has no numbered AC, draft `.ai-engineering-loop/tasks/goal-contract.md` with a failure table, show it, wait for freeze. Do not start Maker.
3. Stages 2-4: Read `maker_intern` from workflow.md (missing or none = parent is Maker). If a label is set, write `.ai-engineering-loop/tasks/maker-brief.md` (Goal Contract path, seams, files in scope) and spawn that intern only with tools that already exist. Do not add HTTP clients or API keys. If the host cannot select that intern, the parent is Maker; say intern INVOCATION_UNAVAILABLE. Intern cannot skip verification, Devil's Advocate, or Judge. After intern returns, parent runs Stage 5. Bugs: red repro first (`core/root-cause-analysis.md`). Features: TDD at named seams (`policies/tdd-policy.md`): one red test per AC row. Surgical diff.
4. Stage 5: run commands from `.ai-engineering-loop/verification.md`. Keep command, exit code, stdout, test counts. Vague "seems green" is invalid. Write `.ai-engineering-loop/tasks/claimed-vs-reality.md` (AC, Claimed, Reality from command log). Do not spawn Devil's Advocate if the file is missing or any Claimed row lacks Reality.
5. Write artifacts, then spawn. Before Devil's Advocate:
   - Write `git diff` to a file (for example `.ai-engineering-loop/tasks/current.diff`).
   - Write changed paths (`git diff --name-only`) into the child prompt as a short list.
   - Put those paths in the child prompt. Do not paste Maker rationale.
   - Write `.ai-engineering-loop/tasks/claimed-vs-reality.md` if missing. Do not spawn DA without it.
   - If stopping mid-loop, write `.ai-engineering-loop/tasks/handoff.md` (`core/handoff-policy.md`).
6. Stage 6: spawn `devil-advocate`. Wait. Prompt: diff file path, name-only list, Goal Contract path, verification log path, conventions.md path, and "at most 8 tool calls; read the diff file; skip css and generated files". Report Spec and Standards axes separately.
7. Stage 7: spawn `judge` the same way (wait, no background). Prompt: Goal Contract path, verification evidence path, Finding Ledger, and "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff".
8. ITERATE with iteration under 3: fix in the parent, re-verify, spawn a **new** Devil's Advocate.
9. After Judge PASS: run the `after_pass` hook from workflow.md if it is not `none`. Then Stage 8: delivery from `.ai-engineering-loop/adapter.md`. Load shipped spec `adapters/<adapter_type>/` (`standard`, `github`, `gitlab`, `dot`). If adapter.md is missing or the type is unknown, run `generate-adapter` (grill). Do not invent a company pipeline. When the user confirms a process lesson, append one row to `lessons.md` (not a chat dump). Terms go to glossary.md.

## Report header

When a child actually returned a result:

```
Execution Mode: TRUE_INDEPENDENT_AGENT
Independent LLM Execution: PROVEN
Native Subagent Invocation: AVAILABLE
Review Method: True Independent Agent
```

When no subagent tool exists:

```
Execution Mode: CONTEXT_ISOLATION_ONLY
Independent LLM Execution: NOT PROVEN
Native Subagent Invocation: UNAVAILABLE
Review Method: Clean-Slate Artifact Isolation Barrier
```
