---
name: ai-engineering-loop
description: >
  Autonomous AI Engineering Operating System. On Grok CLI, run the 8-stage loop
  with native spawn_subagent for Devil's Advocate and Judge (TRUE_INDEPENDENT_AGENT).
  Also handles init/status/refresh of .ai-engineering-loop/ living context.
  Triggers: /ai-engineering-loop, "run the engineering loop", "devil's advocate review".
---

# AI Engineering Loop — Grok CLI Runtime

Canonical specs live in this repository: `core/`, `agents/`, `policies/`.
This skill is the Grok host adapter. Do not paraphrase the specs; read them.

## Host detection (do this first)

1. If the `spawn_subagent` tool is in your tool list and `GROK_SUBAGENTS` is not `0`, Grok native review is **INVOCATION_AVAILABLE**.
2. Independent execution is **PROVEN** only after a child returns a model response with its own `subagent_id` and you did **not** pass `resume_from`.
3. If spawn is missing or `GROK_SUBAGENTS=0`, fall back to `CONTEXT_ISOLATION_ONLY` (artifact barrier in this session). Disclose that honestly. Never call it a subagent review.

Canonical mode ids: `TRUE_INDEPENDENT_AGENT`, `ISOLATED_AGENT_INSTANCE`, `FRESH_PROCESS_AGENT`, `CONTEXT_ISOLATION_ONLY`, `UNAVAILABLE`.
Skill aliases: `NATIVE_SUBAGENT` → `TRUE_INDEPENDENT_AGENT`; `ARTIFACT_ISOLATED_REVIEW` → `CONTEXT_ISOLATION_ONLY`.

## Grok process topology

Parent session is the orchestrator (and usually the Maker). Spawn **siblings**, never nested children (Grok depth limit is 1).

```
Parent (Maker + orchestrator)
  ├─ spawn devil-advocate   capability_mode=execute  isolation=none  resume_from=omit
  └─ spawn judge            capability_mode=execute  isolation=none  resume_from=omit
```

Forbidden `subagent_type` values for DA/Judge: `caveman:cavecrew-reviewer`, `caveman:cavecrew-builder`, `caveman:cavecrew-investigator`, `explore`, `plan`. Cavecrew-reviewer uses a different finding schema and cannot feed the Judge.

Optional fallback if `devil-advocate` / `judge` types are not registered: `subagent_type: "general-purpose"` with the matching agent spec prepended to the prompt and `description` still prefixed `[devil-advocate]` or `[judge]`.

## Commands

### `/ai-engineering-loop init|status|refresh`

Run `npx ai-engineering-loop <command>` in the target repo. Do not commit unless the user asks.

### `/ai-engineering-loop [task]`

1. Stage 0: `npx ai-engineering-loop status` (init/refresh if missing or stale).
2. Stage 1: write a Goal Contract (`core/goal-contract.md`).
3. Stages 2–4: Maker work in the **parent**. Surgical diff + tests. Parent may be the Maker; do not spawn Maker as a child if you still need to spawn DA/Judge afterward from the same parent.
4. Stage 5: run verification from `.ai-engineering-loop/verification.md`. Keep command, exit code, stdout, test counts. Vague "seems green" is invalid.
5. Write artifacts to disk so children do not need parent chat:
   - Goal Contract path
   - `git diff` written to `.ai-engineering-loop/tasks/current.diff`
   - verification log (file)
6. Stage 6: `spawn_subagent` Devil's Advocate. `background: false`. `capability_mode: "execute"`. Do **not** pass `resume_from`. Wait for the child. Prompt: diff file path, name-only file list, Goal Contract path, verification log path, plus "at most 8 tool calls; read the diff file; skip css and generated files".
7. Stage 7: `spawn_subagent` Judge the same way (`background: false`, wait). Use `general-purpose` only if `judge` is rejected. Prompt: Goal Contract path, verification evidence path, Finding Ledger, and "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff".
8. If Judge says `ITERATE` and iteration < 3, Maker fixes in the parent, re-verify, spawn a **fresh** DA (new spawn, no resume).
9. Stage 8: delivery adapter from `.ai-engineering-loop/adapter.md`.

After a proven Grok DA spawn, the report header must be:

```
Execution Mode: TRUE_INDEPENDENT_AGENT
Independent LLM Execution: PROVEN
Native Subagent Invocation: AVAILABLE
Review Method: True Independent Agent
```

When spawn is unavailable:

```
Execution Mode: CONTEXT_ISOLATION_ONLY
Independent LLM Execution: NOT PROVEN
Native Subagent Invocation: UNAVAILABLE
Review Method: Clean-Slate Artifact Isolation Barrier
```

## Headless fallback

If this session cannot spawn but `grok -p` is authenticated, that is `FRESH_PROCESS_AGENT` only after the child process prints a model response. Prefer `spawn_subagent` when both exist.
