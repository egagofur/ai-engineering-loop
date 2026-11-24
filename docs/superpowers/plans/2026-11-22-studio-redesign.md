# AEL Studio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Workflow Studio with a machine-wide, read-only "watch the bots" Studio: project list + 3D loop ring per Run, one Freeze action, macOS notifications.

**Architecture:** Small focused Node modules under `lib/studio/` (instance file, project discovery, Run summary, notifier) feed a rewritten `lib/studio-server.js` with fewer than 10 endpoints. The browser UI is plain ES modules in `studio/js/` plus vendored three.js; render functions are pure (state in, HTML or geometry plan out) so they test in Node without a DOM.

**Tech Stack:** Node >= 18 CommonJS (server), browser ES modules (UI), three.js vendored as `studio/vendor/three.module.min.js` (MIT), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-studio-redesign-design.md`

## Global Constraints

- No build step, no runtime npm dependencies; three.js is a vendored file, not a dependency.
- Bind `127.0.0.1` only; per-process token exchanged for an `HttpOnly; SameSite=Strict` cookie; reject non-local `Host`; CSP `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
- Reads only `.ai-engineering-loop/` inside registry paths and their `worktrees.json` worktrees; the browser never sends a path, only opaque project ids.
- The only write is Freeze via `freezeGoal(..., { studioSession: true })`; agent-like actors stay refused.
- Colours only in `studio/tokens.css` (from phase 1); motion per Emil rules (named properties, `--ease-out`, press `scale(.97)`, hover behind `@media (hover:hover) and (pointer:fine)`, reduced motion keeps fades).
- Every `gateError(...)` keeps `{ why, fix }`; `npm run audit:package` must pass; T1 skill budget via `npm run measure`.
- Do not commit, push or publish unless the maintainer asks (AGENTS.md). Commit steps below are local commits on the feature branch, made only when the maintainer has approved executing this plan.

## Review Focus

1. A registry path that no longer exists, or a project with no `.ai-engineering-loop/runs` → listed as "missing" or "idle", never a 500 (Task 3).
2. `current.json` pointing at a deleted Run, or a corrupt `state.json` → that project shows "idle" with no Run, other projects still render (Task 4).
3. Freeze clicked twice, or the draft changed since the page loaded → second click returns the existing freeze (`alreadyFrozen`); a changed draft returns `GOAL_DRAFT_CONFLICT` and the UI says reload (Tasks 1, 6).
4. Notification text containing quotes, backslashes or newlines from a task title → escaped, never executed; no `osascript`/`notify-send` on the machine → silent no-op (Task 5).
5. 20+ registered projects → one poll loop with a fixed interval, no per-project busy loops; the page stays responsive (Task 6).

---

### Task 1: Idempotent `goal freeze`

**Files:**
- Modify: `lib/goal-runtime.js` (`freezeGoal`), `bin/ai-engineering-loop.js` (goal freeze JSON and text output)
- Modify: `skill-src/ael/references/loop-goal.md` (freeze line)
- Test: `tests/goal-freeze-idempotent.test.js`

**Interfaces:**
- Produces: `freezeGoal(rootDir, runId, opts)` returns the Run as today, plus `run.alreadyFrozen === true` when the Run is already frozen with the same content hash as the latest draft (no new history entry). Different hash → throws `INVALID_GOAL_TRANSITION` as today.
- CLI JSON: `{ ok: true, runId, result: <run>, alreadyFrozen: true }` when idempotent.

- [ ] **Step 1: Write failing tests**
  - `freezes once, then a second freeze of the same draft returns alreadyFrozen with the first actor and approval` — freeze via `studioSession: true` as `'Ega'`, then call again with actor `'pengguna'`, `env: {}`: expect `alreadyFrozen === true`, `goal.actor === 'Ega'`, `goal.approval === 'studio'`, history length unchanged.
  - `a second freeze with a different expected hash still refuses` — freeze, then call again with `expectedHash: 'other'`: expect `code === 'GOAL_DRAFT_CONFLICT'` and no change to `goal.actor`.
  - CLI: `goal freeze --json --latest --by "AEL Round3 Tester"` twice → second `status 0`, `JSON.parse(stdout).alreadyFrozen === true`.
- [ ] **Step 2: Run `node --test tests/goal-freeze-idempotent.test.js`** → FAIL (`INVALID_GOAL_TRANSITION`).
- [ ] **Step 3: Implement** in `freezeGoal`: before the `STARTED` check, if `run.goal?.frozen` and the latest draft's `contentHash === run.goal.hash` and (`expectedHash` is null or equal), return `{ ...run, alreadyFrozen: true }`. In the CLI, pass `alreadyFrozen` into the JSON and print "Goal already frozen by <actor> (<approval>)" in text mode.
- [ ] **Step 4: Skill line** in `loop-goal.md` freeze bullet, append: `` `alreadyFrozen`: the human froze it in Studio; continue. `` Run `npm run build:skills && npm run measure` → T1 ≤ 17859.
- [ ] **Step 5: Run** `node --test tests/goal-freeze-idempotent.test.js tests/human-freeze-repo.test.js` → PASS.
- [ ] **Step 6: Commit** `feat(goal): idempotent freeze so Studio and the host can both approve`.

### Task 2: Machine Studio instance file

**Files:**
- Create: `lib/studio/instance.js`
- Modify: `lib/runtime-files.js` (drop `studio-layouts/`; keep `studio.json` only if still written per project — it is not), `bin/ai-engineering-loop.js` (`readStudioUrl` import from the new module)
- Test: `tests/studio-instance.test.js`

**Interfaces:**
- Produces: `projectId(projectPath: string): string` — first 12 hex of sha256 of `fs.realpathSync(path)`.
- `writeInstance({ home, pid, port }): void` → `~/.ai-engineering-loop/studio.json` `{ schemaVersion: 1, pid, port, url: 'http://127.0.0.1:<port>/', startedAt }`, mode 0600, no token.
- `readInstance({ home }): { pid, port, url } | null` — null when missing, malformed, or pid not alive.
- `clearInstance({ home }): void`.
- `readStudioUrl(rootDir: string, { home } = {}): string | null` → `${url}?project=${projectId(rootDir)}` when an instance is alive.

- [ ] **Step 1: Failing tests**: write then read returns the same port; a dead pid (`999999`) reads as null and the file is removed; `readStudioUrl(repo)` ends with `?project=` + 12 hex; the file never contains `token`.
- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement** (pid check with `process.kill(pid, 0)`; reuse `fsutil` atomic write if present).
- [ ] **Step 4: Run** → PASS; update `bin` to import `readStudioUrl` from `lib/studio/instance.js`; `node --test tests/cli-runtime.test.js` still PASS.
- [ ] **Step 5: Commit** `feat(studio): machine-wide instance file`.

### Task 3: Project discovery and read scope

**Files:**
- Create: `lib/studio/projects.js`
- Test: `tests/studio-projects.test.js`

**Interfaces:**
- Consumes: `listProjects({ home, prune: false })` (`lib/project-registry.js`), `loadRegistry(mainRoot)` (`lib/run-isolation.js`), `projectId` (Task 2).
- Produces: `discoverProjects({ home }): Project[]` where `Project = { id, name, path, missing: boolean, worktrees: [{ id, path, branch, runId }] }`; `name` = last two path segments (`dltx/backend-service`).
- `resolveProject(projects, id): Project | null` — the only way the server turns an id into a path.
- `contextPath(root: string, ...parts): string` — joins under `<root>/.ai-engineering-loop/` and throws `PATH_OUTSIDE_SCOPE` if the resolved path escapes it.

- [ ] **Step 1: Failing tests**:
  - registry with two repos + one deleted path → 3 projects, deleted one `missing: true`.
  - a registry entry that is a worktree of another registered repo (listed in its `worktrees.json`) is folded: appears only under the parent's `worktrees`.
  - `contextPath(root, '..', '..', 'etc')` throws `PATH_OUTSIDE_SCOPE`.
  - `resolveProject(projects, 'deadbeef0000')` → null.
- [ ] **Step 2–4: Run FAIL → implement → run PASS.**
- [ ] **Step 5: Commit** `feat(studio): discover registry projects and worktrees with a read scope`.

### Task 4: Run summary and detail

**Files:**
- Create: `lib/studio/summary.js`
- Test: `tests/studio-summary.test.js`

**Interfaces:**
- Consumes: `getCurrentRun`, `loadRun`, `runsDir` (`lib/run-state.js`), `loadWorkflow`/`workflowStatus` (`lib/workflow-runtime.js`), `loadGoalDraft` (`lib/goal-runtime.js`), `renderHumanGoal` (`lib/ste.js`), `loadProvenance` (`lib/provenance.js`), `loadMerge`, `branchForRun` (`lib/pr-status.js`), `RECEIPT_FILE` (`lib/receipt.js`), `listRunInteractions` (`lib/run-interactions.js`), `contextPath` (Task 3).
- Produces:
  - `STAGES = ['goal','maker','verify','review','judge','deliver']`.
  - `summarizeProject(project): { id, name, state: 'waiting'|'working'|'idle'|'missing', run: RunSummary|null, worktreeRuns: RunSummary[] }`.
  - `RunSummary = { runId, task, state, tier, iteration, maxIterations, stage, ring: [{ stage, status: 'done'|'now'|'pending'|'skipped' }], waiting: null | { kind: 'freeze'|'approval'|'question', since }, updatedAt, elapsedMs }`.
  - `runDetail(project, runId): { summary: RunSummary, goalMarkdown: string|null, findings: { total, blocking }|null, pr: { branch, merged, url }|null, receipt: 'none'|'written'|'verified', unconfirmed: string[], extraNodes: string[] }`.
- Stage mapping rule: node types/ids map onto the six stages (goal→goal, maker→maker, verification→verify, review→review, judge→judge, delivery-approval|delivery→deliver); stages with no node → `skipped`; unmapped nodes listed in `extraNodes`.
- Waiting rule: `freeze` when state `STARTED` and a Goal draft exists; `approval` when `delivery-approval` node is `READY`; `question` when an interaction has no answer. Order in the list: waiting, working, idle, missing.

- [ ] **Step 1: Failing tests** (fixtures built with `createRun`, `saveGoalDraft`, `freezeGoal` with `studioSession: true`):
  - drafted, not frozen → `state 'waiting'`, `waiting.kind 'freeze'`, ring `goal: 'now'`.
  - frozen → ring `goal: 'done'`, `maker: 'now'`, `waiting null`.
  - `current.json` points at a missing Run → `state 'idle'`, `run null` (Review Focus 2).
  - corrupt `state.json` → `idle`, no throw.
  - T0 quick Run → review and judge `skipped`.
  - `runDetail` returns `goalMarkdown` starting with `# Goal for Run` and `unconfirmed` from `provenance.json`.
- [ ] **Step 2–4: Run FAIL → implement → run PASS.**
- [ ] **Step 5: Commit** `feat(studio): run summaries with six-stage ring and waiting state`.

### Task 5: Notifier

**Files:**
- Create: `lib/studio/notify.js`
- Test: `tests/studio-notify.test.js`

**Interfaces:**
- Produces: `createWaitTracker({ notify: (title, body) => void }): { update(projectSummaries): void }` — fires once per new key `${projectId}:${runId}:${waiting.kind}`; a key that disappears and comes back fires again.
- `osNotifier({ platform = process.platform, run = execFileSync, which }): (title, body) => void` — macOS: `run('osascript', ['-e', `display notification ${q(body)} with title ${q(title)}`])` with `q` producing an AppleScript string literal (escape `\` and `"`, newlines → space); Linux: `notify-send title body` only if found; otherwise no-op. Never throws.
- Copy: title `AEL: <project name>`; body `Goal waiting for Freeze` | `Delivery waiting for approval` | `Agent has a question`.

- [ ] **Step 1: Failing tests**: two updates with the same wait → one notify call; wait cleared then back → two calls; task title `He said "hi" \ now` never reaches the command (body uses fixed copy) and `q('a"b\\c')` → `"a\"b\\\\c"`; `platform: 'win32'` → no call, no throw; a `run` that throws → swallowed.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** `feat(studio): one-shot wait notifications for macOS and Linux`.

### Task 6: Server rewrite

**Files:**
- Rewrite: `lib/studio-server.js`
- Test: `tests/studio-server.test.js` (rewrite), adapt `tests/audit-hardening.test.js` Studio cases

**Interfaces:**
- Consumes: Tasks 2–5, `freezeGoal` (Task 1), `humanFreezeActor` behaviour via `freezeGoal`.
- Produces: `createStudioServer({ home, token, notifier, pollMs = 2000 }): { server, token, close() }`.
- Endpoints (all need the session cookie or `x-ael-studio-token`):
  - `GET /api/projects` → `{ ok, projects: ProjectSummary[] }`
  - `GET /api/projects/:id/runs/:runId` → `{ ok, detail }`
  - `GET /api/me` → `{ ok, actor, actorValid }` (actor = config `studioActor` || git global `user.name` || OS user)
  - `PUT /api/me` `{ actor }` → saves `studioActor` in `~/.ai-engineering-loop/config.json` after `humanFreezeActor`-style validation
  - `POST /api/projects/:id/runs/:runId/goal/freeze` `{ expectedHash }` → `freezeGoal(root, runId, { actor, expectedHash, studioSession: true })`; returns `{ ok, run, alreadyFrozen }`
  - `GET /api/events` → SSE: `projects` event with the full summary list whenever it changes (one poll loop every `pollMs`, compare JSON), `ping` every 15 s
  - static allowlist: `/`, `/index.html`, `/tokens.css`, `/styles.css`, `/js/main.js`, `/js/api.js`, `/js/list.js`, `/js/detail.js`, `/js/ring.js`, `/js/ring2d.js`, `/vendor/three.module.min.js`
- Keep from today: token→cookie exchange, Host check, CSP header (Global Constraints), `no-store`.

- [ ] **Step 1: Failing tests**: no cookie → 401; `Host: evil.test` → 403; `/api/projects` lists a fixture registry; unknown project id → 404 `{ code: 'PROJECT_NOT_FOUND' }`; freeze twice → second `alreadyFrozen: true` (Review Focus 3); freeze with stale `expectedHash` → 409 `GOAL_DRAFT_CONFLICT`; `/js/../../package.json` → 404; SSE sends a `projects` event within `pollMs` after a fixture Run changes; with 25 fixture projects one poll completes under 500 ms (Review Focus 5); notifier fake receives one call for a new freeze wait.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** `feat(studio): read-only multi-project server with one freeze action`.

### Task 7: CLI `studio`

**Files:**
- Modify: `bin/ai-engineering-loop.js` (`handleStudio`, help text), `lib/cli-args.js` if `studio` is a writer (it writes `studio.json`: add `{ flags: ['--no-open','--background','--stop','--no-notify','--json'], valued: ['--port'] }`)
- Test: `tests/studio-cli.test.js`

**Interfaces:**
- Consumes: `createStudioServer` (Task 6), `writeInstance`/`readInstance`/`clearInstance` (Task 2), `osNotifier` (Task 5).
- Behaviour: `ael studio` → if `readInstance` is alive, open (unless `--no-open`) and print its tokenless URL with "Studio is already running; if the browser asks for a session, run `ael studio --stop` then `ael studio`", exit 0 (the token belongs to that process and is never written to disk). Otherwise start, `writeInstance`, open browser unless `--no-open`/`--background`. `--background` → spawn a detached child `ael studio --no-open` with stdio to `~/.ai-engineering-loop/studio.log`, print URL from the log once ready. `--stop` → SIGTERM the instance pid, `clearInstance`. `--no-notify` disables the notifier. On exit, `clearInstance`.

- [ ] **Step 1: Failing tests** (`--port 0`, temp HOME): start prints URL and writes `studio.json`; second start reports already running; `--stop` removes `studio.json` and the process exits; `status --json` in a registered repo shows `studioUrl` with `?project=`.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** `feat(studio): machine-wide studio command with --background and --stop`.

### Task 8: UI shell, project list and detail (2D)

**Files:**
- Rewrite: `studio/index.html`, `studio/styles.css`; keep `studio/tokens.css`
- Create: `studio/js/api.js`, `studio/js/main.js`, `studio/js/list.js`, `studio/js/detail.js`
- Test: `tests/studio-ui-render.test.js` (imports the pure render functions with `await import()`), adapt `tests/studio-design-tokens.test.js` keyframe allowlist to the new CSS

**Interfaces:**
- Produces (pure, return HTML strings, escape all data): `renderProjectList(projects, { selectedId }): string`, `renderDetail(detail, { actor }): string`, `renderFreezeButton(summary, actor): string` (only when `waiting.kind === 'freeze'`, label `Freeze as <actor>`).
- `main.js` wires `EventSource('/api/events')`, selection via `?project=` and click, freeze POST, theme from `prefers-color-scheme`, and the ring (Task 9).
- Layout per spec sketch: left list (waiting first), right ring + detail; under 900 px the list stacks on top and the ring becomes the 2D rail.

- [ ] **Step 1: Failing tests**: list orders waiting → working → idle → missing; a task title `<img src=x onerror=1>` renders escaped; freeze button appears only for `freeze` waits and reads `Freeze as Ega`; detail shows `goalMarkdown` as text (not HTML) and lists `unconfirmed`; CSS has no hex outside tokens and only the allowed keyframes.
- [ ] **Step 2–4: FAIL → implement → PASS.** Use the `emil-design-eng` skill for panel, press and transition values.
- [ ] **Step 5: Commit** `feat(studio): project list and run detail UI`.

### Task 9: Loop ring (three.js) with 2D fallback

**Files:**
- Create: `studio/vendor/three.module.min.js` (+ `studio/vendor/three.LICENSE`), `studio/js/ring.js`, `studio/js/ring2d.js`
- Modify: `THIRD_PARTY_NOTICES.md` (three.js, MIT, version)
- Test: `tests/studio-ring.test.js`

**Interfaces:**
- Consumes: `RunSummary.ring`, `iteration`, `maxIterations` (Task 4).
- Produces: `ringModel(ring, { iteration, maxIterations }): { stages: [{ stage, angle, status }], botAngle }` (pure; six stages evenly at 60° from the top, clockwise; `botAngle` at the `now` stage, or at the last `done` when none is `now`).
- `mountRing(el, model, { reducedMotion }): { update(model), dispose() }` in `ring.js` (three.js scene: ring, six stage markers coloured by token values read from CSS custom properties, orange bot easing to `botAngle`); `mountRing2d` in `ring2d.js` with the same API (SVG). `main.js` uses `ring2d` when WebGL is missing or `prefers-reduced-motion: reduce`.
- The three.js file is fetched once from the npm registry (`npm pack three@<exact version>`, copy `build/three.module.min.js`). **Ask the maintainer before downloading** (download rule).

- [ ] **Step 1: Failing tests**: `ringModel` angles `[0,60,120,180,240,300]`; bot at `review` → `botAngle 180`; all done → bot at `deliver`; `ring2d` renders six labelled stages as text (readable without 3D).
- [ ] **Step 2–4: FAIL → implement → PASS.** Use the `threejs-fundamentals`, `threejs-geometry`, `threejs-materials`, `threejs-animation` skills; keep one render loop that stops when the tab is hidden.
- [ ] **Step 5: Commit** `feat(studio): 3D loop ring with an SVG fallback`.

### Task 10: Remove the old Studio, docs, verify

**Files:**
- Delete: `studio/app.js`, `lib/studio-layout.js`, `lib/studio-runtime.js` (if unused after Task 6), `tests/studio-ui.test.js`, `tests/studio-n8n-acceptance.test.js`, `tests/studio-wiring.test.js`, `tests/studio-gestures.test.js`, `tests/studio-layout.test.js`, `tests/studio-detail.test.js`, `tests/studio-v22-acceptance.test.js`, `tests/studio-events.test.js`, `tests/helpers/studio-dom.js`
- Modify: `tests/adapter-detect.test.js` (drop the `bootstrap` import or point it at `lib/adapter-detect` directly), `tests/v110-first-run.test.js` and `tests/smart-context.test.js` (remove assertions about deleted Studio files), `core/local-workflow-studio.md` (rewrite to the new behaviour: what Studio is for, what was removed and where those actions live now), `skill-src/ael/references/loop-commands.md` Studio section, `CHANGELOG.md` (breaking change list), `docs/board.md`
- Test: whole suite

- [ ] **Step 1: Delete files and adapt tests**; `npm test` → PASS.
- [ ] **Step 2: Full gate**: `npm run check:skills && npm test && npm run doctor && npm run eval && npm run audit:package && npm run measure` → all green, T1 ≤ 17859.
- [ ] **Step 3: Manual check in the browser** with two fixture repos (one waiting for freeze, one working): list order, ring, freeze click, notification shown on macOS, light and dark, 375 px width.
- [ ] **Step 4: Commit** `feat!: Studio rebuilt as a read-only bot monitor with Freeze`.
