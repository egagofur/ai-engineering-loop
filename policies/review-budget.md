# Review Budget (all hosts)

Applies to Devil's Advocate and Judge on Claude Code, Grok CLI, and Antigravity. Parent always waits; children never run in the background.

The **agent body** (instructions + JSON output) is identical on all three hosts. Source of truth:

- `agents/shared/devil-advocate.body.md`
- `agents/shared/judge.body.md`

Host files (`.claude/agents/`, `.grok/agents/`, `.agents/`) may differ only in YAML frontmatter (tool names). Tests fail if a host body drifts.

## Shared spawn rules

- Write `git diff` to `.ai-engineering-loop/tasks/current.diff` before review.
- Pass artifact **paths**, not Maker chat.
- Spawn DA and Judge as siblings. Do not nest.
- Prefer named types `devil-advocate` and `judge`. Use `general-purpose` only if the named type is rejected.
- Skip `*.css`, `*report-css*`, generated/vendor. Do not run `git log`.

## Devil's Advocate

- At most **8** tool calls, then emit the Finding Ledger.
- Read the diff file first. Do not run `git diff` if that path was given.
- Open at most **8** files that appear in the diff. Prefer quoting a hunk over opening the whole file.

## Judge

- At most **4** tool calls, then emit PASS, ITERATE, or ESCALATE.
- Read the Finding Ledger and Goal Contract first.
- Open source only to fact-check a `location` the ledger already cited.
- Do not re-review the whole diff. Do not roam the repo.
