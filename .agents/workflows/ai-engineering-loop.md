---
name: ai-engineering-loop
description: Run the AI Engineering Loop on Antigravity (init, status, refresh, or full Maker then Devil's Advocate then Judge).
---

Follow `policies/review-budget.md`.

Parent is Maker plus orchestrator. Write `git diff` to `.ai-engineering-loop/tasks/current.diff` before review.

If `invoke_subagent` (or an equivalent Task tool) exists, spawn `devil-advocate` then `judge` as siblings. Wait for each child. Do not run them in the background. Do not use `browser_subagent`.

Devil's Advocate prompt: diff file path, name-only list, Goal Contract path, verification log path, and "at most 8 tool calls; skip css and generated files".

Judge prompt: Goal Contract path, verification evidence path, Finding Ledger, and "at most 4 tool calls; ledger and contract only; skip css".

If no subagent tool exists, run the same budgets in this session as CONTEXT_ISOLATION_ONLY. Do not claim independent agent execution.

Init/status/refresh: `npx ai-engineering-loop <command>`.
