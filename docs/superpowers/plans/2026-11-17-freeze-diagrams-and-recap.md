# Goal Freeze Diagrams and AEL Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human see the Goal as a state machine, storyboard or actor lanes before freeze (C-27), and produce a periodic evidence-backed recap of delivered work for me, lead or client (C-28).

**Architecture:** Both features read existing artifacts and render one self-contained HTML file with inline SVG and CSS. `lib/flow.js` keeps validation and table logic; new `lib/flow-diagram.js` renders views; `lib/recap.js` collects run data and `lib/recap-html.js` renders it. The CLI only wires commands.

**Tech Stack:** Node >= 18, CommonJS, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-goal-freeze-diagrams-design.md`, `docs/superpowers/specs/2026-11-17-ael-recap-design.md`

## Global Constraints

- No runtime dependencies; no network in generated HTML; light and dark via `prefers-color-scheme`.
- All Goal and run text escaped before it enters HTML or SVG.
- Diagrams never change Run state; HTML is written only when the human asks (`goal diagram`, `recap`).
- Flow bounds: at most 40 steps, at most 12 effects per step.
- New files written with mode 0600 under `.ai-engineering-loop/`.
- T1 skill budget stays within `scripts/measure.js` (headroom about 390 chars); no Mermaid in skill text.
- Every new `gateError` passes `{ why, fix }`; product code has no comments (C-26).

## Review Focus

- Goal text containing `<script>`, quotes or `&` must render as text in every view (escaping test in Task 2 and Task 5).
- A flow where every state is an end state but one, or with one step only, must still render without throwing (Task 2).
- A recap window with zero runs must render an empty-state page, not crash (Task 4).
- `--for client` must contain no `file://`, no command text and no path (Task 5).
- Old Goals with plain `{from,event,to}` steps keep validating and rendering (Task 1).

---

### Task 1: Flow model: new fields, validation, transition table, options

**Files:** Modify `lib/flow.js`, `lib/gates.js:134`, `schemas/goal-contract.schema.json`. Test `tests/flow-model.test.js`.

**Interfaces:**
- Produces: `flowProblems(flow, { acIds, forbidden } = {}) -> string[]`; `transitionTable(goal) -> { states, events, rows: [{ state, cells: { [event]: { kind: 'target'|'targets'|'conflict'|'invalid'|'undecided', targets: [{to, guard}] } } }], endStates }`; `flowCounts(goal) -> { undecided, hotspots, sideEffects }`; `diagramOptions(goal, { preference = 'auto' }) -> [{ view: 'state'|'storyboard'|'lanes', recommended, reason }]`; `flowActors(flow) -> string[]` (missing actor = `user`).

- [ ] Step 1: tests: old 3-field step valid; unknown `effects[].ac` rejected; 41 steps rejected; 13 effects rejected; `hotspot: 5` rejected; forbidden pair with unknown state or event rejected; table cells for target / two guards (`targets`) / same pair no guard (`conflict`) / forbidden (`invalid`) / missing (`undecided`); end states listed separately; counts; options: `flowSubject` → state recommended, two actors incl. non-user → lanes recommended, all user → storyboard recommended, `preference: 'off'` → `[]`, `preference: 'lanes'` → only lanes recommended, no flow → `[]`.
- [ ] Step 2: run `node --test tests/flow-model.test.js`, expect failures.
- [ ] Step 3: implement in `lib/flow.js`; `validateGoalContract` passes `{ acIds, forbidden: contract.forbiddenTransitions }`; schema documents `actor`, `guard`, `effects` (maxItems 12), `hotspot` (string or true), `flowSubject`, `forbiddenTransitions`, `plainSummary` (maxLength 240), flow `maxItems` 40.
- [ ] Step 4: `npm test` green.

### Task 2: Diagram renderer (state, storyboard, lanes)

**Files:** Create `lib/flow-diagram.js`. Test `tests/flow-diagram.test.js`.

**Interfaces:**
- Consumes: Task 1 `transitionTable`, `flowCounts`, `flowWarnings`.
- Produces: `renderDiagram(goal, { view, revision, now }) -> string` (full HTML document); `escapeHtml(text) -> string` (shared with Task 5 via `module.exports`).

- [ ] Step 1: tests per view: returns `<!doctype html>`, contains every state name, contains `event [guard]` label, side-effect effect carries class `side`, hotspot step carries class `hotspot`, table has `?` for undecided and `invalid` for forbidden; `<script>alert(1)</script>` in a state name appears escaped and no raw `<script>` exists; single-step flow renders; unknown view throws.
- [ ] Step 2: fail, Step 3 implement (layered ranks by BFS from first `from` for state view; order of first appearance for storyboard; rows by first-appearance actor for lanes; orthogonal paths; graph-paper style from the recap spike), Step 4 pass.

### Task 3: CLI: `goal draft` extras and `goal diagram`

**Files:** Modify `bin/ai-engineering-loop.js` (handleGoal around 3165, help text), `lib/generate-workflow.js` (parse `freeze_diagram`). Test `tests/goal-diagram-cli.test.js`.

**Interfaces:**
- Consumes: Task 1 `diagramOptions`, `flowCounts`; Task 2 `renderDiagram`.
- Produces: `parseFreezeDiagramLine(text) -> 'auto'|'state'|'storyboard'|'lanes'|'off'` (invalid → 'auto'); `goal draft` JSON `extra.diagramOptions`, `extra.flow.{undecided,hotspots,sideEffects}`, uncapped `extra.impactPreview.tests`; `goal diagram --view <v> [--revision r] [--open]` writes `.ai-engineering-loop/runs/<id>/diagrams/<view>-r<rev>.html` (or `<view>-frozen.html` after freeze) and prints `{ path, view, counts }`.
- [ ] Step 1: CLI tests in a temp repo: draft with flow returns options and counts and writes no `diagrams/` dir; `goal diagram --view state` writes the file and leaves `state.json` unchanged; wrong `--revision` fails naming the current one; missing flow fails with a fix line; `freeze_diagram: off` in workflow.md → empty options.
- [ ] Step 2-4: fail, implement, pass.

### Task 4: Recap data

**Files:** Create `lib/recap.js`. Test `tests/recap.test.js`.

**Interfaces:**
- Produces: `collectRecap({ projects: string[], days, now }) -> { window: {from,to}, previous: {from,to,count}, runs: Run[], metrics }`, where `Run = { project, projectPath, runId, date, endedAt, state, delivered, tier, title, objective, clientText, clientTextSource: 'plainSummary'|'businessOutcome'|'objective', verdict, verdictReason, iterations, branch, approvedBy, commands: [{command, exitCode, durationMs}], acs: [{id, statement, status, evidence}], outOfMap: string[], openFindings: number, stages: {goal,maker,verify,review,deliver}, files: {name: absPath} }`; `metrics = { runs, delivered, firstPassRate, medianCycleMs, t2, causes: {[cause]: n} }` and the same for previous (null when previous has 0 runs); `cleanTitle(state, goal) -> string`.
- [ ] Step 1: fixtures built in a temp dir: runs inside and outside the window; stage durations from history; title cleanup strips leading `--task`; client text precedence; previous window empty → previous metrics null; zero runs → empty arrays.
- [ ] Step 2-4.

### Task 5: Recap HTML and CLI

**Files:** Create `lib/recap-html.js`; modify `bin/ai-engineering-loop.js` (`case 'recap'`, help), `lib/cli-args.js` (`recap: { flags: ['--json','--open'], valued: ['--days','--for','--projects','--out'], positionals: [] }`). Test `tests/recap-cli.test.js`.

**Interfaces:**
- Consumes: Task 4 `collectRecap`; Task 2 `escapeHtml`; `project-registry` `listProjects()` for `--projects all`.
- Produces: `renderRecap(data, { for: 'me'|'lead'|'client', now }) -> string`.
- [ ] Step 1: tests: three tabs present and `--for` tab selected; client section has no `file://`, no command string, no path; deltas hidden when previous is null; empty window shows empty state; `--for client --projects a,b` refused; default output path under `.ai-engineering-loop/recaps/`; `--days 0` refused.
- [ ] Step 2-4.

### Task 6: Docs, skill, cards, release notes

**Files:** `core/goal-contract.md`, new `core/recap.md` (served by `ael docs recap`), `skill-src/ael/references/loop-goal.md` (one line), `skill-src/ael/references/loop-commands.md`, `CHANGELOG.md`, `docs/cards/` C-27 and C-28, `docs/board.md`.
- [ ] Step 1: write docs; `npm run build:skills`.
- [ ] Step 2: `npm run check:skills && npm test && npm run measure && npm run doctor && npm run eval && npm run audit:package` all pass.
- [ ] Step 3: commit per feature.
