# Repo cleanup audit — 2026-11-21

Scope: checkout `main` @ `b3262de` (v2.14.0). Read-only audit: nothing deleted, moved or committed.
Goal: a "clean kitchen" — every folder and Markdown file is either live (code, tests, `ael docs`, package) or clearly history.

## How evidence was gathered

- References: `git grep -lF <path>` across all tracked files (excluding the file itself, `CHANGELOG.md` and generated `ael` skill copies), plus directory-level and basename greps in `lib bin tests scripts skill-src README.md package.json .github`.
- Last touch: `git log -1 --format=%cs -- <path>`.
- Package: `npm pack --dry-run --json` → 320 files, 829,674 B packed, 2,547,337 B unpacked.
- `ael docs`: `lib/docs.js` serves every `.md` under `core/ policies/ profiles/ agents/ adapters/ .agents/skills/ael/references/`.
- Commands: `ael help` command list; `context` and `gate` were also probed (both exist, hidden from the list).
- Cards: `docs/board.md` marks C-01..C-56 all **Done** (PRs #111–#135).
- Branches: `gh pr list --state all` matched against local branches.

Not covered: line-by-line content review of the 30 `core/*.md` and 7 `policies/*.md` (all served by `ael docs`, all reachable, no removed commands found by a command-name scan). A deeper "does each spec still match `lib/`" pass is a separate job.

## Ranked table

Ranked by value (clutter removed) × safety. "Ships" = in `npm pack`.

| # | Path | Verdict | Evidence | Risk | Exact command or edit |
|---|---|---|---|---|---|
| 1 | `.claude/worktrees/{lower-ceremony-loop,nervous-taussig-9f88d5,peaceful-jennings-cc69a0}` (+ branches `claude/lower-ceremony-loop`, `claude/nervous-taussig-9f88d5`, `claude/peaceful-jennings-cc69a0`) | DELETE | 3 registered worktrees, ~11 MB, all clean (0 dirty files), HEADs 4e619b4/19ea01c/cadd14f dated 2026-10-20 are all ancestors of `main`; gitignored, not shipped | Low: work is in `main` | `git worktree remove .claude/worktrees/lower-ceremony-loop && git worktree remove .claude/worktrees/nervous-taussig-9f88d5 && git worktree remove .claude/worktrees/peaceful-jennings-cc69a0 && git branch -d claude/lower-ceremony-loop claude/nervous-taussig-9f88d5 claude/peaceful-jennings-cc69a0` |
| 2 | 33 other local branches (`chore/release-2.*`, `feat/*`, `fix/*`, `docs/readme-refresh*`, `chore/skill-headroom`, `claude/ael-audit-improvements`) | DELETE | Every one has a **MERGED** GitHub PR; squash merges mean `git branch -d` refuses most of them | Low–medium: needs `-D`; check none has unpushed follow-up commits | After row 1: `git fetch --prune && git branch --format='%(refname:short)' \| grep -vx main \| xargs git branch -D` |
| 3 | `.ai-engineering-loop/context/` (local, ignored) | DELETE | 2.4 MB `index.json` of 576 files; most likely written by this audit's `ael context index` probe | None: regenerable cache, gitignored | `rm -rf .ai-engineering-loop/context` |
| 4 | `.ai-engineering-loop/verification.md.user-backup-2026-11-16T115426+0700`, `.ai-engineering-loop/.ael-backup/2026-10-10T21-11-25-351Z/` (local, ignored) | DELETE | Leftovers from `ael update` overlay (2026-10-10) and a 2026-11-16 backup; dogfood context only | None | `rm -rf .ai-engineering-loop/.ael-backup .ai-engineering-loop/verification.md.user-backup-2026-11-16T115426+0700` |
| 5 | `docs/images/{ael-hero.svg,engineering-loop-overview.svg,studio-hero.svg,studio-hero-orange.svg}` | DELETE | No reference anywhere (`git grep` exit 1); ship in package (28,880 B); `studio-hero*.svg` are byte-identical in size (9,400 B) | Low: unused | `git rm docs/images/ael-hero.svg docs/images/engineering-loop-overview.svg docs/images/studio-hero.svg docs/images/studio-hero-orange.svg` |
| 6 | `docs/images/social-preview.png` | ARCHIVE (keep in repo, drop from package) | No in-repo reference; 52,739 B shipped; probably the GitHub "social preview" upload source | Low; human: confirm it is the GitHub social image | Move to `docs/brand/social-preview.png` (not in `files`): `git mv docs/images/social-preview.png docs/brand/social-preview.png` |
| 7 | `README.npm.md` | DELETE (or MERGE into README.md) | 0 references; not in `package.json` `files` (npm uses `README.md`); last touch 2026-11-02; still lists `npx ai-engineering-loop init/status/refresh` + `context` flow and "ai-engineering-loop skill" (renamed to `ael`) | Low | `git rm README.npm.md` |
| 8 | `scripts/init.sh` | DELETE | 0 references except itself; last touch 2026-08-29 (v1.0.12); hand-writes old `config.md/architecture.md/conventions.md` and skips `metadata.json`, `glossary.md`, `adrs/`, `sources.md` that `ael init` now writes (`bin/ai-engineering-loop.js:223`, `:710`) | Medium: header advertises `curl …/main/scripts/init.sh \| bash` — anyone still using that URL gets a broken context | Human decision. If yes: `git rm scripts/init.sh`; optional: replace body with `echo "Use: npx ai-engineering-loop init"; exit 1` for one release |
| 9 | `templates/repo-config/*` (9 `.md` + `claude-permissions.json`, ~6.3 KB) | DELETE or UPDATE | Not in `files`, not read by any code; `ael init` builds context inline in `bin/`; only a comment in `lib/verification-lanes.js:102` names `templates/repo-config/verification.md` | Medium: two sources of truth for context templates | Human decision: (a) `git rm -r templates` and fix the comment in `lib/verification-lanes.js:102`, or (b) make `ael init` read these templates and add a test |
| 10 | `examples/` (16 `.md`, 27,262 B) | UPDATE or DELETE | 0 references from README/core/skill/tests; not shipped; last touch 2026-08-25..30; Goal Contracts/verdicts are Markdown prose while the loop now uses JSON artifacts (`schemas/goal-contract.schema.json`, `verdict.schema.json`) | Low (not shipped) | Human decision: regenerate from a real Run (`runs/<id>/*.json` + `ael recap`) or `git rm -r examples` |
| 11 | `docs/cards/*.md` (8 files, 72,346 B) | ARCHIVE | Board marks C-01..C-56 **Done**; only `novice-ux-2026-11-21.md` is linked (from `bench/sandbox/README.md`) | Low; update 2 links | `mkdir -p docs/archive/cards && git mv docs/cards/*.md docs/archive/cards/`; edit `bench/sandbox/README.md` link and the `docs/cards/` row in `AGENTS.md` ("Where things are") |
| 12 | `docs/board.md` | UPDATE (+ ARCHIVE Done rows) | 56 Done rows, 0 open; no rows for #137–#141 (skill headroom, STE goal, readable Goal, v2.14.0) | Low | Move Done rows to `docs/archive/board-2026-11.md`; keep header + active rows; add rows for #137/#139/#140 if the board should stay complete |
| 13 | `docs/superpowers/` (2 specs + 1 plan + lower-ceremony spec, 37,062 B) | ARCHIVE | Features shipped: C-27/C-28 Done (#122); lower-ceremony merged (worktree commits in `main`); lower-ceremony spec still says "Status: implemented on `claude/lower-ceremony-loop`" | Low | `mkdir -p docs/archive/designs && git mv docs/superpowers/specs/* docs/superpowers/plans/* docs/archive/designs/ && rmdir -p docs/superpowers/specs docs/superpowers/plans`; fix links in archived `slop-to-gold` card |
| 14 | `docs/cuts/` (2 files) + `qa/` (2 files) | ARCHIVE | Issue #110 cut + AC pack + QA run; #110 Done (PRs #111, #112); `qa/` is a top-level folder for one finished issue; last touch 2026-11-16 | Low; the files cross-link each other | `mkdir -p docs/archive/issue-110 && git mv docs/cuts/* qa/* docs/archive/issue-110/`; then fix the relative links inside the four files |
| 15 | `docs/migration-plan.md` | ARCHIVE | 0 references; last touch 2026-09-06; plan to move legacy `dot-dev-workflow` into AEL — done (`adapters/dot/` ships, `dot-dev-skill-router`) | Low | `git mv docs/migration-plan.md docs/archive/` |
| 16 | `docs/antigravity-feasibility.md`, `docs/claude-code-feasibility.md` | ARCHIVE | 0 references; last touch 2026-11-02 (rename sweep only); host rationale now lives in `skill-src/ael/references/loop-hosts.md` + `lib/hosts/registry.js`; claude-code doc is about a Kiro/9router proxy bug, now guarded in `bin/ai-engineering-loop.js:1751` | Low | `git mv docs/antigravity-feasibility.md docs/claude-code-feasibility.md docs/archive/` |
| 17 | `docs/grok-cli-feasibility.md` | KEEP (or ARCHIVE with link fix) | Linked from `core/orchestration-model.md` (served by `ael docs`); target repos cannot open a repo-relative `docs/` link anyway | Low | Optional: archive and change the link in `core/orchestration-model.md` to the GitHub URL |
| 18 | `.github/workflows/ci.yml` | UPDATE | Last touch 2026-09-06; runs `node bin/ai-engineering-loop.js doctor`, which since C-51 is the **machine** doctor (git identity, agent skill, gh/glab) — package checks moved to `doctor --package`; CI also skips `check:skills`, `audit:package` (AGENTS.md pre-publish gate) | Medium: CI may pass/fail on runner setup instead of package health | Edit step to `npm run check:skills && npm test && npm run doctor && npm run eval && npm run audit:package` (code change — needs a PR, not part of this audit) |
| 19 | `.claude/skills/<14 vendored skills>` (repo copies of `.agents/skills/*`, 274,579 B tracked) | MERGE (human) | Byte-identical to `.agents/skills/*` (`diff -rq` empty); not shipped (`files` has only `.claude/agents/`); `lib/sync-hosts.js:156-157` sources from `.agents/skills` only; pinned by `tests/skill-host-compat.test.js:202` (`backend-development`) | Medium: test edit; Claude Code in this repo stops seeing them unless installed via `ael sync-hosts` | Human decision. If yes: `git rm -r` each non-`ael` dir under `.claude/skills/` and drop `.claude/skills/backend-development` from the test host list |
| 20 | `.agents/skills/<14 vendored skills>` (write-swift, animate-expo, emil-design-eng, apple-design, …) | KEEP (flag) | Intentional: installed by `ael sync-hosts`, required by `lib/doctor.js:21-24`, tested in `tests/sync-hosts.test.js`; 274,579 B = 10.8% of unpacked package; 6 of them (`write-swift`, `mobile-native`, `animation-vocabulary`, `find-animation-opportunities`, `pick-ui-library`, `prototype`) are only listed in `lib/sync-hosts.js` | Product decision | Optional later: make the design/mobile pack opt-in (`--pack design`) like `spec` |
| 21 | `.serena/` (2.4 MB, ignored) | KEEP | Local Serena MCP cache, gitignored, not shipped | None | — |
| 22 | `core/` (30), `policies/` (7), `profiles/` (6), `agents/` (8), `adapters/` (44) | KEEP | All served by `ael docs` (`lib/docs.js:11`) and shipped; command scan found no removed commands (`context`, `gate` exist) | — | — |
| 23 | `skill-src/`, `.claude/skills/ael`, `.agents/skills/ael`, `.claude/agents`, `.grok/` | KEEP | Source + generated copies, guarded by `npm run check:skills` and `tests/skill-host-compat.test.js` | — | — |
| 24 | `bench/sandbox/`, `scripts/{audit-package,build-host-skills,build-host-table,measure,sandbox-e2e,sync-spec-pack,verify-release}.js/.sh` | KEEP | Each referenced from `package.json` scripts, tests, workflows or docs | — | — |
| 25 | `vendor/egm/`, `recipes/`, `studio/`, `schemas/`, `migrations/`, `evals/`, `lib/`, `bin/`, `tests/` | KEEP | Read by code (`scripts/sync-spec-pack.js`, `lib/recipe.js`, `lib/studio-server.js`, `lib/update-manager.js`, doctor) and/or tested | — | — |
| 26 | Root: `AGENTS.md`, `README.md`, `CHANGELOG.md`, `SECURITY.md`, `SUPPORT.md`, `THIRD_PARTY_NOTICES.md`, `LICENSE` | KEEP | Referenced by `package.json` `files` / README; `AGENTS.md` needs the link edit from row 11 if cards move | — | — |

### Side finding (code, out of scope)

`ael help` "All commands" omits `gate` and `context`, which exist (`bin/ai-engineering-loop.js:5127`, `:5160`) and are named in `core/runtime-safety.md`, `policies/model-escalation.md`, `README.npm.md` and the skill. Either list them or mark them internal in help.

## Totals per verdict

| Verdict | Rows | Items |
|---|---|---|
| DELETE | 1, 2, 3, 4, 5, 7, 8 | 3 worktrees + 36 local branches, 2 local caches, 4 images, 2 files |
| DELETE or UPDATE (human) | 9, 10 | `templates/`, `examples/` |
| ARCHIVE | 6, 11, 12 (Done rows), 13, 14, 15, 16 | 1 image, 8 cards, board history, 4 design docs, 4 issue-110 docs, 3 docs |
| MERGE | 19 | 14 duplicate skill dirs (`.claude/skills/*`) |
| UPDATE | 12, 18 | `docs/board.md`, `.github/workflows/ci.yml` |
| KEEP | 17, 20–26 | everything served, shipped, read by code or tested |

## Size effect

**npm package** (only rows 5 and 6 touch shipped files):

| Change | Unpacked bytes |
|---|---|
| Unused SVGs (row 5) | 28,880 |
| `social-preview.png` out of `docs/images/` (row 6) | 52,739 |
| **Total** | **81,619 B ≈ 3.2% of 2,547,337 B** |

Optional, product decision (row 20): making the vendored design/mobile skills opt-in would remove up to 274,579 B more (10.8%).

**Git tree** (tracked, not shipped): ~180 KB of Markdown leaves the working set (cards 72 KB, designs 37 KB, examples 27 KB, issue-110 12 KB, old docs 24 KB, README.npm 5 KB, init.sh 3 KB) — archived, not lost, except where marked DELETE. Row 19 removes another 275 KB of duplicates.

**Local disk** (ignored): ~11 MB worktrees + 2.4 MB context cache.

## Proposed cleanup plan

### Safe now (no behaviour change, no test edits)

1. Remove the 3 merged worktrees and their branches (row 1).
2. `git fetch --prune`, then delete the 33 local branches with merged PRs (row 2).
3. Delete local ignored leftovers (rows 3, 4).
4. One docs-only PR, `chore: archive finished cards and designs`:
   - `git rm` the 4 unused SVGs and `README.npm.md` (rows 5, 7).
   - Create `docs/archive/` and move cards, Done board rows, `docs/superpowers/*`, `docs/cuts/*` + `qa/*`, `migration-plan.md`, two feasibility docs (rows 11–16).
   - Fix links: `AGENTS.md` table, `bench/sandbox/README.md`, cross-links inside moved files.
   - Run `npm test && npm run check:skills && npm run audit:package` (no skill text changes, so `measure` is not needed).

### Needs a human decision

1. `scripts/init.sh` — public curl URL; delete, or stub to "use `npx ai-engineering-loop init`" for one release (row 8).
2. `templates/repo-config/` — delete, or make `ael init` actually use them (row 9).
3. `examples/` — regenerate from a real JSON Run, or delete (row 10).
4. `social-preview.png` — confirm it is the GitHub social image before moving (row 6).
5. Repo `.claude/skills/<vendored>` duplicates — drop and edit one test, or keep for in-repo Claude Code use (row 19).
6. CI workflow: switch to `doctor --package` and the full AGENTS.md gate (row 18) — a code PR.
7. Vendored design/mobile skills as an opt-in pack (row 20) — product call.
8. Help text: list or hide `gate` / `context` (side finding) — a code PR.
