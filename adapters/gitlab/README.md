# GitLab delivery adapter

Stage 8 after Judge `PASS` on GitLab.com or self-hosted GitLab.

This is the **generic** GitLab adapter. It is not the DOT adapter. Do not load `adapters/dot/`. No extra environment cherry-picks unless `.ai-engineering-loop/adapter.md` lists those branches.

Requires `glab` authenticated to the current remote. If `glab` is missing, fall back to [`../standard/`](../standard/) and print the branch name.

## Steps

1. Re-run `.ai-engineering-loop/verification.md` if the log is stale.
2. Commit the surgical diff. Push the topic branch. Never push the default branch.

```bash
git push -u origin HEAD
```

3. Optional issue if none is linked:

```bash
glab issue create --title "<summary>" --description "<Goal Contract path and AC list>" --yes
```

4. Open the merge request. Follow [`merge-request.md`](merge-request.md).

5. Extra environments and chat notifications stay off unless `adapter.md` lists them.

6. Stop. The human merges on GitLab.
