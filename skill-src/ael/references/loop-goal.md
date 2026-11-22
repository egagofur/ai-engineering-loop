# Stage 1: Goal Contract

- Before drafting: `pwd` and `git rev-parse --show-toplevel` must be the project the human named. `goal draft` prints `repoRoot`. If it differs, stop. Do not search parent or sibling repos. If unsure, ask and wait.
- `run` said `RUN_CONFLICT`: the human picks an `option`.
- If the user asks for ideas, list a short menu and wait; do not implement.
- Ambiguous task the user can answer: grill first (`docs grill-policy`): design tree, recommended answers, never ask look-up facts. T2 adds `loop-risky`.
- If the user prompt has no numbered AC, draft the contract (`docs goal-contract` if needed), list it, and wait. Chat agreement is not freeze.
- Before acceptance criteria, restate the problem in your own words (`docs goal-contract`, Restate): Problem, Done-when, Fail-if, Unknowns. Leave the human's method out. `goal draft` refuses a missing restatement.
- A bug report already drafted by `run --from-issue` or `outcome repro` has one red-repro AC. Show it and wait for freeze (`docs root-cause-analysis`).
- AC is a failure table: each row has a statement, required evidence, and failure cases. Do not freeze sunny-path-only. T0 may use 1-3 rows that still list failure cases.
- Boundary-crossing AC (UI-API, service-DB, queue, IPC): `crossComponent: true`; needs L3.
- Optional per AC: `verify.command`, `rubric`, `featureId`, `flow` (from/event/to). Show the flow table (`docs goal-contract`).
- Write `.ai-engineering-loop/drafts/goal.json`, then `npx ai-engineering-loop goal draft --json --run <runId> --file <file> --revision <currentRevision>`. Show `goal show --run <runId> --human` and `impactPreview`.
- Write `objective`, AC `statement` and `failureCases` in STE style (`docs goal-contract`): short, active, testable. Fix `readability` warnings before asking for the freeze.
- If `goal draft` returns `diagramOptions`, offer the recommended view or freeze; render only the pick (`goal diagram --view <v>`), then ask: freeze, another view, or add AC for `?`/side effects.
- Stop and ask the human to run `goal freeze --latest --run <runId> --by "<their name>"` in their own terminal and type the confirmation. A non-interactive shell is refused for every --by. Never type that confirmation. Never set `AEL_GOAL_FREEZE_OK`. `--by` is that person, never `agent`, `ael-agent`, a model id, or empty. Never freeze yourself. T0: `quick start`.
- Otherwise the freeze writes a DRAFT blast-radius map: `impact show --run <runId>`. ASSISTED: the human confirms or edits it (`impact confirm --by <name> [--allow <glob>] [--remove <path>]`); copy/CSS/comment-only goals: `impact skip --by <name> --reason <text>` (`docs blast-radius-map`).
- Do not edit production code until the Goal gate passes.
- After the freeze, work from the frozen contract (`goal show --run <runId>`), not the drafting chat; compact the conversation there if the host supports it.
