# Run isolation: one task, one checkout (2026-11-21)

Problem: a second agent session that calls `run "<another task>"` while a Run is unfinished silently resumes the other session's Run (the new task text is ignored). `run --new` starts a second Run in the same checkout, so `gate maker --from-git` captures both Runs' changes. Worktrees are the fix, and they need housekeeping so they do not pile up.

## C-37 · P1 · Detect a conflicting Run instead of resuming it
**Change:** `run "<task>"` with an unfinished current Run whose task differs returns `ok: false`, `code: RUN_CONFLICT` and `conflict: {runId, state, task, lastActivity, idleMinutes, live, changedFiles}` plus `options` with exact commands (resume, worktree, abandon). `live` = activity within 15 minutes (state update or lifecycle event). The same task, or no task, still resumes. The agent asks the human with the host's question UI and never picks.
**AC:** different task → RUN_CONFLICT with options and no new Run; same/no task → resume; abandoning a live Run needs `--force-live`.

## C-38 · P1 · `run --worktree "<task>"`
**Change:** creates `git worktree add -b ael/<slug>-<id> <repo>.ael-worktrees/<slug>-<id> HEAD`, copies the AEL context (not runs, recaps or pointers), starts the Run there, and records it in the main checkout's `.ai-engineering-loop/worktrees.json`. The other Run's uncommitted changes do not come along.
**AC:** new Run lives in the worktree; main checkout's current Run untouched; registry entry written.

## C-39 · P1 · Stage 9: cleanup after deliver
**Change:** after a successful `deliver` in a registered worktree: copy `runs/<id>` back to the main checkout (so stats, recap and calibrate keep the history); remove the worktree only when it has no uncommitted or untracked changes (commits stay on the branch); keep the branch until merged; print where to go back to. Unsafe cases keep the worktree and say why.
**AC:** clean → worktree removed, evidence in main checkout, branch kept; dirty → kept with reason, evidence still copied.

## C-40 · P2 · `ael worktree prune` and a status hint
**Change:** plan per registered worktree: delivered and merged → remove worktree and branch; cancelled and clean → remove worktree (evidence copied); dirty → keep and warn; active but idle over 7 days → report; missing folder → `git worktree prune`. Prints the plan; `--yes` applies it. Never removes uncommitted or unpushed work. `status` and `run` print one line when something can be cleaned. Only worktrees in the registry are touched.
**AC:** each row above behaves as stated; unregistered worktrees untouched; dirty never removed.
