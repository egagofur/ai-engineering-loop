# Weekly process-sampling playbook

Once a week, read three recent Runs. If the project has fewer than three, read all of them. You are checking that the loop was followed. You are not re-reviewing the product.

## Pick the sample

1. List `.ai-engineering-loop/runs/` and take the three newest directories that contain `state.json`.
2. Skip `CANCELLED` unless you are asking why the work stopped.
3. Write down the run id, the task, the tier, and the state.

`ael recap --days 7` is a map of what shipped. The sample still comes from the Run directories, because the recap does not show a skipped gate.

## For each Run, answer from files

| Question | Where to look | Followed when |
|---|---|---|
| The Goal was frozen before the code changed | `state.json` history, then `diff.patch` | `GOAL_FROZEN` is earlier than the diff |
| Verification is a command, not a claim | `verification.json` | `commands` has an entry, `exitCode` is 0, and stdout is stored |
| Review happened when the tier needs it | `findings.json` | T1 and T2 have a ledger. T0 may have the empty ledger the CLI writes |
| The Judge matches the ledger | `verdict.json` | `PASS` only when no BLOCKER or HIGH is still open. Otherwise `ITERATE` or `ESCALATE` |
| A person approved delivery | `delivery.json` | `humanApproved` is true and `approvedBy` is that person |
| The diff stayed inside the Goal | `diff.patch`, the frozen Goal, `impact-map.json` | No surprise files outside the frozen scope |

A missing file is "could not tell", not a pass.

## Write the note down

Three lines per Run: followed, one miss, or "could not tell" plus the missing file. Keep the note in your own weekly log. The loop does not store it.

## When a Run skipped a gate

Do not patch history. On the next Run, watch that gate. If the same gate is skipped in a second sample, treat it as a loop bug and fix the gate.
