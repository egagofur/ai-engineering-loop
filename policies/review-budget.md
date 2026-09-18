# Review Budget (all hosts)

Applies to Devil's Advocate and Judge on Claude Code, Grok CLI, and Antigravity. Parent always waits; children never run in the background.

The **agent body** (instructions + JSON output) is identical on all three hosts. Source of truth:

- `agents/shared/devil-advocate.body.md`
- `agents/shared/judge.body.md`

Host files (`.claude/agents/`, `.grok/agents/`, `.agents/`) may differ only in YAML frontmatter (tool names). Tests fail if a host body drifts.

## Shared spawn rules

- Write `git diff` to `.ai-engineering-loop/tasks/current.diff` before review.
- Pass artifact **paths**, not Maker chat.
- Use the runtime policy `reviewProfile` to size context packs. Default `lean` protects Codex/GPT Plus-style sessions from repeated full-file prompts while keeping all gates intact.
- Prefer `npx ai-engineering-loop context diff-hunks --run <run-id>` for review. It writes a private hunk-only pack with file summaries and unresolved findings, so reviewers do not need full source bodies unless a cited hunk is insufficient.
- Run `npx ai-engineering-loop verification summarize --run <run-id>` after writing `verification.json`; pass the summary path to Judge before raw logs.
- Spawn DA and Judge as siblings. Do not nest.
- Prefer named types `devil-advocate` and `judge`. Use `general-purpose` only if the named type is rejected.
- Skip `*.css`, `*report-css*`, generated/vendor. Do not run `git log`.

| Profile | Intended use | Context behavior |
|---|---|---|
| `lean` | Default for normal paid-agent sessions | Smaller packs, compact findings, iteration-delta review |
| `standard` | Broader routine changes | Moderate packs; still path-first and hunk-first |
| `thorough` | Explicit human opt-in for expensive review | Previous larger limits; use only when risk justifies cost |

## Devil's Advocate

- At most **8** tool calls, then emit the Finding Ledger.
- Read the diff file first. Do not run `git diff` if that path was given.
- Open at most **8** files that appear in the diff. Prefer quoting a hunk over opening the whole file.
- Emit at most **5** findings unless another finding is a BLOCKER. Keep evidence fields short and concrete.
- On iteration 2+, review only the smart diff-hunk pack's new hunks plus unresolved findings unless the changed evidence reopens an accepted finding.
- Report Spec and Standards as separate findings. Do not spawn children to split axes. Do not merge the two axes.

## Judge

- At most **4** tool calls, then emit PASS, ITERATE, or ESCALATE.
- Read the Finding Ledger and Goal Contract first.
- Open source only to fact-check a `location` the ledger already cited.
- Do not re-review the whole diff. Do not roam the repo.
- Keep the verdict compact: blocking IDs, accepted tradeoff IDs, and the shortest action that unblocks the next step.
