# Lower-ceremony, tamper-resistant loop: design

Date: 2026-10-20 · Status: approved by the user's "decide yourself" instruction · Branch: `claude/lower-ceremony-loop`

## Why

The user's main pain is that verification takes too long, although its result is accurate. Accuracy has to stay. The audit (2026-10-20) also found three other problems:

- **Ceremony:** a T0 typo takes about 18 agent calls.
- **Self-certification:** the Maker writes the Devil's Advocate ledger itself, so it can certify its own work.
- **Gaps between spec and code:** the iteration cap, no-progress detection, and learnings are in the spec but not in the code.

Measured on `dltx/backend-service` (NestJS + Jest, 448 suites, 3400 tests):

| Command | Time |
|---|---|
| Full unit suite, serial (`--runInBand`, the project default) | 111 s |
| Typical scoped runs (`jest src/modules/<x>`) | 6–45 s |
| `build` | 17–31 s |
| `tsc --noEmit` | 15–29 s |

Agents already scope tests by hand to stay fast, and that scope is never recorded or checked.

## Goals

1. Verification during iterations runs only the affected tests. The full suite runs at most once per final diff, and never again when the diff has not changed.
2. A T0 change takes about 4 calls: `quick start`, the edit, `quick finish`, `deliver`.
3. The Finding Ledger is bound to the reviewer's raw output. The Maker can no longer drop or flip findings silently.
4. The Judge can block with evidence. It is no longer a stamp that has to echo the deterministic verdict.
5. The iteration cap comes from the recipe, repeated findings escalate, and learnings are mined automatically and shown at run start.
6. The tier is chosen from paths first, and the spec contradictions are removed.

## Non-goals

- Splitting the bin or Studio monoliths. Those belong to the slim branch.
- Security hardening. That belongs to the hardening branch.
- Parallel Maker decomposition, a CI Action, and red-test (TDD) gates. These are follow-ups.

## Anti-goals

- Delivering a change that never ran the full configured suite against its final diff.
- Breaking existing runs, recipes, or artifacts: everything here is additive or defaults to the old behaviour.
- New runtime dependencies.

## Design

### 1. Verification lanes (main item)

- **`verify --related`:** runs the `test_related` command from `.ai-engineering-loop/verification.md`, for example ``- **test_related**: `yarn jest --findRelatedTests {files}` ``.
  - `{files}` expands to the changed, still-existing files in the gated Maker diff, outside `.ai-engineering-loop/`.
  - Records are tagged `scope: "related"`.
  - With no `test_related` line, the command fails with a hint. It never silently runs nothing.
- **`init`/`refresh` discovery:** writes `test_related` when Jest or Vitest is detected (`jest --findRelatedTests {files}` / `vitest related --run {files}`).
- **`verify --final`:** for a run in `JUDGED_PASS` whose verification was related-only.
  - Runs the default full command(s) and writes `final-verification.json`, bound to the same `diffHash` and `gitRevision`.
  - `gate delivery` requires that file, all green, when the gated verification contains only `scope: "related"` records.
  - Legacy records without `scope` count as full.
- **Skip when unchanged:** a passing record for the same `diffHash` + `gitRevision` + command in the bundle being written is reused rather than re-run. It is reported as `reused: true`, and `--fresh` forces a re-run.
  - The same rule applies to `--final`: when the gated verification already holds a passing full record for the identical diff, `--final` returns at once with `reused`.
- **Result for dltx (estimate):** iterations go from about 111 s + build + tsc to the related subset (typically 6–45 s). The full suite runs once at the end. *(Your call: the final lane is enforced at delivery rather than at the Judge, so the Judge stays cheap and the full run happens only on a diff that already passed review.)*

### 2. `ael quick` for T0

- **`quick start "<task>" [--mode assisted]`:**
  - Creates the run. It refuses unless the tier is T0, and then points to the normal flow.
  - Writes a Goal Contract derived from the task:
    - AC-1: "The change does exactly what the task says".
    - Evidence: the verify output and the diff.
    - Failure cases: files outside the task changed; the verification command fails.
  - Passes `gate goal`. Output: `runId`, next step.
- **`quick finish [--run] [--cmd ...]`:** runs `gate maker --from-git`.
  - If the tier rose above T0, it stops with `TIER_RAISED` and the next step for the normal flow.
  - Otherwise it runs `verify`, then auto-fills `claimed-vs-reality.md` from the diff's file list and the recorded commands:
    - Claimed: the files changed.
    - Reality: each command with its exit code and test counts.
  - It then runs `gate review` (empty T0 ledger) and `gate judge` (deterministic).
  - It finishes in `JUDGED_PASS` with the exact `deliver` command, which still needs human approval.
- *(Your call: `quick` never approves delivery. Human approval stays a separate, explicit step.)*

### 3. `review ingest`: the ledger bound to the child

- **`review ingest --run <id> --child-id <id> --file <child-output>`:**
  - Copies the raw child output to `RUN_DIR/review-raw.txt` and hashes it.
  - Extracts the ledger: the last fenced or bare JSON object with a `findings` array.
  - Fills `runId`/`diffHash`, sets `reviewer: { name: "devil-advocate", childId, rawSha256 }`, and writes `findings.json`.
  - Runs `gate review`, then `gate judge` when `judgeRequired` is false. That replaces the hand-normalize, gate review and gate judge calls with one call.
- **`gate review` binding check, when `reviewer.rawSha256` is present:**
  - `review-raw.txt` must hash to that value.
  - Every finding id in the raw ledger must still be in `findings.json`.
  - A finding whose `validity` or `severity` was downgraded relative to the raw ledger needs `dismissal: { by, evidence }`. Otherwise the gate fails with `LEDGER_TAMPERED`.
- **Unbound ledgers (no `rawSha256`) for T1/T2:**
  - Still accepted in ASSISTED, with `ledgerBinding: "UNBOUND"` in the gate output.
  - Rejected in UNATTENDED.
  - *(Your call: keeps existing ASSISTED flows working while making the bound path the cheapest one.)*
- **`goal freeze --confirm-impact`:** confirms the draft impact map in the same human stop, using the same `--by`. Freeze and impact confirmation become one human stop instead of two.

### 4. Judge can add blocking findings

- `verdict.json` may carry `judgeFindings[]`, which use the Finding Ledger schema.
- The Judge gate computes the expected verdict over `findings + judgeFindings`. A Judge can therefore turn a would-be PASS into ITERATE (or into ESCALATE at the cap) by adding a VALID BLOCKER/HIGH finding with evidence and `concreteAlternativeDiff`.
- It still cannot PASS what the deterministic rules block.

### 5. Iteration cap from the recipe

- `maxIterations` = the run workflow's engineering loop group `maxIterations` (the decision group containing the `judge` node), clamped to 1–5. With no workflow it defaults to 3.
- It is used by `gate judge`, by the deterministic verdict, by `judgeRequirement`, and by escalation.
- *(Your call: clamp to 5 per `iteration-policy.md`, even though loop-group schemas allow 100.)*

### 6. No-progress detection

- On every Judge verdict, append to `RUN_DIR/iterations.jsonl`: `{ iteration, diffHash, blockingSignatures[] }`.
  - A signature is `sha256(location + "\n" + normalized failureScenario)`.
- If an ITERATE verdict would repeat the previous iteration's non-empty blocking signature set, or the previous `diffHash`, the gate returns ESCALATE with the reason `NO_PROGRESS`.
  - A repeated `diffHash` means the Maker made no change.

### 7. Learnings fed back

- After a gate leaves the run `DELIVERED` or `ESCALATED`, the CLI runs `learn` itself, best effort; a failure only warns.
- `run --json` includes `learnings` (top 5, a 600-token budget, chosen by `selectLearnings` with the working-tree files).
- `quick start` prints them too.

### 8. Path-first tier

- When changed paths are known and all of them are doc paths, task words are ignored, so the result is T0. A doc-only change in "auth README" is T0.
- When no paths are known and the text has both a trivial and a risky word, the result is T1, not T2. The Maker diff can still raise it to T2.
- "bump" is trivial only when no dependency manifest or lockfile changed. A manifest diff is never T0.

### 9. Spec contradictions fixed

- **`tasks/current.diff`:** review-budget no longer asks for it; the pack or `diff.patch` is the source.
- **Report header:** the CONTEXT_ISOLATION_ONLY header no longer requires the forbidden word "subagent".
- **Severity vocabulary:** one vocabulary, BLOCKER/HIGH/MEDIUM/LOW. SEV-1 is documented as BLOCKER and SEV-2 as HIGH.
- **Lint:** `lint --fix` runs before `gate maker`, never after.
- **Iteration cap:** iteration-policy now matches what the code does.
- **Judge matrix:** the VALID MEDIUM + STRONG cell is defined as a non-blocking acceptable tradeoff.

## Builder notes

- Keep new logic in new modules (`lib/verification-lanes.js`, `lib/quick.js`, `lib/review-ingest.js`, `lib/no-progress.js`) with thin bin handlers. Other branches are rewriting bin, `run-state` and `verification-recorder`.
- Update the skill sources (`skill-src/`), then run `npm run build:skills`. Update `scripts/measure.js` so the T0 scenario uses `quick`.
