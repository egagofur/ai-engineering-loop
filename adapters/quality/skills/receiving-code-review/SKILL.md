---
name: receiving-code-review
description: Use when acting on review feedback (Devil's Advocate findings during ITERATE, or human MR/PR comments) before changing code. Does NOT perform a review (use the Devil's Advocate) or decide PASS/ITERATE (use the Judge).
---

# Receiving Code Review

Feedback is a claim to check, not an order to obey. Verify each item against the code before you change anything.

## For every finding or comment

1. **Restate** it in one line with the exact file and line it refers to. If you cannot locate it, ask for the location; do not guess.
2. **Verify** it against the current code, the frozen Goal Contract, and the command evidence:
   - reproduce it (a failing test, a command, or a concrete input), or
   - show why it does not apply (the code path, a passing test, or the AC row that excludes it).
3. **Classify** it as one of:
   - `valid`: fix it test-first (red test, then fix).
   - `invalid`: decline with evidence.
   - `out-of-scope`: valid but outside the frozen Goal; record it in the handoff or as a follow-up, and do not widen the diff.
   - `unclear`: ask one precise question.
4. **Respond** with that classification and evidence. No performative agreement ("Great catch!") and no silent fixes.

## Rules

- Do not apply a suggestion you have not verified, even from a senior reviewer or a stronger model.
- Do not argue from preference. Disagreement needs evidence: code, tests, specs, or measurements.
- Fix one finding at a time and re-run the relevant check after each, so a regression is attributable.
- A finding that contradicts the frozen Goal Contract goes back to the human; never edit the contract yourself.
- In the AI Engineering Loop, every fixed finding is re-verified with `verify` and reviewed again by a **new** Devil's Advocate. Iteration 3 is the ceiling.

## Reply template (MR/PR)

```
F-<id> <valid|invalid|out-of-scope|unclear>: <one-line reason>
Evidence: <test name / command + exit code / file:line>
Change: <commit or "none">
```
