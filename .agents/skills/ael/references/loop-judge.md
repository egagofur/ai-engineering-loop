# Stage 7: Judge and ITERATE

Read when `gate review` says `judgeRequired`, on T2, or when acting on findings.

- Otherwise run `npx ai-engineering-loop escalation --json` and resolve the required tier through the host model catalog; if unavailable, escalate to the user. T2 needs STRONG_MODEL.
- Judge context: only run-summary.md, verification-summary.json (or verification.json), open-findings.json/findings.json, and the Goal hash; it reads the full diff only if those contradict each other. Judge prompt includes "at most 4 tool calls; ledger and contract only; skip css; do not re-review the whole diff".
- Spawn a fresh sibling Judge, wait, `budget record`, write `RUN_DIR/verdict.json` with `modelTier` and any `judgeFindings`, then `gate judge`. A gate failure overrides optimistic prose.
- ITERATE under the recipe cap: fix in the parent, re-verify, spawn a **new** DA (never resume the previous child). At the cap or NO_PROGRESS, ESCALATE to the human.

## Acting on findings (DA during ITERATE, or human MR/PR comments)

Feedback is a claim to check, not an order. For each finding or comment:
1. Restate it in one line with its file and line. Cannot locate it: ask for the location; do not guess.
2. Verify it against the code, the frozen Goal, and the command evidence: reproduce it (failing test, command, concrete input) or show why it does not apply.
3. Classify: `valid` (fix test-first), `invalid` (decline with evidence), `out-of-scope` (record as a follow-up; do not widen the diff), `unclear` (ask one precise question).
4. Reply with that class and the evidence. No "great catch", no silent fixes.

Fix one finding at a time and re-run its check. A finding that contradicts the frozen Goal goes back to the human. MR/PR reply:

```
F-<id> <valid|invalid|out-of-scope|unclear>: <one-line reason>
Evidence: <test / command + exit code / file:line>
Change: <commit or "none">
```
