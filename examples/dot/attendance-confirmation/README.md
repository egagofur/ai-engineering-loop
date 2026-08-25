# Reference Example: Attendance Confirmation Status Fix

## 1. Context & Scenario

This reference walkthrough demonstrates how a complex real-world bug in the DOT ecosystem moves through the complete **AI Engineering Loop** and is subsequently delivered via the **DOT Delivery Adapter**.

### The Problem
In the Dotify employee portal, attendance confirmation cards displayed an incorrect status (`"PENDING"`) for employees working overtime or on weekends, even when all underlying time logs had already been approved or rejected. Furthermore, non-normal hours employees (shift workers) had their records mistakenly treated under standard 9-to-5 rules.

---

## 2. Walkthrough Stages & Artifacts

1. **[Stage 1: Goal Contract (`goal-contract.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/examples/dot/attendance-confirmation/goal-contract.md)**:
   - Formalized objective, acceptance criteria (normal hours, weekends, non-normal hours, null values), and verification plan.
2. **[Stage 2: Adversarial Review & Triage (`review-findings.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/examples/dot/attendance-confirmation/review-findings.md)**:
   - Independent Devil's Advocate review flagging a timezone offset bug (`COR-001`) and an invalid nitpick (`MAINT-001`).
   - Maker Agent triage and surgical resolution.
3. **[Stage 3: Judge Evaluation & Verdict (`judge-verdict.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/examples/dot/attendance-confirmation/judge-verdict.md)**:
   - Audit of unit test results, typecheck logs, finding resolutions, and issuance of `PASS` verdict.
4. **[Stage 4: DOT Delivery Pipeline (`delivery-report.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/examples/dot/attendance-confirmation/delivery-report.md)**:
   - Creation of GitLab Issue #307, base MR !946, multi-branch propagation to `staging` (!947) and `develop` (!948), Coreview bot triage, and automated Mattermost channel notification.
