# Stages 6-7: Devil's Advocate and Judge

REPORT_ONLY runs skip these stages; their single report review is in `loop-maker`.

## Devil's Advocate (T1, T2)

- `npx ai-engineering-loop review-pack --run <runId> --json` returns the DA pack path, fast-path, escalation floor, and tier. Keep the lean path when eligible; add `context devil-advocate <files...>` only for files whose hunks are insufficient. The DA reads that pack or `RUN_DIR/diff.patch` (do not also write `tasks/current.diff`).
- Use the runtime policy `reviewProfile` (default `lean`); upgrade to `standard` or `thorough` only when the human asks or the budget gate requires it.
- Spawn a new DA as a sibling (Host rules) with the pack path, the changed paths as a short list, and claimed-vs-reality.md. Do not paste Maker rationale. DA prompt includes "at most 8 tool calls; read the diff file; skip css and generated files".
- Iteration 2+: give unresolved findings and new hunks, not the whole diff again.
- Wait, `budget record` its usage (or `--unavailable`), save its output to a file, then `review ingest --run <runId> --child-id <id> --file <output> --json` (binds the ledger, runs `gate review`, and `gate judge` when not required). Never drop a finding; dismiss or downgrade only with `dismissal: {by, evidence}`. Report Spec and Standards separately.

## Judge and iterate

- Judge only when `gate review` says `judgeRequired` or T2, or on ITERATE: `loop-judge`.
