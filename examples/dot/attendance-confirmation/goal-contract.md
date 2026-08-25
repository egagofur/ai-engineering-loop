# Goal Contract: Attendance Confirmation Display Status Fix

## 1. Objective
Fix the incorrect calculation of attendance confirmation display statuses across list and pagination endpoints when time entities contain overtime notes, weekend logs, non-normal hours employees, or null record states.

## 2. Business Outcome & User Lifecycle Impact
- **Employees**: View accurate confirmation statuses (APPROVED, REJECTED, NEED_APPROVAL) reflecting their true attendance record.
- **Managers / Reviewers**: Stop receiving false-positive pending approval notifications for already-settled weekend logs.
- **HR & Payroll**: Accurate cumulative duration calculations for payroll export.

## 3. Acceptance Criteria (AC)
- [ ] **AC-1**: If an employee has `hasNormalHours = true` and `duration <= 8` on a standard weekday without overtime notes, display status must resolve to `APPROVED` or `NEED_APPROVAL` strictly based on clock-in/out presence.
- [ ] **AC-2**: If `overtimeNote` exists or `duration > 8` or `isWeekend = true`, evaluate pending status across all associated `timeEntities`.
- [ ] **AC-3**: Non-normal hours employees (`user.type.hasNormalHours = false`) must not be evaluated under 8-hour weekday thresholds.
- [ ] **AC-4**: Null or missing time entity collections must default safely to `APPROVED` without throwing runtime `TypeError`.
- [ ] **AC-5**: Backward compatibility of the tRPC/REST response contract must be strictly preserved.

## 4. Technical Constraints
- Preserve existing Prisma query schemas in `attendanceConfirmationPagination`.
- Centralize logic in a pure, testable utility function: `resolveAttendanceConfirmationDisplayStatus`.
- No new external runtime dependencies (use existing `dayjs` and `lodash` packages).
- 0 TypeScript compiler errors on `tsc --noEmit`.

## 5. Out of Scope
- Modifying the UI frontend component layouts in `dotify-new/web`.
- Database schema migrations or alter table statements.
- Changing payroll export report generation scripts.

## 6. Verification Requirements
- **Unit Tests**: Comprehensive Jest test suite in `src/server/attendance-confirmations/utils/resolve-display-status.test.ts` covering 100% of branches.
- **Typecheck**: `npx tsc --noEmit` exits with 0.
- **Linter**: `npx eslint --fix` on modified files with 0 errors.
- **Regression**: Run entire test suite: `npx jest --testPathIgnorePatterns="dotify-api"`.

## 7. Definition of Done (DoD)
- [ ] All AC-1 through AC-5 proven by unit tests.
- [ ] Deterministic verification passes 100%.
- [ ] Devil's Advocate review conducted with 0 unresolved blocking findings.
- [ ] Judge issues PASS verdict.
