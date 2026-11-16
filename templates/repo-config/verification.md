# Project Verification Commands

## Commands
- **test_unit**: `npm run test:unit`
- **test_all**: `npm run test`
- **typecheck**: `npx tsc --noEmit`
- **lint**: `npx eslint .`
- **build**: `npm run build`
- **e2e**: `npm run test:e2e` # Optional
- **smoke**: `npm run smoke` # Optional: start app, probe readiness, stop; runs when migrations/config/env/entrypoints change

## Default order

`ai-engineering-loop verify` without `--cmd` runs, cheapest first and stopping at the first failure: build -> typecheck -> lint -> promoted rules -> test_unit -> property. Commands that rewrite files (`--fix`, `--write`) are never run by default. `smoke` is added for startup-risky diffs, and any key an AC requires (`verify.key`) is added when it is configured here.

## Optional catalog keys

Add a line in the Commands list (bold key, backticked command) for each tool the project really has; AEL maps it to a layer and an AC can require it with `"verify": { "key": "<key>" }`.

| Key | Layer | Proves |
|---|---|---|
| `security` | L1 | dependency or static security scan (`npm audit --omit=dev`, semgrep) |
| `property` | L2 | property-based tests (runs in the default plan) |
| `fuzz` | L2 | fuzz tests |
| `mutation` | L2 | mutation tests: do the tests catch broken code? |
| `coverage` | L2 | coverage threshold |
| `benchmark` | L2 | benchmark or performance tests |
| `contract` | L3 | API or consumer contract tests |
| `pentest` | L3 | penetration or DAST scan |
| `formal` | LF | formal verification (TLA+, Lean, model checking); never in the default plan |

## Verification Notes
- Unit test suite should complete within 30 seconds.
- Database integration tests require test container (`docker compose up -d postgres-test`).
