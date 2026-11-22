# Loop commands and Studio

- `init` / `status` / `refresh` / `sync-hosts`: run `npx ai-engineering-loop <command>` in the repo. `sync-hosts` installs the core pack into hosts that already exist; `--pack backend|design` opts in, and user-edited files are backed up first. Do not commit unless asked.
- `onboard`: load skill `project-onboarding` to fill `.ai-engineering-loop/architecture.md` and `conventions.md` from the code with evidence. Never automatic.
- `generate-adapter`: load skill `generate-adapter` if present. Grill Q1-Q5, then write `.ai-engineering-loop/adapter.md`. Do not start Maker.
- `generate-workflow`: load skill `generate-workflow` if present. Grill Q1-Q6. Q6 Maker intern: list numbered options from the host model catalog (see Host rules) plus `none`; if there is no catalog, offer only `none`. Do not type a model name. Write `.ai-engineering-loop/workflow.md` and an empty `lessons.md` if missing. Do not start Maker. Missing `maker_intern` means INVOCATION_UNAVAILABLE.

- Never run `update apply|auto|rollback|policy` unless the user asks; the CLI applies updates itself under the user's policy (`docs runtime-safety`).

## Harness health and history

Run these when the user asks how the loop is doing, before planning work, or when a gate points at them. All read local Run files; none starts a Run.
- `stats [--last <n>] [--json]`: failure causes by harness layer (`task_spec`, `context`, `environment`, `verification`, `state`, `model`), false-victory rate per tier, iterations to PASS, revert rate of delivered Runs (from git) and the verification share of tokens. Fix the bottleneck layer first.
- `learn --transcripts [--since 30d]`: corrections you repeated across agent chats become candidate lessons (local, redacted; `docs verification-loop` 12).
- `learn promote ... --prove <commit>`: the check must fail on the commit that introduced the mistake. `measurement record --ac <id> --runs <n> --spread <pct> --effect <pct> --limiter <text>` for `measure: true` ACs (`docs verification-loop` 3e).
- `run --worktree "<task>"` starts a task in its own git worktree when another Run is unfinished; `worktree prune [--audit] [--include-scratch] [--yes]` removes finished, clean worktrees and merged branches; `pr status --run <id>` reads the PR once and records `merge.json` when merged (`docs run-isolation`).
- `recap [--days N] [--for me|lead|client] [--projects <p,...>|all]`: one HTML page of what shipped, with evidence (`docs recap`). Client recaps take one project.
- `outcome record --run <id> --source mr-comment|revert|bug|incident --location <file[:line]> --summary <text> --by <name>`: a problem people found after delivery. Only record what the human reported; never invent one. Then `calibrate` lists DA misses and wrong dismissals per reviewer prompt version.
- `debt [--file <path>]` lists trade-offs the Judge accepted and L3 waivers; `debt close <id> --by <name>` only on the human's word.
- `next`: the next unblocked feature in `.ai-engineering-loop/features.json` and VCR (verified/activated). Finish the active feature before starting another.
- `learn` lists lessons seen in 3+ Runs; a human promotes one with `learn promote <id> --check "<cmd>" --fix "<instruction>" --by <name>`. Default `verify` then runs it as an L1 rule. On a codebase that already has old violations use `--scope diff`: the check reads only added lines from `$AEL_ADDED_LINES_FILE`, so new ones fail and the old ones become a backlog (`doctor --harness`). Common cases need no script: `--forbid-import "src/renderer/** -> src/main/**"` or `--forbid-api "\buseEffect\(" --except "src/framework/**"`.
- `.ai-engineering-loop/feature-map.md` (Feature | Where | Paths | How to reach | Driver): `review-pack` adds the features a diff touches; use those names and drivers for L3 evidence. `feature-map scaffold` drafts the table from routes, OpenAPI, pages, or the README (a stub if none) and never overwrites an edited map (`.ael-new`). `driver scaffold [--feature <id>]` writes a reusable driver (launch, drive, observe) per row and fills the Driver column; fill in its `EXPECT` and steps once, then reuse it every Run.
- Dig before asking (`docs dig-first`): `.ai-engineering-loop/sources.md` lists readable sources (read-only); `sources hint` suggests queries, `sources record` caches one line each (budget T0 0, T1 4, T2 8). Goal `statements` label fact/decision/assumption; a fact needs `path:line`, a commit or a recorded `S-n`. Assumptions are shown, never blocking.
- `doctor --harness`: harness debt (entry-file size and structure, stale learnings, rule provenance, skill budget). Report findings; do not mass-delete.
- `bench --without <integrity|l3|l1|smoke|rules>` measures whether a gate component still earns its cost (`docs bench`). Never use it on a real task.

## Personal workflow

No task (`ael`, "hi", "what can you do"): offer, numbered, 1) build my workflow, 2) start a task, 3) show status. Do not create a Run or edit files. For 1: `workflow interview --json`, show the pre-filled answers with their evidence, let the user confirm or change them, write the answers to a temp file, then `workflow propose --answers <file> --json` and show the diff. Install only after the user says yes: `workflow accept --proposal <id> --by <name>`. At a no-task start or at Deliver, show at most one pending `workflow suggest` proposal. Never accept for the user. The safety backbone cannot be removed (`docs personal-workflow`).

## Studio

Stage commands (`run`, `goal`, `gate`, `verify`, `review-pack`, `deliver`, `node start|activity|complete`) stream into an open Studio; `status --json` reports `studioUrl`. Emit `npx ai-engineering-loop activity heartbeat --run <runId> --phase <phase> --message <short factual summary>` only during long manual work, never before every stage. Before asking the human, persist the question with `npx ai-engineering-loop interaction question --run <runId> --id <id> --message <text>` so it appears once in Studio.

## Budget

`run --json` already reports the budget; run `budget status --run <runId>` only before each new iteration. After each child, `budget record --input <n> --output <n> --model <id> --role maker|reviewer|judge|verification|gather --run <runId>` from provider usage. No usage shown: `budget record --unavailable --run <runId>` once; ASSISTED continues and discloses it at delivery (do not ask the human); UNATTENDED fails that command, so stop and escalate. `budget pause` is the kill switch. The ledger mode is immutable. UNATTENDED or budget errors: `docs runtime-safety`.

## Resuming

`state --json` gives the current runId only when resuming a run. If stopping mid-loop, write `.ai-engineering-loop/tasks/handoff.md` (`docs handoff-policy`).
