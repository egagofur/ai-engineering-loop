# Goal Contract: Payment Idempotency & Concurrency Lock

## 1. Objective
Eliminate double-spending and balance corruption in the `payment-service` by enforcing mandatory `Idempotency-Key` headers, database transaction isolation, and row-level wallet locks.

## 2. Business Outcome & User Lifecycle Impact
- **Customers**: Guaranteed never to be charged twice for identical checkout operations regardless of network retries or multiple clicks.
- **Finance**: 100% auditability and balance ledger integrity.

## 3. Acceptance Criteria (AC)
- [ ] **AC-1**: Reject `POST /api/v1/payments/charge` with HTTP 400 if `Idempotency-Key` header is missing or empty.
- [ ] **AC-2**: Idempotency records stored atomically with 24-hour expiration window. Duplicate requests return cached original response with `X-Cache: HIT`.
- [ ] **AC-3**: User wallet balance updates serialized via `SELECT balance, version FROM wallets WHERE id = $1 FOR UPDATE`.
- [ ] **AC-4**: Zero race conditions detected under 50 simultaneous parallel requests.

## 4. Technical Constraints
- Maintain Go 1.22 standard library and `github.com/jackc/pgx/v5`.
- No distributed Redis locks unless DB transactions prove insufficient.
- Zero breaking changes to response JSON schemas.

## 5. Out of Scope
- Modifying refund or settlement batch jobs.

## 6. Verification Requirements
- **Unit & Race Tests**: `go test -race -v -count=1 ./internal/payment/...`
- **Lint**: `golangci-lint run ./...`
- **Build**: `go build -o /dev/null ./cmd/server`

## 7. Definition of Done (DoD)
- [ ] AC-1 through AC-4 verified via automated race test suites.
- [ ] Deterministic verification 100% green.
- [ ] Devil's Advocate review conducted with 0 open SEV-1/2 findings.
- [ ] Judge issues PASS verdict.
