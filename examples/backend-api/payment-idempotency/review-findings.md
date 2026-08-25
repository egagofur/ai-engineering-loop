# Adversarial Review Findings: Payment Idempotency

## 1. Review Summary
- **Reviewer**: Devil's Advocate Agent (Profile: `backend-api`)
- **Active Review Domains**: Auth, Database Transactions, Concurrency/Race, N+1, API Contracts
- **Total Findings**: 1
- **Blocking (SEV-1/2)**: 1

---

## 2. Findings Ledger

### Finding CONC-001: Missing transaction rollback when external payment gateway times out
- **Severity**: `CRITICAL` (SEV-1)
- **Category**: `Concurrency & Error Handling`
- **Location**: `internal/payment/service.go:88-102`
- **Evidence**:
  ```go
  tx, _ := s.db.Begin(ctx)
  wallet.Deduct(amount)
  resp, err := s.gatewayClient.Charge(ctx, req)
  if err != nil {
      return nil, err // Exits without tx.Rollback(ctx)
  }
  tx.Commit(ctx)
  ```
- **Problem**:
  If the external payment gateway call returns a timeout or network error, the function exits early without invoking `tx.Rollback(ctx)`. In Go `pgx`, the connection remains locked in a dangling transaction until connection pool cleanup, and the user's wallet balance stays locked.
- **Impact**:
  Connection pool exhaustion and locked wallet accounts during network blips.
- **Recommendation**:
  ```diff
  tx, err := s.db.Begin(ctx)
  if err != nil {
      return nil, err
  }
  + defer tx.Rollback(ctx)
  
  wallet.Deduct(amount)
  resp, err := s.gatewayClient.Charge(ctx, req)
  if err != nil {
      return nil, err
  }
  - tx.Commit(ctx)
  + return resp, tx.Commit(ctx)
  ```
- **Confidence**: `HIGH`
- **Status**: `TRIAGED_VALID`
- **Resolution**:
  Maker Agent implemented `defer tx.Rollback(ctx)` and verified with a unit test simulating gateway timeout.
