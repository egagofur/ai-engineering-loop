# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/). Entries under **Unreleased** ship with the next version bump.

## Unreleased

### Audit / REPORT_ONLY review policy and a non-contradictory header (#57)

- **Fixed:** the execution header could say `Execution Mode: CONTEXT_ISOLATION_ONLY` next to `Native Subagent Invocation: AVAILABLE` with no explanation, for example on recipe `audit` runs in Antigravity. Now the mode line carries the reason: `CONTEXT_ISOLATION_ONLY (reason: <why>)`. The independent and no-subagent headers are unchanged.
- **Changed:** recipe `audit` (REPORT_ONLY) used to skip review entirely, because only Maker runs reach DA and Judge. When the host can invoke a subagent, one fresh `devil-advocate` sibling now challenges `report.json` before `gate report` (no Judge, no iteration loop). Otherwise the same check runs in-session with a reason. The policy is documented in `references/loop-maker.md`, `loop-hosts.md`, `loop-review.md`, and `core/orchestration-model.md`.
- **Added:** an optional `review` block in `report.json`. `gate report` validates it: an independent mode needs `reviewer: devil-advocate` plus the reviewer's own `childId`, and `CONTEXT_ISOLATION_ONLY` with `nativeSubagent: AVAILABLE` needs `reason`. Reports without the block stay valid.

## 1.15.0 - 2026-10-11

### Multi-agent hosts: `setup` suggests `auto` detection mode (#54 decision 4)

- **Changed:** interactive `setup` now asks "Sync agents you install later automatically? [Y/n] (recommended: Y = auto)"; pressing Enter picks `auto`. `setup --yes`, a missing TTY, CI, and scripts keep `manual` unless `--mode` is passed. Gemini CLI detection, Kiro/Junie read-only reviewers, and the deferred Cline reviewer are unchanged.

### Multi-agent hosts, phase 4: new agents, `hosts doctor`, generated host table (#52)

- **Added:** agents installed after `setup` are detected again (stat only). With `hosts.mode: auto`, the background `update auto` of a global install enables and syncs them; a host you disabled stays disabled. With `manual` (default), `status` prints one short notice per new agent, at most once a day. Nothing is written or shown in CI, in `--json` output, or with `AEL_NO_AUTO_UPDATE=1`. `update auto --json` reports `hosts.added`.
- **Added:** `hosts doctor [--json]`: per enabled host, how many copies of the core skill it sees across the folders it scans, whether they are identical, and which AEL files still need a sync. Read-only; exits 1 when something needs attention.
- **Changed:** the README host table is generated from `lib/hosts/registry.js` (`npm run build:hosts-table`); `npm test` fails when it drifts.

### Multi-agent hosts, phase 3: own-folder hosts (#51)

- **Added:** Cline (`~/.cline/skills`), Kiro (`~/.kiro/skills`), and Qwen Code (`~/.qwen/skills`) get their own byte-identical copy of the skill, because they do not read `~/.agents/skills/`.
- **Added:** Roo Code and JetBrains Junie, which the current docs show also read `~/.agents/skills/`, so they use the shared copy (the research report had marked this as inferred "no").
- **Added:** reviewer subagents for Kiro (`~/.kiro/agents/*.md`, `tools: [read]`), Qwen (`~/.qwen/agents/*.md`, `approvalMode: plan`), and Junie (`~/.junie/agents/*.md`, `tools: [Read, Grep]`). Cline and Roo get none (no documented file format), so the loop runs `CONTEXT_ISOLATION_ONLY` there.

### Multi-agent hosts, phase 2: shared-folder hosts (#50)

- **Added:** OpenCode, Windsurf/Devin Desktop, Amp, Factory Droid, Augment (Auggie), Zed, and Goose to the host registry. All of them read the shared `~/.agents/skills/` folder, so they use the same single copy of the skill and never get a second one in their own folders.
- **Added:** reviewer subagents where the host supports file-based ones: OpenCode `~/.config/opencode/agents/*.md` (`mode: subagent`, edits denied), Factory `~/.factory/droids/*.md` (`tools: read-only`), and Augment `~/.augment/agents/*.md`. Amp (TypeScript plugins), Zed, Goose, and Windsurf have no file-based reviewer agent, so the loop runs DA and Judge as `CONTEXT_ISOLATION_ONLY` there.

### Multi-agent hosts, phase 1: host registry, setup, and `hosts` (#49)

- **Added:** a data-driven host registry (`lib/hosts/registry.js`). Each entry holds detection signals, the skill folder (the shared `~/.agents/skills` or the host's own), the folders the host scans, the reviewer subagent format, official doc links, and a verification date. Tier 1 hosts: Claude Code, Codex CLI, Gemini CLI, Antigravity (IDE/2.0 and the `agy` CLI), Grok CLI, Cursor, and GitHub Copilot.
- **Added:** detection by config folder or by an executable on `PATH`. The binary is checked with `stat` only and never executed.
- **Added:** reviewer subagents in each host's own format, all from the same `agents/shared/*.body.md`: Codex `~/.codex/agents/*.toml` (read-only sandbox), Gemini CLI `~/.gemini/agents/*.md`, Cursor `~/.cursor/agents/*.md` (`readonly`), and Copilot `~/.copilot/agents/*.agent.md`.
- **Added:** `setup [--yes] [--hosts a,b] [--mode auto|manual] [--json]`, which runs once and asks before writing. Without a TTY it prints the plan and writes nothing unless `--yes` is passed. Also added: `hosts list [--json]`, `hosts enable <id...>`, and `hosts disable <id...>`. Disabling removes only manifest-tracked files that AEL wrote and you did not edit. The shared folder stays while any enabled host still reads it.
- **Added:** a first-run hint that replaces a `postinstall` hook. It appears on interactive stderr at most once a day until hosts are chosen, never in CI or `--json`, and can be silenced with `AEL_NO_SETUP_HINT=1`. The package still defines no install script.
- Until `setup` runs, `sync-hosts` and `update auto` write only to hosts whose config folder already exists, or that an earlier sync already installed. Hosts found only on `PATH` wait for `setup`.

### Multi-agent hosts, phase 0: close the host gaps (#48)

- **Fixed:** the `ai-engineering-loop` skill now lands in the shared `~/.agents/skills/` folder, so Codex, Gemini CLI, and the other hosts that read it see the loop. Grok, Gemini CLI, and Codex installs trigger it.
- **Fixed:** Gemini CLI no longer gets Antigravity's `~/.gemini/config/skills/` path. Antigravity keeps `~/.gemini/config/skills/`, and its Devil's Advocate and Judge now install as `~/.gemini/config/agents/<name>.md` subagents (`subagent: true`) instead of `~/.agents/*.md`.
- **Changed:** one host-neutral `SKILL.md` (standard `name`/`description` frontmatter only) is generated for every host, byte-identical everywhere. Per-host spawn rules moved to `references/loop-hosts.md`. Grok no longer gets its own skill copies (it reads `~/.claude/skills` and `~/.agents/skills`), and the `user-invocable` overlay is gone (Grok's default is already `true`).
- **Removed:** `~/.agents/workflows/ai-engineering-loop.md`, `~/.agents/{devil-advocate,judge}.md`, and the `~/.claude/commands` and `~/.grok/commands` copies. The skill already provides `/ai-engineering-loop`. `sync-hosts` deletes these files where AEL wrote them, and keeps them if you edited them.
- **Note:** the Claude skill no longer pre-approves tools through `allowed-tools`, because other hosts (for example Copilot) treat that field as a permission grant. Claude Code may ask for permission a little more often.

### `run --abandon` for stale runs (#46)

- **Added:** `run --abandon [--run <id>] --reason <text> --by <name> [--yes] [--json]`. It moves a run that will never finish to `CANCELLED`, records reason, actor, and time in the run's history ledger (recipe-bound runs also get a `RUN_CANCELLED` event), and releases `current.json` so `refresh --non-destructive` and `update auto` process the project again. Run data is kept. With `--run <id>` for a non-current run, the current pointer is left alone.
- ASSISTED runs ask for confirmation (or `--yes`). UNATTENDED runs are refused (exit 2) unless a human passes `--yes`. Finished runs and "no current run" exit 2. `--help` writes nothing, and unknown flags are rejected before any write.
- `status` (text and `--json` `activeRun`), `state`, and `projects list` point at `run --abandon` when the active run has not moved for 7 days or more. The "skipping refresh" message and the pending-projects update summary suggest it too.
- A pointer renamed by hand to `runs/current.stale-*.json` is simply ignored.

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
