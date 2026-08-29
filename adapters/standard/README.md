# Standard delivery adapter

General Stage 8 for any git project. No GitHub, GitLab, Slack, or company bot is required.

Use this when the remote is unknown, the human merges by hand, or you have not generated a forge-specific adapter yet.

## Hard gate

Do not commit, push, or open a change request until Judge `PASS`.

If `.ai-engineering-loop/adapter.md` names a more specific type (`github`, `gitlab`, `dot`), follow that spec instead.

## Steps

1. Read `.ai-engineering-loop/verification.md`. Re-run those commands if the last log is stale. Keep exit codes.
2. Commit only the surgical diff for this Goal Contract.

```bash
git status
git diff
git add <modified-files>
git commit -m "<type>(<scope>): <summary>"
```

3. Push the topic branch. Do not push to `main` / `master` / the default branch.

```bash
git push -u origin HEAD
```

4. Open a change request **with the tool that already exists**, or stop and give the human the compare URL:
   - `gh pr create` if GitHub and `gh` works
   - `glab mr create` if GitLab and `glab` works
   - otherwise print `git remote -v` and the branch name; the human opens the PR/MR
5. Do not cherry-pick to extra environments unless `adapter.md` lists those branches.
6. Do not send chat notifications unless `adapter.md` names a channel and a tool. Never invent a webhook or token.
7. Stop. Merge is a human action unless the user already said to merge.

## Best practice

- One branch, one change request, default branch only.
- Link the Goal Contract path in the PR/MR body (not the whole chat).
- No secrets, no internal hostnames, no coworker handles in the description.
- If the forge CLI is missing, do not install it silently. Tell the user.
