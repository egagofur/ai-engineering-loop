@@ output: .gemini/skills/ai-engineering-loop/SKILL.md
@@ references: .gemini/skills/ai-engineering-loop/references
@@ hostName: Antigravity
@@ refLine: Stage details: `references/loop-*.md` beside this file, read only on entering that stage.
@@ reportIntro: When a child actually returned a result:
@@ frontmatter
---
name: ai-engineering-loop
description: Use when the user runs /ai-engineering-loop, asks to init or refresh living project context, or wants the Maker / Devil's Advocate / Judge engineering loop on Antigravity.
---
@@ hostRules
1. If `invoke_subagent` (or Task) exists, spawn `devil-advocate` then `judge` as siblings, wait for each, never in the background; `general-purpose` only if the named type is rejected. Do not use `browser_subagent`.
2. No subagent tool: run the same budgets in this session as `CONTEXT_ISOLATION_ONLY`; do not claim independent agent execution.
3. Models: the host catalog (`/models` when it exists); never type a model name.
4. Modes: `TRUE_INDEPENDENT_AGENT`, `ISOLATED_AGENT_INSTANCE`, `FRESH_PROCESS_AGENT`, `CONTEXT_ISOLATION_ONLY`, `UNAVAILABLE`.
