# From pstack's scripts (2026-11-21)

Source: [cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT, poteto), `skills/poteto-mode/scripts/worktree-audit.sh` and `skills/poteto-mode/scripts/watch-pr/`. pstack has no single CLI; these two scripts are the parts worth adapting. AEL stays dependency-free: plain Node plus `git` and, when present, `gh`.

## C-41 · P2 · Worktree audit buckets for `worktree prune`

**Source:** `worktree-audit.sh`: a read-only table per worktree (size, age, merged, dirty, remote, PR, last agent chat) sorted by size, with a suggested bucket (`hold-wip`, `hold-open-pr`, `verify-recent-chat`, `safe`, `review`). Deletion stays human-gated.

**Now:** `worktree prune` (C-40) treats any untracked file as dirty, so a worktree holding only build leftovers is never cleaned. It ignores an open PR. It shows no size, and it lists only worktrees AEL registered.

**Change:**
1. Split dirty into `wip` (tracked changes or staged files: always kept) and `scratch` (untracked files only: removable with `--include-scratch`, listed by count).
2. Hold a worktree whose branch has an open PR (`gh pr list --head <branch> --state open`), even when clean.
3. Add size (bytes on disk, excluding `.git`) and age (last commit or file change) per row; sort the plan by size so the biggest wins come first.
4. `worktree prune --audit` prints the table for every git worktree of the repo, including ones AEL did not create, marked `foreign`. Removal still applies only to registered worktrees.
5. Each row gets a bucket: `hold-wip`, `hold-open-pr`, `hold-live-run` (AEL Run active in the last 15 minutes), `safe`, `scratch`, `review`.

**AC:**
- A worktree with only untracked files is `scratch`; it is kept by default and removed with `--include-scratch`.
- A clean worktree with an open PR is `hold-open-pr` and never removed.
- `--audit` lists a foreign worktree with size and bucket and `--yes` does not touch it.
- `wip` is never removed by any flag.

**Effort:** S.

## C-42 · P2 · `ael pr status`: close the loop after delivery

**Source:** `watch-pr`: watches a PR or a stack until merge-ready; verdicts `waiting`, `blocker` (merge conflicts, unresolved review threads, failing checks, draft, merge gate), `ready`, `merged`; JSON by default, `--status-only` for one snapshot.

**Now:** after `deliver`, AEL does not know what happened to the PR. "Delivered" is not "merged". Squash-merged branches are detected only when `gh` happens to be present during prune. Claude Desktop's Auto-fix watches PRs, but other hosts (Cursor, Codex, Antigravity) have nothing.

**Change:**
1. `ael pr status [--run <id> | --branch <name> | --pr <n>] [--json]`: one read-only snapshot through `gh pr view`, no polling. Verdict `waiting | blocker | ready | merged | closed` with blockers named (`merge-conflicts`, `failing-checks: <names>`, `review-threads: <n>`, `draft`, `changes-requested`).
2. The PR for a Run comes from `delivery.json` (`destination` branch) or the worktree registry branch.
3. On `merged`, record it in the Run (`runs/<id>/merge.json`: PR number, merged at, merge commit) so `worktree prune` deletes the branch on evidence, and `stats` / `recap` report merged separately from delivered, plus time from delivery to merge.
4. No `gh`, or `gh` not signed in: exit with a clear message and the command to run; never guess.

**AC:**
- Each verdict and blocker is derived from a recorded `gh` JSON fixture (no network in tests).
- A merged PR writes `merge.json` once; running again does not duplicate it.
- `worktree prune` deletes a squash-merged branch when `merge.json` says merged, without calling `gh`.
- `recap` shows "merged" and median delivery-to-merge time when the data exists.

**Effort:** M.

## Not adopted

- `show-me-your-work/log.sh` (TSV decision log): `lifecycle.jsonl` already records decisions. Its spreadsheet-formula guard (prefix cells starting with `=`, `+`, `-`, `@`) applies if AEL ever exports CSV/TSV.
- `bootstrap.ts` (dependency auto-install by lockfile hash): AEL has no dependencies.
- `automations/benny` (Slack triage, repro, draft fix): Cursor- and Slack-specific.
- `generate-pstack-harness-trees.mjs`, `check-pstack-docs.mjs`: AEL already has `build:skills` and `check:skills`.
