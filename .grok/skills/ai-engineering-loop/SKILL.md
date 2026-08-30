---
name: ai-engineering-loop
description: >
  Autonomous AI Engineering Operating System. On Grok CLI, run the 8-stage loop
  with native spawn_subagent for Devil's Advocate and Judge (TRUE_INDEPENDENT_AGENT).
  Also handles init/status/refresh of .ai-engineering-loop/ living context.
  Triggers: /ai-engineering-loop, "run the engineering loop", "devil's advocate review".
user-invocable: true
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

### `/ai-engineering-loop init|status|refresh|sync-hosts|generate-adapter|generate-workflow`

Run `npx ai-engineering-loop <command>` in the target repo. Do not commit unless the user asks. `sync-hosts` copies this package's skills/agents/commands into `~/.claude`, `~/.grok`, `~/.gemini`, and `~/.agents` for hosts that already exist. `generate-adapter`: load skill `generate-adapter` if present. Grill Q1-Q5. Then write `.ai-engineering-loop/adapter.md`. Do not start Maker. `generate-workflow`: load skill `generate-workflow` if present. Grill Q1-Q6. Q6 Maker intern: run `grok models` (or `/models` if that slash command exists here), drop grok-imagine-* and video, show numbered options plus none. Do not type a model name. Then write `.ai-engineering-loop/workflow.md` and empty `lessons.md` if missing. Do not start Maker.

### `/ai-engineering-loop [task]`

Compact map (not a second OS): Specify (stages 0-1), Make (stages 2-4), Review (stages 5-7), Deliver (stage 8). Keep the 8-stage numbers. Do not skip Goal Contract, verification, Devil's Advocate, or Judge.

1. Stage 0: `npx ai-engineering-loop sync-hosts` then `npx ai-engineering-loop status` (init/refresh if missing or stale). Read `.ai-engineering-loop/glossary.md`. Read `.ai-engineering-loop/lessons.md` and `.ai-engineering-loop/workflow.md` if they exist. Follow workflow.md hooks (`before_grill`, `after_freeze`, `after_pass`). Do not skip Goal Contract, verification, Devil's Advocate, or Judge even if workflow.md asks. If workflow.md is missing, run the default 8-stage loop (no extra hooks). If sync-hosts copied files, tell the user a new session is needed for updated skill text; keep going with this session.
2. Stage 1: Goal Contract (`core/goal-contract.md`). If the user asks for ideas, list a short menu and wait; do not implement. If the task is ambiguous and the user can answer, grill first (`core/grill-policy.md`): design tree, recommended answers, do not ask look-up facts. Skip grill if the contract is already frozen or the user waived it. On business-logic change, and always on `adapter_type: dot`, grill includes blast radius: lifecycle sketch, four pillars (state, sibling, approval, queues), ASCII picture. Load `task-impact-inquiry` if present. Do not run a second interview. Passing unit tests are not isolation proof. Chat agreement is not freeze: every user-visible decision must be a numbered AC in the Goal Contract file. Freeze before any production edit. Name test seams. Use glossary terms. AC is a failure table (happy, empty/omit, boundary, sibling, error). One red test per AC row. Do not freeze sunny-path-only. If the user prompt has no numbered AC, draft `.ai-engineering-loop/tasks/goal-contract.md` with a failure table, show it, wait for freeze. Do not start Maker.
3. Stages 2–4: Read `maker_intern` from workflow.md (missing or none = parent is Maker). Do not type a model name. If a label is set, run `grok models` and confirm the id is in the coding list (not grok-imagine-*). If missing, parent is Maker; say intern INVOCATION_UNAVAILABLE. Otherwise write `.ai-engineering-loop/tasks/maker-brief.md` and spawn that intern as a sibling (`background: false`, wait). Pass a model key only if that key exists on the spawn schema. Do not invent keys, HTTP clients, or custom endpoints. Intern must not spawn DA or Judge (depth 1). After intern returns, parent runs Stage 5 then DA/Judge. Intern cannot skip verification, Devil's Advocate, or Judge. Bugs: red repro first (`core/root-cause-analysis.md`). Features: TDD at named seams (`policies/tdd-policy.md`): one red test per AC row. Surgical diff.
4. Stage 5: run verification from `.ai-engineering-loop/verification.md`. Keep command, exit code, stdout, test counts. Vague "seems green" is invalid. Write `.ai-engineering-loop/tasks/claimed-vs-reality.md` (AC, Claimed, Reality from command log). Do not spawn Devil's Advocate if the file is missing or any Claimed row lacks Reality.
5. Write artifacts to disk so children do not need parent chat:
   - Goal Contract path
   - `git diff` written to `.ai-engineering-loop/tasks/current.diff`
   - verification log (file)
   - `.ai-engineering-loop/tasks/claimed-vs-reality.md` (do not spawn DA without it)
   - If stopping mid-loop, `.ai-engineering-loop/tasks/handoff.md` (`core/handoff-policy.md`)
6. Stage 6: `spawn_subagent` Devil's Advocate. `background: false`. `capability_mode: "execute"`. Do **not** pass `resume_from`. Wait for the child. Prompt: diff file path, name-only file list, Goal Contract path, verification log path, conventions.md path, plus "at most 8 tool calls; read the diff file; skip css and generated files". Report Spec and Standards axes separately.
7. Stage 7: `spawn_subagent` Judge the same way (`background: false`, wait). Use `general-purpose` only if `judge` is rejected. Prompt: Goal Contract path, verification evidence path, Finding Ledger, and "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff".
8. If Judge says `ITERATE` and iteration < 3, Maker fixes in the parent, re-verify, spawn a **fresh** DA (new spawn, no resume).
9. After Judge PASS: run the `after_pass` hook from workflow.md if it is not `none`. Then Stage 8: delivery from `.ai-engineering-loop/adapter.md`. Load shipped spec `adapters/<adapter_type>/` (`standard`, `github`, `gitlab`, `dot`). If adapter.md is missing or the type is unknown, run `generate-adapter` (grill). Do not invent a company pipeline. When the user confirms a process lesson, append one row to `lessons.md` (not a chat dump). Terms go to glossary.md.

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
