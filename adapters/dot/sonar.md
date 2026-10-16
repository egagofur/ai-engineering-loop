# DOT Adapter: Pipeline and Sonar Quality Gate

## 1. Purpose

After the MR exists, the MR pipeline and its Sonar quality gate must pass **before** Coreview triage closes, the card moves to "Ready to review", or Mattermost is sent. A green unit-test run on your machine is not a passed quality gate.

Use `glab` only. Do not paste tokens, Sonar URLs with tokens, or `SONAR_TOKEN` into prompts, commands, or notes.

---

## 2. Flow

```text
MR created (gitlab.md Step 3)
  -> wait for the MR pipeline to finish
     -> pipeline failed            -> FAIL (fix, push, wait again)
     -> pipeline passed
        -> Sonar result found      -> PASS | FAIL
        -> no Sonar on this repo   -> SKIPPED (say so; not PASS)
  -> FAIL: do not move the card, do not notify; loop back
  -> PASS or SKIPPED: continue to coreview.md
```

---

## 3. Step 1: Wait for the MR pipeline

```bash
glab ci status --branch <branch-name> --repo <repo>
glab ci view <branch-name> --repo <repo>        # interactive, optional
glab api "projects/:fullpath/merge_requests/<mr-iid>/pipelines"
```

Take the newest pipeline for the MR's head commit. `running` / `pending`: wait and check again. Do not report the gate while the pipeline is still running.

---

## 4. Step 2: Read the Sonar quality gate

Check both sources. Use whichever the project has.

**A. Sonar job in the pipeline** (for example `sonarqube-check`, `sonar`, any job whose name contains `sonar`):

```bash
glab api "projects/:fullpath/pipelines/<pipeline-id>/jobs"
glab ci trace <job-id> --repo <repo>
```

`failed` job, or a log line like `QUALITY GATE STATUS: FAILED` → FAIL. `success` with `QUALITY GATE STATUS: PASSED` → PASS.

**B. Sonar comment on the MR** (Sonar's MR decoration bot):

```bash
glab mr view <mr-iid> --comments --repo <repo>
```

The newest Sonar note for the current head commit decides: "Quality Gate passed" → PASS, "Quality Gate failed" → FAIL. An older note for an earlier commit does not count.

Neither source present → `SKIPPED (no Sonar on this project)`. Do not invent a PASS.

---

## 5. Step 3: Print the gate report (mandatory)

```text
Sonar Gate
MR: !<mr-iid>
Pipeline: #<pipeline-id> <passed|failed>
Source: <job <name> | MR comment | none>
Quality gate: <PASS | FAIL | SKIPPED>
New issues: <n or list, from the job log / comment>
Coverage on new code: <value or n/a>
Action: <none | fix>
```

---

## 6. On FAIL: loop back

1. List the new issues and the coverage gap from the job log or comment, with file paths.
2. Fix surgically on the same topic branch. Re-run the commands in `.ai-engineering-loop/verification.md`.
3. Commit and push to the same MR. Do not cherry-pick unless the user named extra envs this turn.
4. Go back to Step 1 and wait for the new pipeline.

While the gate is FAIL:

- Do **not** move the card to "Ready to review" (`gitlab.md` Step 4).
- Do **not** send Mattermost (`mattermost.md`).

If the fix would change the frozen Goal Contract's behavior, stop and ask the user. Do not widen scope to make Sonar green.
