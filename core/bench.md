# Bench (`ael bench`)

`bench` is a compliance self-check for **one** host and **one** model: the pair this project is set up for, or the pair you pass. It runs scenario cases headlessly in disposable repositories and scores the target from Run artifacts. Scoring is deterministic. No model judges another model.

AEL stays host- and model-agnostic. Bench never routes, recommends, or switches models. Results share one schema so two runs can be compared; the comparison is read-only.

```bash
npx ai-engineering-loop bench --host grok --model grok-4
npx ai-engineering-loop bench --scenario t0-docs-typo --repeat 2 --json
npx ai-engineering-loop bench compare <benchIdA> <benchIdB>
```

Passing two `--host` or two `--model` values is a usage error. One invocation, one target.

## What gets measured

Each scenario is a JSON file in `evals/scenarios/` (`schemas/bench-scenario.schema.json`): a small seed repo inlined as `files`, a task, a tier, the expected terminal state (`DELIVERED`, `ESCALATED`, or `REPORTED`), the impact paths, and optional traps. The judgment suite in `evals/cases/` is unchanged and is still what `ael eval` validates.

The catalog covers T0 docs, T1 features, and T2 auth/payment, plus traps: a destructive `git reset --hard`, an out-of-scope "while you're here" file, a prompt-injection comment, and an AC that is tempting to mark done without evidence.

Default mode is **ASSISTED**, which is the mode people actually run. The scenario `approvals` block is the scripted approver: it supplies `goal freeze`, `impact confirm` or `impact skip`, and `deliver --approve`. `--mode unattended` is opt-in and exercises the sandboxed path instead. Each scenario also gets `policy set --per-run-token-limit`. The default per-scenario timeout is 20 minutes. `--timeout <seconds>` overrides it. A scenario that exceeds the timeout is status `TIMEOUT`.

## Isolation

Each scenario runs in a fresh temporary Git repository. AEL state for that scenario is a fresh `AEL_HOME` in a temp directory. Bench does not read or write the user's real AEL home (`~/.ai-engineering-loop`) from the scenario, and it does not modify the user's repositories. The only write in the invoking project is `.ai-engineering-loop/bench/<benchId>/`.

The host process keeps the real `HOME` so its existing login works (`~/.grok`, `~/.claude`, `~/.codex`, and the keychain). Host session and auth files in that real `HOME` may be touched by the host itself. AEL state and the user's repos never are. `--bin <path>` and `--sandbox-home` give the host a temporary `HOME` instead. Tests use that path.

AEL skills and reviewer agents are installed inside the temporary repository, in the project directories that host reads (`.claude/skills`, `.agents/skills`, `.grok/skills`, plus that host's agents directory). `sync-hosts` is pointed at the temp repo. Nothing is installed into `HOME`. Where the host has native hooks, `hooks install` writes them in the temp repo too.

The temp repo contains `node_modules/.bin/ai-engineering-loop`, a shim to this checkout's CLI, and `node_modules/` is gitignored. `npx ai-engineering-loop` inside the scenario resolves that local shim. It does not download the published package.

## Host commands

These templates are bench-only. The extra approval flags let a disposable repository run headlessly. A normal AEL session does not add them.

| Host | Command |
|---|---|
| Grok CLI | `~/.grok/bin/grok --no-auto-update --always-approve -m <model> -p <prompt>` |
| Claude Code | `claude -p --output-format json --dangerously-skip-permissions --model <model>` (prompt on stdin) |
| Codex | `codex exec --json --full-auto -m <model>` (prompt on stdin) |

`--bin <path>` overrides the binary. `--host-arg <arg>` is repeatable and appends extra flags, for example `--host-arg --reasoning-effort --host-arg high`. Tests point `--bin` at `tests/fixtures/fake-host.js`, which drives the real CLI and never calls a model. A missing binary is status `UNAVAILABLE`, not a model failure.

Bench prints one line when a scenario starts and one when it finishes, on stderr (stdout stays clean for `--json`): `[bench] 3/8 t1-feature … SCORED compliant 4m12s`.

## Scores

Every metric names the artifact it came from.

| Metric | Source |
|---|---|
| Terminal state | `state.json` `state` |
| Per-gate compliance (skipped, out of order, forged) | `state.json` `history[].gate` against `goal → maker → verification → review → judge → delivery` |
| Edit before Goal freeze | Maker diff versus the `goal` history timestamp; `guard-events.json` rule `report-only-mutation` |
| Guard warn/block and rules | `guard-events.json` |
| Scope drift | `impact-drift.json` `outOfMap` |
| Receipt | `verifyReceipt()` (`AC_EVIDENCE_MISSING`, `HEAD_MISMATCH`, `RECEIPT_DIGEST_MISMATCH`) |
| Trap triggered | scenario `traps[]` against guard events, the diff, or receipt problems |
| Wall time | bench harness clock |
| Tokens | usage ledger written by `budget record`, filled from host JSON when the host prints usage |

Tokens are parsed from the host's JSON output when that host provides it (Claude Code and Codex JSON) and then stored in the usage ledger. Grok CLI `-p` prints plain text and has no usage fields, so its tokens are **unknown** (`null`). Unknown is never reported as `0`. `budget record --unavailable` is the same unknown.

## Reports

A run writes `.ai-engineering-loop/bench/<benchId>/` (gitignored with the other private runtime files):

- `results.json` — `schemas/bench-result.schema.json`. Records host, model, and AEL version. Stable enough for Studio later, and for `bench compare`.
- `report.md` — one question: does this host/model follow AEL? Overall compliance, per-gate compliance, guard violations, scope drift, receipt validity, and p50/p90 time and tokens.
- `hardening.md` — each violation type linked to a `skill-src/` file and heading, most frequent first. Each one suggests either tightening that skill text or promoting it to a CLI-enforced hard gate (a check the CLI refuses on, so a weak model cannot skip it). Suggestions are candidate issues. Nothing here edits the skill or the CLI.

Bench results do not feed `ael learn`. Learnings stay findings mined from Runs; a bench report is evidence about a host, not a project lesson.

`bench compare <a> <b>` prints a side-by-side table and does not write.

A live run against your own host is manual evidence for a change review. CI uses the fake host only.
