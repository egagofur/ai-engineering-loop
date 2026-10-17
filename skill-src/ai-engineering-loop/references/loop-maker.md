# Stages 2-4: Maker

- T1/T2: read `docs tdd-policy` before Maker. Use `npx ai-engineering-loop context query <term>` and `context related <file>` before opening broad source files.
- Branch on mode. REPORT_ONLY: never edit repository files; write `RUN_DIR/report.json` with summary and recommendations, then the report review below, run `gate report`, and stop. ASSISTED: the parent (or intern) is Maker; delivery later needs human approval. UNATTENDED: `sandbox create --run <runId>`, Maker works only in the returned worktreePath, never the parent checkout, then `sandbox capture --run <runId>`.
- Maker intern: read `maker_intern` from workflow.md (missing or `none` = parent is Maker). Confirm it through the host model catalog; otherwise the parent is Maker and you report INVOCATION_UNAVAILABLE. The intern cannot skip later gates or spawn DA/Judge.
- Guardrails: Claude Code enforces them after `hooks install`. Elsewhere, before an out-of-scope edit or a destructive command (`rm -rf`, `DROP TABLE`, `git push --force`, `git reset --hard`, `git clean -fd`) run `guard check --tool edit --path <file>` or `--tool bash --command "<cmd>"`: `warn` = ask the human, `block` = do not run it.
- Bugs: red repro first. Features: one red test per AC row, then green.
- After package and manifest edits are stable, run `npx ai-engineering-loop refresh` once (drift during red-green is expected; do not refresh per test cycle).
- ASSISTED: `npx ai-engineering-loop gate maker --from-git` writes the exact working-tree diff (tracked and new files, excluding `.ai-engineering-loop/`) to `RUN_DIR/diff.patch` and gates it; or write that file yourself and run `gate maker`. UNATTENDED: `sandbox capture` writes it, then `gate maker`. The gate can raise the tier from the diff.

## REPORT_ONLY report review (recipe `audit`)

- Host has a subagent tool (`loop-hosts`): spawn ONE fresh `devil-advocate` sibling with report.json and the evidence paths it cites; it challenges unsupported or wrong findings with the usual DA budget. No Judge, no iteration loop: fold accepted findings once, drop rejected ones with evidence. Record `"review": {"executionMode": "TRUE_INDEPENDENT_AGENT", "nativeSubagent": "AVAILABLE", "reviewer": "devil-advocate", "childId": "<its own id>"}`.
- No subagent tool, or the spawn failed: do the same challenge in this session and record `"executionMode": "CONTEXT_ISOLATION_ONLY"` with `"reason"` (required by `gate report` when `nativeSubagent` is `AVAILABLE`). The header shows `Execution Mode: CONTEXT_ISOLATION_ONLY (reason: <why>)`.
