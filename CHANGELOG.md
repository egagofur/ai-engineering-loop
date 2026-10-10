# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/). Entries under **Unreleased** ship with the next version bump.

## Unreleased

### P2 — combined stage commands to cut agent round-trips (#34)

- **Added:** `verify [--cmd "<command>"]... [--shell] [--serial]` records the commands in parallel by default (`--serial` to opt out), and only if all pass runs `gate verification`, compacts the run, and scaffolds `claimed-vs-reality.md`. With no `--cmd` it uses `test_unit` from `.ai-engineering-loop/verification.md`. Failing commands are recorded and never gated.
- **Added:** `review-pack --json` builds the fast-path assessment, diff-hunk pack, and escalation floor in one call and returns the pack path, tier, and whether a Devil's Advocate is needed.
- **Added:** `deliver --destination <where> --summary <text> --approve --by <name>` approves READY approval nodes, writes `delivery.json`, and passes the delivery gate. In ASSISTED it refuses (exit 2, nothing written) without `--approve`.
- **Added:** `goal freeze --latest --by <name>`: the CLI resolves the newest draft revision and hash.
- **Changed:** `run --json` also returns the budget summary and host-skill freshness. Stage commands publish Studio heartbeats automatically, so skills no longer ask for a manual heartbeat before every stage or for a separate `tasks/current.diff`.
- The long command forms still work, and the tests show both paths produce identical gate history, artifacts, and workflow node states.

### P1 — automatic task tiers with a deterministic review gate (#33)

- **Added:** `run` classifies each new run as **T0** (trivial: docs/typo/lint/bump, small), **T1** (default), or **T2** (risky task text, `HIGH_RISK_PATH`, more than 10 files) and stores `tier` with reasons in `state.json`. `run --json` prints `tier`, `tierReasons`, and the expected subagent count. `--tier T0|T1|T2 --tier-reason <text>` overrides and is recorded.
- **Added:** `gate maker` re-assesses the tier from the gated diff and only raises it (for example T1 → T2 when the diff touches `src/auth/`).
- **Added:** T0 has no Devil's Advocate. `gate review` writes an explicit empty, diff-bound ledger only after `claimed-vs-reality.md` is complete. T0 and T1 `gate judge` write a deterministic verdict (`decidedBy: deterministic-gate`) when there are no BLOCKER/HIGH findings, escalation is `CHEAP_MODEL`, and the iteration is under the cap. Otherwise the Judge subagent is required. `gate review --json` reports `judgeRequired` with reasons.
- **Changed:** A T2 Judge `PASS` requires `modelTier` `STRONG_MODEL` or `HUMAN`. Runs without a tier (created before this change or directly through the library) keep the previous full-Judge behavior.
- **Changed:** The DOT blast-radius grill applies to business-logic changes, not to every DOT task.
- **Added:** Four evaluation cases (21–24) for the tier paths. The catalog is now 24 cases.

### P0 — slim context and round-trips without weakening gates (#26)

- **Fixed (#25):** `--help` / `-h` on any command prints that command's usage and exits without side effects. `sync-hosts --help` no longer runs a real sync. Writer commands (`init`, `refresh`, `sync-hosts`, `update`, `generate-adapter`, `generate-workflow`) reject unknown flags with exit code 2 before writing anything.
- **Fixed (#25):** `sync-hosts` records what it wrote in `~/.ai-engineering-loop/host-manifest.json`. A host file that was edited by hand (or that predates the manifest) is copied to `<file>.ael-backup` before it is overwritten.
- **Changed (#27):** Host skills no longer tell agents to read all of `core/`, `agents/`, and `policies/` (files that do not exist in target repositories). New read-only `ai-engineering-loop docs <name> [--section <heading>]` prints one packaged spec, and skills cite specs only at the stage that needs them.
- **Changed (#28):** Devil's Advocate / Judge budgets live in the agent bodies. Parent skills keep only the one-line spawn prompt (needed when a host falls back to a `general-purpose` child); the Claude command no longer repeats them.
- **Changed (#29):** When the host exposes no provider usage, `budget record --unavailable` notes the gap once. `ASSISTED` continues and discloses it at delivery instead of asking the human; `UNATTENDED` fails closed with `USAGE_UNAVAILABLE_UNATTENDED`. `budget status` runs once per iteration instead of before every child.
- **Changed (#30):** `run` no longer syncs host skills, and Stage 0 no longer calls `sync-hosts`. `status` / new `status --json` report `hostSkills` freshness (`installedVersion`, `packageVersion`, `stale`, `staleFiles`) without writing.
- **Changed (#31):** `sync-hosts` installs only the `core` pack by default. `--pack backend,design` opts in (saved in `~/.ai-engineering-loop/config.json`); `--prune` removes unmodified files of unselected packs. Existing installs keep any optional pack already on disk.
- **Fixed (#32):** `dot-dev-skill-router` names only skills that exist in AEL or dot-plugin (`verification-before-completion`, `design-openapi-contract`, `generate-api-test`, ...) or are explicitly marked *optional, if installed*. Plan-execution and brainstorming routes now go through the AEL loop instead of around it.
