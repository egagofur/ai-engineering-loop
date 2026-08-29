---
name: ai-engineering-loop
description: Use when the user runs /ai-engineering-loop, asks to init or refresh living project context, or wants the Maker / Devil's Advocate / Judge engineering loop on Claude Code.
allowed-tools: "Read, Grep, Glob, Edit, Write, Task, Bash(npm run *), Bash(npm test *), Bash(npx *), Bash(git *)"
---

# AI Engineering Loop (Claude Code)

Canonical specs: `core/`, `agents/`, `policies/`. Read those files. Do not invent extra tool parameters.

## Host rule (prevents 400 REQUEST_BODY_INVALID)

Claude Code talks to strict proxies (including Kiro). Follow this exactly:

1. Use only tools that exist in this session.
2. For subagents, call the host tool named **Task** (or **Agent** if that is the only subagent tool). Pass **only** these keys:
   - `subagent_type`
   - `description`
   - `prompt`
   - `run_in_background: false` only if that key exists on the Task schema. Never invent other keys.
3. Do **not** add any other keys. Extra keys make Kiro return HTTP 400 `REQUEST_BODY_INVALID`.
4. If no Task/Agent tool exists, review in this session and label it `CONTEXT_ISOLATION_ONLY`. Do not invent a tool name.
5. If Bash or Write returns "cannot determine the safety" or HTTP 400 REQUEST_BODY_INVALID: stop that tool. Do not retry it. Continue with Read, Grep, and Glob. Tell the user to switch off auto permission mode (use default) or add a permissions.allow rule for the verification command, then start a new session.

## Commands

- `init` / `status` / `refresh` / `sync-hosts`: run `npx ai-engineering-loop <command>` in the repo. Do not commit unless asked.
- Any other argument: full loop for that task.

## Loop

Parent session is Maker plus orchestrator. Spawn Devil's Advocate and Judge as **siblings**, not nested.

1. Stage 0: `npx ai-engineering-loop sync-hosts` then `npx ai-engineering-loop status` (init or refresh if missing or stale). Read `.ai-engineering-loop/glossary.md`. If sync-hosts copied files, tell the user a new session is needed for updated skill text; keep going with this session.
2. Stage 1: Goal Contract (`core/goal-contract.md`). If the user asks for ideas, list a short menu and wait; do not implement. If the task is ambiguous and the user can answer, grill first (`core/grill-policy.md`): design tree, recommended answers, do not ask look-up facts. Skip grill if the contract is already frozen or the user waived it. On business-logic change, and always on `adapter_type: dot`, grill includes blast radius: lifecycle sketch, four pillars (state, sibling, approval, queues), ASCII picture. Load `task-impact-inquiry` if present. Do not run a second interview. Passing unit tests are not isolation proof. Chat agreement is not freeze: every user-visible decision must be a numbered AC in the Goal Contract file. Freeze before any production edit. Name test seams. Use glossary terms. AC is a failure table (happy, empty/omit, boundary, sibling, error). One red test per AC row. Do not freeze sunny-path-only.
3. Stages 2-4: Maker in the parent. Bugs: red repro first (`core/root-cause-analysis.md`). Features: TDD at named seams (`policies/tdd-policy.md`): one red test per AC row. Surgical diff.
4. Stage 5: run commands from `.ai-engineering-loop/verification.md`. Keep command, exit code, stdout, test counts. Vague "seems green" is invalid.
5. Write artifacts, then spawn. Before Devil's Advocate:
   - Write `git diff` to a file (for example `.ai-engineering-loop/tasks/current.diff`).
   - Write changed paths (`git diff --name-only`) into the Task prompt as a short list.
   - Put those paths in the child prompt. Do not paste Maker rationale.
   - If stopping mid-loop, write `.ai-engineering-loop/tasks/handoff.md` (`core/handoff-policy.md`).
6. Stage 6: Task `subagent_type: devil-advocate`. Use `general-purpose` only if that type is rejected. If the Task schema includes `run_in_background`, set it false. Then wait for Task to return. Do not start Judge or more Maker work until the Finding Ledger is back. Prompt: diff file path, name-only list, Goal Contract path, verification log path, conventions.md path, and "at most 8 tool calls; read the diff file; skip css and generated files". Report Spec and Standards axes separately.
7. Stage 7: Task `subagent_type: judge` the same way (wait, no background). Use `general-purpose` only if `judge` is rejected. Prompt: Goal Contract path, verification evidence path, Finding Ledger, and "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff".
8. ITERATE with iteration under 3: fix in the parent, re-verify, spawn a **new** Devil's Advocate (do not resume the previous child).
9. Stage 8: delivery from `.ai-engineering-loop/adapter.md`.

## Report header

When Task/Agent actually returned a child result:

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
