# Stage 8: Delivery

- After Judge PASS (and `verify --final` if verification was `--related`), run the `after_pass` hook, then the Stage 8 adapter from `.ai-engineering-loop/adapter.md`.
- Before any push, run `npx ai-engineering-loop doctor`: `✗ adapter-*` (unknown `adapter_type`, missing spec) must be fixed; `! adapter-*` (gh/glab not logged in, configured type differs from the detected one) needs a human look. `deliver` repeats this check: UNATTENDED stops before writing, ASSISTED only warns.
- The PR/MR body includes `Steps to Reproduce & Testing (QA)`; bugfix placeholders must not stay empty. Disclose any `budget record --unavailable`.
- Preview remote payloads; never include context packs, usage ledgers, raw logs, or credentials.
- ASSISTED: wait for explicit human approval and never infer it. Then one call: `npx ai-engineering-loop deliver --run <runId> --destination <where> --summary <text> --approve --by <name>` (approves READY approval nodes, writes `RUN_DIR/delivery.json` with `humanApproved: true`, runs `gate delivery`). Without `--approve` it refuses in ASSISTED.
- Long form: `node status --run <runId>`, `node approve delivery-approval --yes --by <name> --run <runId>` for each READY approval node, write `RUN_DIR/delivery.json`, then `gate delivery`. If the gate says a node is not READY, follow its prerequisite hint; never bypass approval.
- Commit before `deliver` (its receipt binds `HEAD`; screenshots: `--evidence AC-N=<https-url>`). Paste `RUN_DIR/receipt.md` into the PR/MR Receipt section unchanged; ❌ stays ❌ (`docs pr-receipt`).
- Only the delivery gate completes the run. It also mines lessons for the next Run.
