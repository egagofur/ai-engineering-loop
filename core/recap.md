# Recap: what shipped in the last N days

`ael recap` turns local Run artifacts into one offline HTML page for a period (C-28). It never changes a Run and never calls a model: every number comes from a Run file.

```bash
npx ai-engineering-loop recap [--days 7] [--for me|lead|client] [--projects <path,...>|all] [--out <file>] [--lang <tag>] [--open] [--json]
```

- `--days`: window length, 1 to 366 (default 7). Runs are grouped by the time in their id.
- `--for`: which tab opens first. All three are in the file.
- `--projects`: default is the current project; `all` reads every registered project (`ael projects`). A client recap covers one project only.
- `--lang`: the language of the Goal text (for example `id`), so screen readers pronounce it right. The page chrome stays English.
- Output: `.ai-engineering-loop/recaps/recap-<from>-<to>-<for>.html` (mode 0600). It stays local; share it on purpose.

There is no built-in schedule. To get one every few days, run it from cron or a scheduled agent.

## The three views

| View | Shows | Never shows |
|---|---|---|
| For me | runs, first-try PASS rate, median cycle time, delivered; activity per day × project; cycle time per run split into goal, maker, verify, review+judge, deliver (from `state.json` history); ITERATE causes | |
| For the lead | delivered, first-try PASS rate, median cycle time, T2 runs; one card per run with verdict, tier, iterations, green checks, files outside the impact map; an evidence drawer with ACs and their evidence, verification commands with exit code and duration, the Judge reason and links to the artifact files | stdout or stderr |
| For the client | a "what's new" timeline of delivered runs and what is in progress | file paths, commands, findings, tiers, iterations, branch names |

Comparisons ("up 2 vs previous period") appear only when the previous window of the same length has runs.

## Text for clients

The client sentence is the Goal's `plainSummary`, else `businessOutcome`, else `objective`. When a delivered run falls back to the objective, the lead tab lists it under "Before you share the client tab"; the client tab itself never shows that note. The recap never rewrites it, so write `plainSummary` in the Goal when the work will be shown to a client.
