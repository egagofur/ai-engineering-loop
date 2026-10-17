# Blast-Radius Impact Map

Scope is decided before code, not discovered after it. Once the Goal Contract is frozen, the CLI writes a heuristic **impact map** into the Run: `.ai-engineering-loop/runs/<runId>/impact-map.json` (schema: `schemas/impact-map.schema.json`). It works on every adapter and in any language the repository uses; it does not depend on DOT or on Indonesian prompts.

## What it lists

Each entry has a `confidence` (0–1) and a `reason`.

| Section | Source |
|---|---|
| `files` | Indexed source files whose path or exported symbols match keywords from the Goal objective, AC statements, and failure cases (English and Indonesian filler words are dropped) |
| `modules` | The top two directory levels of the matched files |
| `endpoints` | Route declarations in matched files (`router.post('/x')`, `app.get(...)`, `@Get('/x')`) |
| `dbTables` | Matching migrations/`.sql` files and `CREATE`/`ALTER`/`DROP TABLE` names found in them |
| `tests` | Matching test files and tests named after a matched source file |

The scan is deterministic (`generator: heuristic-v1`): no model call and no call graph. Treat it as a starting point for the human, not as proof.

## Lifecycle

```bash
npx ai-engineering-loop goal freeze --latest --run <id> --by human   # writes impact-map.json (DRAFT)
npx ai-engineering-loop impact show --run <id>
npx ai-engineering-loop impact confirm --run <id> --by <name> [--allow 'docs/**'] [--remove src/x.js]
# or, for copy / CSS / comment-only goals:
npx ai-engineering-loop impact skip --run <id> --by <name> --reason "copy-only change"
```

- **DRAFT**: written on Goal freeze (and before `gate maker` if it is still missing). `impact map --force` regenerates it.
- **CONFIRMED**: the human accepted or edited it. Its `scope.allowedPaths` (mapped files, tests and migrations, plus `--allow` globs, minus `--remove`) is the Run's allowed scope, which the runtime guardrail enforces. A confirmed map is locked; `impact map --force` resets it to DRAFT.
- **SKIPPED**: trivial goal; `skipReason` is required and kept in the Run.

In ASSISTED mode, show the map to the human and confirm or edit it before Stage 3. On `adapter_type: dot` the `task-impact-inquiry` grill stays mandatory; the map records its outcome.

## Drift at verify

When the verification gate passes, the CLI compares the gated Maker diff with the map and writes `impact-drift.json` (`mapStatus`, `changedFiles`, `outOfMap`). `verify` prints any out-of-map file, `review-pack` lists them for the Devil's Advocate (`impactDrift` in the pack), and the review gate adds one `LOW` / `VALID` / `ACCEPTABLE` finding per file to `findings.json` with `source: "impact-map"`. Drift is a warning: it reaches the Judge and the delivery evidence but never blocks on its own. A DRAFT map is compared against its mapped paths (the finding says "unconfirmed"); a SKIPPED or missing map records no drift.
