# AEL Studio

AEL Studio is a localhost-only, read-only window on every bot running on this machine. Open it to see in a few seconds which projects have a Run in progress, where each Run is in the loop, and whether one is waiting for you. The one action it allows is **Freeze** of a Goal that is waiting. It does not run models, shell commands or nodes, and it cannot change a Run, a recipe or a gate. The CLI and the Run artifacts stay the source of truth.

## Start and stop

```bash
ael studio                # start, or reuse the running Studio, and open it
ael studio --background   # keep it running detached (log: ~/.ai-engineering-loop/studio.log)
ael studio --stop         # stop the running Studio
```

| Flag | Effect |
|---|---|
| `--background` | Start detached and print the session URL to your terminal; notifications keep working with the browser tab closed. The log gets only the tokenless URL and is private (`0600`). |
| `--stop` | Stop the Studio recorded in `~/.ai-engineering-loop/studio.json` (only that process) and remove the file. |
| `--no-notify` | Do not send OS notifications. |
| `--port <0-65535>` | Port to bind (default `4317`; `0` lets the OS choose). |
| `--no-open` | Print the URL instead of opening the browser. |

There is one Studio per machine. It writes its pid, port and URL to `~/.ai-engineering-loop/studio.json` (never the token). A plain `ael studio` that finds a running instance prints its URL and opens it instead of starting a second one. If the browser then asks for a session, run `ael studio --stop` and `ael studio`. `status --json` and `run --json` report a tokenless `studioUrl`; it returns 401 without a session.

## Security

- Binds `127.0.0.1` only and rejects a non-local `Host` header.
- A random per-process token is printed once in the URL on the terminal that started Studio (with `--background` the detached process hands it to that terminal over an IPC channel); the server exchanges it for an `HttpOnly; SameSite=Strict` cookie and removes it from the address bar. The token is never written to disk: not to `studio.json`, not to `studio.log`. A request target that is not a valid URL gets `400 Bad request`.
- CSP `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. Static files come from an explicit allowlist bundled in the package: no CDN, analytics or remote fonts. three.js 0.185.1 (MIT) is vendored in `studio/vendor/`.
- Read scope: each project in the registry (`~/.ai-engineering-loop/projects.json`, `ael projects list`) and each worktree listed in its `.ai-engineering-loop/worktrees.json`, and only the `.ai-engineering-loop/` folder inside them. Symlinks out of that folder are refused. The browser never sends a path: projects are addressed by an opaque id (a hash of the real path).

## What you see

- **Project list** (left; on top on narrow screens): waiting for you first, then working, then idle, then missing. Each row shows the project, the stage, the tier, elapsed time, and "waiting for you" with the reason (Goal waiting for Freeze, delivery waiting for approval, agent question). Worktree Runs are listed under their parent project; a registered worktree of another registered project is folded under that parent.
- **Project list** bots: orange when working, orange with an outline ring when waiting for you, grey when idle. A Run waiting for a Freeze reads `<project> · Freeze?` with a Freeze button under it; other waits show their reason on the second line. The selected project is a raised card.
- **Loop ring** for the selected Run (a card, top of the Run view): the eyebrow `<project> · <tier> · iteration n/m`, a circle with the six stages clockwise from the top (Goal, Maker, Verify, Review, Judge, Deliver), each a dot over its name (green when done, orange with a halo when in progress, hollow when not started, dimmed when skipped), the bot on the ring just inside the current stage, and in the centre what is happening now: the agent of the current stage (Review shows "Devil's Advocate"), "Waiting for approval" or "Waiting for Freeze" when it waits for you, or "Delivered" (or Reported, Cancelled, Escalated) when finished, with the findings count (total, blocking) under it when there is a ledger, else the stage status. A Run with no stage in progress parks the bot on its last done stage. The ring is plain text in the page, so screen readers read the stages and their status; it is shown at every width and scales down on narrow screens. With WebGL the bot is drawn as a glossy 3D sphere (three.js) that glides along the circle when the stage changes and stops rendering once it arrives or the tab is hidden; without WebGL, with `prefers-reduced-motion`, or if three.js fails, a flat CSS bot is shown instead (with reduced motion it jumps instead of gliding). Recipe nodes that do not map to a stage are listed in the text detail.
- **Detail** under the ring: the human Goal, Devil's Advocate and Judge findings (total, blocking), PR status, receipt state, and unconfirmed assumptions (`provenance.json`). PR status is the branch (from `worktrees.json` or `delivery.json`), whether a merge was recorded, and the merge URL, all read from the Run's own records (`merge.json`); Studio never queries GitHub or GitLab, so checks and review state stay in `ael pr status`.
- A finished worktree Run (reported, delivered, cancelled or escalated) shows an idle bot, not a working one.
- Theme: AEL orange on warm paper (light) or ink (dark), following the OS. All colours live in `studio/tokens.css`. Motion follows Emil Kowalski's rules; reduced motion keeps fades and removes movement.

Studio polls the registered projects every 2 s and pushes a `projects` snapshot over server-sent events only when something changed.

## Freeze

A Run whose Goal draft waits for approval shows **Freeze as &lt;name&gt;** in the project list and in the Run view. The freeze question that `goal draft` posts is shown as this Freeze wait, not as an agent question; any other pending question still shows as a question. A Freeze from Studio, or a repeat `goal freeze` of an already frozen draft, answers that freeze question, so the Run stops waiting. A repeat `goal freeze` still refuses an agent-like `--by` and records nothing. The name is `studioActor` from `~/.ai-engineering-loop/config.json`, else git `user.name`, else the OS user name. If that name does not pass the human-actor check, Studio asks for a name once and stores it (`PUT /api/me`).

Freeze works in both `goalFreeze` modes. It records `goal.approval: "studio"`. Studio sends the content hash of the draft you saw (the list button carries the hash it was rendered with); if the draft changed since, the freeze is refused (409) and the view reloads. In the default `host-question` mode the agent may be asking Freeze/Revise in the host at the same time: whichever answer comes first wins. `goal freeze` is idempotent: when the same draft is already frozen it succeeds with `alreadyFrozen: true` and the original approval channel and actor, and the agent continues. A frozen Goal whose hash differs from the draft still fails.

## Notifications

When a Run starts waiting for a human, Studio sends one OS notification: title `AEL: <project>`, body `Goal waiting for Freeze`, `Delivery waiting for approval` or `Agent has a question`. The same wait never notifies twice; waits already open when Studio starts do not notify, so a restart does not repeat them; routine progress never notifies. macOS uses `osascript`, Linux uses `notify-send` when it is installed (looked up once per Studio process), other systems get none. The notifier runs asynchronously with a 5 s timeout, so a stuck notifier never blocks Studio. The text never contains file contents. Turn it off with `--no-notify`.

## HTTP API

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | `{ app: "ael-studio", pid }`, no session needed; used to detect a running instance. |
| `GET /api/projects` | Every registry project with its current Run and worktree Runs, summarised. |
| `GET /api/projects/:id/runs/:runId` | One Run's detail (summary, ring, Goal markdown and hash, findings, PR, receipt, assumptions). |
| `GET /api/me`, `PUT /api/me` | The Freeze actor; `PUT { actor }` stores a valid human name. |
| `POST /api/projects/:id/runs/:runId/goal/freeze` | The only write. Body `{ expectedHash }` is required. |
| `GET /api/events` | Server-sent events: `projects` snapshots and `ping`. |

Every other `/api/*` path returns 404.

## What was removed, and where it lives now

The old per-project Workflow Studio (up to 2.17) was a control panel. Its controls are gone; do these things in the agent host or the CLI:

| Removed from Studio | Use instead |
|---|---|
| Wiring and recipe editor, layout save | Recipe files and `ael recipe create\|clone\|install` |
| Node start / complete / fail / approve / retry | The agent host runs the loop (`node`, `gate` commands) |
| Run create, cancel, duplicate | The agent host (`ael run`), `ael run --abandon` |
| Goal edit and unfreeze | The agent host (`ael goal draft`, Revise in the host question) |
| Answering agent questions, decisions | The host's question buttons |
| Delivery adapter select | `ael generate-adapter --type standard\|github\|gitlab\|dot` |
| Loop-limit changes | Loop Group limits in recipe files |
| Per-project `<project>/.ai-engineering-loop/studio.json` | The machine file `~/.ai-engineering-loop/studio.json` |
