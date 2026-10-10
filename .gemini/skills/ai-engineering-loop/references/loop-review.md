# Stages 6-7: Devil's Advocate and Judge

## Devil's Advocate (T1, T2)

- `npx ai-engineering-loop review-pack --run <runId> --json` returns the DA pack path, fast-path, escalation floor, and tier. Keep the lean path when eligible; add `context devil-advocate <files...>` only for files whose hunks are insufficient. The DA reads that pack or `RUN_DIR/diff.patch` (do not also write `tasks/current.diff`).
- Use the runtime policy `reviewProfile` (default `lean`); upgrade to `standard` or `thorough` only when the human asks or the budget gate requires it.
- Spawn a new DA as a sibling (Host rules) with the pack path, the changed paths as a short list, and claimed-vs-reality.md. Do not paste Maker rationale. DA prompt includes "at most 8 tool calls; read the diff file; skip css and generated files".
- Iteration 2+: give unresolved findings and new hunks, not the whole diff again.
- Wait, `budget record` its usage (or `--unavailable`), normalize its ledger into `RUN_DIR/findings.json` with runId and diffHash, then `npx ai-engineering-loop gate review --json`. Report Spec and Standards separately.

## Judge

- T0, or T1 when `gate review --json` reports `judgeRequired: false`: run `gate judge`; the CLI writes the deterministic verdict.
- Otherwise run `npx ai-engineering-loop escalation --json` and resolve the required tier through the host model catalog; if unavailable, escalate to the user. T2 needs STRONG_MODEL.
- Judge context: only run-summary.md, verification-summary.json (or verification.json), open-findings.json/findings.json, and the Goal hash; it reads the full diff only if those contradict each other. Judge prompt includes "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff".
- Spawn a fresh sibling Judge, wait, `budget record`, write `RUN_DIR/verdict.json` with `modelTier`, then `gate judge`. A gate failure overrides optimistic prose.
- ITERATE while iteration < 3: fix in the parent, re-verify, spawn a **new** DA (never resume the previous child). At the iteration ceiling (3) ESCALATE to the human instead.
