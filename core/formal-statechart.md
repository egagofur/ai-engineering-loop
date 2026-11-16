# Formal flows with pstack `/statechart`

How to prove a risky user flow with a model checker and feed the result into AEL's gates. AEL ships none of this tooling; it only recognises the evidence (card C-25).

## When it is worth it

Use it for flows where a wrong state is expensive and hard to see in unit tests: payments and refunds, sync across devices, retries with leases, notification fan-out, multi-step approvals. For an ordinary screen flow, the Goal `flow` diagram (below) is enough.

## The tool

[`statechart`](https://github.com/cursor/plugins/tree/main/pstack/skills/statechart) is a skill in the pstack plugin by Lauren Tan (MIT). You write a TLA+ spec in which each rule the reader agrees to is an `INVARIANT`. TLC model-checks it, and the skill draws the result as a Mermaid statechart. Its report gives the shortest path to every state that breaks a rule.

Requirements: Java and TLC (installed with `mise` on first run, which needs the network) and a runtime that executes TypeScript. Install pstack as a Cursor plugin, or follow its Claude Code guide (`docs/harness/claude-code.md` in pstack) and call it as `/pstack:statechart`. It runs only when asked (`disable-model-invocation`).

## Wire it into AEL

1. Keep the spec in the repository, for example `spec/checkout.tla` and `spec/checkout.cfg`. Keep constants small, or add a `CONSTRAINT`: TLC keeps going past a broken rule, so an unbounded model can run without end.
2. `statechart` requires its `--out` folder to be new or empty, so a fixed folder fails the second `verify` (exit 2). Wrap it in a small script that clears the folder first, and add the folder to `.gitignore` (otherwise delivery reports it as an untracked file, C-06):

   ```sh
   #!/usr/bin/env sh
   # scripts/formal.sh
   set -e
   rm -rf .tmp/statechart
   exec "$PSTACK/skills/statechart/scripts/statechart" spec/checkout.tla --config spec/checkout.cfg --out .tmp/statechart
   ```

3. Register the wrapper as the `formal` key in `.ai-engineering-loop/verification.md`. `formal` is layer `LF` and never runs in the default plan:

   ```
   - **formal**: `sh scripts/formal.sh`
   ```

   The statechart command exits with TLC's code: 0 when every rule holds, 1 when a rule breaks, 2 when TLC stops with an error. So a broken rule fails the verification gate like any other failing command.
4. Require it on the AC that the model covers:

   ```json
   { "id": "AC-2", "statement": "A refund never leaves the order both paid and refunded", "evidenceRequired": "TLC model check", "failureCases": ["double refund"], "verify": { "layer": "LF" } }
   ```

   Default `verify` then runs `formal` (C-23), and `gate judge` refuses PASS until it passed on the gated diff (`AC_NOT_PROVEN`).
5. Attach the chart to the PR receipt: publish `chart.mmd` (or a rendered image) and pass `deliver --evidence AC-2=<https-url>`. The receipt lists it under "Verification artifacts" as a diagram.
6. When the model describes code, replay each bug path from the report against the real code, as a test or a live repro. A path that does not reproduce means the model is wrong until shown otherwise.

## Without TLA+: the Goal `flow` diagram

A Goal Contract `flow` (`[{ "from", "event", "to" }]`, see `docs goal-contract`) is rendered by `goal draft` and in the PR receipt as a Mermaid `stateDiagram-v2` plus a `From | Event | To` table. GitHub renders the diagram in the PR. It lets a reviewer check that the agent understood the intended flow; it proves nothing about the code. For proof, use `formal` as above.

Skill text never contains Mermaid (some hosts cannot render it); diagrams appear only in command output and PR receipts.
