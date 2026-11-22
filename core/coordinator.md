# Coordinating agents

AEL does not start agents, rank them, or pass work between them. The human starts each agent in the host they already use. Every host runs the same commands.

## One checkout, one unfinished Run

A second task in the same checkout returns `RUN_CONFLICT` (exit 3). The human chooses a worktree, resume, or abandon. The agent does not choose. See `docs run-isolation`.

## More than one agent

Each extra task gets its own worktree:

```bash
npx ai-engineering-loop run --worktree "<task>"
```

Work only in the printed path. Do not edit another agent's worktree. Do not merge another agent's branch.

## Stacked pull requests

The human names the branch the next task sits on. That branch is a commit already in this repository. AEL does not fetch.

```bash
npx ai-engineering-loop run --worktree --base <branch> "<task>"
```

This creates `ael/<slug>-<id>` from `<branch>` and records `baseRef` on the worktree. `--base` without `--worktree` is refused, because switching the current checkout would mix Runs.

The human orders the stack and merges it. An agent does not merge.

## What this is not

No coordinator process. No host-specific queue. No second model and no arena. The same commands work in every host.
