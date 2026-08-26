---
name: ai-engineering-loop
description: Run the AI Engineering Loop (init, status, refresh, or full Maker then Devil's Advocate then Judge).
allowed-tools: "Read, Grep, Glob, Edit, Write, Task, Bash(npm run *), Bash(npm test *), Bash(npx *), Bash(git *)"
---

Follow `.claude/skills/ai-engineering-loop/SKILL.md`.

Use the Task tool for Devil's Advocate and Judge. Pass subagent_type, description, and prompt. If the schema includes run_in_background, set it false. Wait for each Task to finish. Write the git diff to a file and pass that path; do not let the reviewer roam the repo.

Arguments: init, status, refresh, or a task description.
