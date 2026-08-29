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
4. Use `ponytail` when the smallest correct solution matters.
5. Use `dot-verification` before claiming a change is fixed, complete, passing, or ready.
6. Commits, push, GitLab issue/MR, Mattermost, deploys, database mutation, and deletion are explicit user-requested side effects. `auto-mr-issue` is never automatic.
7. Do not invent APIs, test results, design tokens, or behavior. Report blockers as blockers.

## Route by task

| Task | Load in order |
|---|---|
| DOT bugfix / feature / refactor that will be committed or opened as MR | `ai-engineering-loop` (grill includes `task-impact-inquiry`; DA + Judge before commit) → `dot-dev-workflow` Stage 8 after Judge PASS |
| Impact / blast-radius question only (no implementation) | `task-impact-inquiry` |
| New feature, product/UI behavior unclear | `brainstorming` → `product-contract-analysis` → then `ai-engineering-loop` if it will be built |
| Legacy FE + BE module documentation | `generate-module-fsd` |
| Raw `.fig` file to standalone HTML + Tailwind | `fig-to-tailwind-extractor`; add `figma-token-extractor` for token/visual-contract audit |
| New landing page or visual redesign | `frontend-design` + `design-taste-frontend`; add `ui-ux-pro-max` only for a targeted UI decision |
| UI/accessibility/design review | `web-design-guidelines`; add `ui-ux-pro-max` for focused UX, stack, typography, or interaction guidance |
| DOT API contract or OpenAPI change | `ai-engineering-loop` → `dot-openapi-contract` → `dot-verification` |
| DOT backend behavior/API regression coverage | `ai-engineering-loop` → `dot-api-test` → `dot-verification` |
| Backend architecture, clean code, naming, or query optimization | `ai-engineering-loop` → `backend-development` (during Maker) → `dot-verification` |
| Backend action, queue, worker, or entity status recalculation | `ai-engineering-loop` → `backend-development` + `backend-safety-guardrails` (during Maker) → `dot-verification` |
| Local web app repro, browser smoke, or UI regression | `webapp-testing` → `dot-verification` |
| Plan execution with review checkpoints | `executing-plans` → `ai-engineering-loop` |
| Pre-merge review after AEL already ran | AEL Judge verdict is the gate. Do not re-run skill `devils-advocate` unless Judge was skipped |
| Code review feedback reception | `receiving-code-review` |
| GitLab MR discussions / feedback resolution | `gitlab-mr-feedback` → `receiving-code-review` |
| Broad creative/product ideation | `creative-ideation`; use `brainstorming` when the next outcome must be an approved plan |
| Explicit post-commit GitLab issue/MR request | `auto-mr-issue` after the user explicitly asks for it |

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
