# Third-Party Notices

## emilkowalski/skills

AEL vendors design and animation skills from `emilkowalski/skills` so `ai-engineering-loop sync-hosts` can install them for supported local AI-agent hosts.

- Source: https://github.com/emilkowalski/skills
- License: MIT

The vendored skill text remains authored by the original project. See the upstream repository for updates and full project context.

## Adopted skill ideas (issue #36)

The following AEL files were written fresh for AEL. No upstream text was copied. They adapt ideas from the projects below, which are credited here.

### obra/superpowers

- Source: https://github.com/obra/superpowers
- License: MIT
- Ideas adapted: receiving-code-review (verify feedback before acting, decline with evidence), verification-before-completion (no completion claim without fresh evidence), and systematic-debugging (trace backward, question the design after three failed fixes, bisect test pollution).
- AEL files: `adapters/quality/skills/receiving-code-review/SKILL.md`, the "No claim without fresh evidence" section of `references/loop-verify.md`, and "When fixes keep failing" in `core/root-cause-analysis.md`.

### worldflowai/everything-claude-code

- Source: https://github.com/worldflowai/everything-claude-code
- License: MIT (as stated in the project README)
- Ideas adapted: strategic-compact (compact at stage boundaries) and verification-loop (build, typecheck, lint, test, security order).
- AEL files: the compaction notes in `references/loop-goal.md` / `loop-verify.md` and the default order in the generated `.ai-engineering-loop/verification.md`.

### Cynthia-cym/project-onboarding

- Source: https://github.com/Cynthia-cym/project-onboarding
- License: MIT, Copyright (c) 2026 Cynthia-cym
- Ideas adapted: evidence-first repository onboarding from structure, history, and code patterns.
- AEL files: `adapters/project-onboarding/` (writes `.ai-engineering-loop/architecture.md` and `conventions.md`).

### ael-code-simplifier

`adapters/quality/skills/ael-code-simplifier/SKILL.md` is an original AEL text for a common "simplify the diff without changing behavior" practice.
