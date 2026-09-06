# Runtime Safety Modes

AI Engineering Loop separates analysis, human-supervised delivery, and unattended execution. The mode is stored in the run ledger and cannot change during a run.

## Modes

| Mode | Repository mutation | Delivery | Intended use |
|---|---|---|---|
| `REPORT_ONLY` | Forbidden | Ends at `gate report` | Audits, recommendations, and first-time evaluation |
| `ASSISTED` | Allowed after the Goal Contract gate | `delivery.json` must contain `"humanApproved": true` | Default production workflow |
| `UNATTENDED` | Allowed only when explicitly enabled; Maker uses a disposable locked Git worktree by default | Deterministic gates still apply | Trusted automation with budget monitoring |

`UNATTENDED` is disabled by default. Enable it deliberately:

```bash
npx ai-engineering-loop policy set --allow-unattended true
npx ai-engineering-loop run --mode unattended "task"
```

The repository policy lives at `.ai-engineering-loop/runtime-policy.json`. Invalid policy fails closed. Do not change a policy merely because an agent asks to bypass a gate.

## Token budget and emergency stop

Check the budget before every model call and record provider-reported usage immediately afterward:

```bash
npx ai-engineering-loop budget status --run <run-id>
npx ai-engineering-loop budget record --run <run-id> \
  --input <provider-input-tokens> \
  --output <provider-output-tokens> \
  --model <provider-model-id>
```

Never convert byte estimates into "actual" usage. If the host does not expose provider usage, `UNATTENDED` must stop and escalate to a human. In `ASSISTED`, disclose that accounting is unavailable and require the human to decide whether to continue.

The per-run limit spans UTC days. The daily limit resets on the next UTC day. Ledgers are append-only JSONL under `.ai-engineering-loop/usage/` and are ignored by Git. A malformed ledger blocks execution rather than undercounting.

Emergency controls:

```bash
npx ai-engineering-loop budget pause
npx ai-engineering-loop budget resume
```

`pause` sets the persistent kill switch. It blocks new run and context/model boundaries, while `budget record` remains available so an in-flight response can still be accounted.

## Unattended Maker isolation

After `gate goal`, create the worktree:

```bash
npx ai-engineering-loop sandbox create --run <run-id>
```

Run Maker with its working directory set to the returned `worktreePath`. Do not let Maker edit the parent checkout. When Maker is done:

```bash
npx ai-engineering-loop sandbox capture --run <run-id>
npx ai-engineering-loop gate maker --run <run-id>
```

Capture writes `diff.patch` plus hash-bound `sandbox-evidence.json`, removes the disposable worktree, and releases the repository-wide Maker lock. The unattended Maker gate rejects a manually supplied diff without matching evidence. Use `sandbox abort` to discard an interrupted Maker worktree.

> [!IMPORTANT]
> A Git worktree is a filesystem and concurrency boundary, not an operating-system sandbox. It does not restrict network access, child processes, credentials inherited by the host, or writes outside the worktree. Run truly untrusted agents in a container or VM with a minimal environment and restricted network.

## Host invariant

Every supported host follows the same order:

1. Read run mode and budget status.
2. Freeze and gate the Goal Contract.
3. End with a report in `REPORT_ONLY`, require human delivery approval in `ASSISTED`, or isolate Maker in `UNATTENDED`.
4. Before each model/subagent call, check budget; after it returns, record actual usage.
5. Keep context packs, usage ledgers, worktrees, locks, raw logs, and credentials out of commits and remote payloads.
