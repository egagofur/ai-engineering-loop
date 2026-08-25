# Reference Example: Mobile App Offline Sync Queue

## 1. Scenario Overview

This walkthrough demonstrates the **AI Engineering Loop** operating in a **Mobile Application** repository (`mobile-app` profile) for a field survey application built in Flutter / SQLite.

### The Problem
Field inspectors working in remote areas without cellular coverage experienced loss of submitted inspection forms when the application was closed or terminated by the OS before regaining an internet connection.

---

## 2. Dynamic Context Resolution

```text
Engine: AI Engineering Loop Core
Profile: profiles/mobile-app.md
Repo Config: inspector-app/.ai-engineering-loop/ (Flutter 3.22, sqflite, Riverpod)
Task: Implement persistent offline SQLite mutation queue with exponential backoff sync
```

---

## 3. Walkthrough Artifacts

1. **[Goal Contract (`goal-contract.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/examples/mobile-app/offline-sync-queue/goal-contract.md)**:
   - AC-1: All form submissions persist immediately to local SQLite `mutation_queue` table before network dispatch.
   - AC-2: Background sync engine triggers on network restoration with exponential backoff.
   - AC-3: OS suspension / app kill must not drop un-synced items.
2. **[Adversarial Review Findings (`review-findings.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/examples/mobile-app/offline-sync-queue/review-findings.md)**:
   - Devil's Advocate activates `mobile-app` rules (offline persistence, lifecycle, battery).
   - Flags missing disk write error handling when device storage is full (`PERF-001`).
3. **[Judge Verdict (`judge-verdict.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/examples/mobile-app/offline-sync-queue/judge-verdict.md)**:
   - Audits Flutter unit & mock network tests, verifies 100% pass, and issues `PASS` verdict.
