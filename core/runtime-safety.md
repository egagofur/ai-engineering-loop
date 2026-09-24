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

## Review profile

Context packs default to the `lean` review profile so paid conversational hosts do not exhaust tokens on repeated full-file review context. The profile changes context limits and reviewer output expectations only; it does not skip Goal Contract, verification, Devil's Advocate, Judge, or delivery gates.

```bash
npx ai-engineering-loop policy set --review-profile lean
npx ai-engineering-loop policy set --review-profile standard
npx ai-engineering-loop policy set --review-profile thorough
```

Use `lean` for normal Codex/GPT Plus-style sessions, `standard` when the diff is broad but still routine, and `thorough` only when the human explicitly opts into a deeper, more expensive review. A single context pack can override the policy without changing future runs:

```bash
npx ai-engineering-loop context devil-advocate --profile thorough <files...>
```

Prefer smart context before opening whole files:

```bash
npx ai-engineering-loop context index
npx ai-engineering-loop context query createStudioRun
npx ai-engineering-loop context related lib/studio-server.js
npx ai-engineering-loop context fast-path --json
npx ai-engineering-loop context diff-hunks --run <run-id>
npx ai-engineering-loop context diff-hunks --run <run-id> --include-ignored
npx ai-engineering-loop verification record --run <run-id> -- npm test
npx ai-engineering-loop verification summarize --run <run-id>
npx ai-engineering-loop context compact --run <run-id>
```

The index stores file summaries and hashes, never file bodies, and reuses per-hash summaries when files are unchanged. `query` and `related` return metadata only so agents can choose the right files before reading source. `fast-path` keeps low-risk small diffs on lean review and names the reason when a task must use the standard path. The diff-hunk pack stores bounded changed hunks, file summaries, token estimates, unresolved blocking findings from the previous ledger, and a count of paths skipped by context policy. Smart context skips CSS, generated bundles, lockfiles, build output, and `.aelcontextignore` matches by default; pass `--include-ignored` only when those files are the task. `verification record` executes the command without a shell by default, stores bounded output after secret and local-path redaction, binds it to the gated Maker diff, and records failures instead of hiding them. `verification summarize` extracts available test counts and short failure excerpts without forwarding raw logs. Context budget errors include per-file estimates (paths and counts only). `context compact` writes `run-summary.md`, `run-summary.json`, and `open-findings.json` so iteration 2+ reviewers and Judge start from compact artifacts and request full source or logs only when the hunk or summary cannot prove or disprove a finding.

## Package update workflow

Agents may check for package updates, but must not update the user's global or project installation without explicit instruction. Use:

```bash
ai-engineering-loop update check
ai-engineering-loop update plan
ai-engineering-loop update apply --yes
```

`update plan` prints the exact install, `sync-hosts`, `refresh`, and `doctor` commands for the detected install scope. `update apply --yes` runs those commands explicitly; the separate `--yes` flag is the confirmation boundary.

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
