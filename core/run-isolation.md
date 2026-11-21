# Run isolation: one task, one checkout

Two agent sessions in one checkout corrupt each other: `gate maker --from-git` captures every uncommitted change, so a second task's diff would include the first task's work. AEL keeps one unfinished Run per checkout and moves other tasks into git worktrees (cards C-37 to C-40).

## When another Run is unfinished (C-37)

`run "<task>"` with an unfinished current Run whose task differs (case and spacing ignored) does not start or resume anything. It exits 3 with `code: RUN_CONFLICT` and:

```json
"conflict": {
  "runId": "...", "state": "MAKER_COMPLETE", "task": "...",
  "lastActivity": "2026-11-21T03:10:00.000Z", "idleMinutes": 4, "live": true,
  "changedFiles": 9, "recommended": "worktree",
  "options": [
    { "id": "worktree", "command": "ai-engineering-loop run --worktree --json \"<task>\"" },
    { "id": "resume",   "command": "ai-engineering-loop run --json" },
    { "id": "abandon",  "command": "ai-engineering-loop run --abandon --run <id> --reason \"<why>\" --by <name> --force-live" }
  ]
}
```

- `live` means the Run changed state or logged a lifecycle event in the last 15 minutes, so another session is probably working on it.
- `recommended` is `worktree` when the Run is live or the checkout has uncommitted changes, otherwise `abandon`.
- The agent shows the options with the host's question UI and waits. It never picks one.
- The same task, or no task, still resumes the Run.
- `run --abandon` on a live Run needs `--force-live`.

## `run --worktree "<task>"` (C-38)

Creates `<repo>.ael-worktrees/<slug>-<id>` next to the repository on branch `ael/<slug>-<id>`, from `HEAD` (uncommitted changes of the other Run stay behind), copies the AEL context files (not `runs/`, `recaps/`, `tasks/` or pointers), starts the Run there, and records it in `.ai-engineering-loop/worktrees.json` of the main checkout. `--mode`, `--recipe`, `--tier` and `--tier-reason` pass through. Work only in the printed path for that Run.

## Stage 9: cleanup after deliver (C-39)

When `deliver` completes a Run inside a registered worktree:

1. `runs/<id>/` is copied to the main checkout, so `stats`, `recap` and `calibrate` keep the history.
2. If the worktree has no uncommitted or untracked changes (outside `.ai-engineering-loop/`), it is removed. Commits stay on the branch.
3. The branch is kept until it is merged.
4. The output's `cleanup.mainCheckout` is where the agent continues.

A dirty worktree is kept, with the reason in `cleanup.keptReason`.

## `worktree prune` (C-40)

`ai-engineering-loop worktree prune` prints a plan; `--yes` applies it. Only worktrees in the registry are considered.

| Worktree | Action |
|---|---|
| Run delivered, cancelled or escalated, worktree clean | remove the worktree (evidence copied first) |
| Branch merged into the default branch (or a merged PR, when `gh` is available) and worktree gone | delete the branch |
| Uncommitted or untracked changes | kept, with a note |
| Run still active and idle for 7+ days | reported, so a human can abandon it there |
| Folder already deleted by hand | `git worktree prune`, entry closed |

Uncommitted or unmerged work is never removed. `status` and `run` print one line when something can be cleaned up.
