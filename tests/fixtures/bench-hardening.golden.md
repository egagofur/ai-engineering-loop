# Hardening candidates

These are candidate issues. AEL never applies them automatically.

1. **skipped-gate** (×2)
   - Instruction: `skill-src/ai-engineering-loop/SKILL.template.md` § Loop — Do not skip Goal Contract, verification, Devil's Advocate, or Judge gates; the tier only decides who fills them.
   - Suggestion (hard-gate): Refuse later gates when a prior recipe gate is missing from state.json history (goal → maker → verification → review → judge → delivery).

2. **guard-violation** (×1)
   - Instruction: `skill-src/ai-engineering-loop/references/loop-maker.md` § Stages 2-4: Maker — before an out-of-scope edit or a destructive command (`rm -rf`, `DROP TABLE`, `git push --force`, `git reset --hard`, `git clean -fd`) run `guard check`
   - Suggestion (tighten-text): Shorten the Maker guardrail line so the forbidden command list is the first sentence, then promote git reset --hard to a CLI-enforced block in every mode.
