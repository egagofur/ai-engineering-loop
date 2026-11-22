---
name: ael
description: Use for a feature or bugfix in a repo with AI Engineering Loop: "please add", "please fix", "fix this bug", "build this feature", "tambahin fitur", "Use AI Engineering Loop", /ael, "run the engineering loop", "devil's advocate review", or init/refresh living project context. A one-line typo or "just change this line" is a direct edit, not this loop.
---
<!-- Generated from skill-src/ by npm run build:skills; do not edit. -->

# AI Engineering Loop

Stage details: `references/loop-*.md` beside this file (also via `docs`), read only on entering that stage. Specs and references: `npx ai-engineering-loop docs <name> [--section <h>]`; never read whole spec directories.

## Host rules

Same skill on every host. Before the first DA or Judge spawn, read your host's section in `loop-hosts` (exact tool, allowed keys, fallbacks).
1. Spawn `devil-advocate` then `judge` as fresh siblings with the host's own subagent tool, passing only keys its schema has; wait for each, never in the background or nested; `general-purpose` only if the named type is rejected. Never use a browser subagent as reviewer.
2. No subagent tool: same budgets in this session as `CONTEXT_ISOLATION_ONLY`; never claim independent execution.
3. A tool says "cannot determine the safety" or returns HTTP 400: stop that tool, do not retry, continue read-only, and tell the user (`loop-hosts`).
4. Models: the host catalog (`/models`, `grok models`); never type a model name.

## Commands

`init|status|refresh|sync-hosts|generate-*|stats|calibrate|debt|next`: run `npx ai-engineering-loop <command>` (`loop-commands`); do not commit unless asked. No task: offer `workflow interview` or a task; no Run. Otherwise: the loop.

## Loop

Map (not a second OS) of the 8-stage loop: Specify (stages 0-1), Make (stages 2-4), Review (stages 5-7), Deliver (stage 8). Gate failures override prose. Never edit `state.json`/`current.json`.

Tier (from `run --json`; it only rises). Do not skip Goal Contract, verification, Devil's Advocate, or Judge gates; the tier only decides who fills them.
- **T0** trivial (docs/typo/lint): `quick start "<task>"` (run + `gate goal`), edit, `quick finish`; no subagents.
- **T1** normal: frozen Goal, red test, `verify --related`, lean DA, `review ingest`; Judge only on `judgeRequired`.
- **T2** risky (HIGH_RISK_PATH, DOT business logic, >10 files): add `loop-risky` (blast radius, Judge on STRONG_MODEL). Unseen risk: `run --new --tier T2 --tier-reason <why>`.

0. `run --json [--mode report-only|assisted|unattended]` (`RUN_DIR` = `.ai-engineering-loop/runs/<runId>/`). Do not run `sync-hosts` per run; if `hostSkills.stale`, ask the user. Read `.ai-engineering-loop/glossary.md`, plus `lessons.md`/`workflow.md` if present; heed `learnings`.
1. Goal Contract: `loop-goal` (confirm the git toplevel is the project the human named). 2-4. Maker: `loop-maker`, then `gate maker`. 5. Verify: `loop-verify`. 6-7. DA and Judge: `loop-review`. 8. Deliver: `loop-deliver`.

Invariants (every tier):
- AC is a failure table. Do not freeze sunny-path-only. Chat agreement is not freeze.
- One red test per AC row (bugs: red repro) before the fix.
- Write claimed-vs-reality.md after `gate verification` passes. Do not spawn Devil's Advocate if the file is missing or any Claimed row lacks Reality.
- ITERATE to iteration 3 (or the recipe cap), each with a **new** DA.
- Never infer human approval; ask with host buttons (`loop-hosts`). A cancelled or unanswered question: stop and wait; never freeze yourself.
- After each child `budget record` real usage or `--unavailable`; never invent counts.
- No secrets or hidden reasoning in activity messages.

## Report header

The final report starts with the execution-mode block in `loop-deliver` (TRUE_INDEPENDENT_AGENT or CONTEXT_ISOLATION_ONLY); never claim independent execution without a subagent result. Tool AVAILABLE but unused: add `(reason: <why>)`.
