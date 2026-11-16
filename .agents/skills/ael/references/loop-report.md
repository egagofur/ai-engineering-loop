# REPORT_ONLY: report review

Read only in REPORT_ONLY mode, after writing `RUN_DIR/report.json` (`loop-maker`).

## REPORT_ONLY report review (recipe `audit`)

- Host has a subagent tool (`loop-hosts`): spawn ONE fresh `devil-advocate` sibling with report.json and the evidence paths it cites; it challenges unsupported or wrong findings with the usual DA budget. No Judge, no iteration loop: fold accepted findings once, drop rejected ones with evidence. Record `"review": {"executionMode": "TRUE_INDEPENDENT_AGENT", "nativeSubagent": "AVAILABLE", "reviewer": "devil-advocate", "childId": "<its own id>"}`.
- No subagent tool, or the spawn failed: do the same challenge in this session and record `"executionMode": "CONTEXT_ISOLATION_ONLY"` with `"reason"` (required by `gate report` when `nativeSubagent` is `AVAILABLE`). The header shows `Execution Mode: CONTEXT_ISOLATION_ONLY (reason: <why>)`.
