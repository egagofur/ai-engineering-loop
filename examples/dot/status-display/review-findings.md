# Adversarial Review Findings & Triage: Request Display Status Fix

## 1. Review Summary

- **Reviewer**: Devil's Advocate Agent
- **Target Branch**: `main...fix/request-display-status`
- **Total Findings**: 2
- **Blocking (SEV-1/2)**: 1
- **Non-Blocking / Invalid**: 1

---

## 2. Findings Ledger

### Finding COR-001: Missing null safety when iterating `lineItems`

- **Severity**: `HIGH` (SEV-2)
- **Category**: `Correctness`
- **Location**: `src/server/requests/utils/resolve-display-status.ts:34-41`
- **Evidence**:

```typescript
const hasPending = confirmation.lineItems.some(
  (item) => item.status === "NEED_APPROVAL"
);
```

- **Problem**:
  If `confirmation.lineItems` is `null` or `undefined` (legacy rows), `.some()` throws `TypeError`.
- **Impact**:
  Pagination API crashes for historical records.
- **Recommendation**:

```diff
- const hasPending = confirmation.lineItems.some(
+ const hasPending = (confirmation.lineItems ?? []).some(
    (item) => item.status === "NEED_APPROVAL"
  );
```

- **Confidence**: `HIGH`
- **Status**: `TRIAGED_VALID`
- **Resolution**:
  Maker applied `(confirmation.lineItems ?? [])` and added `should return APPROVED when lineItems is null or undefined`.

---

### Finding MAINT-001: Suggestion to convert helper into an abstract factory class

- **Severity**: `LOW` (SEV-4)
- **Category**: `Maintainability`
- **Location**: `src/server/requests/utils/resolve-display-status.ts:1-50`
- **Evidence**:
  Utility is `export function resolveRequestDisplayStatus(...)`.
- **Problem**:
  Reviewer wanted a Strategy/Factory for future calculator swaps.
- **Impact**:
  None. Pure functions match this repo.
- **Recommendation**: Refactor to `class StatusCalculatorFactory`.
- **Confidence**: `LOW`
- **Status**: `TRIAGED_INVALID`
- **Triage Reason**:
  Speculative overengineering. Constraint: surgical change, no extra abstractions.
