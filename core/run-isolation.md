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

### Buckets (C-41, from pstack `worktree-audit`)

`worktree prune` prints `SIZE  AGE  BUCKET  RUN  WORKTREE`, biggest first:

| Bucket | Meaning | Removed? |
|---|---|---|
| `hold-wip` | changed or staged tracked files | never, by any flag |
| `hold-live-run` | its AEL Run was active in the last 15 minutes | no |
| `hold-open-pr` | the branch has an open pull request (`gh pr list`) | no |
| `review` | Run still unfinished but quiet | no; idle 7+ days is reported |
| `scratch` | Run finished, only untracked files left (build output, logs) | with `--include-scratch` |
| `safe` | Run finished, clean | yes |
| `foreign` | not created by AEL (`--audit` only) | never |

`--audit` adds every other git worktree of the repository as `foreign`, so you can see what fills the disk; prune still only touches registered worktrees.

## `pr status` (C-42, from pstack `watch-pr`)

`ai-engineering-loop pr status [--run <id> | --branch <name> | --pr <n>] [--json]` reads the pull request once through `gh pr view` (no polling) and returns `merged`, `closed`, `blocker`, `waiting` or `ready`. Blockers are named: `draft`, `merge-conflicts`, `failing-checks: <names>`, `changes-requested`. `waiting` lists pending checks or `review`. With `--run`, the branch comes from the worktree registry or `delivery.json`.

When the PR is merged, the Run gets `runs/<id>/merge.json` (PR number, URL, merged at, merge commit), written once. `worktree prune` then deletes a squash-merged branch on that evidence without calling `gh`; `stats` counts merged Runs and `recap` shows "merged N after delivery" per Run and a "Merged into main" metric for the lead.

Without `gh`, or with `gh` signed out, the command stops with `GH_UNAVAILABLE` and the command to fix it. Set `AEL_GH_BIN` to use another `gh` binary.

## `pr babysit` (after the PR is open)

`ai-engineering-loop pr babysit --run <id> [--json]` watches the pull request for that Run. Each look is a `pr status` read (same `gh pr view`, same `GH_UNAVAILABLE` when `gh` is missing or signed out). It polls with backoff while the verdict is `waiting`: 2s, 4s, 8s, 16s, then 30s, and at most 8 times.

| What you see | What babysit does |
|---|---|
| Failing checks, and the fix classifies as T0 or T1 | Starts a fix Run on that same branch and pushes it (`git push origin <branch>`). T0 and T1 come from the same classifier as `run`: the failing check names are the task text, and a dirty risky path raises the tier. The agent finishes that Run, then runs `pr babysit` again. |
| Failing checks that classify as T2 | Stops. A human takes a risky fix. |
| `ready` (ready to merge) | Stops and says so. You merge it. |
| `changes-requested` | Stops and says so, even when checks are also failing. |
| `merged`, `closed`, `draft`, or `merge-conflicts` with no failing checks | Stops and names the blocker. |
| This checkout is on a different branch | Stops and names the PR branch. It does not switch branches. |

The fix Run is recorded at `runs/<fix-id>/fix-pass.json` (`parentRunId`, `branch`, `tier`, `checks`). Calling babysit again while that Run is unfinished pushes the same branch and does not start a second Run.

Merge stays with the human. This command does not run `gh pr merge` or `git merge`.
