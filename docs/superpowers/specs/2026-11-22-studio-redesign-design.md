# AEL Studio redesign: watch the bots, freeze the Goal

Date: 2026-11-22. Status: draft for approval. Supersedes the old Workflow Studio (`studio/`, `lib/studio-server.js`, v2.17.0).

## Intent and why

AEL runs work through AI agents; the human states intent and approves. The old Studio grew into half dashboard, half control panel (about 40 API endpoints, an n8n-style wiring editor, node start/complete/fail/retry, Goal editing) and has not followed the CLI since 2026-10-18. It now contradicts the product: Goal freeze moved to host question buttons in 2.16, and the wiring editor can change a gated flow.

The maintainer wants Studio to be a **high-level window**: see which bots are working, where, and whether one is waiting for a human, without micromanaging. The one action allowed is **Freeze** a Goal. It is rebuilt from zero, not patched.

Success: open one Studio and know within a few seconds what every bot on the machine is doing; get a macOS notification when a bot needs you; freeze a Goal with one click; never be invited to drive individual steps.

## Goals

1. **All projects in one Studio.** Read every project in the registry (`~/.ai-engineering-loop/projects.json`, `ael projects list`) and show each project's active Run (and its worktree Runs) with stage, tier, elapsed time and "waiting for you".
2. **One Run as a loop ring.** Selecting a project shows its Run as a 3D ring of the six stages (Goal, Maker, Verify, Review, Judge, Deliver) with an orange bot moving around it, iteration count (for example 2 of 3), and the current activity.
3. **Readable detail under the ring**: the human Goal (`goal.md`), DA and Judge findings (counts, blocking), PR status (`pr status` data when present), receipt state, unconfirmed assumptions (`provenance.json`).
4. **Freeze** a Goal that is waiting, from the project list or the Run view, in both `goalFreeze` modes. Uses the existing Studio approval channel (`goal.approval: "studio"`). In the default `host-question` mode the agent may already be asking Freeze/Revise in the host; whichever the human clicks first wins (see "Freeze from two places").
5. **macOS notifications** when a bot starts waiting for a human (Goal waiting for freeze, delivery waiting for approval, an agent question), even with the browser tab closed.
6. **Brand and motion**: AEL orange on warm paper (light default) or ink (dark, following the OS), Geist; motion per Emil Kowalski's rules (as in the phase-1 work on `feat/studio-redesign-tokens`).

## Non-goals

- No wiring or recipe editor, no node start/complete/fail/approve/retry, no Run creation or cancel, no Goal editing, no adapter selection, no loop-limit changes, no answering agent questions in Studio (agents ask through the host's question buttons).
- No remote access, accounts or sharing. Studio stays localhost-only.
- No new data source: Studio only reads what the CLI already writes.

## Anti-goals (failure even if it works)

- Studio becomes a second place to run the loop, or lets someone bypass a gate.
- The 3D view hides information: text must stay readable, and everything shown in 3D must also be available as text.
- Notifications become noise: one notification per new "waiting for you", never repeats for the same wait, nothing for routine progress.
- A build step or runtime npm dependency sneaks in.

## Constraints

- AGENTS.md: plain Node (CommonJS, Node >= 18), no build step, no runtime dependencies; `npm run audit:package` must pass; Run artifacts are never shipped.
- Security: bind 127.0.0.1 only; random per-process token exchanged for an `HttpOnly; SameSite=Strict` cookie (keep today's mechanism); reject non-local `Host`; CSP `default-src 'self'; script-src 'self'` (no inline scripts, no CDN, no remote fonts). Reading other project folders is limited to paths in the registry and only to `.ai-engineering-loop/` inside them.
- Freeze rules from 2.16 stay true: Studio freeze is a human click (`studio` channel); agent-like actors are refused by `freezeGoal`.
- Works offline. three.js is vendored as one ES module file (MIT) in the package.
- Reuse from phase 1 (branch `feat/studio-redesign-tokens`, uncommitted): `studio/tokens.css` and the token/motion guard tests. Its changes to the old `app.js`/`styles.css` and their tests are dropped with the old UI.

## Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| 1. Rebuild inside the AEL package, plain browser ES modules, vendored three.js, notifications from the Studio server (`osascript` on macOS, `notify-send` on Linux) | Keeps one npm package, no build, works offline; hand-written UI needs module discipline; package grows ~650 KB | **Chosen** by the maintainer |
| 2. Separate app with Vite, React and react-three-fiber, prebuilt into the package | Nicer component model; adds a build step and dependencies, against AGENTS.md | Rejected |
| 3. Native macOS menu bar app (Swift) | Best notifications; macOS only, Xcode and signing, heaviest to maintain | Rejected |

Visual direction (picked from mockups): **C. project list on the left (2D) + loop ring for the selected Run on the right (3D)**, over A (isometric floor) and B (2D card grid).

## Decided parts of the how

**Layout**

```
┌ AEL Studio ─────────────────────────────── 4 projects · 2 bots working ┐
│ PROJECTS             │  socialcrab/orch · T2 · iteration 2/3            │
│ ◉ ael · Freeze?      │            GOAL ✓                                │
│ ● socialcrab/orch    │   DELIVER ○        ✓ MAKER       3D ring,        │
│ ● dltx/backend       │   JUDGE  ○  [Devil's Advocate]  ✓ VERIFY  bot     │
│ ○ aduhai/cms         │            ◉ REVIEW ← bot here          circling │
│                      │  Goal (goal.md) · findings · PR · receipt · assumptions │
└──────────────────────┴──────────────────────────────────────────────────┘
```

- Left list order: waiting for you first, then working, then idle; each row shows bot (orange working, outlined waiting, grey idle), project name, stage, tier, elapsed.
- Mobile/narrow: list on top, ring collapses to a 2D stage rail.
- Theme: light default, dark via `prefers-color-scheme`; tokens as in `studio/tokens.css` from phase 1.

**Server** (`lib/studio-server.js` rewritten; target under 10 endpoints)

- `GET /api/projects`: registry projects with their current and worktree Runs, summarised (state, stage, tier, iteration, elapsed, waiting reason).
- `GET /api/projects/:id/runs/:runId`: one Run's detail (stage timeline, human Goal, findings summary, PR status, receipt, unconfirmed assumptions).
- `GET /api/events`: server-sent events for changes across all projects (reuse `lib/run-watcher.js`, one watcher per project).
- `POST /api/projects/:id/runs/:runId/goal/freeze`: the only write; calls `freezeGoal(..., { studioSession: true })` with the human name.
- Static assets: an explicit allowlist (index.html, tokens.css, styles, modules, vendored three.js).
- Project ids are opaque (hash of the path); raw paths are never accepted from the browser.

**Freeze from two places** (maintainer decision)

- Studio Freeze works for every Run, including default `host-question` Runs.
- `goal freeze` becomes idempotent for an agent: if the same draft (same content hash) is already frozen, it returns success with `alreadyFrozen: true` and the original approval channel and actor, instead of `INVALID_GOAL_TRANSITION`. A frozen Goal whose hash differs from the draft the agent wants to freeze still fails.
- Skill text (`loop-goal`): when `goal freeze` answers `alreadyFrozen`, treat the Goal as approved, close the host question if the host allows it, and continue. Keep within the T1 skill budget (`npm run measure`).

**Freeze actor** (builder call): Studio records the human name from git `user.name` (global), falling back to the OS user name, and the button reads "Freeze as <name>". The name must pass `humanFreezeActor`; if it does not, the button asks for a name once and remembers it in `~/.ai-engineering-loop/config.json`.

**Notifications**

- The server tracks "waiting for you" states per Run and sends one OS notification when a new wait appears: Goal draft waiting for freeze, `delivery-approval` READY, an open agent question.
- macOS: `osascript -e 'display notification …'`; Linux: `notify-send` when present; otherwise none. Text includes project and what is waiting, never file contents.
- `ael studio --background` keeps the server running without opening a browser so notifications work with the tab closed; `ael studio --stop` ends it. Notifications can be turned off with a flag or setting. Start at login (launchd) is out of scope (maintainer decision).

**One Studio per machine** (builder call)

- The new server is machine-wide. It writes its pid, port and URL to `~/.ai-engineering-loop/studio.json` (no token). A plain `ael studio` reuses a running instance and opens it, or starts one.
- `studioUrl` in `status --json` / `run --json` points at the machine Studio with that project selected (`/?project=<id>`); it stays tokenless.
- The old per-project `<project>/.ai-engineering-loop/studio.json` is no longer written; readers fall back to the machine file.

**Read scope and worktrees** (builder call)

- Readable roots: each registry path, plus each worktree path listed in that project's `.ai-engineering-loop/worktrees.json`; only the `.ai-engineering-loop/` folder inside each root is read.
- Worktree Runs are shown under their parent project. A registry entry that is itself a worktree of another registered project is folded under that parent, not listed twice.
- Project ids are a hash of the resolved real path; the browser never sends a path.

**Runs that do not follow six stages** (builder call): nodes map onto the six ring stages by type; stages a Run skips (T0, report-only) are dimmed; extra recipe nodes appear in the text detail under the ring.

**Removed**

- `studio/app.js` (128 KB) and the old `styles.css`, the wiring/recipe editor, node control endpoints, Run create/cancel/duplicate, Goal save/unfreeze, decisions, adapter select, loop-limit, layout save, execute/install endpoints, and their tests. `lib/studio-layout.js` and `lib/studio-runtime.js` if nothing else uses them.

## Left to the builder

- Module split under `studio/js/` and how the ring is drawn (geometry, lighting, bot animation) within the three.js and Emil skills; a static 2D fallback when WebGL is unavailable or reduced motion is set.
- Exact "waiting for you" detection from existing artifacts and lifecycle events.
- Throttling of SSE updates across many projects.
- Test strategy: server API tests, a DOM test helper for the new UI, the existing token/motion guard tests adapted, and a notification test with a fake notifier.
- Migration notes in CHANGELOG and `core/local-workflow-studio.md` (what was removed and where those actions live now: agent host and CLI).
