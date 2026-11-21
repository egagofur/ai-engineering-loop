# Stages 2-4: Maker

- T1/T2: read `docs tdd-policy` before Maker. Use `npx ai-engineering-loop context query <term>` and `context related <file>` before opening broad source files.
- ASSISTED (default): the parent (or intern) is Maker; delivery needs human approval. REPORT_ONLY, UNATTENDED, `maker_intern`: `loop-modes`.
- Guardrails: Claude Code enforces them after `hooks install`. Elsewhere, before an out-of-scope edit or a destructive command (`rm -rf`, `DROP TABLE`, `git push --force`, `git reset --hard`, `git clean -fd`) run `guard check --tool edit --path <file>` or `--tool bash --command "<cmd>"`: `warn` = ask the human, `block` = do not run it.
- No code comments in product code (C-26): put intent in names, types, tests; rationale in the commit.
- Bugs: red repro first. Features: one red test per AC row, then green.
- After package and manifest edits are stable, run `npx ai-engineering-loop refresh` once (drift during red-green is expected; do not refresh per test cycle).
- `eslint --fix` and other auto-fixers run before `gate maker`, never after.
- ASSISTED: `npx ai-engineering-loop gate maker --from-git` writes the exact working-tree diff (tracked and new files, excluding `.ai-engineering-loop/`) to `RUN_DIR/diff.patch` and gates it; or write that file yourself and run `gate maker`. UNATTENDED: `sandbox capture` writes it, then `gate maker`. The gate can raise the tier from the diff.
