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

- `init` / `status` / `refresh` / `sync-hosts` / `generate-adapter` / `generate-workflow`: run `npx ai-engineering-loop <command>` in the repo. Do not commit unless asked.
- `generate-adapter`: load skill `generate-adapter` if present. Grill Q1-Q5. Then write `.ai-engineering-loop/adapter.md`. Do not start Maker.
- `generate-workflow`: load skill `generate-workflow` if present. Grill Q1-Q6. Q6 Maker intern: if `/models` exists in this session, use it and show numbered options; else only `none`. Do not type a model name. Then write `.ai-engineering-loop/workflow.md` and empty `lessons.md` if missing. Do not start Maker.
- Any other argument: full loop for that task.

## Loop

Compact map (not a second OS): Specify (stages 0-1), Make (stages 2-4), Review (stages 5-7), Deliver (stage 8). Keep the 8-stage numbers. Do not skip Goal Contract, verification, Devil's Advocate, or Judge.

## Deterministic artifact gates (mandatory)

Run `npx ai-engineering-loop state --json` to get the current runId and use `.ai-engineering-loop/runs/<runId>/` as `RUN_DIR`. Never edit state.json or current.json.

Read `core/runtime-safety.md`. Before every model or subagent call, run `budget status --run <runId>` and afterward run `budget record --input <actual> --output <actual> --model <id> --run <runId>` using provider-reported usage. Never invent usage. Missing usage stops UNATTENDED and requires human direction in ASSISTED. `budget pause` is the kill switch.

Inherited invariants remain mandatory: read `core/grill-policy.md`, `policies/tdd-policy.md`, and `.ai-engineering-loop/glossary.md`. On `adapter_type: dot`, grill includes blast radius: lifecycle sketch and load `task-impact-inquiry`. If the user prompt has no numbered AC, draft the contract, list a short menu and wait. Chat agreement is not freeze. AC is a failure table. One red test per AC row. Do not freeze sunny-path-only. Write claimed-vs-reality.md. Do not spawn Devil's Advocate if the file is missing or any Claimed row lacks Reality. Report Spec and Standards separately. DA prompt includes "at most 8 tool calls; read the diff file; skip css and generated files". Judge prompt includes "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff". `generate-workflow` still reads workflow.md and lessons.md; missing maker_intern means INVOCATION_UNAVAILABLE. Do not type a model name.

1. Stage 0: sync hosts, check status, then run `npx ai-engineering-loop run [--mode report-only|assisted|unattended]` to create or resume the ledger. Run `state --json` and `budget status`. Read glossary, lessons, and workflow overlays. Required gates cannot be skipped.
2. Stage 1: keep the human Goal Contract Markdown and write `RUN_DIR/goal-contract.json` with schemaVersion, runId, objective, numbered AC, evidenceRequired, and non-empty failureCases. Grill ambiguous decisions and business blast radius first. Run `npx ai-engineering-loop gate goal`; do not edit production code unless it passes.
3. After Goal freeze, branch on mode. REPORT_ONLY: never edit repository files; write `RUN_DIR/report.json`, run `gate report`, and stop. ASSISTED: use the normal Maker. UNATTENDED: run `sandbox create --run <runId>`, run Maker only in the returned worktreePath, never edit the parent checkout, then run `sandbox capture --run <runId>`. Resolve maker_intern only through the host catalog; otherwise parent is Maker. Intern cannot skip gates. Use red repro or TDD. ASSISTED writes `RUN_DIR/diff.patch`; UNATTENDED capture writes it. Then run `npx ai-engineering-loop gate maker`.
4. Stage 5: write `RUN_DIR/verification.json` with current git revision, gated diff hash, command, execution identity, times, exit code, stdout, timeout status, and test counts. Keep claimed-vs-reality.md. Run `npx ai-engineering-loop gate verification`; do not spawn DA unless it passes.
5. Write artifacts, then spawn. Before Devil's Advocate:
   - Write `git diff` to a file (for example `.ai-engineering-loop/tasks/current.diff`).
   - Write changed paths (`git diff --name-only`) into the child prompt as a short list.
   - Put those paths in the child prompt. Do not paste Maker rationale.
   - Write `.ai-engineering-loop/tasks/claimed-vs-reality.md` if missing. Do not spawn DA without it.
   - If stopping mid-loop, write `.ai-engineering-loop/tasks/handoff.md` (`core/handoff-policy.md`).
6. Stage 6: Build `npx ai-engineering-loop context devil-advocate <files...>`, check `budget status`, spawn DA with the pack path, wait, and `budget record` actual usage. Normalize its output into `RUN_DIR/findings.json` with runId and diffHash, then run `npx ai-engineering-loop gate review`.
7. Stage 7: Run `npx ai-engineering-loop escalation --json`, resolve the required tier through the host catalog, or escalate to the user. Build Judge context from goal-contract.json, verification.json, and findings.json only. Check `budget status`, spawn Judge, wait, and `budget record` actual usage. Write `RUN_DIR/verdict.json` with modelTier, then run `npx ai-engineering-loop gate judge`.
8. ITERATE with iteration under 3: fix in the parent, re-verify, spawn a **new** Devil's Advocate.
9. After Judge PASS: run after_pass, then the configured Stage 8 adapter. PR/MR body includes `Steps to Reproduce & Testing (QA)`; bugfix placeholders must not stay empty. Preview remote payloads and never include context packs, usage ledgers, raw logs, or credentials. In ASSISTED, wait for explicit human approval and put `humanApproved: true` in `RUN_DIR/delivery.json`; never infer it. Then run `npx ai-engineering-loop gate delivery`.

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
