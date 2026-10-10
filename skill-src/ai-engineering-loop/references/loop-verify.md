# Stage 5: Verification

- One call: `npx ai-engineering-loop verify --run <runId> [--cmd "<command>"]...` (defaults to `test_unit` from `.ai-engineering-loop/verification.md`). It records each command in parallel (`--serial` for dependent commands), binds bounded, redacted evidence to the gated diff, and only when all pass runs `gate verification`, `context compact`, and scaffolds claimed-vs-reality. Shell syntax needs `--shell`.
- Long form (same gate): `verification record --run <runId> -- <executable> [args...]` per command, `gate verification`, `context compact --run <runId>`, `context claimed-vs-reality --run <runId>`.
- A failed command is recorded honestly and returns non-zero; it cannot pass the gate. Vague "seems green" is invalid.
- Fill `.ai-engineering-loop/tasks/claimed-vs-reality.md`: Claimed from the actual change, Reality from command output. Do not spawn DA while the file is missing or any Claimed row lacks Reality.
- Hand-authored artifacts: `scaffold verification|findings|delivery --run <runId>` writes an incomplete `.template.json`; edit it into the real artifact, remove `_templateOnly`, and `validate <repository-relative-file>`. Templates are never evidence.
- Pass run-summary.md and verification-summary.json to reviewers instead of raw logs.

## No claim without fresh evidence

Before saying "done", "fixed", "passing", or "ready", run the proving command in this iteration and cite its output; earlier runs and "should work" are not evidence.

| Claim | Required evidence |
|---|---|
| Tests pass | the test command's output this iteration, exit 0 |
| Bug fixed | the red repro now passes, with the command shown |
| AC met | its claimed-vs-reality row cites that output |

After `verify`, continue from run-summary.md and verification-summary.json, not earlier logs or chat.
