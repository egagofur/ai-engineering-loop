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

## Agent-friendly artifact diagnostics

Use the recorder for verification commands instead of hand-writing process metadata:

```bash
npx ai-engineering-loop verification record --run <run-id> -- npm test
npx ai-engineering-loop verification summarize --run <run-id>
```

The recorder runs commands without a shell by default, limits and redacts captured output, binds it to the gated Maker diff, and preserves failed results as failed evidence. Use `--shell -- "command"` only when shell syntax is required. A scaffold is only a starting point, never gate evidence:

```bash
npx ai-engineering-loop scaffold delivery --run <run-id>
```

Copy or rename the generated `.template.json` to the gate's real artifact filename (for example, `delivery.json`), fill it with observed evidence, and remove `_templateOnly`. Then validate the real file:

```bash
npx ai-engineering-loop validate .ai-engineering-loop/runs/<run-id>/delivery.json
```

`validate` reports artifact-content problems without advancing the workflow; its gate remains responsible for freshness, readiness, and human approval.

For a frozen Goal, generate the claimed-vs-reality table with blank evidence fields and fill them only from actual changes and verification output:

```bash
npx ai-engineering-loop context claimed-vs-reality --run <run-id>
```

In a recipe-bound run, `gate delivery` may report that a prerequisite node is ready but not approved. Inspect `node status --run <run-id>`, then explicitly approve that named approval node; never skip the human checkpoint.

## Context boundary

Create model-visible context through:

```bash
npx ai-engineering-loop context maker <files...>
npx ai-engineering-loop context devil-advocate <files...>
npx ai-engineering-loop context judge <files...>
```

The command rejects sensitive paths and repository escapes, redacts recognized credentials, caps files and estimated tokens, and marks truncation. Budget errors report the limit, estimated requested size, and per-file contribution (paths and counts only). Never replace a bounded pack with the parent transcript.

Before Judge, run:

```bash
npx ai-engineering-loop escalation --json
```

Use the minimum returned tier from the active host catalog. Never invent a model slug. A lower-tier Judge cannot issue `PASS` when stronger review is required.
