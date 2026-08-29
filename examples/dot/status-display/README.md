# Reference Example: Request Display Status Fix

## 1. Context & Scenario

This walkthrough shows how a status-display bug moves through the **AI Engineering Loop** and the **DOT Delivery Adapter**. Names, URLs, and schema below are **fictional**. Do not copy real client tickets, GitLab links, or field names into this package.

### The Problem

On an employee portal, request cards on the list and pagination endpoints showed `"PENDING"` after every line item was already approved or rejected. Non-standard-window records were also scored with the standard-day rule.

---

## 2. Walkthrough Stages & Artifacts

1. **[Stage 1: Goal Contract (`goal-contract.md`)](./goal-contract.md)**:
   - Objective, acceptance criteria (standard window, holiday, non-standard window, null values), and verification plan.
2. **[Stage 2: Adversarial Review & Triage (`review-findings.md`)](./review-findings.md)**:
   - Devil's Advocate flags a null-safety bug (`COR-001`) and an invalid nitpick (`MAINT-001`).
   - Maker triage and surgical fix.
3. **[Stage 3: Judge Evaluation & Verdict (`judge-verdict.md`)](./judge-verdict.md)**:
   - Audit of tests, typecheck, finding resolutions, and `PASS`.
4. **[Stage 4: DOT Delivery Pipeline (`delivery-report.md`)](./delivery-report.md)**:
   - Fictional issue, base MR, cherry-picks to `staging` and `develop`, Coreview triage, Mattermost notice.
