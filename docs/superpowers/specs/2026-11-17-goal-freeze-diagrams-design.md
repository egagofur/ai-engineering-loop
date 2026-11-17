# Goal freeze diagrams: look before you freeze

Status: design, awaiting approval. Card: C-27 (to be added to `docs/cards/` when work starts).

## Intent

Before a human freezes a Goal Contract, they read the AC. The AC tell them what should happen, not what else the change will touch: other features, data that changes as a side effect, jobs that run later, and transitions nobody decided. Today `goal draft` shows a flat `impactPreview` (files, tests cut to 10) and, when the Goal has a `flow`, a From | Event | To table plus Mermaid text that most hosts print raw.

This feature lets the human pick a picture of the change before freezing, built from data the agent writes into the Goal, so gaps show up while they are still cheap to fix: as a new AC, a non-goal, or an explicit "not allowed".

The visual style follows `/stack-diagram`: graph-paper background, white tiles, orthogonal arrows, monospace labels. AEL does not use that skill or its toolchain (Python, network logos, Playwright); it draws its own SVG in Node.

## Goals

- Three views, chosen by the human, rendered on demand from one data source (the Goal `flow`):
  1. **Storyboard**: the user's steps as screens, left to right, with effects pinned under the step where they happen.
  2. **Actor lanes** (swimlane): one row per actor (user, app, service, db, job, external); steps placed in order, so a cron or queue that runs later is visible.
  3. **State machine + transition table**: UML statechart with `event [guard] / effects` labels, plus an ISTQB-style table of every state × event pair.
- Side effects that no AC covers are marked (amber, dashed) in every view. Undecided transitions are marked as hotspots.
- The transition table is computed by the CLI, never by the model: every state × event pair the Goal does not define is shown as `?` (undecided) unless the Goal lists it as forbidden.
- After `goal draft`, the agent proactively offers: the recommended view first, other views, or freeze. After a view is rendered, it asks again: freeze, another view, or add AC / non-goal / forbidden transitions for what the picture surfaced.
- HTML is generated only for the view the human picked, only when picked. Nothing is pre-rendered.
- `impactPreview` drops its 10-test cap and shows the same lists as the post-freeze impact map (files, tests), so nothing is hidden at decision time.

## Non-goals

- Service blueprint, CRUD matrix, riak (ripple), before/after data tables: considered and not built now.
- No automatic discovery of which other features read the same data (call-graph or SQL tracing). Effects come from what the agent writes into the Goal.
- No Studio UI for these views in this version. The freeze question Studio already shows is unchanged; the HTML file opens in the browser.
- No model checking. Formal proof stays with the `formal` key and pstack `/statechart` (`docs formal-statechart`).
- No user-defined diagram templates.

## Anti-goals (failure even if it works)

- A diagram ever freezes, unfreezes, or blocks a freeze. Freeze stays an explicit human act.
- The picture claims something the Goal does not say (an invented effect, a transition the agent did not write).
- HTML files leak into the npm package or the PR body (run artifacts stay local; `audit:package` must pass).
- Skill text grows past the T1 budget, or contains Mermaid.
- The agent renders views the human did not ask for.

## Constraints

- Plain Node, CommonJS, no runtime dependencies, Node >= 18.
- Output is one self-contained HTML file: inline SVG and CSS, no scripts required, no network, light and dark via `prefers-color-scheme`.
- All Goal text is untrusted: escape it in SVG and HTML.
- T1 skill budget: about 390 characters of headroom (17468 of 17859). One line in `loop-goal.md` at most; detail goes in `core/goal-contract.md`.
- Every new `gateError` (if any) carries `{ why, fix }`.
- Backward compatible: existing Goals with plain `{from, event, to}` steps keep working, and `goal draft` keeps returning `flow.table` and `flow.mermaid`.

## Approaches considered

| | How | Trade-off |
|---|---|---|
| **A. Agent writes data, CLI draws (chosen)** | Agent extends the Goal `flow`; a CLI command renders the chosen view to HTML and computes the transition table. | Consistent, testable, offline, the `?` cells cannot be skipped. Cost: a small hand-written SVG layout. |
| B. Agent draws free-form HTML each time | Model writes SVG per run. | Prettiest and most flexible, but differs every run, untestable, token-heavy, and nothing guarantees the table is complete. |
| C. Reuse Mermaid output + Markdown table | Already mostly exists. | Cheapest, but terminals do not render Mermaid, it cannot meet the look the user asked for, and HTML would need a CDN. |

The human picked A for all three views.

## Data model (decided)

The Goal keeps one source: `flow`. Each step gains optional fields; the old three-field step stays valid.

```json
"flowSubject": "order",
"flow": [
  { "from": "Diproses", "event": "batal", "to": "Dibatalkan",
    "actor": "user",
    "guard": "belum dikirim",
    "effects": [
      { "text": "refund ke saldo", "ac": "AC-2" },
      { "text": "stok +1", "ac": "AC-3" },
      { "text": "poin loyalti ditarik?" }
    ] },
  { "from": "Dikirim", "event": "batal", "to": "Dibatalkan", "hotspot": "boleh batal setelah dikirim?" }
],
"forbiddenTransitions": [ { "from": "Selesai", "event": "batal" } ]
```

- `actor`: free text, short (user, app, refund-service, db, cron). Used by the lanes view; missing = `user`.
- `guard`: free text shown in `[ ]`.
- `effects[]`: `text` required; `ac` optional. An effect without `ac` is a side effect not covered by an AC and is drawn amber.
- `hotspot`: string (the open question) or `true`. A hotspot step is drawn dashed red and listed as a question.
- `flowSubject` (Goal level, optional): the entity whose status the flow describes. Its presence is what makes the state view the recommended one.
- `forbiddenTransitions` (Goal level, optional): pairs the human decided are invalid. The table shows them as `invalid` instead of `?`.
- Validation: unknown `ac` ids (not in `acceptanceCriteria`) are a flow problem (fails the Goal gate like other malformed flow). Bounds: at most 40 steps and 12 effects per step; over that, `goal diagram` refuses with a message to split the flow.

## Behaviour (decided)

### `goal draft`

Unchanged, plus:
- `extra.diagramOptions`: `[{ view, recommended, reason }]`, recommended first. No file is written.
  - `state` recommended when `flowSubject` is set.
  - `lanes` recommended when the flow has at least two distinct actors and one of them is not `user`.
  - `storyboard` recommended when every step's actor is `user` (or no actors are given).
  - More than one can be recommended; all three are always listed when `flow` exists. With no `flow`, `diagramOptions` is empty and the agent may offer to draft one.
- `extra.impactPreview.tests` is no longer cut to 10.
- Summary counts in `extra.flow`: `undecided` (`?` cells), `hotspots`, `sideEffects`.

### `goal diagram` (new)

```
ael goal diagram --run <runId> --view state|storyboard|lanes [--revision <r>] [--open]
```

- Reads the current draft (or the given revision), validates `flow`, renders only that view, writes `.ai-engineering-loop/runs/<runId>/diagrams/<view>-r<revision>.html` (mode 0600), prints the path and the same counts, and the next question.
- Re-running for the same revision overwrites that file. A new draft revision gets a new file.
- `--open` opens it in the default browser (same mechanism Studio uses).
- Works before and after freeze; never changes Run state.

### Agent behaviour (skill)

After `goal draft`: show AC + impact, then offer the recommended view, the other views, or freeze, as one question. Render only what the human picked. After rendering: summarise what is amber or `?`, then ask: freeze, another view, or turn the findings into AC / non-goals / `forbiddenTransitions` (which means a new draft revision). T0 runs do not offer diagrams unless asked.

Project default (optional): `- **freeze_diagram**: auto | state | storyboard | lanes | off` in `.ai-engineering-loop/workflow.md`, read the same way as `maker_intern`. `auto` (default) uses the rules above; a fixed value makes that view the recommended one; `off` stops the proactive offer (the command still works).

## Views (decided at the level the human saw)

- **State machine**: states as rounded tiles, initial-state dot, transitions as orthogonal arrows labelled `event [guard] / effects`; effects with an AC in the normal colour, side effects amber; hotspot transitions dashed red. Below it, the transition table: rows = states, columns = distinct events, cells = target state, `invalid`, or `?`.
- **Storyboard**: one phone-shaped frame per state in order of first appearance, the event that leaves it under the frame, effects pinned below in tiles (amber when no AC).
- **Lanes**: one row per actor in order of first appearance, steps as tiles in flow order, arrows between consecutive steps; side effects and hotspots marked as above.
- Every view: legend, Goal objective and draft revision in the header, light and dark.

## Calls made after the builder check (author's calls, open to correction)

1. **Revisions.** Only the latest draft is stored. `--revision <r>` must equal the current draft revision, otherwise the command fails and names the current one. After freeze, `goal diagram` reads the frozen contract and names the file `<view>-frozen.html`.
2. **Validation.** All new checks run inside `validateGoalContract` (so `goal draft` rejects them, like other malformed `flow`): unknown `ac` ids, more than 40 steps or 12 effects per step, `hotspot` not a string or `true`, and `forbiddenTransitions` entries whose `from` is not a state or whose `event` is not used in the flow. `flowProblems` takes the whole Goal (or a second `acIds` argument) for the AC check.
3. **Transition table.** Rows are states that have at least one outgoing step; states with none are listed once below the table as end states. Columns are every distinct event in the flow. A cell is: the target (with `[guard]` when given); several targets when steps differ by guard; `conflict` when two steps share from × event with the same or no guard (counted as a hotspot); `invalid` when listed in `forbiddenTransitions`; otherwise `?`.
4. **Warnings.** `flowWarnings` (unreachable state, dead end not named as terminal) are drawn as a small marker on that state in every view and listed in the legend.
5. **Schema.** The new fields go into `schemas/goal-contract.schema.json` with types and the same bounds (`maxItems` 40 and 12, `hotspot` string or `true`).
6. **`freeze_diagram`.** Parsed by the CLI from workflow.md (small parser next to the `maker_intern` one). It shapes `diagramOptions`: a fixed view is marked recommended; `off` returns an empty list plus `diagramsOff: true`. Invalid values warn and fall back to `auto`. The skill line only says "offer `diagramOptions`".
7. **`--open`.** Reuses the Studio opener with the file path; a failure to open prints a warning and still exits 0.
8. **No flow.** `extra.flow` stays absent, as today. `sideEffects` counts effects without `ac`; `hotspots` counts steps with `hotspot` plus conflict cells; `undecided` counts `?` cells.

## Left to the builder

- Layout algorithm details (layered ranks for the state view, wrapping long labels, spacing constants), as long as no arrow crosses label text and nothing is clipped.
- Exact colours and fonts within the stack-diagram look (system font stack; no embedded fonts).
- Module boundaries (for example extending `lib/flow.js` and adding `lib/flow-diagram.js`).
- Wording of CLI output.
- Tests: at least one per decided behaviour above, including escaping, the `?`/`invalid` table, recommendation rules, the uncapped tests list, "no file until asked", and the step/effect bounds.

## Docs and release

- `core/goal-contract.md`: the new fields and views. `skill-src/ael/references/loop-goal.md`: one line. `loop-commands.md`: the `goal diagram` command.
- `CHANGELOG.md` Unreleased; card C-27 and board row.
