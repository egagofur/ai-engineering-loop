# AGENTS.md: ai-engineering-loop

AEL is an npm CLI (`bin/ai-engineering-loop.js`, alias `ael`) plus host skills that run a gated engineering loop: Goal Contract -> Maker -> verification -> Devil's Advocate -> Judge -> delivery. Plain Node.js (CommonJS, Node >= 18), no runtime dependencies. The CLI has no build step; only Studio's browser UI is compiled (Svelte + Vite, devDependencies) into the committed `studio/app/`.

## Start here

1. Read this file, then `README.md` for what users see.
2. `npm test` must be green before you change anything. If it is red on a clean checkout, fix that first.
3. Find the code before reading broadly: `rg -n "<symbol>" lib bin`.

## Verify

| Command | When |
|---|---|
| `npm test` | every change (node:test, `tests/*.test.js`) |
| `npm run check:skills` | after editing `skill-src/` or agent bodies |
| `npm run doctor` | before a release or delivery |
| `npm run eval` | when touching `evals/` or Judge/DA policy |
| `npm run audit:package` | when touching `package.json` `files` or adding files |
| `npm run measure` | after any skill text change (T1 context budget) |
| `npm run build:studio` / `npm run check:studio` | after editing `studio/src/`, `studio/js/` or `studio/*.css` (rebuild, then check `studio/app/` matches) |

Full pre-publish gate: `npm run check:skills && npm run check:studio && npm test && npm run doctor && npm run eval && npm run audit:package`.

## Hard rules

- **Generated files.** `.claude/skills/ael/**` and `.agents/skills/ael/**` are built from `skill-src/` by `npm run build:skills`. `studio/app/**` is built from `studio/src/`, `studio/js/` and the CSS by `npm run build:studio`. Never edit them by hand; `check:skills` and `check:studio` fail on drift.
- **Agent prompts.** The Devil's Advocate and Judge prompts live in `agents/shared/*.body.md`. `.claude/agents/*.md` and `.grok/agents/*.md` must carry the same body under their own frontmatter (tested in `tests/skill-host-compat.test.js`).
- **Skill context budget.** T1 parent context (SKILL.md plus the references a T1 run reads) must stay at or under 50% of the baseline in `scripts/measure.js` (tested). Put detail in `core/*.md` (served by `ael docs <name>`) or in references that T1 does not read (`loop-commands`, `loop-report`, `loop-hosts`, `loop-risky`). `ael doctor --harness` shows the headroom.
- **Gate errors.** Every `gateError(...)` in `lib/gates.js` passes `{ why, fix }` (tested). Fixes name the exact next command.
- **Evidence over prose.** Gates recompute outcomes from artifacts (`runs/<id>/*.json`); never add a path where prose or a model's claim can override a gate.
- **Bench-only switches.** Ablation (`bench --without`) must stay unusable on real runs: it needs bench env plus the repo marker, and every skip is logged.
- **Privacy.** Run artifacts may hold source excerpts and logs. Never ship them: `npm run audit:package` must pass.
- Do not commit, push, or publish unless asked.

## Where things are

| Path | Contents |
|---|---|
| `bin/ai-engineering-loop.js` | CLI entry and command handlers |
| `lib/gates.js` | stage gates (goal, maker, verification, review, judge, delivery) |
| `lib/verification-*.js`, `lib/baseline.js` | recording, default plan, layers, integrity scan |
| `lib/claimed-vs-reality.js` | claimed-vs-reality parsing and the L1/L2/L3 rules |
| `lib/cli-args.js` | flag allowlist for commands that write files |
| `skill-src/ael/` | skill template and stage references (source of truth) |
| `studio/src/` | Studio UI: Svelte components (`App.svelte`, `components/`), Vite entry |
| `studio/js/` | Studio pure helpers and the three.js kitchen scene (imported by the components and by tests) |
| `studio/app/` | built Studio served by `lib/studio-server.js` (generated, shipped) |
| `agents/` | DA, Judge, Maker specs; `agents/shared/` = runtime prompt bodies |
| `core/`, `policies/` | specs served by `ael docs <name>` |
| `schemas/` | JSON Schemas for Run artifacts |
| `evals/` | judgment cases and bench scenarios |
| `docs/cards/`, `docs/board.md` | open improvement cards and their status |
| `docs/archive/` | finished cards, board history, old designs and plans (read only for history) |

## Definition of done

- Behaviour change has a test that fails without it.
- `npm test` and `npm run check:skills` pass; `npm run measure` is within budget if skill text changed.
- New user-facing behaviour is documented in `core/` (and routed from `skill-src` if agents need it).
- `CHANGELOG.md` gets an entry for user-visible changes.
