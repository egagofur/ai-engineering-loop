---
name: ai-engineering-loop
description: Run the AI Engineering Loop on Antigravity (init, status, refresh, or full Maker then Devil's Advocate then Judge).
---

Follow `policies/review-budget.md`. Parent is Maker plus orchestrator. Do not use `browser_subagent`.

Stage 1: grill if the task is ambiguous (`core/grill-policy.md`), then freeze the Goal Contract. On `adapter_type: dot`, that grill includes `task-impact-inquiry` (Antigravity skill under `~/.gemini/config/skills/`); do not run a second interview. Use `.ai-engineering-loop/glossary.md`. Name test seams. Maker: TDD at those seams (`policies/tdd-policy.md`). Bugs: red repro first (`core/root-cause-analysis.md`). Mid-loop stop: `core/handoff-policy.md`.

If `invoke_subagent` (or Task) exists, spawn `devil-advocate` then `judge` as siblings. Wait for each child. Do not run them in the background. Use `general-purpose` only if the named type is rejected.

5. Before Devil's Advocate: write `git diff` to `.ai-engineering-loop/tasks/current.diff` and put `git diff --name-only` in the child prompt. Do not paste Maker rationale.
6. Devil's Advocate prompt: diff file path, name-only list, Goal Contract path, verification log path, conventions.md path, and "at most 8 tool calls; read the diff file; skip css and generated files". Report Spec and Standards axes separately.
7. Judge prompt: Goal Contract path, verification evidence path, Finding Ledger, and "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff".

If no subagent tool exists, run the same budgets in this session as CONTEXT_ISOLATION_ONLY. Do not claim independent agent execution.

Init/status/refresh/sync-hosts: `npx ai-engineering-loop <command>`. Stage 0: `npx ai-engineering-loop sync-hosts` then `npx ai-engineering-loop status`. If sync-hosts copied files, tell the user a new session is needed for updated skill text; keep going with this session.
