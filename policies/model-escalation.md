# Model Escalation Policy

Cheap models are the default Maker, Devil's Advocate, and Judge. Required workflow stages never disappear when the model tier changes.

The objective is not to prevent every model error. Unsupported output must fail a deterministic gate, and repeated uncertainty must move to a stronger reviewer.

## Deterministic routing

Use `CHEAP_MODEL` when all evidence is current, context is complete, and no high-risk path changed.

Require `STRONG_MODEL` when any of these signals exist:

- Authentication, authorization, payment, billing, database migration, infrastructure, cryptography, or secret-handling paths changed.
- The model emitted two invalid structured artifacts.
- A finding cites a path that does not exist.
- Verification is flaky.
- A stage context pack was truncated.
- A critical acceptance criterion remains `UNKNOWN`.
- Devil's Advocate and Judge disagree about a blocking finding.

Require `HUMAN` when:

- The iteration ceiling is reached.
- A credential or evaluation canary reached model-visible output.

Diff size alone is not a risk classification. A one-line authorization change can require stronger review.

## Verdict metadata

Judge writes `modelTier` in `verdict.json`:

```json
{
  "modelTier": "CHEAP_MODEL",
  "humanApproved": false
}
```

`ai-engineering-loop gate judge` computes the required tier. A lower tier may safely issue `ESCALATE`, but it cannot issue `PASS` when stronger review is required.

Run `ai-engineering-loop escalation --json` before spawning Judge to select the minimum acceptable tier. Do not invent a provider or model slug; resolve the tier through the active host's model catalog.
