---
name: ai-engineering-loop
description: Run the AI Engineering Loop on Antigravity (init, status, refresh, or full Maker then Devil's Advocate then Judge).
---

Follow `policies/review-budget.md`. Parent is Maker plus orchestrator. Do not use `browser_subagent`.

If `invoke_subagent` (or Task) exists, spawn `devil-advocate` then `judge` as siblings. Wait for each child. Do not run them in the background. Use `general-purpose` only if the named type is rejected.

5. Before Devil's Advocate: write `git diff` to `.ai-engineering-loop/tasks/current.diff` and put `git diff --name-only` in the child prompt. Do not paste Maker rationale.
6. Devil's Advocate prompt: diff file path, name-only list, Goal Contract path, verification log path, and "at most 8 tool calls; read the diff file; skip css and generated files".
7. Judge prompt: Goal Contract path, verification evidence path, Finding Ledger, and "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff".

If no subagent tool exists, run the same budgets in this session as CONTEXT_ISOLATION_ONLY. Do not claim independent agent execution.

Init/status/refresh: `npx ai-engineering-loop <command>`.
