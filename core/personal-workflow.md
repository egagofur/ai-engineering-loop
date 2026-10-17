# Personal workflow

A personal workflow is your own recipe. It belongs to **you, not a repository**: it is stored under your AEL home and applies to every repo you work in, unless a project pins its own recipe. AEL proposes changes to it from your run history. Only you install them.

## Onboarding (no-task invocation)

When the skill is invoked without a concrete task (`ael`, "hi", "what can you do"), the agent does not create a Run and does not edit files. It offers three options:

1. build my workflow,
2. start a task,
3. show status.

Building the workflow:

```bash
npx ai-engineering-loop workflow interview --json             # questions, pre-filled from history, each with evidence
npx ai-engineering-loop workflow propose --answers a.json --json  # candidate recipe + diff, validated by the compiler
npx ai-engineering-loop workflow accept --proposal <id> --by <name>
npx ai-engineering-loop workflow reject --proposal <id> --by <name>
```

`interview` fills each answer from the last 20 run summaries when at least 80% of them agree, and cites the run ids and counts it used. With no history it returns plain defaults (T1, ASSISTED, no extra approvals, `maker_intern: none`).

## Where it lives

Everything is under the AEL home: `$AEL_HOME/.ai-engineering-loop/` if `AEL_HOME` is set, otherwise `~/.ai-engineering-loop/`. Nothing here is ever committed to a repository.

| Path | Content |
|---|---|
| `workflow/personal.json` | the installed personal recipe (`id: personal`) |
| `workflow/.history/<version>.json` | previous versions |
| `workflow-proposals/<id>.json` | proposals: `pending`, `accepted`, `rejected` |
| `workflow-history.jsonl` | one summary per finished Run, across all repos |
| `config.json` | `defaultRecipe: personal`, who accepted it |

## Run history (`workflow-history.jsonl`)

Every terminal Run (`DELIVERED`, `ESCALATED`, `REPORTED`, or abandoned/`CANCELLED`) appends one line. Each line holds:

- run id, state, mode, tier, recipe id and `workflowSource`;
- iterations;
- impact confirm/skip and the out-of-map count;
- guard warn/block counts;
- gate outcomes;
- learning ids;
- `repoHash`, the sha256 of the resolved repo root.

It **never** holds the repository path, task text, file paths or contents, lesson text, or secrets, and the line is redacted before it is written. The file is mode 0600. Writing the summary can never undo a Run's terminal transition.

## Suggestions (proposals only)

`workflow suggest [--json]` reads the last 20 summaries and writes proposals. It never edits a recipe, a config, or `workflow.md`. Each proposal lists its evidence (run ids + counts). Current rules:

- 80% or more of T1 runs confirmed an unchanged impact map → an impact-confirm checkpoint aimed at later iterations.
- Markdown-only tasks ran at T0 in 80% or more of cases (at least 3) → a docs-light node.
- 4 or more of the last 10 T1 runs edited outside the impact map → an impact checkpoint before Maker.
- A learning id seen in 3 or more runs → a checklist note on the personal recipe.

A pending proposal of the same kind blocks a new one. A rejected proposal is not suggested again until its evidence has more runs than when it was rejected. The skill shows at most one pending proposal, at the start of a no-task session or at Deliver, and never mid-loop.

## Guarantees

- **Never silent.** No gate, recipe, tier rule or default changes without `workflow accept --by <name>`. UNATTENDED can never accept (`HUMAN_REQUIRED`), and the agent never accepts on the user's behalf.
- **The backbone cannot be removed.** Proposals compile through `lib/recipe.js`. A recipe that removes or conditionally skips goal-contract, devil-advocate or judge, removes the ASSISTED approval before delivery, or lowers the T2 Judge below STRONG_MODEL is rejected with a named error (`BACKBONE_*`), even if the user asks.
- Personalization may add nodes, change optional nodes, or choose among valid recipes. The host and model stay the user's choice.

## Precedence

`run` resolves the recipe in this order (see [Configuration precedence](./configuration-precedence.md)):

1. **Project-required.**
   - `workflow.requiredRecipe` pins a recipe; `workflow.allowPersonal: false` falls back to the built-in default. Both live in `.ai-engineering-loop/runtime-policy.json`.
   - Project recipe nodes marked `required: true` and `adapter.md` `required_node` lines are merged into whatever recipe wins and cannot be dropped.
   - `run --recipe <id>` cannot bypass a pinned recipe.
2. **Personal workflow** (`workflow/personal.json`), when the project does not pin one and the personal recipe supports the run mode.
3. **Built-in default**: `default`, or `audit` for REPORT_ONLY.

`run --json` reports `workflowSource` (`project-required`, `personal`, or `builtin`). An explicit `run --recipe <id>` picks that recipe for one run (reported as `builtin`).
