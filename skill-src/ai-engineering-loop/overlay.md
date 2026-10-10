@@ outputs: .claude/skills/ai-engineering-loop, .agents/skills/ai-engineering-loop
@@ refLine: Stage details: `references/loop-*.md` beside this file (also via `docs`), read only on entering that stage.
@@ reportIntro: When a subagent actually returned its own result (Grok: its own `subagent_id`):
@@ frontmatter
---
name: ai-engineering-loop
description: Use when the user runs /ai-engineering-loop, says "run the engineering loop" or "devil's advocate review", asks to init or refresh living project context, or wants the Maker / Devil's Advocate / Judge engineering loop.
---
@@ hostRules
Same skill on every host. Before the first DA or Judge spawn, read your host's section in `loop-hosts` (exact tool, allowed keys, fallbacks).
1. Spawn `devil-advocate` then `judge` as fresh siblings with the host's own subagent tool, passing only keys its schema has; wait for each, never in the background or nested; `general-purpose` only if the named type is rejected. Never use a browser subagent as reviewer.
2. No subagent tool: same budgets in this session as `CONTEXT_ISOLATION_ONLY`; never claim independent execution.
3. A tool says "cannot determine the safety" or returns HTTP 400: stop that tool, do not retry, continue read-only, and tell the user (`loop-hosts`).
4. Models: the host catalog (`/models`, `grok models`); never type a model name.
