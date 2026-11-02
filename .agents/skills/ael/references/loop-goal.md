# Stage 1: Goal Contract

- If the user asks for ideas, list a short menu and wait; do not implement.
- Ambiguous task the user can answer: grill first (`docs grill-policy`): design tree, recommended answers, never ask look-up facts. T2 adds `loop-risky`.
- If the user prompt has no numbered AC, draft the contract (`docs goal-contract` if needed), list it, and wait. Chat agreement is not freeze.
- AC is a failure table: each row has a statement, required evidence, and failure cases. Do not freeze sunny-path-only. T0 may use 1-3 rows that still list failure cases.
- Write the contract JSON to a repository-local file, then `npx ai-engineering-loop goal draft --run <runId> --file <file> --revision <currentRevision>` (publishes the draft and the freeze question to Studio). Show the human the draft and its `impactPreview` in one message.
- Wait for the explicit human freeze, then `npx ai-engineering-loop goal freeze --latest --run <runId> --by <name>` (or `--revision <r> --hash <h>`). Add `--confirm-impact` when that answer also accepts the blast radius. T0: `quick start`.
- Otherwise the freeze writes a DRAFT blast-radius map: `impact show --run <runId>`. ASSISTED: the human confirms or edits it (`impact confirm --by <name> [--allow <glob>] [--remove <path>]`); copy/CSS/comment-only goals: `impact skip --by <name> --reason <text>` (`docs blast-radius-map`).
- Do not edit production code until the Goal gate passes.
- After the freeze, work from the frozen contract (`goal show --run <runId>`), not the drafting chat; compact the conversation there if the host supports it.
