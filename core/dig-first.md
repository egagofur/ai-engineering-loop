# Dig First, Then Ask (C-45, C-46)

Agents guess when they cannot see the source, and they ask the human what the repo, the tracker or the chat already answers. AEL gives them a short list of where to look, a budget, and a way to show which Goal statements are backed by a source.

## Sources registry

`init`, `refresh` and `ai-engineering-loop sources refresh` write `.ai-engineering-loop/sources.md`:

| Source | Detected by | Read with |
|---|---|---|
| code | git work tree with a commit | `rg`, `git log -S`, `git blame` |
| github | `gh auth status` | `gh issue list --search`, `gh pr list --search` |
| gitlab | `glab auth status` | `glab issue list --search`, `glab mr list --search` |
| mattermost | a Mattermost MCP server in a host config (`~/.claude.json`, `~/.cursor/mcp.json`, `~/.codex/config.toml`, Gemini/Antigravity config, project `.mcp.json`) | the MCP's read and search tools only |
| ael | past Runs, `lessons.md`, `debt.json`, `feature-map.md` | `learn`, `debt list` |

The table is rewritten on every refresh. The `## Scope (edit me)` section is yours (channels, labels, things never to read) and is kept. Tokens are never stored. A missing source is listed as unavailable; nothing fails because of it, and the agent still digs in the code and git.

Connectors are triggers, not authorities: they are read-only. The agent never posts, comments or edits through them.

## Gather budget

| Tier | Gather queries per Run |
|---|---|
| T0 | 0 |
| T1 | 4 |
| T2 | 8 |

Record each useful result: `sources record --run <id> --source github --ref <url|path:line|sha> --line "<one line>"`. It lands in `runs/<id>/sources.json` as `S-n`, redacted, one line each. Past the budget the CLI refuses with `GATHER_BUDGET`: stop, mark the rest as assumptions, or ask the human one question. Stop early once every Goal statement has a source. `sources hint [--run <id>]` prints the commands worth trying for this task. Token use: `budget record --role gather`.

## Provenance labels

A Goal Contract may carry `statements`:

```json
"statements": [
  { "text": "Filters live in src/report/filters.js", "kind": "fact", "source": "src/report/filters.js:12" },
  { "text": "The issue asks for persistence", "kind": "fact", "source": "S-1" },
  { "text": "CSV, not XLSX", "kind": "decision", "by": "ega" },
  { "text": "Exports stay under 10k rows", "kind": "assumption" }
]
```

The goal gate checks every fact: `path:line` must exist, a commit SHA must exist (`git cat-file`), a URL or `S-n` must be recorded in `sources.json`. A fact that fails becomes an assumption with the reason; a decision with no `by` and no valid source does too. The gate never fails on this. Prose cannot turn an assumption into a fact; only a checkable source does.

The result is `runs/<id>/provenance.json`. Assumptions are shown, never blocking, on every tier: `status` ("Unconfirmed: n assumption(s)"), the receipt ("Unconfirmed assumptions"), and the review pack, where the Devil's Advocate may raise a finding when the code relies on one.
