{{frontmatter}}

# AI Engineering Loop

{{refLine}} Specs and references: `npx ai-engineering-loop docs <name> [--section <h>]`; never read whole spec directories.

## Host rules

{{hostRules}}

## Commands

`init|status|refresh|sync-hosts|generate-adapter|generate-workflow`: run `npx ai-engineering-loop <command>` (`loop-commands`); do not commit unless asked. Otherwise: the loop.

## Loop

Compact map (not a second OS) of the 8-stage loop: Specify (stages 0-1), Make (stages 2-4), Review (stages 5-7), Deliver (stage 8). Parent is Maker plus orchestrator; Devil's Advocate (DA) and Judge are fresh **siblings**, never nested or resumed. A gate failure overrides prose. Never edit `state.json`/`current.json`.

Tier (from `run --json`; it only rises). Do not skip Goal Contract, verification, Devil's Advocate, or Judge gates; the tier only decides who fills them.
- **T0** trivial (docs, typo, lint): `gate goal`, Maker, `verify`, claimed-vs-reality, `gate review`, `gate judge` (deterministic); no subagents.
- **T1** normal: frozen Goal, red test, `verify`, lean DA, `gate review --json`; spawn Judge only on `judgeRequired`.
- **T2** risky (HIGH_RISK_PATH, DOT business logic, >10 files): add `loop-risky` (blast radius, Judge on STRONG_MODEL). Unseen risk: `run --new --tier T2 --tier-reason <why>`.

0. `run --json [--mode report-only|assisted|unattended]` (runId, tier, budget, hostSkills; `RUN_DIR` = `.ai-engineering-loop/runs/<runId>/`). Do not run `sync-hosts` per run; if `hostSkills.stale`, ask the user to. Read `.ai-engineering-loop/glossary.md`, plus `lessons.md`/`workflow.md` if present.
1. Goal Contract: `loop-goal`. 2-4. Maker: `loop-maker`, then `gate maker`. 5. Verify: `loop-verify`. 6-7. DA and Judge: `loop-review`. 8. Deliver: `loop-deliver`.

Invariants (every tier):
- AC is a failure table. Do not freeze sunny-path-only. Chat agreement is not freeze.
- One red test per AC row (bugs: red repro) before the fix.
- Write claimed-vs-reality.md after `gate verification` passes. Do not spawn Devil's Advocate if the file is missing or any Claimed row lacks Reality.
- ITERATE at most to iteration 3, each with a **new** DA.
- Never infer human approval.
- After each child `budget record` real usage or `--unavailable`; never invent counts.
- No secrets or hidden reasoning in activity messages.

## Report header

{{reportIntro}}

```
Execution Mode: TRUE_INDEPENDENT_AGENT
Independent LLM Execution: PROVEN
Native Subagent Invocation: AVAILABLE
Review Method: True Independent Agent
```

When no subagent ran:

```
Execution Mode: CONTEXT_ISOLATION_ONLY
Independent LLM Execution: NOT PROVEN
Native Subagent Invocation: UNAVAILABLE
Review Method: Clean-Slate Artifact Isolation Barrier
```
