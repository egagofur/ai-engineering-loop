# DOT Adapter: Topic branch, base, and optional propagate

## 1. Default: one topic branch, one MR

Do not open three MRs. Cherry-pick to `staging` or `develop` is opt-in (section 4).

### Related HEAD — stay

HEAD is related when the branch name is `feat/…` or `fix/…` (or the same ticket id) for **this** feature.

Stay on that branch. Do not create a new topic branch. Open **one MR** onto the branch it was cut from.

### Unrelated HEAD — new topic branch

HEAD is unrelated when it is `main`, `master`, `develop`, `staging`, or another ticket's branch.

Create a new `type/descriptive-name` branch from the live integration base (section 2). Then open **one MR** onto that base.

## 2. Pick the base

1. `git fetch origin`
2. Default branch: `git remote show origin` → `HEAD branch`.
3. Do not `git pull` into the current HEAD. Cut the topic branch from `origin/<base>` so local `main` / leftover `develop` stay untouched.

**`develop` is in use** only when the default branch is `develop`. Then always cut the new topic branch from `origin/develop`, even if HEAD is `main`, `staging`, or another ticket. HEAD being `main` does not override an in-use `develop` default:

```bash
git fetch origin
git checkout -b <type>/<descriptive-name> origin/develop
```

**`develop` is unused** (leftover) when the default branch is `main` / `master`, even if `origin/develop` exists and even if HEAD is `develop`. Do not force leftover develop:

```bash
git fetch origin
git checkout -b <type>/<descriptive-name> origin/main
```

(`master` if that is the default.)

## 3. Environments (names only)

These exist on many DOT remotes. They are **not** automatic MR targets.

1. **`main` / `master`** — production (`[MR MAIN]` / `[MR PROD]`).
2. **`staging`** — QA (`[MR STAGING]`).
3. **`develop`** — integration (`[MR DEV]`).

## 4. Optional propagate (this turn only)

Do not cherry-pick to `staging` or `develop` unless the user named those branches **this turn** (`propagate`, `3 branch`, `staging dan develop`, `multi-branch`). Chat `setuju` is not propagate. `.ai-engineering-loop/adapter.md` cannot turn this on by itself.

When asked, for each named extra target:

```bash
git fetch origin <target-env>
git checkout -b <branch-name>-<target-env> origin/<target-env>
git cherry-pick <commit-hash>
# commands from .ai-engineering-loop/verification.md
git push -u origin <branch-name>-<target-env>
glab mr create \
  --source-branch <branch-name>-<target-env> \
  --target-branch <target-env> \
  --title "<type>(<scope>): <short description>" \
  --description "<MR Description Markdown>" \
  --yes
```

Conflicts: resolve surgically, re-run verification, `git cherry-pick --continue`.
