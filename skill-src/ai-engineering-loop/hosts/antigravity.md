@@ output: .agents/workflows/ai-engineering-loop.md
@@ hostName: Antigravity workflow
@@ refLine: Stage details: the `loop-*` references via `npx ai-engineering-loop docs <name>`, read only on entering that stage.
@@ reportIntro: When a child actually returned a result:
@@ frontmatter
---
name: ai-engineering-loop
description: Run the AI Engineering Loop on Antigravity (init, status, refresh, or full Maker then Devil's Advocate then Judge).
---
@@ hostRules
1. If `invoke_subagent` (or Task) exists, spawn `devil-advocate` then `judge` as siblings and wait for each; `general-purpose` only if rejected. Do not use `browser_subagent`.
2. No subagent tool: same budgets in this session as `CONTEXT_ISOLATION_ONLY`; never claim independent execution.
3. Models: the host catalog; never type a model name.
