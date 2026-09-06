# Artifact Gates

AI Engineering Loop does not trust a model's statement that a stage is complete. A stage advances only when its artifact passes a deterministic CLI gate.

## Run ledger

Start or resume a run:

```bash
npx ai-engineering-loop run
npx ai-engineering-loop state --json
```

Artifacts live under `.ai-engineering-loop/runs/<run-id>/`. Do not edit `state.json` or `current.json` manually.

## Required transitions

| Stage | Artifact | Gate |
|---|---|---|
| Goal freeze | `goal-contract.json` | `gate goal` |
| Maker complete | `diff.patch` | `gate maker` |
| Verification | `verification.json` | `gate verification` |
| Devil's Advocate | `findings.json` | `gate review` |
| Judge | `verdict.json` | `gate judge` |
| Delivery | `delivery.json` | `gate delivery` |

JSON sidecars follow the schemas shipped in `schemas/`. Keep the Markdown Goal Contract and human report; sidecars make their claims machine-checkable.

Gate failures are evidence. Do not edit state to bypass one. Repair the artifact or return to Maker.

## Context boundary

Create model-visible context through:

```bash
npx ai-engineering-loop context maker <files...>
npx ai-engineering-loop context devil-advocate <files...>
npx ai-engineering-loop context judge <files...>
```

The command rejects sensitive paths and repository escapes, redacts recognized credentials, caps files and estimated tokens, and marks truncation. Never replace a bounded pack with the parent transcript.

Before Judge, run:

```bash
npx ai-engineering-loop escalation --json
```

Use the minimum returned tier from the active host catalog. Never invent a model slug. A lower-tier Judge cannot issue `PASS` when stronger review is required.
