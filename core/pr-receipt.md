# Proof-Carrying PR Receipt

A PR/MR from the loop carries a **receipt**: a checkable summary of what was proven, not free-text claims. `deliver` writes it as the last step after approval:

- `RUN_DIR/receipt.json` (schema: `schemas/receipt.schema.json`)
- `RUN_DIR/receipt.md`, the "Receipt" section for the PR/MR body (GitHub, GitLab and DOT templates)
- `delivery.json` → `receipt: { path, digest }`

```bash
git commit ...   # commit first: the receipt binds HEAD (or pass --head <sha>)
npx ai-engineering-loop deliver --run <id> --destination pr --summary "<text>" --approve --by <name> \
  [--host claude] [--model <id>] [--evidence AC-1=https://ci.example/run/42/shot.png]
npx ai-engineering-loop verify-receipt --run <id> --head <pr-head-sha>      # or: verify-receipt <path/to/receipt.json>
```

## Contents

| Field | Source |
|---|---|
| `goal` | frozen `goal-contract.json`: repo-relative path, file sha256, content hash, version, objective |
| `acceptanceCriteria[]` | every AC from the frozen Goal, `PASS` or `MISSING` with `missing` reasons. Evidence: the claimed-vs-reality row, every verification command (exit code, timeout status, sha256 of its output), and hosted links from `--evidence` |
| `verification` | diff hash, git revision, commands, optional numeric `coverage` from `verification.json` |
| `review` | finding-ledger summary (total, valid, blocking, by severity) and the Judge verdict (verdict, model tier, decided by) |
| `impact`, `guard` | blast-radius drift (#71) and guardrail warn/block counts (#59) when present |
| `base`, `head`, `host` | Run start revision, `HEAD` (or `--head`), host id and model |
| `artifacts[]` | sha256 of the Goal, diff, verification, findings, verdict, impact map/drift, guard events and claimed-vs-reality |
| `digest` | sha256 of the canonical receipt body |

An AC is `PASS` only when it has a filled claimed-vs-reality row and every recorded verification command passed. Missing evidence is an explicit ❌; it is never dropped. `deliver` still finishes (the human approved it) but prints the missing AC ids.

No secrets and no local absolute paths: text is redacted, artifact paths are repository-relative, and screenshots are only accepted as `http(s)` links without credentials.

## `verify-receipt`

Exit 1 (usable in CI) when any of these fail: `RECEIPT_DIGEST_MISMATCH` (receipt edited), `ARTIFACT_MISSING` / `ARTIFACT_TAMPERED` (an artifact's sha256 changed), `GOAL_CHANGED`, `AC_NOT_IN_RECEIPT`, `AC_EVIDENCE_MISSING`, `VERDICT_NOT_PASS`, `BLOCKING_FINDINGS`, `HEAD_MISMATCH` (receipt head ≠ `--head`, default the checkout's `HEAD`). It reads the Run directory, so it runs where the Run lives (the developer machine, or CI with the Run attached). Signing the digest is not implemented yet; the schema reserves `signature`.
