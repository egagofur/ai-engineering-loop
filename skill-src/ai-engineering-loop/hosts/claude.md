@@ output: .claude/skills/ai-engineering-loop/SKILL.md
@@ references: .claude/skills/ai-engineering-loop/references
@@ hostName: Claude Code
@@ refLine: Stage details: `references/loop-*.md` beside this file, read only on entering that stage.
@@ reportIntro: When Task/Agent returned a child result:
@@ frontmatter
---
name: ai-engineering-loop
description: Use when the user runs /ai-engineering-loop, asks to init or refresh living project context, or wants the Maker / Devil's Advocate / Judge engineering loop on Claude Code.
allowed-tools: "Read, Grep, Glob, Edit, Write, Task, Bash(npm run *), Bash(npm test *), Bash(npx *), Bash(git *)"
---
@@ hostRules
Strict proxies (including Kiro) return HTTP 400 `REQUEST_BODY_INVALID` on unknown keys:
1. Use only tools that exist in this session. Spawn subagents with **Task** (or **Agent** if that is the only one), passing only `subagent_type`, `description`, `prompt`, and `run_in_background: false` only if the schema has it. Never invent other keys.
2. `subagent_type: devil-advocate` / `judge`; `general-purpose` only if rejected. No Task/Agent tool: review in this session as `CONTEXT_ISOLATION_ONLY`.
3. Bash or Write says "cannot determine the safety" or 400: stop that tool, do not retry, use Read/Grep/Glob, and tell the user to leave auto permission mode or add a permissions.allow rule, then start a new session.
4. Models: `/models` when it exists; never type a model name.
