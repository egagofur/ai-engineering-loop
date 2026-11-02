# Notice of modifications (egagofur fork)

This repository is a fork of [google/elephant-goldfish-model](https://github.com/google/elephant-goldfish-model)
(EGM), Copyright Google LLC, licensed under the Apache License 2.0 (see `LICENSE`).
EGM is not an officially supported Google product, and this fork is not endorsed by Google.

`main` tracks upstream unchanged except for this file. Pull upstream updates with
`gh repo sync egagofur/elephant-goldfish-model`.

## Derivative shipped by ai-engineering-loop

[ai-engineering-loop](https://github.com/egagofur/ai-engineering-loop) (AEL) vendors a pinned
commit of this fork under `vendor/egm/` and generates a modified derivative, the optional
`spec` host pack, with `scripts/sync-spec-pack.js`. The changes made to that derivative:

- Skills and reviewer personas are renamed from `egm-*` to `ael-spec-*`
  (`egm-drift-report` becomes `ael-spec-drift`) so they cannot collide with an installed EGM plugin.
- Plugin-root and harness-specific references (`${CLAUDE_PLUGIN_ROOT}`, `docs/claude.md`,
  `docs/codex.md`, `docs/harnesses.md`, `agents/*.md`, `resources/**`) are replaced with
  `npx ai-engineering-loop docs <name>` lookups and AEL's per-host subagent rules, so the
  pack works on every AEL host (Grok CLI, Cursor, Claude Code, Codex, Antigravity, and others).
- Where a host has no fresh-context subagent tool, the reviews run sequentially in the same
  session and are labelled `CONTEXT_ISOLATION_ONLY` instead of stopping.
- `egm-bootstrap`, plugin manifests, the website, tests, and icons are not shipped.

Every generated file keeps its `license: Apache-2.0` line and names the source commit.
