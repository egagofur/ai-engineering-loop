# Stage 7: Judge and ITERATE

Read when `gate review` says `judgeRequired`, on T2, or when acting on findings.

- Otherwise run `npx ai-engineering-loop escalation --json` and resolve the required tier through the host model catalog; if unavailable, escalate to the user. T2 needs STRONG_MODEL.
- Judge context: only run-summary.md, verification-summary.json (or verification.json), open-findings.json/findings.json, and the Goal hash; it reads the full diff only if those contradict each other. Judge prompt includes "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff".
- Spawn a fresh sibling Judge, wait, `budget record`, write `RUN_DIR/verdict.json` with `modelTier` and any `judgeFindings`, then `gate judge`. A gate failure overrides optimistic prose.
- Acting on findings (ITERATE or human MR comments): verify each one before changing code; fix valid ones test-first, decline invalid ones with evidence (skill `ael-receiving-code-review` if installed).
- ITERATE under the recipe cap: fix in the parent, re-verify, spawn a **new** DA (never resume the previous child). At the cap or NO_PROGRESS, ESCALATE to the human.
