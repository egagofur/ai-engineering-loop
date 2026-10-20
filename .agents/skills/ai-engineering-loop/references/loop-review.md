# Stages 6-7: Devil's Advocate and Judge

REPORT_ONLY runs skip these stages; their single report review is in `loop-maker`.

## Devil's Advocate (T1, T2)

- `npx ai-engineering-loop review-pack --run <runId> --json` returns the DA pack path, fast-path, escalation floor, and tier. Keep the lean path when eligible; add `context devil-advocate <files...>` only for files whose hunks are insufficient. The DA reads that pack or `RUN_DIR/diff.patch` (do not also write `tasks/current.diff`).
- Use the runtime policy `reviewProfile` (default `lean`); upgrade to `standard` or `thorough` only when the human asks or the budget gate requires it.
- Spawn a new DA as a sibling (Host rules) with the pack path, the changed paths as a short list, and claimed-vs-reality.md. Do not paste Maker rationale. DA prompt includes "at most 8 tool calls; read the diff file; skip css and generated files".
- Iteration 2+: give unresolved findings and new hunks, not the whole diff again.
- Wait, `budget record` its usage (or `--unavailable`), save its output to a file, then `review ingest --run <runId> --child-id <id> --file <output> --json` (binds the ledger, runs `gate review`, and `gate judge` when not required). Never drop a finding; dismiss or downgrade only with `dismissal: {by, evidence}`. Report Spec and Standards separately.

## Judge

- Otherwise run `npx ai-engineering-loop escalation --json` and resolve the required tier through the host model catalog; if unavailable, escalate to the user. T2 needs STRONG_MODEL.
- Judge context: only run-summary.md, verification-summary.json (or verification.json), open-findings.json/findings.json, and the Goal hash; it reads the full diff only if those contradict each other. Judge prompt includes "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff".
- Spawn a fresh sibling Judge, wait, `budget record`, write `RUN_DIR/verdict.json` with `modelTier` and any `judgeFindings`, then `gate judge`. A gate failure overrides optimistic prose.
- Acting on findings (ITERATE or human MR comments): verify each one before changing code; fix valid ones test-first, decline invalid ones with evidence (skill `ael-receiving-code-review` if installed).
- ITERATE under the recipe cap: fix in the parent, re-verify, spawn a **new** DA (never resume the previous child). At the cap or NO_PROGRESS, ESCALATE to the human.
