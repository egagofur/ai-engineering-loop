# Stage 1: Goal Contract

- If the user asks for ideas, list a short menu and wait; do not implement.
- Ambiguous task the user can answer: grill first (`docs grill-policy`): design tree, recommended answers, never ask look-up facts. T2 adds `loop-risky`.
- If the user prompt has no numbered AC, draft the contract (`docs goal-contract` if needed), list it, and wait. Chat agreement is not freeze.
- AC is a failure table: each row has a statement, required evidence, and failure cases. Do not freeze sunny-path-only. T0 may use 1-3 rows that still list failure cases.
- Emit `npx ai-engineering-loop activity goal-drafting --run <runId> --message <summary>`, write the contract JSON to a repository-local temporary file, then `npx ai-engineering-loop goal draft --run <runId> --file <file> --revision <currentRevision>` so Studio shows the exact draft.
- Wait for the explicit human freeze, then `npx ai-engineering-loop goal freeze --latest --run <runId> --by human` (or `--revision <r> --hash <h>`). T0 may write `RUN_DIR/goal-contract.json` and run `gate goal` directly.
- The freeze writes a DRAFT blast-radius map (`RUN_DIR/impact-map.json`). Show it (`impact show --run <runId>`); in ASSISTED let the human confirm or edit it (`impact confirm --run <runId> --by <name> [--allow <glob>] [--remove <path>]`), or skip a copy/CSS/comment-only goal with `impact skip --by <name> --reason <text>`. Spec: `docs blast-radius-map`.
- Do not edit production code until the Goal gate passes.
- After the freeze, work from the frozen contract (`goal show --run <runId>`), not the drafting chat; compact the conversation there if the host supports it.
