# Garden

`refresh --garden` reports stale project knowledge. It writes nothing unless you pass `--yes`. It never deletes a Run.

```bash
npx ai-engineering-loop refresh --garden
npx ai-engineering-loop refresh --garden --yes
```

## What it looks at

| Knowledge | Stale when | `--yes` does |
|---|---|---|
| `.ai-engineering-loop/learnings.json` | Every listed file is gone, or the lesson has not been seen in the last 20 Runs | Removes those entries and records them under `suppressed`. Other lessons stay. Ledgers are not re-mined. |
| `.ai-engineering-loop/feature-map.md` | Every path on a row matches no tracked file | Moves that row under `## Stale (garden)`. A row that still has a live path is only reported. The previous file is kept as `feature-map.md.ael-backup` the first time. |
| `runs/<id>/` | Unfinished and idle 7 days or more, or finished and 30 days or older | Nothing. Unfinished Runs are listed so a human can abandon one. Finished Runs stay on disk. |

`--garden` does not reconcile context. That remains `refresh` and `refresh --non-destructive`. Passing `--garden` together with `--non-destructive` is refused.
