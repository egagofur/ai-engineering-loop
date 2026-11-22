# Overnight contract

An overnight run is an `UNATTENDED` Run the human started and then left. The agent may keep working only inside this contract. `overnight check` recomputes the result from Run files. A note the agent wrote about itself does not count.

This is not a new mode. Enable unattended the same way as today (`docs runtime-safety`):

```bash
npx ai-engineering-loop policy set --allow-unattended true
npx ai-engineering-loop run --mode unattended "<task>"
```

The Goal is still frozen by the human before the agent is left alone. Delivery still waits for that person.

## What the agent may do

- Continue a Goal the human already froze.
- Edit only inside that frozen scope, in the sandbox worktree (`sandbox create`).
- Run verify, Devil's Advocate, and Judge, inside the recipe's iteration cap and the token budget.
- Record evidence under `runs/<id>/`.

## What the agent must not do

- Freeze, unfreeze, or edit the Goal.
- Deliver, approve, or merge.
- Force-push, `git reset --hard`, or `git clean -fd`.
- Widen scope, change verification config, or add a dependency.
- Guess a product decision, or pick a `RUN_CONFLICT` option the human has not answered.

## Stop conditions

Stop on the first one that is true. Do not start another iteration after it.

| Code | Stop when |
|---|---|
| `GOAL_NOT_FROZEN` | The Goal is not frozen. Do not invent one. |
| `NEEDS_HUMAN` | A question is waiting, or the next step is a product decision. |
| `GUARD_BLOCK` | `guard-events.json` has a `block`. |
| `BUDGET` | The budget kill switch is on, or `budget record --unavailable` fails. |
| `VERIFY_STILL_RED` | Verification is still red at the iteration cap. |
| `JUDGE_ESCALATE` | The Judge escalated. |
| `JUDGED_PASS` | The Judge passed. Wait. Do not deliver. |

## What must be left for the morning

A person should be able to review without replaying the session.

- The frozen Goal (`goal.frozen` on the Run).
- `runs/<id>/diff.patch` when the stop is `JUDGED_PASS` or the human has since approved delivery.
- `runs/<id>/verification.json` (command, exit code, logs) in those same cases.
- `runs/<id>/verdict.json` for `JUDGED_PASS` and `JUDGE_ESCALATE`.
- `runs/<id>/findings.json` when a review ran.
- Unanswered questions in `interactions.jsonl`.

`JUDGED_PASS` is a successful stop. The human delivers in the morning with `deliver --approve --by <name>`.

## Check

```bash
npx ai-engineering-loop overnight check [--run <id>] [--json]
```

Exit 0 when the contract holds. Exit 1 when an unattended Run was delivered without a person (`humanApproved` not true, or `approvedBy` is an agent name), or a stopped Run is missing the morning files above. Assisted and report-only Runs do not apply; the check says so and exits 0.
