@@ outputs: .claude/skills/ael, .agents/skills/ael
@@ refLine: Stage details: `references/loop-*.md` beside this file (also via `docs`), read only on entering that stage.
@@ reportIntro: When a subagent returned its own result (Grok: its own `subagent_id`):
@@ frontmatter
---
name: ael
description: Use for a feature or bugfix in a repo with AI Engineering Loop: "please add", "please fix", "fix this bug", "build this feature", "tambahin fitur", "Use AI Engineering Loop", /ael, "run the engineering loop", "devil's advocate review", or init/refresh living project context. A one-line typo or "just change this line" is a direct edit, not this loop.
---
@@ hostRules
Same skill on every host. Before the first DA or Judge spawn, read your host's section in `loop-hosts` (exact tool, allowed keys, fallbacks).
1. Spawn `devil-advocate` then `judge` as fresh siblings with the host's own subagent tool, passing only keys its schema has; wait for each, never in the background or nested; `general-purpose` only if the named type is rejected. Never use a browser subagent as reviewer.
2. No subagent tool: same budgets in this session as `CONTEXT_ISOLATION_ONLY`; never claim independent execution.
3. A tool says "cannot determine the safety" or returns HTTP 400: stop that tool, do not retry, continue read-only, and tell the user (`loop-hosts`).
4. Models: the host catalog (`/models`, `grok models`); never type a model name.
