# Proof, not prose (from pstack, 2026-11-18)

Source: [cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT, poteto). Goal: less human re-checking of agent claims. Every item moves a check from the human (or a model's say-so) to something the CLI runs. No new subagents: agents write the proof command, the CLI runs it.

Success is measured by C-36: human interventions per Run, and the share of blocking findings that reproduce.

## C-29 · P1 · Findings survive only when a run proves them
**Source:** `interrogate` ("a finding survives only when a run proves it").
**Now:** DA writes `reproduction` as prose; the Judge weighs BLOCKER/HIGH on text alone.
**Change:** a finding may carry `proof: {command, shell?}`. At `gate review` the CLI runs each VALID BLOCKER/HIGH proof (destructive commands refused by the guard, 120s timeout) and records `proofStatus`: `reproduced` (non-zero exit: the bug shows), `not_reproduced` (exit 0), `refused`, `timed_out`. A `not_reproduced` finding no longer blocks. Results go to `runs/<id>/proofs.json`.
**AC:** reproduced stays blocking; not_reproduced stops blocking; destructive proof refused and still blocking; ablation `proofs` honoured only in bench.

## C-30 · P1 · One safety fact with a proof level
**Source:** `blast-radius` (find the one fact the change is safe because of; prove it by running code; levels 1–5).
**Change:** `ael safety record --run <id> --fact <text> [--cmd <cmd>] [--live] [--level 1-3]`. With `--cmd` the CLI runs it; exit 0 records level 4 (5 with `--live`), otherwise it refuses. T2 Judge PASS needs level ≥ 4 (`SAFETY_FACT_UNPROVEN`).
**AC:** level 4 only after a passing run; T2 PASS refused without it; T1 unaffected.

## C-31 · P2 · Promoted rules must catch a real past mistake
**Source:** `correct` ("prove each new check fails on a real past mistake").
**Change:** `learn promote ... --prove <commit>` runs the check against that commit (added lines for `--scope diff` and forbid rules, a temporary worktree for repo rules). It must fail; the rule records `provenBy`. `doctor --harness` lists unproven rules.
**AC:** promote refuses when the check passes on the commit; proven rule records commit and time.

## C-32 · P2 · Attack the premise on a repeated cause
**Source:** `principle-attack-the-premise`.
**Change:** a Judge ITERATE whose `cause` repeats the previous ITERATE's cause needs `premise: {statement, test}` in verdict.json (`PREMISE_REQUIRED`).
**AC:** second ITERATE with the same cause refused without premise; accepted with it.

## C-33 · P2 · Explain the number
**Source:** `principle-explain-the-number`, `benchmark-checklist`.
**Change:** an AC with `measure: true` needs `ael measurement record --ac <id> --runs N --spread <pct> --effect <pct> --limiter <text>`; Judge PASS needs runs ≥ 3, a limiter, and spread < effect (`MEASUREMENT_UNEXPLAINED`).
**AC:** missing, too few runs, or noise larger than effect refuse PASS.

## C-34 · P3 · Feature map drift
**Source:** `maintain-verification-skill`.
**Change:** `doctor --harness` warns for feature-map entries whose path globs match no file.

## C-35 · P3 · Formal coverage drift
**Source:** `maintain-formal-verification-skill`.
**Change:** `- **formal_covers**: <globs>` in verification.md; default `verify` adds the `formal` key when the gated diff touches covered files.

## C-36 · P2 · Measure the micro-management
**Change:** `stats` reports human interventions per Run (answered questions, escalations, recorded outcomes) and proof outcomes (reproduced vs not reproduced); `recap` shows them for me and lead.
