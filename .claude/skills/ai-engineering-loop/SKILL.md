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

- `init` / `status` / `refresh` / `sync-hosts` / `generate-adapter` / `generate-workflow`: run `npx ai-engineering-loop <command>` in the repo. Do not commit unless asked.
- `generate-adapter`: load skill `generate-adapter` if present. Grill Q1-Q5. Then write `.ai-engineering-loop/adapter.md`. Do not start Maker.
- `generate-workflow`: load skill `generate-workflow` if present. Grill Q1-Q6. Q6 Maker intern: if `/models` exists in this session, use it and show numbered options; else only `none`. Do not type a model name. Then write `.ai-engineering-loop/workflow.md` and empty `lessons.md` if missing. Do not start Maker.
- Any other argument: full loop for that task.

## Loop

Compact map (not a second OS): Specify (stages 0-1), Make (stages 2-4), Review (stages 5-7), Deliver (stage 8). Keep the 8-stage numbers. Do not skip Goal Contract, verification, Devil's Advocate, or Judge.

Parent session is Maker plus orchestrator. Spawn Devil's Advocate and Judge as **siblings**, not nested.

## Deterministic artifact gates (mandatory)

Run `npx ai-engineering-loop state --json` to get the current `runId` and use `.ai-engineering-loop/runs/<runId>/` as `RUN_DIR`. Never edit `state.json` or `current.json`.

Inherited invariants remain mandatory: read `core/grill-policy.md`, `policies/tdd-policy.md`, and `.ai-engineering-loop/glossary.md`. On `adapter_type: dot`, grill includes blast radius: lifecycle sketch and load `task-impact-inquiry`. If the user prompt has no numbered AC, draft the contract, list a short menu and wait. Chat agreement is not freeze. AC is a failure table. One red test per AC row. Do not freeze sunny-path-only. Write claimed-vs-reality.md. Do not spawn Devil's Advocate if the file is missing or any Claimed row lacks Reality. Report Spec and Standards separately. DA prompt includes "at most 8 tool calls; read the diff file; skip css and generated files". Judge prompt includes "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff".

1. Stage 0: `npx ai-engineering-loop sync-hosts`, `status`, then `run` to create or resume the ledger. Read `.ai-engineering-loop/glossary.md`. Read `.ai-engineering-loop/lessons.md` and `.ai-engineering-loop/workflow.md` if they exist. Follow workflow.md hooks (`before_grill`, `after_freeze`, `after_pass`). Do not skip Goal Contract, verification, Devil's Advocate, or Judge even if workflow.md asks. If workflow.md is missing, run the default 8-stage loop. If sync-hosts copied files, tell the user a new session is needed; keep going with this session.
2. Stage 1: Goal Contract (`core/goal-contract.md`). If the user asks for ideas, list a short menu and wait; do not implement. If the task is ambiguous and the user can answer, grill first (`core/grill-policy.md`): design tree, recommended answers, do not ask look-up facts. On business-logic change, and always on `adapter_type: dot`, include blast radius. Chat agreement is not freeze. Keep the human Markdown contract and write `RUN_DIR/goal-contract.json` with `schemaVersion`, `runId`, objective, numbered AC, evidenceRequired, and non-empty failureCases. Run `npx ai-engineering-loop gate goal`; do not edit production code unless it passes.
3. Stages 2-4: Read `maker_intern` from workflow.md (missing or none = parent is Maker). Do not type a model name. Confirm a configured intern through `/models` when available; otherwise parent is Maker and report INVOCATION_UNAVAILABLE. Intern cannot skip later gates. Bugs: red repro first. Features: one red test per AC row. Write the exact review diff to `RUN_DIR/diff.patch`, then run `npx ai-engineering-loop gate maker`.
4. Stage 5: run commands from `.ai-engineering-loop/verification.md`. Write `RUN_DIR/verification.json` with current git revision, gated diff hash, command, execution identity, times, exit code, stdout, timeout status, and test counts. Vague "seems green" is invalid. Keep `.ai-engineering-loop/tasks/claimed-vs-reality.md`. Run `npx ai-engineering-loop gate verification`; do not spawn Devil's Advocate unless it passes.
5. Write artifacts, then spawn. Before Devil's Advocate:
   - Write `git diff` to a file (for example `.ai-engineering-loop/tasks/current.diff`).
   - Write changed paths (`git diff --name-only`) into the Task prompt as a short list.
   - Put those paths in the child prompt. Do not paste Maker rationale.
   - Write `.ai-engineering-loop/tasks/claimed-vs-reality.md` if missing. Do not spawn DA without it.
   - If stopping mid-loop, write `.ai-engineering-loop/tasks/handoff.md` (`core/handoff-policy.md`).
6. Stage 6: Build `npx ai-engineering-loop context devil-advocate <files...>` from contract, diff, verification, conventions, and changed source paths. Task `subagent_type: devil-advocate`. Use `general-purpose` only if rejected. Wait. Normalize its ledger into `RUN_DIR/findings.json` with runId and diffHash, then run `npx ai-engineering-loop gate review`.
7. Stage 7: Run `npx ai-engineering-loop escalation --json` before selecting Judge. Resolve the required tier through `/models`; if unavailable, escalate to the user. Build Judge context from only goal-contract.json, verification.json, and findings.json. Spawn Judge as a sibling and wait. Normalize its output into `RUN_DIR/verdict.json`, include `modelTier`, then run `npx ai-engineering-loop gate judge`. A gate failure overrides optimistic prose.
8. ITERATE with iteration under 3: fix in the parent, re-verify, spawn a **new** Devil's Advocate (do not resume the previous child).
9. After Judge PASS: run the `after_pass` hook, then Stage 8 from `.ai-engineering-loop/adapter.md`. PR/MR body includes `Steps to Reproduce & Testing (QA)`; bugfix placeholders must not stay empty. Preview remote payloads; do not expose context packs, raw logs, or credentials. Write `RUN_DIR/delivery.json` with destination and summary, then run `npx ai-engineering-loop gate delivery`. Only this gate completes the run.

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
