# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/). Entries under **Unreleased** ship with the next version bump.

## Unreleased

_No changes yet._

## 1.14.0 - 2026-10-10

### Auto-update and project registry (#37)

- **Added:** `~/.ai-engineering-loop/projects.json`, filled by `init`/`run`/`status`/`refresh`, plus `projects list|add|remove|scan --root <dir> [--depth 4]`. Missing folders are pruned, and the scan skips `node_modules`, `.git`, and symlinks.
- **Added:** a background version check (detached, at most every 24 h, 3 s timeout, cached in `update-check.json`) that never blocks a command, even offline.
- **Added:** `update policy off|notify|patch|minor|all` with `--channel` and `--pin`. Majors are always notice-only. Opt out with `AEL_NO_AUTO_UPDATE=1` or `CI=true`.
- **Added:** `update auto` for global installs. It takes a lock, verifies the release repository and integrity, then runs `npm i -g`, `sync-hosts`, and `refresh --non-destructive` for every registered project. Projects with an active run stay pending, and updates wait while any UNATTENDED run is active. `update rollback --yes` undoes the update.
- **Added:** `refresh --non-destructive`. Files you edited are kept and new templates are written as `*.ael-new`. Generated hashes are tracked in `.ai-engineering-loop/.ael-generated.json`.
- **Added:** a useful update notice: current -> latest, 2-4 highlights from the target's CHANGELOG (fetched in the background and cached), one update command for the detected package manager (npm/pnpm/yarn/bun), and how to silence it (`AEL_NO_UPDATE_NOTICE=1`). At most once per 24 h per project, interactive stderr only, never in CI or `--json`. `CHANGELOG.md` now ships in the package.
- **Added:** legacy projects (no `.ael-generated.json`) get AEL-managed context files overwritten and obsolete ones deleted on their first update, with a snapshot in `.ai-engineering-loop/.ael-backup/<timestamp>/` that `update rollback` restores. Hash-tracked projects also drop obsolete unedited AEL files. `sync-hosts` removes host files it installed that the package no longer ships (for example the old `code-simplifier` and `receiving-code-review` folders), keeping edited ones.
- **Added:** `migrate --from <version>` and `migrations/<major>.js` (idempotent, recorded in `~/.ai-engineering-loop/migrations.json`). `update apply` runs it after any install that crosses a major. No migration ships in 1.x.
- **Release:** `publish.yml` publishes with `npm publish --access public --provenance` through OIDC (`id-token: write`), no long-lived token.
- **Conservative defaults (open decisions):** project-scope installs are notify-only and `package.json` is never changed. With no policy set and no interactive answer, the policy is `notify`; the first-run TTY prompt suggests `minor`. Agents never initiate updates (`core/runtime-safety.md`).

### Slim skill adoption (#36)

- **Added:** `project-onboarding` (core pack) fills `.ai-engineering-loop/architecture.md` and `conventions.md` from the code, citing evidence. Output is in Indonesian or English, it reads the last 100 commits (or `--since`), and it covers a wider file-type list. It never triggers automatically (`/ai-engineering-loop onboard`).
- **Added:** opt-in `quality` pack (`sync-hosts --pack quality`). `ael-code-simplifier` tidies a finished diff with no behavior change, on request only, before `verify`. `ael-receiving-code-review` verifies each finding before acting on it and declines with evidence.
- **Merged, no new skill:** "no claim without fresh evidence" and a claim-to-evidence table in `loop-verify`. Trace-backward, three-strikes, and test-pollution bisection in `core/root-cause-analysis.md`. Stage-boundary compaction notes in `loop-goal` and `loop-verify`. A default verification order in the `verification.md` that `init` generates.
- **Not adopted:** `using-dot-skills` (an always-invoke rule that conflicts with "pick the smallest relevant skill"), plus planners, TDD guides, reviewer agents, and hooks that duplicate AEL stages.
- All adopted text was written fresh for AEL; credits are in `THIRD_PARTY_NOTICES.md`.
- Both quality skills carry an `ael-` prefix (`ael-code-simplifier`, `ael-receiving-code-review`) so they cannot clash with dot-plugin's `code-simplifier` and `receiving-code-review`.

### P3 — one skill source, slim SKILL.md, on-demand references, metrics (#35)

- **Changed:** the four `ai-engineering-loop` host skills (Claude, Grok, Gemini/Antigravity skill, Antigravity workflow) are generated from `skill-src/ai-engineering-loop/` (one template plus a per-host overlay) by `npm run build:skills`. `npm run check:skills` and a test fail when a generated file is edited by hand.
- **Changed:** each SKILL.md is now at most 4,000 characters (it was 8-12k): host rules, tier table, stage map, and the quality invariants. Stage details moved to `references/loop-{goal,maker,verify,review,deliver,risky,commands}.md`, read only on entering a stage.
- **Added:** `sync-hosts` installs `references/` beside each host SKILL.md. The references are also available as `ai-engineering-loop docs loop-<stage>` (the Antigravity workflow uses this).
- **Added:** `gate maker --from-git` writes the working-tree diff (tracked and new files, excluding `.ai-engineering-loop/`) to `RUN_DIR/diff.patch` and gates it in one call. It is refused in UNATTENDED, where `sandbox capture` is used instead.
- **Changed:** Stage 0 no longer calls `status` separately, because `run --json` reports host-skill freshness. T0 skips the `tdd-policy` read.
- **Added:** `npm run measure` drives T0 docs, T1 feature, and T2 auth fixtures through the real CLI and reports context, calls, and subagents per tier.

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
