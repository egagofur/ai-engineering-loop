# How AEL verifies work

A change is verified when the gates below have passed on recorded files. A sentence from the agent is not verification.

## Gates, in order

1. **Goal.** The human froze a contract that says what fails (`docs goal-contract`). The agent does not freeze it.
2. **Maker.** `gate maker --from-git` writes `runs/<id>/diff.patch`. That diff is the change.
3. **Verify.** `ael verify` runs the project's commands and writes `verification.json`: the command, the exit code, and the logs. A non-zero exit blocks the gate.
4. **Review.** Claimed-vs-reality cites those logs. Devil's Advocate writes `findings.json`. `gate review` checks the ledger against the diff.
5. **Judge.** PASS, ITERATE, or ESCALATE, from the ledger and the evidence (`docs judge-policy`). PASS with an open BLOCKER or HIGH is refused.
6. **Deliver.** A person passes `deliver --approve --by <name>`. The receipt is recomputed from the artifacts.

## What verify records

```bash
npx ai-engineering-loop verify --run <id>
```

The default plan runs the commands configured in `.ai-engineering-loop/verification.md` (build, typecheck, lint, unit tests), stops at the first failure, and stores each result. `--related` is the fast lane on the files that changed. `--final` is the full run after the Judge passes, before delivery.

## Layers

| Layer | Proves |
|---|---|
| L1 | Static checks: types, lint, build |
| L2 | Tests and other runtime checks |
| L3 | A real user flow across components |

The long map, including baselines and waivers, is `docs verification-loop`.

## Tiers

T0 still runs verify and the gates. The CLI writes the empty ledger and the verdict; there is no Devil's Advocate subagent. T1 adds that review. T2 adds a stronger Judge and a safety proof. None of the tiers skip the recorded command.
