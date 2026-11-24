# Stage 8: Delivery

- After Judge PASS (and `verify --final` if verification was `--related`), run the `after_pass` hook, then the Stage 8 adapter from `.ai-engineering-loop/adapter.md`.
- Before any push, run `npx ai-engineering-loop doctor`: `✗ adapter-*` (unknown `adapter_type`, missing spec) must be fixed; `! adapter-*` (gh/glab not logged in, configured type differs from the detected one) needs a human look. `deliver` repeats this check: UNATTENDED stops before writing, ASSISTED only warns.
- The PR/MR body includes `Steps to Reproduce & Testing (QA)`; bugfix placeholders must not stay empty. Disclose any `budget record --unavailable`.
- Preview remote payloads; never include context packs, usage ledgers, raw logs, or credentials.
- ASSISTED: never infer approval. When the human says yes, record it at once: `npx ai-engineering-loop deliver --run <runId> --approve --by <name>`. After commit, push and PR/MR, finish with `deliver --run <runId> --destination <where> --summary <text> --approve --by <name>` (writes `delivery.json` with `humanApproved: true`, runs `gate delivery`).
- Long form: `node status --run <runId>`, `node approve delivery-approval --yes --by <name> --run <runId>` for each READY approval node, write `RUN_DIR/delivery.json`, then `gate delivery`. If the gate says a node is not READY, follow its prerequisite hint; never bypass approval.
- Commit before `deliver` (its receipt binds `HEAD`; videos/screenshots: `--evidence AC-N=<https-url>`, required for `crossComponent` and rubric ACs). Paste `RUN_DIR/receipt.md` into the PR/MR Receipt section unchanged; ❌ stays ❌ (`docs pr-receipt`).
- Only the delivery gate completes the run. It also mines lessons for the next Run.
- Worktree Run: after `deliver`, continue in `cleanup.mainCheckout` (Stage 9).
- After the PR is open, `npx ai-engineering-loop pr babysit --run <runId>` polls with backoff. Failing checks start a T0 or T1 fix on that same branch and push it. Ready to merge, or changes requested, stops for a human. Merge stays with the human (`docs run-isolation`).

## Report header (execution mode)

When a subagent returned its own result (Grok: its own `subagent_id`):

```
Execution Mode: TRUE_INDEPENDENT_AGENT
Independent LLM Execution: PROVEN
Native Subagent Invocation: AVAILABLE
Review Method: True Independent Agent
```

When no subagent ran (tool AVAILABLE: mode adds `(reason: <why>)`):

```
Execution Mode: CONTEXT_ISOLATION_ONLY
Independent LLM Execution: NOT PROVEN
Native Subagent Invocation: UNAVAILABLE
Review Method: Clean-Slate Artifact Isolation Barrier
```
