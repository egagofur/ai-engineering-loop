# Goal Contract: Request Display Status Fix

## 1. Objective

Fix incorrect display status on list and pagination endpoints when a request has mixed line items, holiday logs, non-standard windows, or null collections.

## 2. Business Outcome & User Lifecycle Impact

- **Employees**: See APPROVED, REJECTED, or NEED_APPROVAL matching the real record.
- **Reviewers**: Stop getting false pending notices for already-settled holiday logs.
- **Finance**: Totals used by the downstream aggregate job stay consistent.

## 3. Acceptance Criteria (AC)

- [ ] **AC-1**: If `hasStandardWindow = true` and `duration` is within the standard day limit on a weekday without a rush note, display status is `APPROVED` or `NEED_APPROVAL` from clock-in/out presence only.
- [ ] **AC-2**: If a rush note exists, or duration exceeds the standard limit, or `isHoliday = true`, evaluate pending status across all associated `lineItems`.
- [ ] **AC-3**: Non-standard-window records (`user.type.hasStandardWindow = false`) must not use the weekday duration threshold.
- [ ] **AC-4**: Null or missing `lineItems` default to `APPROVED` without throwing `TypeError`.
- [ ] **AC-5**: The existing API response contract is unchanged.

## 4. Technical Constraints

- Keep the existing list/pagination query shape.
- Centralize logic in a pure function: `resolveRequestDisplayStatus`.
- No new runtime dependencies.
- `tsc --noEmit` exits 0.

## 5. Out of Scope

- Frontend layout changes.
- Database migrations.
- Changing the downstream aggregate/export job.

## 6. Verification Requirements

- **Unit Tests**: Jest suite at `src/server/requests/utils/resolve-display-status.test.ts`.
- **Typecheck**: `npx tsc --noEmit` exits 0.
- **Linter**: `npx eslint --fix` on modified files, 0 errors.
- **Regression**: commands in `.ai-engineering-loop/verification.md` (example: `npx jest && npx tsc --noEmit`).

## 7. Definition of Done (DoD)

- [ ] AC-1 through AC-5 proven by unit tests.
- [ ] Deterministic verification passes.
- [ ] Devil's Advocate review with 0 unresolved blocking findings.
- [ ] Judge issues PASS.
