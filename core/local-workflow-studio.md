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
- **Run stage**: the selected Run fills the screen next to the list. A glass card in the top-left shows `<project> · <tier> · iteration n of m`, the Run title (full text on hover), when it started, and the wait as a chip (**Freeze?**, **Approve delivery?**, **Agent asks you**); a Goal waiting for Freeze keeps its Freeze button right there. **Details** (bottom right, or press `D`) opens the findings, PR, receipt, Goal and assumptions in a bottom sheet: it slides up over the stage, closes with Esc, the Close button, a tap on the dimmed backdrop, or a downward drag on touch, keeps focus inside while open, and returns focus to the button. Below 900 px the project list folds into a **Projects** menu in the top bar so the stage keeps the whole screen.
- **Kitchen**: with WebGL the Run is a warm open restaurant kitchen seen slightly from above: a cream tiled backsplash, a wooden back shelf on iron brackets with jars, a steel hood over the Cook station, a steel back counter, pendant lamps over the pass that cast soft pools of light, a marble counter on a wooden front and a terracotta dining floor. It reads left to right along the counter with six stations: **Order** (Goal: an open order book, an ink pot with a quill and a ticket spike), **Cook** (Maker: a hob with a pan and a stock pot, steam while cooking), **Taste** (Verify: a cutting board with soup and a spoon, shakers and herbs), **Critic** (Review: a plate on a velvet cloth, a magnifier on a stand and a glass of wine, under a dim red spot), **Head chef** (Judge: a service bell, ticket slips and a stamp) and **Serve** (Deliver: a plate under a cloche and a stack of plates). Hover a station with a mouse and it lifts slightly while its label lights up. Under each station its name and AEL stage are page text projected from the scene (for example "Taste / Verify"). A lamp on the counter front shows each station's status: green done, warm orange with a soft pulse in progress, dim not started, greyed skipped (T0 skips Critic and Head chef). Order tickets hang on a rail on the back wall; this Run's orange ticket slides to the active station, reading "Your order" or, after a Run went back, "Iteration 2 of 3", and a dashed "Sent back to the kitchen" path runs from Head chef to Cook. The bot stands on the counter behind its station's props and hops between stations with a little squash and stretch when the stage changes. When the Judge passes, the Head chef's bell wobbles. In front of the counter is the guest table, **You, the guest**: when the Run waits for a Freeze it asks **Confirm the order?** with the Freeze button; a delivery approval reads **Bring it out?** and an agent question "The waiter asks you something" (both answered in the agent host). A small dining area holds NPC diners (round bots like the chef in their own colours) who lift a fork, sip or chat on staggered loops and now and then glance at the bot while the kitchen works; hover or focus one for its name tag (name, note, "Eating while their workflow cooks"). The top-right caption shows what is happening now (the current stage's agent, "Waiting for Freeze", "Delivered", with the findings count when there is a ledger). Rendering is procedural (no downloaded models): rounded and bevelled forms, PBR materials (veined marble, brushed steel, wood grain, glazed tiles), warm key, fill and rim lights, soft shadows, contact shadows, ACES tone mapping with a per-theme exposure, and a generated environment; static geometry is merged per material. It renders only while something moves (an idle bot wakes it only to blink) and pauses in a hidden tab, and a finished Run's diners hold still. Switching projects repaints the same kitchen behind a short fade; Previous/Next in the station view slides a second kitchen in and disposes the old one. Without WebGL, or if three.js fails, the Run is a flat circle with the same station names, the ticket, the return note and the guest prompt as text. With `prefers-reduced-motion` the chef cuts to the next station with a short fade, lamps do not pulse and diners hold a still pose. Recipe nodes that do not map to a stage are listed in the details.
- **Top bar**: the AEL mark, the project count, bots working (orange chip with a live dot) and waiting for you (outlined chip), and the connection state (Live, Reconnecting, Offline). It stays at the top while you scroll.
- **Bot**: one glossy orange sphere with two tall black capsule eyes set a little right of centre, as if looking sideways, and a soft contact shadow; no visor, no mouth. It is a button, and its name says what it is doing (for example "Bot is reviewing: Devil's Advocate, 3 findings · 1 blocking"). Small accessories show the station: a laurel wreath and a quill at Order, a chef hat with a spatula at Cook and with a spoon at Taste, a monocle, a magnifier, a near-black body and dim red eyes as the Critic, a chef hat and a gavel at Head chef, a chef hat and a tray with a cloche at Serve. The eyes carry the mood: they blink every few seconds, squint while reviewing, widen with a question mark when the agent asks you something, tilt angrily during a long wait, and turn to ^ ^ when you click. A waiting bot looks around, then taps, then grumbles, then rants with steam; a finished Run's bot smiles and rests. Click, tap or Enter makes it bounce and spin; on a mouse its eyes follow the pointer. With `prefers-reduced-motion` (the OS setting) it holds a still pose and only fades remain. These are decoration; the page text is the source of truth.
- **Waiting moods**: while a Run waits for you, the bot gets more impatient with how long the wait has lasted (thresholds in `WAIT_LEVEL_SECONDS`, `studio/js/mood.js`): first a polite line ("Your order, please?", "Bring it out?"), from 30 s it taps its foot (**…**), from 2 min it is annoyed ("The kitchen is waiting…"), from 5 min it rants (hops, steam puffs, rotating lines such as "Confirm the order!" or "The food's getting cold!"). All lines are fixed copy in one table (`WAIT_COPY`), never file contents. Screen readers hear the line once when the level changes, not on every rotation. With reduced motion the bot holds a still pose and the bubble shows one line.
- **Station view**: click, tap or press Enter on the bot (or click its station) and the camera dollies to that station in the same kitchen; a glass card shows the project, Run title, activity, stage, tier, iteration, the wait, and the Freeze button when the Goal waits for Freeze. **Previous** / **Next** (or ←/→) move to the previous or next project with an active Run, and the list selection follows: the kitchens slide past each other. **Close** or Esc zooms back out and returns focus to the bot. It is a modal dialog with focus kept inside. With reduced motion the zoom and the switch are cuts. Without WebGL the view shows the card only.
- **Goal**: shown **Formatted** (headings, lists, emphasis, code, http(s) links; everything else is escaped text) or as raw **Markdown**, switched with the tabs (arrow keys, Home, End).
- **Details** (the sheet): the human Goal, Devil's Advocate and Judge findings (total, blocking), PR status, receipt state, and unconfirmed assumptions (`provenance.json`). PR status is the branch (from `worktrees.json` or `delivery.json`), whether a merge was recorded, and the merge URL, all read from the Run's own records (`merge.json`); Studio never queries GitHub or GitLab, so checks and review state stay in `ael pr status`.
- A finished worktree Run (reported, delivered, cancelled or escalated) shows an idle bot, not a working one.
- Theme: AEL orange on warm paper (light) or ink (dark), following the OS. All colours live in `studio/tokens.css`. Motion follows Emil Kowalski's rules; reduced motion keeps fades and removes movement.

### Diners

The named diners are a nod to people who inspired AEL, relaxing over dinner while their own workflows cook; they come from `studio/diners.json` (`[{ "name", "note" }]`, at most 6). Generic diners without name tags fill the empty chairs. To seat your own, add `studio.diners` to `~/.ai-engineering-loop/config.json`:

```json
{ "studio": { "diners": [{ "name": "Night owl", "note": "Orders dessert first" }] } }
```

Each entry needs a `name` (at most 40 characters) and may have a `note` (at most 60); Studio keeps the first 6 valid entries, drops the rest, and shows names as escaped text. When no entry is valid it falls back to `studio/diners.json`. `GET /api/me` returns the list as `diners`; there is no endpoint that writes it.

Studio polls the registered projects every 2 s and pushes a `projects` snapshot over server-sent events only when something changed.

## Freeze

A Run whose Goal draft waits for approval shows **Freeze as &lt;name&gt;** in the project list and in the Run view. The freeze question that `goal draft` posts is shown as this Freeze wait, not as an agent question; any other pending question still shows as a question. A Freeze from Studio, or a repeat `goal freeze` of an already frozen draft, answers that freeze question, so the Run stops waiting. A repeat `goal freeze` still refuses an agent-like `--by` and records nothing. The name is `studioActor` from `~/.ai-engineering-loop/config.json`, else git `user.name`, else the OS user name. If that name does not pass the human-actor check, Studio asks for a name once and stores it (`PUT /api/me`).

Freeze works in both `goalFreeze` modes. It records `goal.approval: "studio"`. Studio sends the content hash of the draft you saw (the list button carries the hash it was rendered with); if the draft changed since, the freeze is refused (409) and the view reloads. In the default `host-question` mode the agent may be asking Freeze/Revise in the host at the same time: whichever answer comes first wins. `goal freeze` is idempotent: when the same draft is already frozen it succeeds with `alreadyFrozen: true` and the original approval channel and actor, and the agent continues. A frozen Goal whose hash differs from the draft still fails.

### Look before you freeze

When the draft waiting for Freeze has a `flow` and `freeze_diagram` in `.ai-engineering-loop/workflow.md` is not `off`, Studio offers **Look at the order sketch** at the guest table, next to the Freeze chip, and as **Sketch** in the project list. It opens a sheet with the diagram views as tabs (State, Storyboard, Lanes; the recommended one first, as `goal draft` ranks them in `diagramOptions`), the counts ("3 undecided, 1 hotspot, 2 side effects"), the line "To change the Goal, answer Revise in your agent host." and **Freeze as &lt;name&gt;** at the bottom, which sends the same `expectedHash` as every other Freeze; a successful Freeze turns the button into a green check with one soft pulse before the view refreshes. Studio has no Revise button. The sheet opens at once: while a Run waits for Freeze, Studio already loads the recommended view in the background, shows a skeleton until a view has loaded, keeps one iframe per visited tab, and loads the other tabs when the browser is idle. Diagram URLs carry the draft's content hash (`&rev=<hash>`); the server lets the browser cache such a URL only while that hash is the current draft, and serves every other request with `no-store`. The diagram is the same page `goal diagram` writes, rendered on request and never saved (`runs/<id>/diagrams` is not touched). It loads in a sandboxed iframe from `GET /api/projects/:id/runs/:runId/goal/diagram?view=…`, served with its own Content-Security-Policy: no scripts, only its one inline stylesheet allowed by hash, `frame-ancestors 'self'`, and `sandbox`.

## Notifications

When a Run starts waiting for a human, Studio sends one OS notification: title `AEL: <project>`, body `Goal waiting for Freeze`, `Delivery waiting for approval` or `Agent has a question`. The same wait never notifies twice; waits already open when Studio starts do not notify, so a restart does not repeat them; routine progress never notifies. macOS uses `osascript`, Linux uses `notify-send` when it is installed (looked up once per Studio process), other systems get none. The notifier runs asynchronously with a 5 s timeout, so a stuck notifier never blocks Studio. The text never contains file contents. Turn it off with `--no-notify`.

## HTTP API

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | `{ app: "ael-studio", pid }`, no session needed; used to detect a running instance. |
| `GET /api/projects` | Every registry project with its current Run and worktree Runs, summarised. |
| `GET /api/projects/:id/runs/:runId` | One Run's detail (summary, ring, Goal markdown and hash, findings, PR, receipt, assumptions; `diagramOptions` and `flowCounts` while a draft with a flow waits for Freeze). |
| `GET /api/projects/:id/runs/:runId/goal/diagram?view=state\|storyboard\|lanes` | The draft's diagram page (read-only, sandboxed CSP). 400 for an unknown view, 404 without a draft, a flow, or with `freeze_diagram: off`. |
| `GET /api/me`, `PUT /api/me` | The Freeze actor and the diners; `PUT { actor }` stores a valid human name. |
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
