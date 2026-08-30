---
name: ai-engineering-loop
description: Run the AI Engineering Loop on Antigravity (init, status, refresh, or full Maker then Devil's Advocate then Judge).
---

Follow `policies/review-budget.md`. Parent is Maker plus orchestrator. Do not use `browser_subagent`.

Stage 1: if the user asks for ideas, list a short menu and wait; do not implement. Grill if the task is ambiguous (`core/grill-policy.md`), then freeze the Goal Contract file. Chat agreement is not freeze. If the user prompt has no numbered AC, draft `.ai-engineering-loop/tasks/goal-contract.md` with a failure table, show it, wait for freeze. Do not start Maker. On business-logic change, and always on `adapter_type: dot`, grill includes blast radius: lifecycle sketch, four pillars (state, sibling, approval, queues), ASCII picture. Load `task-impact-inquiry` if present. Do not run a second interview. Passing unit tests are not isolation proof. Use `.ai-engineering-loop/glossary.md`. Name test seams. AC is a failure table (happy, empty/omit, boundary, sibling, error). One red test per AC row. Do not freeze sunny-path-only. Maker: TDD at those seams (`policies/tdd-policy.md`): one red test per AC row. Bugs: red repro first (`core/root-cause-analysis.md`). Mid-loop stop: `core/handoff-policy.md`.

If `invoke_subagent` (or Task) exists, spawn `devil-advocate` then `judge` as siblings. Wait for each child. Do not run them in the background. Use `general-purpose` only if the named type is rejected.

5. Before Devil's Advocate: write `git diff` to `.ai-engineering-loop/tasks/current.diff` and put `git diff --name-only` in the child prompt. Do not paste Maker rationale. Write `.ai-engineering-loop/tasks/claimed-vs-reality.md` (AC, Claimed, Reality from command log). Do not spawn Devil's Advocate if the file is missing or any Claimed row lacks Reality.
6. Devil's Advocate prompt: diff file path, name-only list, Goal Contract path, verification log path, conventions.md path, and "at most 8 tool calls; read the diff file; skip css and generated files". Report Spec and Standards axes separately.
7. Judge prompt: Goal Contract path, verification evidence path, Finding Ledger, and "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff".

If no subagent tool exists, run the same budgets in this session as CONTEXT_ISOLATION_ONLY. Do not claim independent agent execution.

Init/status/refresh/sync-hosts/generate-adapter/generate-workflow: `npx ai-engineering-loop <command>`. Stage 0: `npx ai-engineering-loop sync-hosts` then `npx ai-engineering-loop status`. Read `.ai-engineering-loop/glossary.md`. Read `.ai-engineering-loop/lessons.md` and `.ai-engineering-loop/workflow.md` if they exist. Follow workflow.md hooks (`before_grill`, `after_freeze`, `after_pass`). Do not skip Goal Contract, verification, Devil's Advocate, or Judge even if workflow.md asks. If workflow.md is missing, run the default 8-stage loop (no extra hooks). If sync-hosts copied files, tell the user a new session is needed for updated skill text; keep going with this session. After Judge PASS: run the `after_pass` hook if it is not `none`. Stage 8: load `adapters/<adapter_type>/`. If adapter.md is missing, run `generate-adapter` (grill). Do not invent a company pipeline. Confirmed process lessons go to `lessons.md`, not a chat dump.
