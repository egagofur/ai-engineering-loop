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

## Deterministic artifact gates (mandatory)

Run `npx ai-engineering-loop state --json` to get the current `runId` and use `.ai-engineering-loop/runs/<runId>/` as `RUN_DIR`. Never edit `state.json` or `current.json`.

Read `core/runtime-safety.md`. Before every model or subagent call, run `budget status --run <runId>`; immediately afterward run `budget record --input <actual> --output <actual> --model <id> --run <runId>` from provider-reported metadata. Never invent usage. Missing usage stops UNATTENDED and requires human direction in ASSISTED. `budget pause` is the kill switch.

Inherited invariants remain mandatory: read `core/grill-policy.md`, `policies/tdd-policy.md`, and `.ai-engineering-loop/glossary.md`. On `adapter_type: dot`, grill includes blast radius: lifecycle sketch and load `task-impact-inquiry`. If the user prompt has no numbered AC, draft the contract, list a short menu and wait. Chat agreement is not freeze. AC is a failure table. One red test per AC row. Do not freeze sunny-path-only. Write claimed-vs-reality.md. Do not spawn Devil's Advocate if the file is missing or any Claimed row lacks Reality. Report Spec and Standards separately. DA prompt includes "at most 8 tool calls; read the diff file; skip css and generated files". Judge prompt includes "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff". `generate-workflow` still reads workflow.md and lessons.md; missing maker_intern means INVOCATION_UNAVAILABLE. Do not type a model name.

1. Stage 0: `npx ai-engineering-loop sync-hosts`, `status`, then `run [--mode report-only|assisted|unattended]` to create or resume the ledger. Run `state --json` and `budget status`. Read glossary, lessons, and workflow overlays. Required gates cannot be skipped.
2. Stage 1: keep the human Goal Contract Markdown and write `RUN_DIR/goal-contract.json` with schemaVersion, runId, objective, numbered AC, evidenceRequired, and non-empty failureCases. Grill ambiguous decisions and business blast radius first. Run `npx ai-engineering-loop gate goal`; do not edit production code unless it passes.
3. After Goal freeze, branch on mode. REPORT_ONLY: never edit repository files; write `RUN_DIR/report.json`, run `gate report`, and stop. ASSISTED: use the normal Maker. UNATTENDED: run `sandbox create --run <runId>`, run Maker only in the returned worktreePath, never edit the parent checkout, then run `sandbox capture --run <runId>`. Resolve `maker_intern` only through `grok models`; unknown means parent Maker. Intern cannot skip gates or spawn DA/Judge. Use red repro or TDD. ASSISTED writes `RUN_DIR/diff.patch`; UNATTENDED capture writes it. Then run `npx ai-engineering-loop gate maker`.
4. Stage 5: run verification and write `RUN_DIR/verification.json` with current git revision, gated diff hash, command, execution identity, times, exit code, stdout, timeout status, and test counts. Keep claimed-vs-reality.md. Run `npx ai-engineering-loop gate verification`; do not spawn DA unless it passes.
5. Write artifacts to disk so children do not need parent chat:
   - Goal Contract path
   - `git diff` written to `.ai-engineering-loop/tasks/current.diff`
   - verification log (file)
   - `.ai-engineering-loop/tasks/claimed-vs-reality.md` (do not spawn DA without it)
   - If stopping mid-loop, `.ai-engineering-loop/tasks/handoff.md` (`core/handoff-policy.md`)
6. Stage 6: Build `npx ai-engineering-loop context devil-advocate <files...>`. Check `budget status`, spawn Devil's Advocate with the pack path, `background: false`, `capability_mode: "execute"`, and no `resume_from`; wait and `budget record` actual usage. Normalize its output into `RUN_DIR/findings.json` with runId and diffHash, then run `npx ai-engineering-loop gate review`.
7. Stage 7: Run `npx ai-engineering-loop escalation --json`; resolve `STRONG_MODEL` through `grok models`, or escalate to the user if unavailable. Build Judge context from only goal-contract.json, verification.json, and findings.json. Check `budget status`, spawn a fresh sibling Judge and wait, then `budget record` actual usage. Normalize `RUN_DIR/verdict.json` with modelTier, then run `npx ai-engineering-loop gate judge`.
8. If Judge says `ITERATE` and iteration < 3, Maker fixes in the parent, re-verify, spawn a **fresh** DA (new spawn, no resume).
9. After Judge PASS: run `after_pass`, then the configured Stage 8 adapter. PR/MR body includes `Steps to Reproduce & Testing (QA)`; bugfix placeholders must not stay empty. Preview remote payloads and never include context packs, usage ledgers, raw logs, or credentials. In ASSISTED, wait for explicit human approval and put `humanApproved: true` in `RUN_DIR/delivery.json`; never infer it. Then run `npx ai-engineering-loop gate delivery`.

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
