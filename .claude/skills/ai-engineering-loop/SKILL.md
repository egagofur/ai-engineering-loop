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

- `init` / `status` / `refresh`: run `npx ai-engineering-loop <command>` in the repo. Do not commit unless asked.
- Any other argument: full loop for that task.

## Loop

Parent session is Maker plus orchestrator. Spawn Devil's Advocate and Judge as **siblings**, not nested.

1. Stage 0: `npx ai-engineering-loop status` (init or refresh if missing or stale).
2. Stage 1: write a Goal Contract. Schema: `core/goal-contract.md`.
3. Stages 2-4: Maker work in the parent. Surgical diff plus tests.
4. Stage 5: run commands from `.ai-engineering-loop/verification.md`. Keep command, exit code, stdout, test counts. Vague "seems green" is invalid.
5. Write artifacts, then spawn. Before Devil's Advocate:
   - Write `git diff` to a file (for example `.ai-engineering-loop/tasks/current.diff`).
   - Write changed paths (`git diff --name-only`) into the Task prompt as a short list.
   - Put those paths in the child prompt. Do not paste Maker rationale.
6. Stage 6: Task `subagent_type: devil-advocate`. Use `general-purpose` only if that type is rejected. If the Task schema includes `run_in_background`, set it false. Then wait for Task to return. Do not start Judge or more Maker work until the Finding Ledger is back. Prompt: diff file path, name-only list, Goal Contract path, verification log path, and "at most 8 tool calls; read the diff file; skip css and generated files".
7. Stage 7: Task `subagent_type: judge` the same way (wait, no background). Prompt: Goal Contract, verification evidence, Finding Ledger.
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
