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

- `init` / `status` / `refresh` / `sync-hosts`: run `npx ai-engineering-loop <command>` in the repo. Do not commit unless asked.
- Any other argument: full loop for that task.

## Loop

1. Stage 0: `npx ai-engineering-loop sync-hosts` then `npx ai-engineering-loop status` (init or refresh if missing or stale). Read `.ai-engineering-loop/glossary.md`. If sync-hosts copied files, tell the user a new session is needed for updated skill text; keep going with this session.
2. Stage 1: Goal Contract (`core/goal-contract.md`). If the user asks for ideas, list a short menu and wait; do not implement. If the task is ambiguous and the user can answer, grill first (`core/grill-policy.md`): design tree, recommended answers, do not ask look-up facts. Skip grill if the contract is already frozen or the user waived it. On `adapter_type: dot`, that grill includes `task-impact-inquiry` (this host: `~/.gemini/config/skills/task-impact-inquiry`); do not run a second interview. Chat agreement is not freeze: every user-visible decision must be a numbered AC in the Goal Contract file. Freeze before any production edit. Name test seams. Use glossary terms.
3. Stages 2-4: Maker in the parent. Bugs: red repro first (`core/root-cause-analysis.md`). Features: TDD at named seams (`policies/tdd-policy.md`). Surgical diff.
4. Stage 5: run commands from `.ai-engineering-loop/verification.md`. Keep command, exit code, stdout, test counts. Vague "seems green" is invalid.
5. Write artifacts, then spawn. Before Devil's Advocate:
   - Write `git diff` to a file (for example `.ai-engineering-loop/tasks/current.diff`).
   - Write changed paths (`git diff --name-only`) into the child prompt as a short list.
   - Put those paths in the child prompt. Do not paste Maker rationale.
   - If stopping mid-loop, write `.ai-engineering-loop/tasks/handoff.md` (`core/handoff-policy.md`).
6. Stage 6: spawn `devil-advocate`. Wait. Prompt: diff file path, name-only list, Goal Contract path, verification log path, conventions.md path, and "at most 8 tool calls; read the diff file; skip css and generated files". Report Spec and Standards axes separately.
7. Stage 7: spawn `judge` the same way (wait, no background). Prompt: Goal Contract path, verification evidence path, Finding Ledger, and "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff".
8. ITERATE with iteration under 3: fix in the parent, re-verify, spawn a **new** Devil's Advocate.
9. Stage 8: delivery from `.ai-engineering-loop/adapter.md`.

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
