# From poteto's live with Matt Pocock (2026-11-21)

Source: "LIVE: Poteto (creator of pstack) on shipping 1,000's of PR's a month at SpaceX" (Matt Pocock, 1:05:36), transcript from YouTube captions. pstack `create-verification-skill` (MIT, poteto) for C-43.

What was said, with timestamps:
- 20:34–21:40: put the deterministic parts of a skill into a script or CLI; leave only judgment to the agent. The verification CLI is "just glue" over Playwright and the Chrome DevTools Protocol (22:01).
- 22:44–23:26: without it, every agent rebuilt its own verification script, each one differently, then threw it away: wasted context and time. Build it once, ship it inside the skill.
- 50:36: when several agents take the same shortcut, fix the environment (lints, types, skills), not the agent.
- 60:36–63:24: mine your past chat transcripts for the moments you had to correct or step in, and turn them into lint rules or skills (pstack `recall`).

AEL already keeps deterministic work in its CLI, turns repeated mistakes into proven rules (`learn promote --prove`, C-31), and keeps skills to steps. Two gaps remain.

## C-43 · P2 · `ael driver scaffold`: build the verification driver once

**Now:** the feature map (C-22) has a `Driver` column, but nothing helps create one. L3 evidence is often a script the agent writes during the Run and discards, different every Run.

**Change:**
1. `ael driver scaffold [--feature <id>] [--surface web|cli|api]` writes `.ai-engineering-loop/drivers/<feature>.<ext>` plus a short README, from what the repo already has: an existing Playwright/Cypress setup, the dev command in `verification.md` or `package.json`, the feature-map row (where, how to reach).
2. Each driver has three parts: **launch** (start the app and wait until ready, from an empty state), **drive** (the user steps from the feature map), **observe** (screenshot, response body, log, exit code into `runs/<id>/evidence/`). Exit 0 only when the observed result matches.
3. The scaffold fills the feature map's `Driver` column with the exact command; `review-pack` already passes drivers to reviewers.
4. No new dependency in AEL: the scaffold reuses the project's own test runner, or writes a plain Node script that uses `fetch` or the project's Playwright if present. Without either, it writes a launch/observe script and says what is missing.
5. `doctor --harness` warns when a Driver command points at a file that is gone, and (info) lists features with no driver when the project has an e2e or smoke lane. Running every driver from doctor would be slow and side-effectful, so doctor checks presence only.

**AC:**
- On a repo with Playwright and a feature-map row, scaffold writes a runnable driver and updates the row.
- On a repo without a browser runner, scaffold writes an API/CLI driver or a launch/observe script and names the gap.
- `doctor --harness` lists features with no driver (when an e2e or smoke lane exists) and Driver commands whose file is missing.
- Re-running scaffold never overwrites an edited driver (writes `<file>.ael-new`).

**Effort:** M.

## C-44 · P1 · `ael learn --transcripts`: learn from what you keep correcting

**Now:** `learn` reads Run artifacts (DA findings, outcomes). The corrections you type in chat ("don't use X", "again?", "use the logger") never reach it, so the same intervention repeats across sessions. C-36 counts interventions but cannot name them.

**Change:**
1. `ael learn --transcripts [--since 30d] [--host claude|cursor|codex|all]` reads local host transcripts for this repository (Claude Code `~/.claude/projects/<repo-slug>/*.jsonl`, Cursor `~/.cursor/projects/<slug>/agent-transcripts`, Codex sessions when present). Read-only; transcripts never leave the machine.
2. It extracts human turns that correct the agent (negations and imperatives after an agent action, "again", "already said", reverts the human asked for), groups similar ones across sessions, and keeps groups seen in 2+ sessions.
3. Output: candidate lessons in the existing `learnings.json` flow, tagged `source: transcripts` with session count, last seen, and one redacted example (secrets and home paths stripped, at most 200 characters). Nothing raw is stored.
4. Each candidate suggests the strongest fix level (architecture, type, lint via `learn promote --forbid-api/--forbid-import`, test, docs) and the `--prove <commit>` to back it, when a matching commit exists.
5. `stats` shows the top repeated corrections next to interventions per Run (C-36).

**AC:**
- From fixture transcripts with the same correction in 3 sessions, one candidate appears with count 3 and a redacted example; a one-off correction does not.
- No transcript text beyond the redacted example is written anywhere; `audit:package` and a test scanning `.ai-engineering-loop/` confirm it.
- Missing host folders are skipped with a note; the command never fails because one host is absent.
- Candidates go through the normal `learn promote` path; nothing becomes a rule automatically.

**Effort:** M–L.
