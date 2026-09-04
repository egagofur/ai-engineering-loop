---
name: dot-dev-workflow
description: DOT Stage 8 delivery after AI Engineering Loop Judge PASS. GitLab issue/MR, one topic-branch MR (extra env cherry-pick only if named this turn), Coreview triage, Mattermost. Not a substitute for ai-engineering-loop.
---

# DOT Delivery Workflow (Stage 8)

This is **not** the engineering OS. On DOT repositories:

1. Run **`ai-engineering-loop`** for Stages 0-7 (grill, RCA, Maker, verification, Devil's Advocate, Judge).
2. Run **this skill only after Judge `PASS`** (or the user explicitly asked to ship).
3. Stage 1 grill already includes `task-impact-inquiry`. Do not interview again.
4. Stages 6-7 are AEL DA + Judge. Do not re-run skill `devils-advocate` as a second pre-commit OS.

If `ai-engineering-loop` is missing on this host, say so and stop. Do not silently run the old 9-phase loop.

## Mapping (old phases → AEL)

| Old `dot-dev-workflow` | Now |
|---|---|
| Phase 1 RCA | AEL Stage 2 (`core/root-cause-analysis.md`) |
| Phase 2 impact inquiry | AEL Stage 1 grill + `task-impact-inquiry` |
| Phase 3-5 code / tests / tsc | AEL Stages 4-5 (`policies/tdd-policy.md`, `.ai-engineering-loop/verification.md`) |
| Phase 6 `devils-advocate` | AEL Stages 6-7 (Finding Ledger + Judge PASS/ITERATE/ESCALATE) |
| Phase 7-9 glab / Coreview / Mattermost | **This skill** (AEL Stage 8). Prefer `adapters/dot/` in the AEL package when present. |

`git commit`, `git push`, and `glab mr create` are forbidden until Judge `PASS`.

## DOT Maker constraints (AEL Stage 4)

While AEL Maker runs, still enforce:

- `backend-development` for naming, queries, layering.
- `backend-safety-guardrails` on mutations, jobs, recalculation: never bypass BullMQ; scope by entity id not coarse date strings; never overwrite `APPROVED`/`REJECTED` without explicit force; BigInt as string across boundaries; container moves sync old and new parents.
- Tests: commands in `.ai-engineering-loop/verification.md` (fallback `npx jest && npx tsc --noEmit`).
- Topic branch: if HEAD is already `feat/…` or `fix/…` for this feature, stay on that branch. Do not create a new topic branch. If HEAD is unrelated (`main`, `master`, `develop`, `staging`, other ticket), `git fetch origin`, then `git checkout -b type/descriptive-name origin/develop` when develop is in use (default branch is `develop`). Do not `git pull` into the current HEAD. HEAD being `main` does not override an in-use `develop` default. If develop is unused leftover (default branch is `main` / `master`), `git checkout -b type/descriptive-name origin/main` even if HEAD is `develop`. Do not force leftover develop.

Print these six invariants before commit (N/A allowed only with one sentence citing the diff):

- Queue: BullMQ not bypassed
- Granularity: entity id, not grouping strings
- BigInt: string in payloads, compare as BigInt
- Manual review: APPROVED/REJECTED not auto-reset
- Container move: old and new parents synced
- Hygiene: no unused locals or dead imports

---

## Stage 8a — Topic-branch MR and issue card (`glab`)

If the workspace has `adapters/dot/gitlab.md` and `adapters/dot/multi-branch.md`, follow those. Otherwise:

1. Commit:

```bash
git add <modified-files>
git commit -m "<type>(<scope>): <summary>"
```

2. Create a GitLab issue if none is linked (`glab issue create` with module title, scope checkboxes, `Steps to Reproduce & Testing (QA)` from `adapters/dot/gitlab.md`, expectation table, label `Ready to Test`). On a bugfix, do not leave those placeholders empty.

3. Open **one** MR (`glab mr create` onto the live integration base from the topic-branch rules above; description links the issue). Issue and MR descriptions must include `Steps to Reproduce & Testing (QA)` (reproduce + how to test). On a bugfix, do not leave those placeholders empty. Do not cherry-pick to `staging` or `develop` unless the user named those branches this turn. Chat `setuju` is not propagate. Do not open three MRs.

---

## Stage 8b — Coreview and MR discussions

Follow `adapters/dot/coreview.md` when present, plus `gitlab-mr-feedback` and `receiving-code-review`.

Gate before Mattermost: run `glab mr view <id> --comments` and print the triage. `comments: 0` is a printed empty triage, not a skip.

```text
Phase 8 Triage
MR: !<id>
Command: glab mr view <id> --comments
Comments: <n>
Valid: <list or none>
Halu: <list or none>
Action: <none | fix | reply>
```

Reply **inside** the Coreview discussion thread (not a top-level note):

```bash
glab api "projects/:fullpath/merge_requests/<mr-id>/discussions"
glab api "projects/:fullpath/merge_requests/<mr-id>/discussions/<discussion_id>/notes" -X POST -F "body=<text>"
```

- VALID: fix surgically, re-verify, commit, push to the same topic MR, reply with commit hash. Do not cherry-pick to `staging` or `develop` unless the user named those branches this turn. Chat `setuju` is not propagate.
- HALU: do not change code; reply with file-cited technical pushback.

---

## Stage 8c — Mattermost (`no-ai-slop`)

Follow `adapters/dot/mattermost.md` when present.

1. Resolve channel and PIC from `~/.gemini/config/mattermost-channel-mapping.json`. If PIC is missing, ask the user and save it.
2. Send via MCP `mattermost_send_message` with `from: "AI Agent"`. Use the Mattermost CLI only if MCP fails. Do not send twice.
3. Put `cc: <PIC>` on the last line.

Format (plain text, no markdown headings):

```text
[MR <ENV_TAG>] <MR_URL>
Changes log
- <active-voice change>
- <what the system now does>
- <regression protection>

cc: <PIC>
```

ENV tags: `[MR DEV]` develop, `[MR STAGING]` staging, `[MR MAIN]` / `[MR PROD]` main.

Forbidden: puffery (`secara komprehensif`, `robust`, `mengoptimalkan proses`), raw code/AST in the report.
