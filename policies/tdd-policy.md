# TDD Policy (Maker, Stages 4–5)

Maker implements with a red → green loop at **pre-agreed seams**. Refactoring is not part of this loop; it belongs to a later Goal Contract or to review.

Canonical Maker rules: `agents/maker.md`. Verification evidence: `core/verification-loop.md`.

## Seams

A seam is the public interface where you observe behavior without reaching inside. Seams are named in the Goal Contract during Stage 1. Prefer existing seams. The ideal number of new seams is zero; the next best is one.

No test is written at an unconfirmed seam. If the contract omitted seams and grill was skipped, name them in the plan (Stage 3) and freeze them in the contract before the first red test.

## What a good test is

The test reads like a specification of behavior at the seam. Names use `.ai-engineering-loop/glossary.md`. The test survives an internal rewrite. Expected values come from the Goal Contract or a known-good literal, not from re-running the implementation.

## Failure table

The Goal Contract's AC-1..N **are** the test list. Each row is one red test at the named seam. Do not invent a parallel "comprehensive suite" of only positive cases.

Default rows unless the contract marked them N/A with one sentence:

1. Happy path
2. Empty / omitted / null
3. Boundary (min, max, off-by-one, locked vs open)
4. Sibling / isolation (other entities in the same parent must not change)
5. Error / denied / unauthorized / invalid input

Do not stop after the first green test. A suite that never asserts a failure mode does not cover the feature.

## Loop

1. **Red.** Write one failing test for one AC row. Confirm it fails for the right reason.
2. **Green.** Write the smallest production change that passes that test.
3. Repeat one row at a time (vertical). Do not write the whole suite first.
4. After AC-1..N are green, run the full verification commands in `.ai-engineering-loop/verification.md` and keep the Evidence Contract.
5. **Coverage as a map, not a score.** If a coverage command exists, use the report to find branches that map to a written AC and are still untested. Add tests only for those. Do not chase 90% with tautological asserts. Line coverage without a failure table is invalid evidence.
6. **Mutation (optional).** If `.ai-engineering-loop/verification.md` names a mutation tool (Stryker, mutmut, PIT, cargo-mutants), run it on the files this task touched. Surviving mutants on an AC path are ITERATE. Do not add mutation as a new stage or a global 90% gate.
7. **Property-based (optional).** When the input space is broad (ids, dates, strings, amounts), one property per invariant beats a pile of copied positives. Not required for every task.

## Forbidden tests

- **Implementation-coupled:** mocks internal collaborators, tests private methods, or asserts through a side channel (raw DB) instead of the seam.
- **Tautological:** expected value is computed the same way as the code (`expect(add(a,b)).toBe(a+b)`).
- **Source grep:** `grep -q 'featureFlag' src/file` is not a test of the AC. Prove behavior at the named seam or on the named artifact.
- **Happy-path only:** every test is a success case while the contract listed empty, boundary, sibling, or error rows.
- **Coverage theater:** raising percent with `toBeDefined()`, snapshot-without-oracle, or tests that cannot fail.
- **Horizontal slicing:** all tests first, then all implementation.

## Evidence

Stage 5 still requires command, exit code 0, stdout, test counts, and assertionEvidence mapped to AC ids. "We did TDD" is not evidence. A red-then-green story without logs is invalid. assertionEvidence must cite at least one non-happy-path AC when the failure table has one.
