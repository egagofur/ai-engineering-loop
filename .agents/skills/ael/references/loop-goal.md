# Stage 1: Goal Contract

- `run` said `RUN_CONFLICT`: the human picks an `option`.
- If the user asks for ideas, list a short menu and wait; do not implement.
- Ambiguous task the user can answer: grill first (`docs grill-policy`): design tree, recommended answers, never ask look-up facts. T2 adds `loop-risky`.
- If the user prompt has no numbered AC, draft the contract (`docs goal-contract` if needed), list it, and wait. Chat agreement is not freeze.
- Before acceptance criteria, restate the problem in your own words (`docs goal-contract`, Restate): Problem, Done-when, Fail-if, Unknowns. Leave the human's method out. `goal draft` refuses a missing restatement.
- A bug report already drafted by `run --from-issue` or `outcome repro` has one red-repro AC. Show it and wait for freeze (`docs root-cause-analysis`).
- AC is a failure table: each row has a statement, required evidence, and failure cases. Do not freeze sunny-path-only. T0 may use 1-3 rows that still list failure cases.
- Boundary-crossing AC (UI-API, service-DB, queue, IPC): `crossComponent: true`; needs L3.
- Optional per AC: `verify.command` (Judge PASS needs it green), `rubric` for subjective ACs; Goal `featureId` links `features.json`; Goal `flow` (from/event/to) for UI work: show its table with the draft (`docs goal-contract`).
- Write the contract JSON to `.ai-engineering-loop/drafts/goal.json`, then `npx ai-engineering-loop goal draft --json --run <runId> --file <file> --revision <currentRevision>` (publishes the draft and the freeze question to Studio). Show the human `goal show --run <runId> --human` (plain Markdown) and the `impactPreview` in one message.
- Write `objective`, AC `statement` and `failureCases` in STE style (`docs goal-contract`, STE): one fact or action per sentence, active voice, at most 20-25 words, words a test can check. Fix `readability` warnings from `goal draft` before asking for the freeze.
- If `goal draft` returns `diagramOptions`, offer the recommended view or freeze; render only the pick (`goal diagram --view <v>`), then ask: freeze, another view, or add AC for `?`/side effects.
- Wait for the explicit human freeze, then `npx ai-engineering-loop goal freeze --json --latest --run <runId> --by <name>` (or `--revision <r> --hash <h>`). Add `--confirm-impact` when that answer also accepts the blast radius. T0: `quick start`.
- Otherwise the freeze writes a DRAFT blast-radius map: `impact show --run <runId>`. ASSISTED: the human confirms or edits it (`impact confirm --by <name> [--allow <glob>] [--remove <path>]`); copy/CSS/comment-only goals: `impact skip --by <name> --reason <text>` (`docs blast-radius-map`).
- Do not edit production code until the Goal gate passes.
- After the freeze, work from the frozen contract (`goal show --run <runId>`), not the drafting chat; compact the conversation there if the host supports it.
