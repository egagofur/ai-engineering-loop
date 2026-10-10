---
name: dot-dev-skill-router
description: Route DOT tasks. Commit-bound bugfix, feature, or refactor uses ai-engineering-loop for Stages 0-7, then dot-dev-workflow for Stage 8 delivery. Do not use dot-dev-workflow as a parallel engineering OS.
---

# DOT Development Skill Router

Pick the smallest relevant skill. Do not load every skill. **AI Engineering Loop is the engineering OS on DOT repos.** `dot-dev-workflow` is Stage 8 delivery only (GitLab, cherry-pick, Coreview, Mattermost).

## Core rules

1. Read repository instructions and inspect the affected code before choosing a workflow.
2. For DOT work that will be committed or opened as an MR, load `ai-engineering-loop`. Stage 1 grill includes `task-impact-inquiry` (four pillars). Stages 6-7 are AEL Devil's Advocate and Judge. Do not run the old 9-phase `dot-dev-workflow` as a second loop. Do not run `task-impact-inquiry` as a second interview after grill.
3. After Judge `PASS`, load `dot-dev-workflow` for Stage 8 delivery only.
4. Use `ponytail` (optional, if installed) when the smallest correct solution matters.
5. Use `verification-before-completion` (dot-plugin; older installs call it `dot-verification`) before claiming a change is fixed, complete, passing, or ready.
6. Commits, push, GitLab issue/MR, Mattermost, deploys, database mutation, and deletion are explicit user-requested side effects. `auto-mr-issue` (optional, if installed) is never automatic.
7. Do not invent APIs, test results, design tokens, or behavior. Report blockers as blockers.
8. If a named skill is not installed, say so and continue with `ai-engineering-loop`; never guess a substitute name.

## Skill sources

- **AEL (this package):** `ai-engineering-loop`, `task-impact-inquiry`, `dot-dev-workflow`, `backend-development`.
- **dot-plugin:** `verification-before-completion`, `design-openapi-contract`, `design-dbml-database`, `generate-api-test`, `generate-ui-e2e-test`, `generate-module-fsd`, `merge-request`, `gitlab-mr-feedback`, `receiving-code-review`, `fetch-gitlab-issue`, `sonarqube-issues`, `sentry-issues`.
- **Optional, if installed:** `ponytail`, `auto-mr-issue`, `product-contract-analysis`, `fig-to-tailwind-extractor`, `figma-token-extractor`, `frontend-design`, `design-taste-frontend`, `ui-ux-pro-max`, `web-design-guidelines`, `webapp-testing`, `backend-safety-guardrails`, `creative-ideation`.

## Route by task

| Task | Load in order |
|---|---|
| DOT bugfix / feature / refactor that will be committed or opened as MR | `ai-engineering-loop` (grill includes `task-impact-inquiry`; DA + Judge before commit) → `dot-dev-workflow` Stage 8 after Judge PASS |
| Impact / blast-radius question only (no implementation) | `task-impact-inquiry` |
| New feature, product/UI behavior unclear | `ai-engineering-loop` Stage 1 grill and Goal Contract; add `product-contract-analysis` (optional, if installed) for product questions. Do not run a separate brainstorming loop |
| Legacy FE + BE module documentation | `generate-module-fsd` |
| Raw `.fig` file to standalone HTML + Tailwind | `fig-to-tailwind-extractor`; add `figma-token-extractor` for token/visual-contract audit (both optional, if installed) |
| New landing page or visual redesign | `frontend-design` + `design-taste-frontend`; add `ui-ux-pro-max` only for a targeted UI decision (optional, if installed) |
| UI/accessibility/design review | `web-design-guidelines`; add `ui-ux-pro-max` for focused UX, stack, typography, or interaction guidance (optional, if installed) |
| DOT API contract or OpenAPI change | `ai-engineering-loop` → `design-openapi-contract` → `verification-before-completion` |
| DOT database schema (DBML) change | `ai-engineering-loop` → `design-dbml-database` → `verification-before-completion` |
| DOT backend behavior/API regression coverage | `ai-engineering-loop` → `generate-api-test` → `verification-before-completion` |
| Backend architecture, clean code, naming, or query optimization | `ai-engineering-loop` → `backend-development` (during Maker) → `verification-before-completion` |
| Backend action, queue, worker, or entity status recalculation | `ai-engineering-loop` → `backend-development` + `backend-safety-guardrails` (optional, if installed) during Maker → `verification-before-completion` |
| Local web app repro, browser smoke, or UI regression | `webapp-testing` (optional, if installed) → `verification-before-completion` |
| Executing an existing written plan | `ai-engineering-loop` (paste the plan as the Goal Contract draft). Do not load `executing-plans` as a second loop |
| Pre-merge review after AEL already ran | AEL Judge verdict is the gate. Do not re-run a separate devil's-advocate skill unless Judge was skipped |
| Code review feedback reception | `receiving-code-review` |
| GitLab MR discussions / feedback resolution | `gitlab-mr-feedback` → `receiving-code-review` |
| Broad creative/product ideation | AEL idea menu (list a short menu and wait); `creative-ideation` (optional, if installed) for open-ended exploration |
| Explicit post-commit GitLab issue/MR request | `auto-mr-issue` (optional, if installed) after the user explicitly asks for it |

## Workflow gates

- Goal Contract (with seams and, on DOT, impact matrix) before production edits.
- Before `git commit` / `glab mr create`: AEL Judge `PASS`. Considering risks while coding is not that gate.
- Before Mattermost: `glab mr view --comments` printed to the user, even when comment count is 0.
- For final reports, separate verified, failed, blocked, and untested items.

## Avoid

- Do not run `dot-dev-workflow` Phases 1-6 when `ai-engineering-loop` is available.
- Do not chain `task-impact-inquiry` then a full second engineering loop.
- Do not invoke `auto-mr-issue` merely because code was committed.
- Do not use the full delivery pipeline for a tiny local question unless the user asked to ship.
