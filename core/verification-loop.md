# Deterministic Verification Loop & Evidence Contract

## 1. Overview & Core Laws

The Verification Loop is the deterministic machine gate of the AI Engineering Loop:

> **"Code cannot enter Devil's Advocate review until it achieves 100% green machine verification backed by explicit, verifiable execution evidence."**

Maker reaches that green via [TDD Policy](../policies/tdd-policy.md): red at a named seam, then green. "We did TDD" without logs is not a PASS.

---

## 2. Verification Evidence Contract

A verification `PASS` is **strictly invalid** without concrete execution evidence. The system categorically rejects vague statements such as *"command was launched"* or *"test appears to have passed"*.

### Required Evidence Properties:
1. **`command`**: Exact shell string executed (e.g. `npm test -- --runInBand`).
2. **`executionIdentity`**: Process ID (PID), execution hash, or system execution identifier.
3. **`startTime` & `endTime`**: ISO timestamps documenting execution duration.
4. **`exitCode`**: Must be `0`. Any non-zero exit code immediately halts the gate.
5. **`stdout` & `stderr`**: Raw machine logs captured from execution.
6. **`timeoutStatus`**: Must be `"COMPLETED"` (not timed out or backgrounded without completion).
7. **`testCounts`**: Explicit counts of passed, failed, and skipped tests.
8. **`assertionEvidence`**: Specific assertion proof matching the active Goal Contract's Acceptance Criteria, observed at a named test seam. Must include a non-happy-path AC when the contract has a failure table. Coverage percent is not assertionEvidence.

```json
{
  "command": "npm test",
  "executionIdentity": "exec-d4f1a2",
  "startTime": "2026-08-25T10:00:00.000Z",
  "endTime": "2026-08-25T10:00:04.500Z",
  "exitCode": 0,
  "stdout": "PASS src/services/payment.test.ts (14 tests passed, 0 failed)",
  "stderr": "",
  "timeoutStatus": "COMPLETED",
  "testCounts": {
    "passed": 14,
    "failed": 0,
    "skipped": 0
  },
  "assertionEvidence": "AC-1: Lock payment row before update verified in test_concurrent_payment_locking"
}
```

## 3. Verification Layers & Command Mapping

Verification terminates through three explicit layers of evidence. Unit tests alone have systematic blind spots for cross-component and integration defects. An acceptance criterion crossing component boundaries requires Layer 3 verification or written justification if Layer 3 is unavailable.

| Layer | Scope | Configured Command (`verification.md`) | Purpose |
|---|---|---|---|
| **L1: Static / Syntax** | Syntax, static types, style, compilation | `typecheck`, `lint`, `build` | Fast static catch before runtime. Rejects type errors, lint regressions, and compilation breakage. |
| **L2: Behavioral / Runtime** | Functions, units, modules, regressions | `test_unit`, `test_related`, `test_all` | Fast behavioral feedback at named seams and regression verification. |
| **L3: End-to-End** | Cross-component flows, integrations, browser/API | `e2e` (optional) | Realistic integrated proof across boundary seams. |

Unit tests isolate and mock by design, which is exactly why they miss interface mismatches, state propagation errors, resource leaks, and environment dependencies between components.

| Tier | Required layers |
|---|---|
| T0 | L1-L2 (L3 when an AC is `crossComponent: true`) |
| T1 | L1-L2, plus L3 for every `crossComponent: true` AC |
| T2 | L1-L3 on every AC |

Enforcement (`lib/claimed-vs-reality.js`, `gate review`):
- The Layer cell accepts `L1`, `L2`, `L3`, combos such as `L2+L3`, and `L3 waived: <reason>` (at least 15 characters). Unknown tokens fail the gate.
- An AC that needs L3 without L3 or a reasoned waiver fails `gate review` on every tier, with a FIX line that says what to run.
- Legacy 3-column files stay valid when no AC needs L3.
- Tags are bound to recorded evidence (C-01): `L1` needs a passing L1 command in `verification.json`/`final-verification.json`; `L3` needs a passing `e2e` command, or Reality that describes a manual end-to-end flow (steps, URL, screenshot path). Commands not mapped in `verification.md` count as L2. Waivers need no command.
- When `e2e` is empty in `verification.md`, run the AC's real user flow and cite the observation, or write the waiver. Devil's Advocate and Judge challenge waivers like any other claim.

---

## 3a. Baseline and Default Plan

**Baseline (C-10).** After the Goal gate and before the Maker gate, `verify --baseline --run <id>` runs the default plan on the untouched tree and writes `runs/<id>/baseline.json` with status `GREEN`, `RED`, or `BROKEN`.
- `BROKEN` (a command exits 127, i.e. it does not exist): the command fails with a FIX to correct `verification.md`. Verification cannot prove anything with a broken command.
- `RED`: the tree was already failing. Later, when `verify` fails, each failing command is labelled `pre-existing` (every failing test name was already failing at baseline) or new. Unnamed failures are always treated as new. The gate still blocks; the label tells the Maker whether the change caused it.

**Default plan (C-02).** `verify` without `--cmd` runs `build -> typecheck -> lint -> test_unit` (whichever are configured), serially, and stops at the first failure. Commands that rewrite files (`--fix`, `--write`) are never run by default. Each record carries its layer (`L1`/`L2`/`L3`).

**Verification catalog (C-23).** AEL does not ship test tools; it recognises the ones a project has. Any of these keys in `verification.md` is mapped to a layer and recorded with it: `security` (L1); `property`, `fuzz`, `mutation`, `coverage`, `benchmark` (L2); `contract`, `pentest` (L3); `formal` (LF, a separate layer for model checking and proofs). Only `property` joins the default plan (after `test_unit`); the rest run when an AC requires them with `"verify": { "key": "<key>" }` (or `"layer": "LF"`), or with `--cmd`. `gate judge` refuses PASS until each required key passed on the gated diff (`AC_NOT_PROVEN`). Claimed-vs-reality accepts `LF` as a Layer tag. Testing in production (canary, shadowing, monitoring) stays outside AEL; its outcomes come back through `outcome record` (C-13).

**Feature map (C-22).** Optional `.ai-engineering-loop/feature-map.md` is a site map of what users can do, one Markdown table: `| Feature | Where (UI or endpoint) | Paths (globs) | How to reach | Driver |`. `review-pack` appends the entries whose `Paths` the diff touches, so the Devil's Advocate and L3 evidence use the same names ("export-csv", not "the button on the left"). `Driver` is an optional reusable command that runs the flow (cheaper and more repeatable than an agent clicking around). `doctor --harness` warns when `e2e` or `smoke` is configured but the map is empty.

**L1 at T1/T2.** When `verification.md` configures `typecheck` or `lint`, the verification gate at T1/T2 refuses a full-scope bundle with no L1 record (`L1_MISSING`). The related lane is exempt; `verify --final` runs the full plan.

`init` writes only commands the project really has: `typecheck` from a script or a TypeScript setup, `lint` and `build` only from package scripts.

**Smoke (C-03).** An optional `smoke` key in `verification.md` is a command that starts the app, probes readiness (a health URL, a golden journey), stops it, and exits. It counts as L2. When the gated diff touches startup-risky files (migrations, `.env*`, `config/`, `*.config.*`, Docker/Procfile, `main|index|server|app` entrypoints, dependency manifests), default `verify` runs it after `test_unit`, and the verification gate fails with `SMOKE_MISSING` when it did not run. A smoke command that times out or exits non-zero blocks the gate; on timeout the recorder kills its process group.

## 3b. Verification Integrity (C-11)

At `gate review` the CLI scans the gated diff and adds `source: "verification-integrity"` findings (HIGH; BLOCKER at T2, VALID, with a concrete fix) for:
- a skip/only/todo marker added in a test file (`it.skip`, `xit`, `fit`, `@Disabled`, `pytest.mark.skip`, `t.Skip`, ...);
- a test file deleted without a replacement test in the same directory;
- assertions removed from a test file without replacement;
- a change to verification config (`.ai-engineering-loop/verification.md`, jest/vitest/playwright/cypress config, `pytest.ini`, coverage config) that the frozen Goal Contract does not name.

These findings cannot be dropped or downgraded by the reviewer. Only a human dismissal (`dismissal: {by, evidence}`) can downgrade them; otherwise the review gate fails.

## 3c. Justification Comments and Suppressions (C-18)

Agents write comments to justify not doing the right thing, and comments cannot be enforced. At `gate review` the CLI scans comments added in non-test product files and adds `source: "comment-justification"` findings (`axis: "standards"`):
- a suppression (`eslint-disable*`, `@ts-ignore`, `@ts-expect-error`, `# type: ignore`, `# noqa`, `//nolint`, `NOSONAR`, `istanbul/c8 ignore`): **HIGH** without a reason, **MEDIUM** with one (eslint `-- reason`, or text after the directive);
- a comment that justifies a workaround (`workaround`, `quick fix`, `hack`, `temporary`, `for now`, `band-aid`, `fix later`, ...): **MEDIUM**. Projects add patterns in `.ai-engineering-loop/rules.json` as `"justificationPatterns": ["<regex>"]`.

Docs, changelogs, data files and tests are skipped. Unlike C-11, a reviewer may downgrade these with `dismissal: {by, evidence}` (for example generated code); dropping or downgrading one without evidence fails the review gate.

## 4. The 4 Verification Gates

1. **Gate 1: Unit & Integration Tests**: All unit and edge-case tests must pass with 0 failures.
2. **Gate 2: Static Type Analysis**: `tsc --noEmit` or compiler type checking must exit with code `0` (zero type errors).
3. **Gate 3: Linter Analysis**: Linter rules must pass cleanly with 0 errors on modified files.
4. **Gate 4: Production Build**: The build command (`npm run build`, `go build`, `cargo build`) must produce a clean compile.

---

## 5. Rejection Triggers

The Verification Gate immediately halts and returns to the Maker if:
- Any test suite fails or times out.
- Exit code is non-zero.
- The command was sent to the background and not verified to completion.
- Test logs contain zero passing assertions for new acceptance criteria.
- assertionEvidence maps only to a happy path while the Goal Contract lists empty, boundary, sibling, or error AC rows.
- The only new "test" is a source grep or a coverage percentage.

---

## 6. Claimed vs Reality (before Devil's Advocate)

Write `.ai-engineering-loop/tasks/claimed-vs-reality.md` after verification logs exist:

```bash
npx ai-engineering-loop context claimed-vs-reality --run <run-id>
```

This scaffolds one row per frozen acceptance criterion but leaves Claimed, Reality, and Layer empty. Fill them from the implemented change and actual command output; the scaffold is not verification evidence.

```markdown
# Claimed vs Reality

| AC | Claimed | Reality from command log | Layer |
|---|---|---|---|
| AC-1 | <what Maker said is done> | <command, exit code, assertion or log line> | L2 |
```

Do **not** spawn Devil's Advocate if:

- the file is missing
- the table has zero rows
- any Claimed row has empty Reality
- Reality is only `seems green`

Parser: `lib/claimed-vs-reality.js` (`readyForDa`). Pass that path to DA/Judge with the verification log.

## 7. Clean State at Delivery (C-06)

`gate delivery` also checks that the next session starts from a tree it can trust:
- **Always blocks:** a `debugger` statement, merge-conflict marker or interactive breakpoint added by the change; a secret-like file in the change (`.env`, `.env.local`, keys; `.env.example` is fine); a `_templateOnly` scaffold left in the Run directory or `.ai-engineering-loop/tasks/`.
- **Untracked files that are not part of the reviewed diff** (logs, coverage, scratch files): block in UNATTENDED, warn in ASSISTED. Warnings are printed and kept in the Run history as `cleanStateWarnings`.

## 8. Debt Ledger (C-14)

At `gate delivery` the CLI copies two kinds of deferred work into `.ai-engineering-loop/debt.json` (tracked in git, like `learnings.json`):
- VALID `MEDIUM`/`LOW` findings the Judge accepted as trade-offs (file, scenario, risk, "revisit on the next change touching <file>");
- claimed-vs-reality rows with `L3 waived: <reason>` ("revisit when an e2e command exists").

`review-pack` appends open debt on the files the new diff touches to the Devil's Advocate pack and lists it. `ael debt` lists open items (`--file <path>`); `ael debt close <id> --by <name> [--note <text>]` closes one.

## 9. Reviewer Inputs Are Logged (C-16)

"Model-visible means logged": `review-pack` writes `runs/<id>/review-inputs.json` with the sha256 of the review pack, the gated diff, and the Devil's Advocate prompt body. `review ingest` copies them into `findings.json` (`reviewer.inputs`, `reviewer.promptSha256`). `gate review` fails the ledger binding when any recorded input changed after the reviewer saw it, so a missed defect can always be traced to exactly what the reviewer was shown.

## 10. Reviewer Calibration (C-13)

Gates prove the change matches the Goal; only reality proves the reviewers were right. After delivery, record problems people found:

```
ael outcome record --run <id> --source mr-comment|revert|bug|incident --location <file[:line]> --summary <text> --by <name> [--evidence <path|url>]
ael calibrate [--json]
```

`calibrate` compares each outcome with that Run's Finding Ledger: `DA_MISS` (no finding on that file), `FALSE_DISMISS` (a finding on that file was marked INVALID or dismissed), `CAUGHT_BUT_SHIPPED` (a VALID finding was accepted as a trade-off). Results are grouped by the reviewer prompt hash (C-16), so after you tighten `agents/shared/devil-advocate.body.md` for a recurring miss you can see whether the next prompt version misses less. Plan for several tuning rounds; record each prompt change in its commit message.

## 11. Promoting Review Feedback to Rules (C-05)

`learn` lists **promotion candidates**: learnings seen in 3 or more Runs. A human turns one into an executable check:

```
ael learn promote L-abc123 --check "! grep -rq \"require('fs')\" src/renderer" --fix "Move file access to src/preload/file-ops.ts and call window.api" --by <name> [--why <text>]
```

Rules live in `.ai-engineering-loop/rules.json` (tracked). Default `verify` runs every rule as an L1 check after the static checks; a violation prints `Rule <id> violated. WHY: ... FIX: ...`. The verification gate refuses a full-scope bundle in which any rule has no passing record (`RULES_MISSING`). The check must exit non-zero on a violation and is run through the shell unless `--no-shell` is given.

**Ratchet rules (C-17).** `--scope diff` judges only what the change adds, so a rule can be promoted on a codebase that still has old violations. Its check receives `AEL_CHANGED_FILES` (one path per line) and `AEL_ADDED_LINES_FILE` (`path:line:text` for every added line, the `grep -n` format), for example `! grep -E "useEffect\(" "$AEL_ADDED_LINES_FILE"` (POSIX shell) or a small Node script for Windows. New occurrences fail with their `file:line`; old ones do not. `doctor --harness` runs each diff rule against every tracked line and reports the remaining legacy backlog, and says when it is clean enough to switch the rule to `--scope repo`.

**Built-in rule kinds (C-20).** The two most common corrections need no hand-written check:
- `--forbid-import "<fromGlob> -> <toGlob>"`: files under `fromGlob` may not import modules under `toGlob`. Relative specifiers are resolved against the importing file (with common extensions); bare names such as `fs` or `react` match as written, so `"src/renderer/** -> fs"` forbids Node's `fs` in the renderer.
- `--forbid-api "<regex>" [--except "<glob>"]`: the API may appear only inside the excepted paths, for example `useEffect` only in `src/framework/**`.

Both are stored with `kind`, always use `scope: "diff"`, and run as `rules check <ruleId>` through the same CLI (so `rules.json` holds no machine-specific path). Violations print as `file:line: <message>` and the rule's FIX.

