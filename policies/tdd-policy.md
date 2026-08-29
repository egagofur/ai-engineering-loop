# TDD Policy (Maker, Stages 4–5)

Maker implements with a red → green loop at **pre-agreed seams**. Refactoring is not part of this loop; it belongs to a later Goal Contract or to review.

Canonical Maker rules: `agents/maker.md`. Verification evidence: `core/verification-loop.md`.

## Seams

A seam is the public interface where you observe behavior without reaching inside. Seams are named in the Goal Contract during Stage 1. Prefer existing seams. The ideal number of new seams is zero; the next best is one.

No test is written at an unconfirmed seam. If the contract omitted seams and grill was skipped, name them in the plan (Stage 3) and freeze them in the contract before the first red test.

## What a good test is

The test reads like a specification of behavior at the seam. Names use `.ai-engineering-loop/glossary.md`. The test survives an internal rewrite. Expected values come from the Goal Contract or a known-good literal, not from re-running the implementation.

## Loop

1. **Red.** Write one failing test for one AC slice. Confirm it fails for the right reason.
2. **Green.** Write the smallest production change that passes that test.
3. Repeat one slice at a time (vertical). Do not write the whole suite first.
4. After slices covering AC-1..N, run the full verification commands in `.ai-engineering-loop/verification.md` and keep the Evidence Contract.

## Forbidden tests

- **Implementation-coupled:** mocks internal collaborators, tests private methods, or asserts through a side channel (raw DB) instead of the seam.
- **Tautological:** expected value is computed the same way as the code (`expect(add(a,b)).toBe(a+b)`).
- **Horizontal slicing:** all tests first, then all implementation.

## Evidence

Stage 5 still requires command, exit code 0, stdout, test counts, and assertionEvidence mapped to AC ids. "We did TDD" is not evidence. A red-then-green story without logs is invalid.
