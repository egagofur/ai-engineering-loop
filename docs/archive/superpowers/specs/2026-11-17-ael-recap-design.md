# AEL recap: what shipped in the last N days, with proof

Status: approved by the user after a spike (2026-11-17). Card: C-28.

## Intent

Every few days (N, default 7) the user wants one page that shows the features AEL delivered in that window, for one of three readers, with every claim backed by a run artifact. A spike built from real runs (`dltx/backend-service`, `dltx/frontend-service`, 7 runs) was accepted as the direction: full-width HTML, three tabs, evidence one click away.

## Goals

- `ael recap [--days N] [--for me|lead|client] [--projects <path,...>|all] [--out <file>] [--open]` writes one self-contained HTML file.
- Three views in one file (tabs), the `--for` view opened first:
  - **me**: metric cards (runs, first-pass PASS rate, median cycle time, delivered), activity heatmap (day × project), cycle time per run split into AEL stages (goal, maker, verify, review+judge, deliver), top ITERATE causes when there are any.
  - **lead**: metric cards (delivered, first-pass PASS rate, median cycle time, T2 runs); one card per run with badges (verdict, tier, iterations, green verification count, out-of-map files, open findings) and an evidence drawer: ACs with status and evidence, verification commands with exit code and duration, Judge reason, out-of-map files, links to the artifact files.
  - **client**: a "what's new" timeline of delivered runs (date, title, one plain sentence, "verified: N criteria, M automated checks passed"); a "now" list of runs still in progress. No file paths, code, commands, findings, tiers or iteration counts.
- Every number is computed from run artifacts (`state.json`, `goal-contract.json`, `verdict.json`, `verification.json`, `receipt.json`, `run-summary.json`, `iterations.jsonl`, `delivery.json`). Nothing is model-written.

## Non-goals

- No scheduler. Running it every N days is cron, a scheduled agent, or a human.
- No Now/Next/Later columns beyond "now" (features.json has no priority order yet).
- No publishing; the file stays local unless the human shares it.
- No charts library, no network.

## Anti-goals

- The client view leaks source paths, code, command lines, logs or findings. It is built from an allowlist of fields.
- A metric is shown with a comparison that means nothing (an empty previous period).
- The recap changes any Run.

## Decisions (from the spike)

- **Projects.** Default is the current project. `--projects all` reads every project in the AEL project registry; a comma list reads those paths. `--for client` with more than one project is refused (one client, one project).
- **Title.** Goal `title` if present, else the first sentence of `objective`, else `state.displayName` with a leading `--flag` token stripped. Truncated to 90 characters.
- **Client sentence.** Goal `plainSummary` if present (new optional Goal field, one sentence for non-technical readers, at most 240 characters); else `businessOutcome`; else `objective` with a visible "still technical" note. The recap never rewrites text.
- **Comparison.** Deltas against the previous window of the same length are shown only when that window has at least one run; otherwise the card says "no earlier data".
- **Cycle time.** From `state.history` transitions: goal = STARTED → GOAL_FROZEN, maker = GOAL_FROZEN → MAKER_COMPLETE (last), verify = → VERIFIED (last), review = VERIFIED → JUDGED_* (last), deliver = JUDGED_PASS → DELIVERED. Median over delivered runs.
- **Evidence links.** `file://` links to the run's artifact files (lead and me views only).
- **Output.** Default path `.ai-engineering-loop/recaps/recap-<from>-<to>-<for>.html`, mode 0600, git-ignored by the existing `.ai-engineering-loop/` handling. `--open` uses the Studio opener and only warns on failure.
- **Style.** Same look as the freeze diagrams (graph-paper background, tiles, monospace labels), light and dark, responsive down to phone width.
- **Privacy.** Commands are shown as recorded (the recorder already redacts); stdout and stderr are never included.

## Left to the builder

Layout constants, module split (suggested `lib/recap.js` data + `lib/recap-html.js` render), CLI wording, tests (window filtering, stage durations, title cleanup, client allowlist, refusing multi-project client, empty previous window, escaping).
