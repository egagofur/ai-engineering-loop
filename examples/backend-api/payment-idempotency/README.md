# Reference Example: Backend API Payment Idempotency & Race Condition Fix

## 1. Scenario Overview

This walkthrough demonstrates the **AI Engineering Loop** operating in a **Backend API** repository (`backend-api` profile) with standard GitHub adapter integration.

### The Problem
A Go/PostgreSQL payment processing microservice experienced double-spend vulnerabilities when users clicked the payment confirmation button multiple times in rapid succession. The database updated account balances without transactional row-level locks or idempotency key uniqueness checks.

---

## 2. Dynamic Context Resolution

```text
Engine: AI Engineering Loop Core
Profile: profiles/backend-api.md
Repo Config: payment-service/.ai-engineering-loop/ (Go 1.22, pgx, GitHub Adapter)
Task: Implement atomic idempotency key validation and SELECT FOR UPDATE row locking
```

---

## 3. Walkthrough Artifacts

1. **[Goal Contract (`goal-contract.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/examples/backend-api/payment-idempotency/goal-contract.md)**:
   - AC-1: Idempotency-Key header mandatory on POST `/api/v1/payments/charge`.
   - AC-2: Atomic reservation using PostgreSQL `INSERT ... ON CONFLICT DO NOTHING`.
   - AC-3: Concurrent requests for same user wallet serialized with `SELECT ... FOR UPDATE`.
2. **[Adversarial Review Findings (`review-findings.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/examples/backend-api/payment-idempotency/review-findings.md)**:
   - Devil's Advocate activates `backend-api` rules (concurrency, database atomicity).
   - Flags missing rollback on external gateway timeout (`ERR-001`).
3. **[Judge Verdict (`judge-verdict.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/examples/backend-api/payment-idempotency/judge-verdict.md)**:
   - Evaluates parallel test execution (`go test -race ./...`), verifies concurrency safety, and issues `PASS` verdict.
