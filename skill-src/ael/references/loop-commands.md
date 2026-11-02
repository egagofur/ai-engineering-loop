# Loop commands and Studio

- `init` / `status` / `refresh` / `sync-hosts`: run `npx ai-engineering-loop <command>` in the repo. `sync-hosts` installs the core pack into hosts that already exist; `--pack backend|design` opts in, and user-edited files are backed up first. Do not commit unless asked.
- `onboard`: load skill `project-onboarding` to fill `.ai-engineering-loop/architecture.md` and `conventions.md` from the code with evidence. Never automatic.
- `generate-adapter`: load skill `generate-adapter` if present. Grill Q1-Q5, then write `.ai-engineering-loop/adapter.md`. Do not start Maker.
- `generate-workflow`: load skill `generate-workflow` if present. Grill Q1-Q6. Q6 Maker intern: list numbered options from the host model catalog (see Host rules) plus `none`; if there is no catalog, offer only `none`. Do not type a model name. Write `.ai-engineering-loop/workflow.md` and an empty `lessons.md` if missing. Do not start Maker. Missing `maker_intern` means INVOCATION_UNAVAILABLE.

- Never run `update apply|auto|rollback|policy` unless the user asks; the CLI applies updates itself under the user's policy (`docs runtime-safety`).

## Personal workflow

No task (`ael`, "hi", "what can you do"): offer, numbered, 1) build my workflow, 2) start a task, 3) show status. Do not create a Run or edit files. For 1: `workflow interview --json`, show the pre-filled answers with their evidence, let the user confirm or change them, write the answers to a temp file, then `workflow propose --answers <file> --json` and show the diff. Install only after the user says yes: `workflow accept --proposal <id> --by <name>`. At a no-task start or at Deliver, show at most one pending `workflow suggest` proposal. Never accept for the user. The safety backbone cannot be removed (`docs personal-workflow`).

## Studio

Stage commands (`run`, `goal`, `gate`, `verify`, `review-pack`, `deliver`, `node start|activity|complete`) stream into an open Studio; `status --json` reports `studioUrl`. Emit `npx ai-engineering-loop activity heartbeat --run <runId> --phase <phase> --message <short factual summary>` only during long manual work, never before every stage. Before asking the human, persist the question with `npx ai-engineering-loop interaction question --run <runId> --id <id> --message <text>` so it appears once in Studio.

## Budget

`run --json` already reports the budget; run `budget status --run <runId>` only before each new iteration. After each child, `budget record --input <n> --output <n> --model <id> --run <runId>` from provider usage. No usage shown: `budget record --unavailable --run <runId>` once; ASSISTED continues and discloses it at delivery (do not ask the human); UNATTENDED fails that command, so stop and escalate. `budget pause` is the kill switch. The ledger mode is immutable. UNATTENDED or budget errors: `docs runtime-safety`.

## Resuming

`state --json` gives the current runId only when resuming a run. If stopping mid-loop, write `.ai-engineering-loop/tasks/handoff.md` (`docs handoff-policy`).
