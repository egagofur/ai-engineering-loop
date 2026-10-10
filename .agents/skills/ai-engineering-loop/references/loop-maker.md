# Stages 2-4: Maker

- T1/T2: read `docs tdd-policy` before Maker. Use `npx ai-engineering-loop context query <term>` and `context related <file>` before opening broad source files.
- Branch on mode. REPORT_ONLY: never edit repository files; write `RUN_DIR/report.json` with summary and recommendations, run `gate report`, and stop. ASSISTED: the parent (or intern) is Maker; delivery later needs human approval. UNATTENDED: `sandbox create --run <runId>`, Maker works only in the returned worktreePath, never the parent checkout, then `sandbox capture --run <runId>`.
- Maker intern: read `maker_intern` from workflow.md (missing or `none` = parent is Maker). Confirm it through the host model catalog; otherwise the parent is Maker and you report INVOCATION_UNAVAILABLE. The intern cannot skip later gates or spawn DA/Judge.
- Bugs: red repro first. Features: one red test per AC row, then green.
- After package and manifest edits are stable, run `npx ai-engineering-loop refresh` once (drift during red-green is expected; do not refresh per test cycle).
- ASSISTED: `npx ai-engineering-loop gate maker --from-git` writes the exact working-tree diff (tracked and new files, excluding `.ai-engineering-loop/`) to `RUN_DIR/diff.patch` and gates it; or write that file yourself and run `gate maker`. UNATTENDED: `sandbox capture` writes it, then `gate maker`. The gate can raise the tier from the diff.
