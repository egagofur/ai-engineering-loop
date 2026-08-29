# GitHub delivery adapter

Stage 8 after Judge `PASS` on GitHub-hosted repos.

This is not the engineering OS. Do not run Maker. Do not skip Devil's Advocate or Judge.

Requires `gh` authenticated to the current remote. If `gh` is missing, fall back to [`../standard/`](../standard/) and print the compare URL.

## Steps

1. Re-run `.ai-engineering-loop/verification.md` if the log is stale.
2. Commit the surgical diff. Push the topic branch. Never push the default branch.

```bash
git push -u origin HEAD
```

3. Optional issue if none is linked (branch name, `Fixes #n`, or `gh issue list`):

```bash
gh issue create --title "<summary>" --body "<Goal Contract path and AC list>"
```

4. Open the pull request. Follow [`pull-request.md`](pull-request.md).

5. Extra branches, review bots, and chat are **off** unless `.ai-engineering-loop/adapter.md` names them. Do not invent Actions secrets or Slack webhooks.

6. Stop. The human merges on GitHub.
