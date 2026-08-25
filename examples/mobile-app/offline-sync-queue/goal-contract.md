# Goal Contract: Offline Mutation Queue & Sync Engine

## 1. Objective
Implement an offline-first transactional queue in SQLite that captures user inspection submissions locally and synchronizes reliably with the cloud API upon network reconnection.

## 2. Business Outcome & User Lifecycle Impact
- **Field Inspectors**: Can complete and save survey reports anywhere with zero risk of data loss.
- **Operations**: Automatic background upload with zero manual re-entry.

## 3. Acceptance Criteria (AC)
- [ ] **AC-1**: Submissions write to local SQLite `mutation_queue` with status `PENDING` before network attempt.
- [ ] **AC-2**: Connectivity changes trigger FIFO queue processing with max 3 retry attempts per item.
- [ ] **AC-3**: Simulated app kill during background sync resumes cleanly upon next launch.
- [ ] **AC-4**: Zero data loss under intermittent network flapping (3G/offline transitions).

## 4. Technical Constraints
- Flutter 3.22, Dart 3.4, `sqflite` for local DB, `connectivity_plus` for network state.
- Pure Dart logic for sync manager with zero direct UI widget dependencies.

## 5. Out of Scope
- Modifying survey form UI layout or camera image capture compression.

## 6. Verification Requirements
- **Unit & Mock Tests**: `flutter test test/core/sync/offline_queue_test.dart`
- **Static Analysis**: `dart analyze`
- **Build Check**: `flutter build bundle`

## 7. Definition of Done (DoD)
- [ ] All AC-1 through AC-4 proven via unit & repository test suites.
- [ ] Static analysis 0 issues.
- [ ] Devil's Advocate review conducted with 0 unresolved blocking findings.
- [ ] Judge issues PASS verdict.
