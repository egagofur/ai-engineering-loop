# Run modes and the Maker intern

Read when the Run is REPORT_ONLY or UNATTENDED, or `workflow.md` names a `maker_intern`.

- Branch on mode. REPORT_ONLY: never edit repository files; write `RUN_DIR/report.json` with summary and recommendations, then the report review (`loop-report`), run `gate report`, and stop. ASSISTED: the parent (or intern) is Maker; delivery later needs human approval. UNATTENDED: `sandbox create --run <runId>`, Maker works only in the returned worktreePath, never the parent checkout, then `sandbox capture --run <runId>`.
- Maker intern: read `maker_intern` from workflow.md (missing or `none` = parent is Maker). Confirm it through the host model catalog; otherwise the parent is Maker and you report INVOCATION_UNAVAILABLE. The intern cannot skip later gates or spawn DA/Judge.
