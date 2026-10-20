# Stage 5: Verification

- `npx ai-engineering-loop verify --run <runId> [--cmd "<command>"]...` (default `test_unit` from verification.md) records commands in parallel (`--serial`, `--shell`), binds redacted evidence to the gated diff, and only when all pass gates verification, compacts, and scaffolds claimed-vs-reality.
- Iterating (T1/T2): `verify --related` runs `test_related` on the diff's changed files. After Judge PASS, `verify --final` runs the full suite once; delivery requires it after related-only runs. Unchanged diff: passes are reused (`--fresh` re-runs).
- A failed command is recorded honestly and returns non-zero; it cannot pass the gate. Vague "seems green" is invalid.
- Fill `.ai-engineering-loop/tasks/claimed-vs-reality.md`: Claimed from the actual change, Reality from command output. Do not spawn DA while the file is missing or any Claimed row lacks Reality.
- Hand-authored artifacts: `scaffold verification|findings|delivery --run <runId>`, fill it, remove `_templateOnly`, then `validate <file>`. Templates are never evidence.
- Pass run-summary.md and verification-summary.json to reviewers instead of raw logs.

## No claim without fresh evidence

Before saying "done", "fixed", "passing", or "ready", run the proving command in this iteration and cite its output; earlier runs and "should work" are not evidence.

| Claim | Required evidence |
|---|---|
| Tests pass | the test command's output this iteration, exit 0 |
| Bug fixed | the red repro now passes, with the command shown |
| AC met | its claimed-vs-reality row cites that output |

After `verify`, continue from run-summary.md and verification-summary.json, not earlier logs or chat.
