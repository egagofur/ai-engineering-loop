---
name: ai-engineering-loop
description: Run the AI Engineering Loop (init, status, refresh, or full Maker → verify → Devil's Advocate subagent → Judge subagent).
---

Follow `.grok/skills/ai-engineering-loop/SKILL.md`.

Arguments:

- `init` / `status` / `refresh` / `sync-hosts` / `generate-adapter` → run `npx ai-engineering-loop <arg>`
- anything else → full 8-stage loop for that task, spawning `devil-advocate` then `judge` via `spawn_subagent`
