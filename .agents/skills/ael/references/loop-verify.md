# Stage 5: Verification

- `npx ai-engineering-loop verify --run <runId> [--cmd "<command>"]...` (default `test_unit` from verification.md) runs commands in parallel (`--serial`, `--shell`), binds redacted evidence to the gated diff, and on pass compacts and scaffolds claimed-vs-reality.
- Iterating (T1/T2): `verify --related` runs `test_related` on changed files. After Judge PASS, `verify --final` runs the full suite once before delivery. Unchanged diff reuses passes (`--fresh` re-runs).
- Failed commands return non-zero and block the gate. Vague "seems green" is invalid.
- Fill `.ai-engineering-loop/tasks/claimed-vs-reality.md`: Claimed from change, Reality from command output, optional Layer (`L1`, `L2`, `L3`). Multi-component ACs need L3 evidence or justification if `e2e` is unconfigured. Never spawn DA if file is missing or any row lacks Reality.
- Hand-authored artifacts: `scaffold verification|findings|delivery --run <runId>`, fill, remove `_templateOnly`, then `validate <file>`.
- Pass run-summary.md and verification-summary.json to reviewers instead of raw logs.

## Verification Layers & Command Mapping

| Layer | Scope | Command (`verification.md`) | Focus |
|---|---|---|---|
| **L1** | Static | `typecheck`, `lint`, `build` | Types, lint, build |
| **L2** | Runtime | `test_unit`, `test_related`, `test_all` | Unit and regression tests |
| **L3** | End-to-End | `e2e` (optional) | Integrated boundary proof |

## No claim without fresh evidence

Before claiming "done", "fixed", "passing", or "ready", run the proving command this iteration; earlier runs and "should work" are not evidence.

| Claim | Required evidence |
|---|---|
| Tests pass | test output this iteration, exit 0 |
| Bug fixed | passing red repro, command shown |
| AC met | claimed-vs-reality cites output |

After `verify`, continue from run-summary.md and verification-summary.json.
