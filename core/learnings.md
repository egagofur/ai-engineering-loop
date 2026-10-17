# Project Learnings (`ael learn`)

The same Devil's Advocate objections should not be raised Run after Run. `learn` mines the finding ledgers of past Runs (`RUN_DIR/findings.json`) into project learnings that the next Maker and Devil's Advocate packs carry.

```bash
npx ai-engineering-loop learn                 # write .ai-engineering-loop/learnings.json + learnings.md
npx ai-engineering-loop learn --dry-run --json
npx ai-engineering-loop learn --prune [--max-age-runs 20]
```

## What becomes a learning

- Only findings with `validity: VALID`. `INVALID` findings and findings whose `status`/`resolution`/`decision` is `REJECTED`, `DISMISSED`, `WONT_FIX` or `INVALID` are excluded. Blast-radius drift findings (`source: impact-map`) describe one Run and are skipped.
- Findings are clustered per review axis (`spec` / `standards`) by word overlap of their `failureScenario` (Jaccard ≥ 0.6) and deduped. Each entry keeps the highest severity, the latest wording, the file locations, the occurrence count and the `runIds` it came from.
- Deterministic: no model call, no timestamps of its own; the same Runs always produce the same bytes. Runs are mined oldest first, so entry ids (`L-<hash>`) stay stable.
- Text passes the `safe-context` secret and home-path redaction before it is written. `learnings.json` follows `schemas/learnings.schema.json`.

## Pruning

`--prune` moves entries to `suppressed` when every file they point at is gone (`files-removed`) or their last occurrence is older than the newest `--max-age-runs` Runs (`stale`). To retire a lesson by hand, set `"supersededBy": "<where the rule now lives>"` on its entry; the next `learn` suppresses it. A suppressed lesson comes back only if it recurs in a newer Run.

## In context packs

`context maker|devil-advocate` packs and the `review-pack` diff-hunk pack add up to 5 `learnings`: entries whose locations match the pack's files first (same file, then same directory), then lessons seen in 2+ Runs. They use at most 10% of the stage's token budget and never push the pack past it (`learningTokens` is counted in `estimatedTokens`). Judge packs get none.
