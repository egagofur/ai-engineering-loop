@@ output: .grok/skills/ai-engineering-loop/SKILL.md
@@ references: .grok/skills/ai-engineering-loop/references
@@ hostName: Grok CLI
@@ refLine: Stage details: `references/loop-*.md` beside this file, read only on entering that stage.
@@ reportIntro: After a proven Grok DA spawn:
@@ frontmatter
---
name: ai-engineering-loop
description: Use when the user runs /ai-engineering-loop, says "run the engineering loop" or "devil's advocate review", or asks to init or refresh living project context on Grok CLI (native spawn_subagent review).
user-invocable: true
---
@@ hostRules
1. `spawn_subagent` present and `GROK_SUBAGENTS` not `0`: review is **INVOCATION_AVAILABLE**; **PROVEN** only after a child returns its own `subagent_id`. Otherwise use `CONTEXT_ISOLATION_ONLY`, disclosed; never call it a subagent review.
2. Siblings only (depth limit 1): `capability_mode: "execute"`, `background: false`, `isolation: none`, no `resume_from`. Forbidden `subagent_type` for DA/Judge: `caveman:cavecrew-reviewer`, `caveman:cavecrew-builder`, `caveman:cavecrew-investigator`, `explore`, `plan`. Unregistered: `general-purpose`, agent spec prepended, `description` prefixed `[devil-advocate]`/`[judge]`.
3. Models: `grok models` (drop grok-imagine-* and video); never type a model name. Headless `grok -p` is `FRESH_PROCESS_AGENT` only once it prints a model response.
4. Alias: `NATIVE_SUBAGENT` → `TRUE_INDEPENDENT_AGENT`.
