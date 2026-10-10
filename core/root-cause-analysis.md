# Root Cause Analysis (Stage 2)

Stage 2 is diagnosis, not coding. The Maker must not start a production diff until the failure (or the missing capability) is named with evidence.

## Feature work

For a new capability with a frozen Goal Contract:

1. Trace the data path (ingress → domain → data → side effects).
2. Name the existing module and **seam** that will carry the change.
3. List edge cases the AC already require.
4. Stop. Stage 3 is the plan; Stage 4 is the diff.

## Bug and regression work

Use a gated diagnosis loop. Do not skip a gate.

1. **Red repro.** Build or run a feedback loop that fails on this bug (test, log, metric, or script). If you cannot turn it red, you do not understand it yet.
2. **Minimise.** Shrink input, surface, and time window until one causal slice remains.
3. **Hypothesise.** Write 1–3 falsifiable causes. Do not "try things".
4. **Instrument.** Add the smallest probe that distinguishes those causes. Remove the probe if it is not a product requirement.
5. **Fix.** Only after one hypothesis is confirmed. The fix is Stage 4, still test-first at the agreed seam (`policies/tdd-policy.md`).
6. **Regression test.** The red repro becomes a kept test mapped to an AC.

## When fixes keep failing

- **Trace backward.** Start at the wrong value or symptom and walk up the call chain to where it first became wrong. Fix it there, not where it surfaced.
- **Three strikes.** If three fixes for the same failure did not hold, stop patching. Question the design or assumption underneath, and raise it with the human before attempt four.
- **Test pollution.** If a test passes alone but fails in the suite, find the polluter by bisection: run the failing test after each half of the preceding test files until one file remains, then fix its leaked state (globals, timers, files, environment, database rows).

## Anti-patterns

- Guessing a fix from stack-trace vibe without a red repro
- Horizontal exploration of the whole repo "in case"
- Editing production code in Stage 2
- Asking the user for facts that exist in git, logs, or `.ai-engineering-loop/verification.md`
