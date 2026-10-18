# Local Workflow Studio

Workflow Studio is a localhost-only live view of recipe-bound and classic CLI runs. It is the place to glance at what the agent is doing and whether the run is still compliant. It does not execute models, shell commands, arbitrary node code, or inject prompts into an external AI conversation. The existing recipe compiler and controlled workflow runtime remain the source of truth.

## Start

```bash
ai-engineering-loop studio
```

The CLI binds only to `127.0.0.1`, creates a random process-local session token, and opens a tokenized bootstrap URL. The server exchanges that URL for an `HttpOnly; SameSite=Strict` cookie and removes the token from the address bar. Use `--no-open` when you want to copy the printed URL manually, or `--port 0` to let the operating system choose an available port.

The server rejects non-local `Host` headers. Static assets are bundled in the npm package; there are no CDNs, analytics, remote fonts, or browser-side model calls. Responses use a restrictive Content Security Policy and are not cached.

Studio watches one project root — the working directory where it was launched. The header shows that root. `status --json` and `run --json` include `studioUrl` when a Studio process for that root is alive. That field identifies the running Studio; it is tokenless and returns 401 without a session. Do not write the session token to disk or into agent-visible output. Open the browser session from the tokenized URL printed by `ael studio`.

## Real-time sync

Studio does not poll `/api/live` on a timer. One `RunWatcher` per process recursively watches `.ai-engineering-loop/runs/` and `current.json`. On a change it re-reads only the changed artifact and pushes a typed event on `GET /api/events` (SSE).

Event types: `run.created`, `run.state`, `lifecycle`, `artifact.impact`, `artifact.drift`, `artifact.guard`, `artifact.verification`, `artifact.findings`, `artifact.verdict`, `artifact.receipt`, `artifact.delivery`, `current.changed`, `presence`. Each event carries `runId`, a monotonic `seq`, and a minimal payload.

The first SSE frame is `hello` with `mode` (`watch` or `poll`), `root`, `currentRunId`, and `seq`. The status pill shows `live: watch` or `live: poll`. Where `fs.watch` is unavailable (or `AEL_STUDIO_FS_WATCH=0`), Studio falls back to a 1 s stat-poll of the same files.

`Last-Event-ID` and `?after=<seq>` replay from an in-memory ring. A gap larger than the ring sends `resync`; the client then reloads `/api/bootstrap`. If the event stream ends or errors, the client reconnects with `setTimeout` backoff (500 ms, 1 s, 2 s, max 5 s) and resumes from the last `seq`; a failed resume falls back to `/api/bootstrap`. The Retry button still calls the same resync. The stream covers every run in the project. The UI follows `current.json` by default and can pin any run, including a classic run with no bound workflow and a run driven with `--run <id>` that is not current.

`GET /api/runs/:id/lifecycle` remains as a bounded REST ledger. `GET /api/runs/:id/lifecycle/stream` and `POST /api/import/*` return 404.

## Live run view

The default route is the live run view. It follows the open run over `GET /api/events`.

- A progress rail for goal, maker, verify, review, judge, and deliver. Each stage shows its status and duration, and the running stage is highlighted.
- A question banner when the run is waiting on a person, with Answer in Studio.
- A current-step card with the node, iteration, running time, latest activity, evidence chips recorded so far, Open node details, and Start with AI Agent.
- Compliance and budget chips for mode, tier, iteration, guard warns and blocks, drift, receipt, and tokens. Tokens read `unknown` when the host reports no usage. A delivered run with no receipt reads “no receipt: run predates receipts”.
- Latest events with clock times, and a timeline grouped by step.
- The header shows when the run started and the heartbeat age. Every time is a `<time datetime>` with the exact local timestamp in a tooltip.

The Goal Contract stays a side sheet of this view (draft, review, freeze, unfreeze). Start with AI Agent still copies a run-bound handoff into the clipboard.

## Runs

**Runs** is a slim history list. Open a row to pin it in the live view as a read-only replay. Artifact inspection still accepts only regular files inside the owning run, rejects path traversal and symlinks, enforces a size bound, and redacts recognized secrets.

## Wiring existing nodes

Studio is read-only for workflow *structure*. Do not create, duplicate, delete, or import nodes here. Author recipes as files and use `recipe create|clone|install`.

**Wiring** keeps the canvas for edges between nodes that already exist: add, remove, or re-point a connection, plus fit, zoom, tidy/auto-layout, and undo/redo for those edge edits. Node moves are layout-only (`PUT /api/layout`) and never enter the graph hash.

Every wiring change is validated by `POST /api/validate`, which is the same `lib/recipe.js` compiler and safety backbone (goal-contract → maker → verification → devil-advocate → judge → delivery/report, plus a human approval before delivery in ASSISTED). An edge set that breaks the backbone is rejected with the compiler's named error and cannot be saved. The server also rejects a recipe whose node set differs from the loaded base (`baseRecipeId`): same node ids, types, and node config; only edges, `dependsOn`, and layout may change. That failure is `STUDIO_STRUCTURE_READ_ONLY` and lists added, removed, and changed node ids. A builtin may still be installed as `<id>-local` when the nodes are unchanged. A valid change is installed only after the confirm dialog (`POST /api/install`). Built-in recipe ids stay reserved; Studio installs a project copy.

## Wiring canvas

### Node tiles

Each existing node is one tile: a type icon, the node name, and exactly one status line. That line is the duration slot (`Passed · 6m 10s` when a duration was recorded). Stage and type text are not repeated as badges on the tile. A loop group draws a container around its nodes and labels it `iteration n / max` from the live loop state.

### Side panel

Click a tile to open the side panel. The tabs are Overview, Output, Evidence, and Timeline. The Overview tab shows the node's upstream input, status, and timing as labeled chips: status, duration, finished, loop iteration, attempts, and the reason when the node failed or blocked. Output is a one-paragraph summary plus the run files. Evidence for a built-in gate is read from the run directory: the goal contract, diff stats and files touched, verification output and test counts, review findings, the judge verdict, the approver, and the delivery receipt. `nodes[id].artifact` stays authoritative when a custom node has one. Each read is confined to that run directory and checked against the sha256 in `state.json`. A mismatch shows “artifact changed”. Path traversal and symlinks are rejected, size is bounded, and recognized secrets are redacted. The Timeline tab lists only this node's events, grouped by iteration or attempt, with human labels and no numbering.

Times read as “5 min ago”, “2 days ago · Oct 16, 15:41”, or an absolute date after 7 days. The exact timestamp is in the tooltip and in `<time datetime>`. Durations read as `2m 20s` and `1h 04m`. A gate duration comes from `GATE_PASSED` or from `NODE_COMPLETED` in the lifecycle log.

### Tooltip

Hover or keyboard focus shows a tooltip with the node name, type, stage, and status. The tooltip is separate from the tile, so the tile does not carry a second stage or type badge.

### Minimap and zoom controls

The minimap draws one rectangle per node. Zoom controls are zoom in (+), zoom out (−), fit, auto-layout, and the zoom percent. Fit and auto-layout keep every built-in recipe inside the canvas.

### Shortcuts

The `?` sheet lists the shortcuts: `F` fit, `L` auto-layout, `+` and `-` zoom, `0` reset zoom, arrow keys between nodes, Enter to open the side panel, Esc to close it, and undo/redo for wiring edits. `:focus-visible` outlines the canvas controls.

On a trackpad, two-finger scroll pans the canvas on both axes, and pinch zooms around the cursor. Ctrl+wheel zooms the same way. Dragging empty canvas with the left button pans, which is also how macOS three-finger drag pans. A click on empty canvas clears the selection. Shift+drag draws a marquee selection. Middle-button drag and Space+drag still pan. The page and the canvas set `overscroll-behavior: none`, and the canvas wheel listener is non-passive, so a horizontal swipe does not navigate browser history. Scrolling inside the side panel scrolls the panel.

### Save bar

The dirty-only save bar stays hidden while the wiring is clean. The first edge change shows the change count, Valid or Invalid, Discard, and Save. Save opens the confirm dialog before `POST /api/install`. A backbone-breaking edge shows the compiler's named error and disables Save. Every edit is checked with `POST /api/validate`.

### Run summary card

When a run is DELIVERED, REPORTED, ESCALATED, or CANCELLED, the canvas shows a run summary card with duration, tests, findings, drift, receipt, and tokens. Tokens read `unknown` when the usage ledger has none.

Workflow structure on this canvas stays read-only. There is no control to create, delete, rename, duplicate, or import nodes. Rewiring only connects nodes that already exist. Live tile and summary updates come from `GET /api/events`.

## Stage 8 delivery adapter

Delivery nodes still expose the project-level Stage 8 adapter in `.ai-engineering-loop/adapter.md`. `POST /api/adapter/select` can select the shipped `standard`, `github`, `gitlab`, or `dot` adapters. The browser never accepts arbitrary adapter code or executes delivery commands.

## Trust boundary

Studio improves observability; it does not weaken runtime gates:

- graph validation does not imply execution permission;
- local execution requires exactly one permitted trigger/root and an audited frozen Goal;
- command nodes remain disabled;
- approvals remain explicit state transitions;
- connector edits cannot bypass the required safety backbone;
- Run History cannot mutate persisted runs or artifacts;
- delivery adapters cannot run before Judge `PASS`;
- token data comes only from the provider-recorded usage ledger;
- the event stream never exposes file contents outside the run-dir artifacts already served.
