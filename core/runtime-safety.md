# Runtime Safety Modes

AI Engineering Loop separates analysis, human-supervised delivery, and unattended execution. The mode is stored in the run ledger and cannot change during a run.

## Modes

| Mode | Repository mutation | Delivery | Intended use |
|---|---|---|---|
| `REPORT_ONLY` | Forbidden | Ends at `gate report` | Audits, recommendations, and first-time evaluation |
| `ASSISTED` | Allowed after the Goal Contract gate | `delivery.json` must contain `"humanApproved": true` | Default production workflow |
| `UNATTENDED` | Allowed only when explicitly enabled; Maker uses a disposable locked Git worktree by default | Deterministic gates still apply | Trusted automation with budget monitoring |

`UNATTENDED` is disabled by default. Enable it deliberately:

```bash
npx ai-engineering-loop policy set --allow-unattended true
npx ai-engineering-loop run --mode unattended "task"
```

The repository policy lives at `.ai-engineering-loop/runtime-policy.json`. Invalid policy fails closed. Do not change a policy merely because an agent asks to bypass a gate.

## Runtime guardrails (scope freeze and destructive commands)

Gates check artifacts after a stage. The guard checks each tool call **before** it runs:

```bash
npx ai-engineering-loop guard check --tool edit --path src/list.js
npx ai-engineering-loop guard check --tool bash --command "git push --force"
npx ai-engineering-loop hooks install        # Claude Code: .claude/settings.json PreToolUse hook
npx ai-engineering-loop hooks status | uninstall
```

| Check | Rule |
|---|---|
| Edit / Write / MultiEdit / NotebookEdit | Blocked or warned when the file is outside the Run scope or matches `scope.deniedPaths`. `.ai-engineering-loop/` (Run artifacts) is always writable. A `REPORT_ONLY` Run may not edit at all. |
| Bash | `rm` with recursive + force flags, `DROP TABLE/DATABASE/SCHEMA`, `TRUNCATE`, `git push --force` / `-f` / `--force-with-lease` / `+refspec`, `git reset --hard`, `git clean` with `-f` and `-d`. |

**Scope** = the frozen Goal's optional `scope.allowedPaths` plus the confirmed blast-radius map (`impact confirm`, see `docs blast-radius-map`). `scope.deniedPaths` always applies. A Goal without `scope` and without a confirmed map has no path enforcement (backward compatible). Globs: `**` crosses directories, `*` and `?` stay inside one segment, a trailing `/` is a directory prefix; paths are repository-relative.

**Decision** by Run mode: `ASSISTED` → `warn` (the Claude hook answers `ask`, so the human decides); `UNATTENDED` and `REPORT_ONLY` → `block` (`deny`; CLI exit code 2). With no active Run the policy `defaultMode` applies and nothing is recorded.

**Evidence:** every warn and block is appended to `RUN_DIR/guard-events.json` (tool, rule ids, reasons, mode, redacted repository-relative target). `gate <name>` prints the counts and `--json` returns `guard: { warn, block, rules }`.

**Enforced vs advisory:** only hosts with a native pre-tool hook API are **enforced** (Claude Code today, `hooks` in `lib/hosts/registry.js`). Every other host is **advisory**: the loop instructions ask the agent to run `guard check` itself, and nothing stops a call it skips. `hosts list`, `hosts doctor`, and the README host table show the column. The guard is not a sandbox: it does not isolate the OS or the network; UNATTENDED still uses the disposable worktree.

## Token budget and emergency stop

Check the budget once after `run` and again before each new iteration, and record provider-reported usage whenever the host returns it:

```bash
npx ai-engineering-loop budget status --run <run-id>
npx ai-engineering-loop budget record --run <run-id> \
  --input <provider-input-tokens> \
  --output <provider-output-tokens> \
  --model <provider-model-id>
```

Never convert byte estimates into "actual" usage. If the host does not expose provider usage:

- `ASSISTED`: run `npx ai-engineering-loop budget record --unavailable --run <run-id>` once, continue, and disclose the gap in the delivery summary. Do not stop to ask the human; a human is already present at Goal freeze and delivery approval.
- `UNATTENDED`: the same command fails with `USAGE_UNAVAILABLE_UNATTENDED`. Stop and escalate to a human.

Gaps are written to `.ai-engineering-loop/usage/unavailable-<UTC-day>.jsonl`, separate from the strict token ledger, so they never undercount or corrupt actual usage. Run, daily, and kill-switch limits are unchanged.

The per-run limit spans UTC days. The daily limit resets on the next UTC day. Ledgers are append-only JSONL under `.ai-engineering-loop/usage/` and are ignored by Git. A malformed ledger blocks execution rather than undercounting.

Emergency controls:

```bash
npx ai-engineering-loop budget pause
npx ai-engineering-loop budget resume
```

`pause` sets the persistent kill switch. It blocks new run and context/model boundaries, while `budget record` remains available so an in-flight response can still be accounted.

## Review profile

Context packs default to the `lean` review profile so paid conversational hosts do not exhaust tokens on repeated full-file review context. The profile changes context limits and reviewer output expectations only; it does not skip Goal Contract, verification, Devil's Advocate, Judge, or delivery gates.

```bash
npx ai-engineering-loop policy set --review-profile lean
npx ai-engineering-loop policy set --review-profile standard
npx ai-engineering-loop policy set --review-profile thorough
```

Use `lean` for normal Codex/GPT Plus-style sessions, `standard` when the diff is broad but still routine, and `thorough` only when the human explicitly opts into a deeper, more expensive review. A single context pack can override the policy without changing future runs:

```bash
npx ai-engineering-loop context devil-advocate --profile thorough <files...>
```

Prefer smart context before opening whole files:

```bash
npx ai-engineering-loop context index
npx ai-engineering-loop context query createStudioRun
npx ai-engineering-loop context related lib/studio-server.js
npx ai-engineering-loop context fast-path --json
npx ai-engineering-loop context diff-hunks --run <run-id>
npx ai-engineering-loop context diff-hunks --run <run-id> --include-ignored
npx ai-engineering-loop verification record --run <run-id> -- npm test
npx ai-engineering-loop verification summarize --run <run-id>
npx ai-engineering-loop context compact --run <run-id>
```

The index stores file summaries and hashes, never file bodies, and reuses per-hash summaries when files are unchanged. `query` and `related` return metadata only so agents can choose the right files before reading source. `fast-path` keeps low-risk small diffs on lean review and names the reason when a task must use the standard path. The diff-hunk pack stores bounded changed hunks, file summaries, token estimates, unresolved blocking findings from the previous ledger, and a count of paths skipped by context policy. Smart context skips CSS, generated bundles, lockfiles, build output, and `.aelcontextignore` matches by default; pass `--include-ignored` only when those files are the task. `verification record` executes the command without a shell by default, stores bounded output after secret and local-path redaction, binds it to the gated Maker diff, and records failures instead of hiding them. `verification summarize` extracts available test counts and short failure excerpts without forwarding raw logs. Context budget errors include per-file estimates (paths and counts only). `context compact` writes `run-summary.md`, `run-summary.json`, and `open-findings.json` so iteration 2+ reviewers and Judge start from compact artifacts and request full source or logs only when the hunk or summary cannot prove or disprove a finding.

## Package update workflow

Agents never initiate package updates. They must not run `update apply`, `update auto`, `update rollback`, or `update policy`, or install a different package version, unless the user explicitly asks in this session. Agents may run `update check` and report the result.

The CLI may update itself, but only under the policy the user chose (`~/.ai-engineering-loop/config.json` → `autoUpdate`):

| Policy | Patch | Minor | Major |
|---|---|---|---|
| `off` | - | - | - |
| `notify` (used when no policy is set) | notice | notice | notice |
| `patch` | apply | notice | notice |
| `minor` (first-run default answer) | apply | apply | notice |
| `all` | apply | apply | notice (also applies prereleases on the chosen channel) |

- **Check:** `run`, `status`, `init`, and `refresh` start `update auto --background` detached at most once every 24 hours (`npm view <pkg> dist-tags`, 3 s timeout). The command itself never waits. Offline or failed checks keep the cached tags and stay silent.
- **Opt-out:** `AEL_NO_AUTO_UPDATE=1`, `CI=true`, or `update policy off`.
- **Apply (global installs only):** acquire `~/.ai-engineering-loop/update.lock`, verify the release (registry `repository.url` must match this package, and `dist.integrity` must exist), `npm install -g <pkg>@<target>`, `sync-hosts`, then `refresh --non-destructive` in every project in `~/.ai-engineering-loop/projects.json`. User-edited context files are kept and new templates are written as `*.ael-new`. Projects with an active run are skipped and retried later; a human closes a stale run with `run --abandon --reason <text> --by <name>` (agents never abandon a run on their own). Updates are deferred entirely while any UNATTENDED run is active.
- **Project installs (devDependency or npx):** notify only. `package.json` and lockfiles are never changed automatically. The notice shows current -> latest, 2-4 CHANGELOG highlights, one update command for the detected package manager (npm/pnpm/yarn/bun), and how to silence it (`AEL_NO_UPDATE_NOTICE=1` or `update policy off`). It appears at most once per 24 h per project, on an interactive stderr only, never in CI or `--json` output. Global `notify` and major notices use the same format.
- **Host setup (no install hooks):** the package defines no `preinstall`/`install`/`postinstall` script, so installing never writes to `$HOME`. `ai-engineering-loop setup` (interactive, or `--yes`) detects agents by config folder or by an executable on `PATH` (stat only, never executed) and saves the selection in `~/.ai-engineering-loop/config.json` (`hosts.enabled`, `hosts.disabled`, `hosts.mode`). `hosts enable|disable <id...>` change it; disabling removes only manifest-tracked, unedited AEL files. Before `setup`, sync writes only to hosts whose config folder exists. Agents never run `setup` or `hosts enable|disable` on their own initiative. Agents installed later are re-detected (stat only): with `hosts.mode: auto` the background `update auto` of a global install enables and syncs them (never a host the user disabled); with `manual` `status` shows one rate-limited notice. Neither writes or prints in CI, in `--json` output, or with `AEL_NO_AUTO_UPDATE`. `hosts doctor` is read-only.
- **Legacy projects (no `.ael-generated.json` yet):** the first `refresh --non-destructive` overwrites AEL-managed context files directly and deletes obsolete AEL-managed files instead of writing `*.ael-new`. Old copies go to `.ai-engineering-loop/.ael-backup/<timestamp>/` first, and hashes are recorded so later updates use the normal flow. Append-only files (lessons, glossary) and all other user files are never touched. `sync-hosts` likewise removes host files it recorded in its manifest that the package no longer ships (unless edited).
- **Majors:** `update apply --yes` runs `ai-engineering-loop migrate --from <old>` right after the install. `migrations/<major>.js` steps are idempotent and recorded in `~/.ai-engineering-loop/migrations.json`.
- **Rollback:** `update rollback --yes` reinstalls the previous version, re-syncs host skills, and restores any legacy-update snapshot taken by that update.

Manual workflow:

```bash
ai-engineering-loop update check
ai-engineering-loop update plan
ai-engineering-loop update apply --yes
ai-engineering-loop update policy minor      # or off|notify|patch|all; --pin 1.13.x, --channel next
ai-engineering-loop projects list            # projects refreshed after an update
```

`update plan` prints the exact install, `sync-hosts`, `refresh`, and `doctor` commands for the detected install scope. `update apply --yes` runs those commands explicitly; the separate `--yes` flag is the confirmation boundary.

## Unattended Maker isolation

After `gate goal`, create the worktree:

```bash
npx ai-engineering-loop sandbox create --run <run-id>
```

Run Maker with its working directory set to the returned `worktreePath`. Do not let Maker edit the parent checkout. When Maker is done:

```bash
npx ai-engineering-loop sandbox capture --run <run-id>
npx ai-engineering-loop gate maker --run <run-id>
```

Capture writes `diff.patch` plus hash-bound `sandbox-evidence.json`, removes the disposable worktree, and releases the repository-wide Maker lock. The unattended Maker gate rejects a manually supplied diff without matching evidence. Use `sandbox abort` to discard an interrupted Maker worktree.

> [!IMPORTANT]
> A Git worktree is a filesystem and concurrency boundary, not an operating-system sandbox. It does not restrict network access, child processes, credentials inherited by the host, or writes outside the worktree. Run truly untrusted agents in a container or VM with a minimal environment and restricted network.

## Host invariant

Every supported host follows the same order:

1. Read run mode and budget status.
2. Freeze and gate the Goal Contract.
3. End with a report in `REPORT_ONLY`, require human delivery approval in `ASSISTED`, or isolate Maker in `UNATTENDED`.
4. Before each model/subagent call, check budget; after it returns, record actual usage.
5. Keep context packs, usage ledgers, worktrees, locks, raw logs, and credentials out of commits and remote payloads.
