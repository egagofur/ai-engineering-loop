# Controlled Workflow Runtime

The controlled runtime binds a validated recipe to one run without replacing the existing artifact gates. It is opt-in through `run --recipe`; runs started without that option retain the legacy behavior.

## Immutable run binding

At run creation the CLI compiles the selected recipe and writes private runtime files under `.ai-engineering-loop/runs/<run-id>/`:

- `plan.json`: canonical compiled DAG with source and graph hashes
- `workflow-state.json`: reconstructable scheduler cache
- `events.jsonl`: append-only, hash-chained transition log

The run ledger stores the recipe ID, recipe version, source hash, and graph hash. Resume rejects a different graph. Every load recalculates the plan hash and verifies the full event chain. The state cache is reconstructed from events, so a stale or edited cache cannot grant a node permission to run.

## Scheduler rules

Node states are:

`PENDING → READY → RUNNING → PASSED`

Additional outcomes are `FAILED`, `SKIPPED`, and `BLOCKED`.

- A node becomes `READY` only after every dependency is `PASSED` or conditionally `SKIPPED`.
- A failed dependency makes descendants `BLOCKED`.
- `retry` returns a failed or interrupted custom node to `READY` and recalculates descendants.
- Structured conditions read only allowlisted run metadata.
- Legacy gates execute atomically under the workflow lock and mark their corresponding node passed only after existing artifact validation succeeds.
- Judge `ITERATE` resets Maker and its descendants while preserving upstream analysis.
- Judge `ESCALATE` blocks unfinished nodes.

## Commands

```bash
# Create an immutable recipe-bound run
ai-engineering-loop run --recipe bugfix --mode assisted "repair retry race"

# Inspect scheduler state
ai-engineering-loop node status --json

# Custom agent lifecycle
ai-engineering-loop node start root-cause
ai-engineering-loop budget status --node root-cause --estimate 4000
ai-engineering-loop budget record --node root-cause \
  --input 3000 --output 700 --model provider/model-id
ai-engineering-loop node complete root-cause \
  --artifact .ai-engineering-loop/runs/<run-id>/root-cause.json

# Failure and crash recovery
ai-engineering-loop node fail root-cause --reason provider-timeout
ai-engineering-loop node retry root-cause

# Explicit human checkpoint
ai-engineering-loop node approve delivery-approval --yes --by account-id
```

Existing gate commands remain authoritative for built-in stages:

```bash
ai-engineering-loop gate goal
ai-engineering-loop gate maker
ai-engineering-loop gate verification
ai-engineering-loop gate review
ai-engineering-loop gate judge
ai-engineering-loop gate delivery
```

## Artifact and token boundaries

Agent completion requires a regular JSON file inside the repository, rejects symlink escape, binds `runId`, validates the declared repository-relative schema, and records the artifact hash. Artifact content is never copied into the event log.

Provider-reported usage can be attributed to a node. `budget status --node --estimate` must be called before a model request; it combines kill switch, daily, run, node-state, and node token limits. `budget record --node` records actual provider usage after the response.

## Intentionally disabled

The runtime does not execute `command` nodes. Command nodes are conservatively classified as repository mutation, rejected in `REPORT_ONLY`, and fail with `COMMAND_EXECUTION_DISABLED`. Enabling them later requires a separate sandboxed executor with executable allowlists, environment filtering, bounded output, cancellation, and auditable process isolation.

The CLI also does not invoke a model itself. Host agents perform model work, record real token usage, and submit structured artifacts through the runtime boundary.
