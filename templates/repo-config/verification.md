# Project Verification Commands

## Commands
- **test_unit**: `npm run test:unit`
- **test_all**: `npm run test`
- **typecheck**: `npx tsc --noEmit`
- **lint**: `npx eslint --fix`
- **build**: `npm run build`
- **e2e**: `npm run test:e2e` # Optional

## Verification Notes
- Unit test suite should complete within 30 seconds.
- Database integration tests require test container (`docker compose up -d postgres-test`).
