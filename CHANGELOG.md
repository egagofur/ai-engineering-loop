# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/). Entries under **Unreleased** ship with the next version bump.

## Unreleased

### Security

- Studio: mutating requests now need the `x-ael-studio-token` header or an exact same-origin `Origin`, plus `content-type: application/json`. The SameSite cookie alone no longer authorizes a POST from another localhost port.
- Secret redaction covers JSON keys (`{"password":"…"}`), key names embedded in identifiers (`AWS_SECRET_ACCESS_KEY=`, `_password`, `clientSecret`), npm `npm_` tokens, Stripe `sk_live_`/`rk_live_` keys, Slack `xox*` tokens, JWTs, and credentials in URLs (`postgres://user:pass@host`).
- Guard: agent edits to CLI-owned Run evidence (`verification.json`, `state.json`, event ledgers, and others) are denied; `\rm -rf`, `find -delete`, `git checkout -- .`, `git restore`, and `git branch -D` are detected; a failing hook exits 2 (fail closed) outside ASSISTED; `hooks install` pins the hook command to the installed version.

### Fixed

- `verification record` timeouts stop the whole process tree (process group on POSIX, `taskkill /T` on Windows) and no longer hang on a grandchild that holds the output pipes.
- Concurrent `verification record` calls and Run state updates no longer lose each other's writes: both re-read under a lock before writing.
- An unterminated last line in `events.jsonl`, `lifecycle.jsonl`, or `interactions.jsonl` (crash mid-append) no longer bricks the Run; the next append quarantines it to `<ledger>.torn-*`.
- Windows: `npm` and other `.cmd` shims are resolved for `verification record` and auto-update; atomic writes retry a transient `EPERM`/`EBUSY` rename.
- Studio live snapshots show the newest 100 lifecycle events, and the watcher seeds its cursor from the latest event, so long Runs no longer replay stale events.

### Lighter package and faster hook calls

- **Changed:** the npm package ships one copy of the host skills (`.agents/skills`, which `sync-hosts` already installs from) instead of two identical trees: 247 files, 1.79 MB unpacked (was 279 files, 2.11 MB). `docs` and `doctor` read `.agents/skills`.
- **Changed:** the CLI loads command modules on first use. `guard check --hook` now loads 15 modules instead of 61.
- **Removed:** internal helpers that only tests called (capability selection and report formatting in `lib/orchestration.js`, `lib/intern-catalog.js`, recipe import plan/apply, loop-group create/remove, and a few single-use exports). CLI behaviour is unchanged.
- **Internal:** one atomic writer, sha256 helper, optional JSON reader and actor-id rule (`lib/fsutil.js`), and one hash-chained JSONL ledger for run interactions and lifecycle (`lib/jsonl-ledger.js`).

## 2.2.0 - 2026-10-18

### Studio: richer node detail, Live tab, times, and trackpad gestures (#91)

- **Added:** built-in nodes show Evidence from the run directory (goal contract, diff stats and files touched, verification output and test counts, review findings, judge verdict, approver, delivery destination and receipt). The read stays inside the run directory and checks sha256 against `state.json`. A mismatch shows “artifact changed”. A node that already has `nodes[id].artifact` keeps that descriptor. Gate durations come from `GATE_PASSED`, or from `NODE_COMPLETED` in the lifecycle log when the workflow log has none.
- **Added:** the node panel tabs are Overview, Output, Evidence, and Timeline. Status, duration, finish time, loop, and attempts are labeled chips. Output is a one-paragraph summary. The timeline lists that node's events, grouped by iteration, with human labels.
- **Added:** times read as “just now”, “14s ago”, “5 min ago”, “3 h ago”, “yesterday · Oct 17, 15:41”, or “2 days ago · Oct 16, 15:41”, and as an absolute date after 7 days. Each time is a `<time datetime>` whose tooltip has the exact local timestamp. Durations use `2m 20s` and `1h 04m`.
- **Added:** the Live tab shows a stage rail, a question banner with Answer in Studio, the current step, compliance and budget chips, latest events, and a timeline grouped by step. Updates still arrive on `GET /api/events`. Tokens read `unknown` when the host reports no usage. A delivered run with no receipt says “no receipt: run predates receipts”.
- **Changed:** two-finger scroll pans the canvas on both axes. Pinch and Ctrl+wheel zoom around the cursor. A left-button drag on empty canvas pans, including macOS three-finger drag. Shift+drag selects with a marquee. `overscroll-behavior: none` on the page and canvas, plus a non-passive wheel listener, keeps a horizontal swipe from triggering browser back/forward. Scrolling inside the side panel still scrolls the panel.
- **Changed:** workflow structure stays read-only. Rewiring existing nodes is unchanged.

## 2.1.0 - 2026-10-18

### Studio: n8n-style Wiring canvas (#88)

- **Added:** node tiles on the Wiring canvas (type icon, name, one status line that is also the duration slot, no stage or type badge). Edges are cubic Bézier curves; the edge into the RUNNING node animates, and `prefers-reduced-motion` disables that animation. A loop group draws a container labeled `iteration n / max` from live loop state.
- **Added:** a minimap with one mark per node, zoom controls (+, −, fit, auto-layout, percent), a node side panel with Input, Output, Evidence, and Timeline tabs, a tooltip, and a `?` shortcut sheet (`F`, `L`, `+`, `-`, `0`, arrows, Enter, Esc, undo/redo). `:focus-visible` outlines the controls.
- **Added:** a dirty-only save bar (change count, Valid or Invalid, Discard, Save) that stays hidden while the wiring is clean. Save still goes through the confirm dialog. A finished run shows a summary card with state, destination, Judge verdict, approver, duration, tests, findings, drift, receipt, and tokens (`unknown` when the ledger has none). Node durations are derived from consecutive node `updatedAt` times.
- **Added:** `delivery.json` is a watched artifact: `GET /api/events` emits `artifact.delivery` (`destination`, `humanApproved`, `approvedBy`) for the summary card.
- **Changed:** auto-layout and fit keep every built-in recipe (default, bugfix, refactor, high-risk, docs-light, audit) inside the canvas at 1280×800 and 1600×1000. The edge delete control appears only on hover or selection. Live updates still arrive on `GET /api/events` via `applyEvent`; the client does not poll.
- **Changed:** workflow structure stays read-only (#80). The canvas has no create, delete, rename, duplicate, or import control for nodes. Rewiring existing edges is still validated by `POST /api/validate`. A backbone-breaking edge shows the compiler's named error and disables Save. Node-set changes still fail with `STUDIO_STRUCTURE_READ_ONLY`, and `POST /api/import/*` stays 404.

### README refresh for 2.0.0 (#86)

- **Docs:** README Workflow Studio section describes the 2.0 live-run view, real-time `/api/events`, and wiring-only canvas (node creation, duplication, import, and Studio-created Agent nodes are gone). Adds `ael bench` (compliance self-check for your own host and model; slow) and personal workflow (`workflow interview|propose|accept|suggest`, `~/.ai-engineering-loop/workflow/`, `workflow-history.jsonl`, project-required > personal > built-in). Updates the CLI cheat sheet, recipe authoring example, major-update note, and Documentation links.

## 2.0.0 - 2026-10-17

### Breaking changes

- Studio no longer creates or edits nodes (#80). Wiring mode only edits edges between existing nodes. `POST /api/import/preview` and `POST /api/import/apply` return 404. Author recipes as files plus `recipe create|clone|install`.
- `GET /api/runs/:id/lifecycle/stream` returns 404; subscribe to `GET /api/events` instead (#80).
- **Upgrade:** run `ai-engineering-loop sync-hosts` once after upgrading so installed host skills match 2.0.0.

### Personal workflow onboarding (#81)

- **Added:** `workflow interview|propose|accept|reject|suggest`. With no concrete task the skill offers to build a personal recipe, start a task, or show status, and does not create a Run. Interview questions come pre-filled from the last 20 run summaries (80% majority). `propose` compiles a candidate through the recipe safety backbone. `accept --by` is the only way to install it.
- **Added:** the personal recipe, its version history, proposals, and `workflow-history.jsonl` live under the AEL home (`AEL_HOME` or `~/.ai-engineering-loop`), never in a repository. Each terminal Run appends a summary of counts and a repo hash. Suggestions are proposals only; a rejected proposal stays quiet until new evidence outgrows the old one.
- **Changed:** `run` resolves project-required (`workflow.requiredRecipe`, `workflow.allowPersonal: false`, required project nodes, `adapter.md`) then the personal recipe, then the built-in default (`audit` for REPORT_ONLY). `run --json` reports `workflowSource`. `run --recipe` cannot bypass the project-required layer. UNATTENDED cannot accept (`HUMAN_REQUIRED`).
- **Added:** eval case `25-no-task-onboarding`; the always-loaded skill gains a no-task line (offer `workflow interview` or a task; no Run), with details in `loop-commands`.
- **Docs:** `core/personal-workflow.md` (`docs personal-workflow`).

### `ael bench`: compliance self-check for one host and model (#79)

- **Added:** `bench [--host <id> --model <id>] [--scenario <id>]... [--repeat <n>] [--bin <path>] [--host-arg <arg>]... [--sandbox-home] [--mode assisted|unattended|report-only] [--timeout <seconds>] [--json]`. One target per invocation. Each scenario runs in a fresh temp repo. `AEL_HOME` is a temp directory. The host process keeps the real `HOME` so it can authenticate; `--bin` and `--sandbox-home` use a temp `HOME` instead. Skills are installed in the temp repo (the directories that host reads), and `node_modules/.bin/ai-engineering-loop` shims this checkout so `npx` does not download the published package. Default timeout is 20 minutes. A missing binary is `UNAVAILABLE`, not a model failure. Default mode is ASSISTED; the scenario's scripted approver answers Goal freeze, impact confirm, and `deliver --approve`. `--mode unattended` is opt-in. Progress lines go to stderr.
- **Added:** `evals/scenarios/` (T0 docs, T1 features, T2 auth/payment, and traps) and `schemas/bench-scenario.schema.json`. The `evals/cases` judgment suite is unchanged by the bench.
- **Added:** scoring from Run artifacts only (`state.json`, `guard-events.json`, `impact-drift.json`, `verifyReceipt()`, the usage ledger, the harness clock). Tokens are parsed from host JSON when the host provides it (Claude Code and Codex). Grok CLI `-p` is plain text, so its tokens stay unknown, never `0`. `budget record --unavailable` is the same unknown. Bench-only host templates: Grok `--no-auto-update --always-approve`, Claude `--dangerously-skip-permissions`, Codex `--full-auto`. `--host-arg` appends extra flags. `--bin` overrides the binary.
- **Added:** `.ai-engineering-loop/bench/<benchId>/{results.json,report.md,hardening.md}` (`schemas/bench-result.schema.json`). The report is per-gate compliance, guard violations, scope drift, receipt validity, and p50/p90 time and tokens for that single target. `hardening.md` maps each violation to a `skill-src/` instruction, ranked by frequency, with a text-tightening or hard-gate suggestion. Suggestions are not applied. There is no routing or model recommendation.
- **Added:** `bench compare <benchIdA> <benchIdB>` prints a read-only side-by-side table.
- **Docs:** `core/bench.md` (`docs bench`).

### Studio: real-time sync and compact live-run UI (#80)

- **Added:** `lib/run-watcher.js` recursively watches `.ai-engineering-loop/runs/` and `current.json` (debounce ~100 ms) and pushes typed events on `GET /api/events` with monotonic `seq`. Event types: `run.created`, `run.state`, `lifecycle`, `artifact.impact|drift|guard|verification|findings|verdict|receipt`, `current.changed`, `presence`. `hello` reports `watch` or `poll` plus the watched root. `Last-Event-ID` / `?after=<seq>` replay from an in-memory ring; a gap sends `resync` for a full `/api/bootstrap`. `AEL_STUDIO_FS_WATCH=0` (and a failed `fs.watch`) uses a 1 s stat-poll.
- **Added:** compact live-run view as the default route (stage rail, heartbeat age, tier/mode/iteration/budget, guard/drift/receipt chips, pending-question banner, merged timeline). The Goal sheet and run-history list remain. Wiring mode edits edges between existing nodes only; `/api/validate` is still `lib/recipe.js`, and install still requires the confirm dialog.
- **Added:** watched-root display. `status --json` and `run --json` include `studioUrl` (tokenless Studio identity; the browser session comes from the URL printed by `ael studio`) when a Studio process for that root is alive (`.ai-engineering-loop/studio.json`).
- **Added:** `/api/install` requires `baseRecipeId` and rejects node-set changes (`STUDIO_STRUCTURE_READ_ONLY`); `/api/validate` reports the same code when `baseRecipeId` is sent. Only edges, `dependsOn`, and layout may differ from the loaded base recipe, including a builtin installed as `<id>-local`.
- **Added:** the Studio client reconnects to `/api/events` with `setTimeout` backoff and `Last-Event-ID` / `?after=`; a `resync` event or failed resume falls back to `/api/bootstrap`. The Retry button remains.
- **Breaking:** removed the 1.8 s `refreshLive` client poll and the 750 ms per-client lifecycle interval. `GET /api/runs/:id/lifecycle/stream` returns 404; use `GET /api/events`.
- **Breaking:** removed node creation, duplication, deletion, inspector field edits, loop-group creation, Custom Agent dialog, Import workflow JSON (preview/merge/replace), and the export/copy-brief toolbar. `POST /api/import/preview` and `POST /api/import/apply` return 404. Author recipes as files + `recipe create|clone|install`.
- **Changed:** artifact SSE summaries match real writers: `verification.json` derives `passed`/`failed` from the command bundle (no `status`); findings `blocking` uses `isBlockingFinding`; `receipt.json` verification is `verifyReceipt` (`present`, `digest`, `verified`, `problems`).
- **Changed:** RunWatcher processes only `current.json` and paths under `runs/`; `usage/`, `learnings.json`, drafts, and other context files emit no events.

## 1.17.0 - 2026-10-17

### `ael learn`: past Runs become project learnings for context packs (#61)

- **Added:** `learn [--dry-run] [--prune] [--max-age-runs <n>]` (`lib/learn.js`, `schemas/learnings.schema.json`). It reads every Run's `findings.json`, keeps only VALID findings that were not rejected (drift findings from #71 are skipped), clusters them per axis by word overlap, and writes deterministic, deduped `.ai-engineering-loop/learnings.json` and `learnings.md` with occurrence counts and source `runIds`. Text is redacted with the `safe-context` secret and home-path filters.
- **Added:** `--prune` suppresses lessons whose files are gone or that have not recurred in the newest N Runs (default 20); an entry with `supersededBy` is suppressed on the next run. A suppressed lesson returns only when it recurs in a newer Run.
- **Added:** Maker and Devil's Advocate context packs (`context maker|devil-advocate`, `review-pack`) include up to 5 relevant `learnings` within 10% of the stage token budget, counted in `estimatedTokens`; Judge packs get none.
- **Docs:** `core/learnings.md` (`docs learnings`); the Stage 8 reference runs `learn` after delivery.

### Proof-carrying PR receipt: `receipt.json` and `verify-receipt` (#70)

- **Added:** `schemas/receipt.schema.json` and `lib/receipt.js`. `deliver` (incl. `--approve`) writes `RUN_DIR/receipt.json` and `receipt.md` as its last step: the frozen Goal with its hashes, every AC with its evidence (claimed-vs-reality row, verification commands with output sha256, hosted links), the finding-ledger summary and Judge verdict, impact drift and guard counts, base/head SHA, the sha256 of every referenced artifact, and an overall digest. An AC without evidence is an explicit ❌ (`MISSING`), never dropped.
- **Added:** `deliver --host <id> --model <id> --head <sha> --evidence AC-N=<https-url>`. Evidence links must be `http(s)` without credentials; the receipt carries no secrets or local absolute paths.
- **Changed:** `delivery.json` stores `receipt: { path, digest }` (`schemas/delivery.schema.json`).
- **Added:** `verify-receipt [--run <id> | <receipt.json>] [--head <sha>]` re-hashes the artifacts and Goal, checks every AC has evidence, the verdict is PASS with no blocking finding, and the head SHA matches; exit 1 on any mismatch.
- **Changed:** the GitHub, GitLab and DOT MR templates have a Receipt section; the Stage 8 reference says to paste `receipt.md` unchanged. Spec: `core/pr-receipt.md` (`docs pr-receipt`).

### Hook-enforced runtime guardrails: scope freeze and destructive commands (#59)

- **Added:** optional `scope: { allowedPaths, deniedPaths }` (repository-relative globs) in the Goal contract, frozen with the Goal and validated by the Goal gate. Absent = no path enforcement.
- **Added:** `guard check --tool edit|bash` returns `allow | warn | block` with rule ids and reasons. Edits are checked against the Goal scope plus the confirmed impact map (#71) and `deniedPaths`; Bash is checked for `rm -rf`, `DROP TABLE`/`TRUNCATE`, `git push --force`, `git reset --hard` and `git clean -fd`. ASSISTED warns, UNATTENDED and REPORT_ONLY block (exit 2). Every warn/block is written to `RUN_DIR/guard-events.json`, and `gate` prints the counts (`guard` in `--json`).
- **Added:** `hooks install | uninstall | status` writes an idempotent Claude Code `PreToolUse` hook to the project's `.claude/settings.json` (`guard check --hook claude` answers `deny` / `ask`). Other hooks in the file are kept.
- **Added:** the host registry marks guardrails as **enforced** (native hooks: Claude Code) or **advisory**; shown in `hosts list`, `hosts doctor` and the README host table.
- **Docs:** `core/runtime-safety.md` "Runtime guardrails"; the Maker reference tells advisory hosts to call `guard check` themselves.

### Blast-radius impact map before Stage 3 (#71)

- **Added:** `schemas/impact-map.schema.json` and `lib/impact-map.js`. Freezing the Goal (`goal freeze` or `gate goal`) writes a DRAFT `RUN_DIR/impact-map.json` listing files, modules, endpoints, DB tables/migrations and tests, each with a confidence and a reason. It is a deterministic scan of the repository index against keywords from the frozen Goal (English and Indonesian filler words dropped), so it works on every adapter. `gate maker` writes it too if it is still missing.
- **Added:** `impact map | show | confirm | skip | drift`. `confirm --by <name>` (with optional `--allow <glob>` / `--remove <path>`) locks the map and writes `scope.allowedPaths`, the Run's allowed scope. `skip --reason <text>` records why a trivial goal (copy, CSS, comments) has no map.
- **Added:** after the verification gate the CLI writes `impact-drift.json` (changed files vs the map). `verify` and `review-pack` print out-of-map files, the diff-hunk pack carries `impactDrift`, and the review gate adds one `LOW` finding per out-of-map file to `findings.json` (`source: "impact-map"`). Drift warns; it does not block.
- **Docs:** `core/blast-radius-map.md` (`docs blast-radius-map`); the Stage 1 reference and `task-impact-inquiry` point at the map.

## 1.16.0 - 2026-10-16

### Host certification tiers and an instruction-only `AGENTS.md` digest (#60)

- **Changed (breaking):** the numeric `tier` in `lib/hosts/registry.js` is replaced by `certification: full | experimental | instruction-only` plus `certifiedBy`. **full** requires a recorded real `default` recipe run with reviewer subagents and every gate (`certifiedBy: { recipe, aelVersion, date }`), and the registry test enforces it. No run is recorded yet, so no host is `full`. The 14 hosts with file-based reviewer agents are `experimental`, and the 6 without (Windsurf/Devin, Amp, Zed, Goose, Cline, Roo) are `instruction-only`. `hosts list --json` returns `certification` instead of `tier`.
- **Added:** the README host table, `hosts list` and `hosts doctor` show the tier.
- **Added:** a compact digest for instruction-only hosts, generated from `skill-src/ai-engineering-loop/digest.md` to `agents/instruction-only/AGENTS.md` (at most 2 KB; the build fails above that, and `check:skills` catches drift). Read it with `npx ai-engineering-loop docs AGENTS`. Documented in `references/loop-hosts.md`.

### DOT Stage 8: Sonar quality gate and "Ready to review" card move (#65)

- **Added:** `adapters/dot/sonar.md`. After the MR, wait for the pipeline and read the Sonar quality gate from the pipeline's Sonar job or the Sonar MR comment (`glab` only, no tokens). It prints a `Sonar Gate` report. `FAIL` loops back to a fix on the same MR. A project without Sonar is `SKIPPED`, never PASS.
- **Added:** `adapters/dot/gitlab.md` Step 4 moves the issue card to the "Ready to review" board list after a Sonar PASS/SKIPPED gate and the printed Coreview triage. It only swaps board-list labels, is idempotent, and skips cleanly when no card or list exists (`board_ready_label` in `adapter.md` overrides the label).
- **Changed:** DOT Stage 8 order is now issue → MR → pipeline + Sonar gate → Coreview triage → card to "Ready to review" → Mattermost (`adapters/dot/README.md`, `mattermost.md` preconditions, `dot-dev-workflow` Stages 8a–8e). A Sonar `FAIL` blocks both the card move and the notification.

### `task-impact-inquiry` is adapter-neutral (#64)

- **Changed:** the skill moved from `adapters/dot/skills/` to `adapters/quality/skills/task-impact-inquiry/` (still installed by default, not part of the opt-in `quality` pack). Its triggers are now English plus Indonesian, and the DOT-only process references (`dot-dev-workflow`, BullMQ) were replaced with neutral wording. `sync-hosts` installs global skill folders that every project shares, so gating on one project's `adapter_type` could not be correct; neutral content was the safe option. On `adapter_type: dot` the blast-radius grill stays mandatory (`core/grill-policy.md`, `adapters/dot/README.md`).

### Adapter checks in `doctor` and a `deliver` preflight (#63)

- **Added:** `doctor` run inside an initialized project now checks the adapter: unknown `adapter_type` (error, with a "did you mean" suggestion), a missing spec (error), `gh`/`glab` missing or not logged in for the chosen type (warning; `dot` checks the DOT host), a missing `adapter.md` (warning), and a configured type that differs from the shared detector (warning). Warnings print with `!` and do not make doctor fail. Doctor on the package itself is unchanged.
- **Added:** `deliver` runs the same checks before it approves or writes anything. UNATTENDED fails with `ADAPTER_PREFLIGHT_FAILED` on any problem except the detector mismatch; ASSISTED prints warnings and continues.

### One adapter detector for `init`, `generate-adapter` and Studio (#62)

- **Fixed:** `generate-adapter` and Studio recommended `gitlab` for a DOT GitLab remote while `init` chose `dot`, so accepting their recommendation silently dropped the DOT pipeline. All three now call `lib/adapter-detect.js` and agree.
- **Changed:** the remote host now wins over CI files. A GitHub remote without `.github/workflows/` is `github` (was `standard`); CI files only decide when the remote host is unknown or missing.
- **Changed:** the `origin` remote is read (fallback: the first remote) instead of the first `url =` line in `.git/config`, so submodule URLs and `upstream` no longer win. Linked worktrees (`.git` is a file) are detected.
- **Added:** `generate-adapter` prints the reason next to `recommended:`, Studio's bootstrap returns `adapters.reason`, and `init` records it in the context evidence.

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
