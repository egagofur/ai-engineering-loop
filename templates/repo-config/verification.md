# Project Verification Commands

## Commands
- **test_unit**: `npm run test:unit`
- **test_all**: `npm run test`
- **typecheck**: `npx tsc --noEmit`
- **lint**: `npx eslint --fix`
- **build**: `npm run build`
- **e2e**: `npm run test:e2e` # Optional

## Default order

Run cheapest-first and stop at the first failure: build -> typecheck -> lint -> test_unit -> test_all -> security (`npm audit --omit=dev` or the stack's scanner) -> e2e (optional). `ai-engineering-loop verify` uses `test_unit` unless commands are passed with `--cmd`; pass `--serial` when one step depends on another.

## Verification Notes
- Unit test suite should complete within 30 seconds.
- Database integration tests require test container (`docker compose up -d postgres-test`).
