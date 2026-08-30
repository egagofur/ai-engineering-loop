# Handoff Artifact

When a session stops mid-loop (context limit, user switch, detach), the orchestrator writes a handoff so the next agent continues the same 8-stage run. This is not a new stage.

## Path

`.ai-engineering-loop/tasks/handoff.md`

Overwrite the previous handoff for the active task. Do not commit unless the user asks.

## Required sections

```markdown
# Handoff: <short task title>

## Stage
<0-8 plus grill / iterate-N>

## Goal Contract
<path, frozen or not>

## Seams
- <public interface under test>

## Verification
- last command, exit code, log path (or NOT RUN)
- claimed-vs-reality.md path (or NOT RUN)

## Review
- DA ledger path (or NOT RUN)
- Judge verdict (or NOT RUN)
- open VALID BLOCKER/HIGH ids

## Glossary / ADRs touched
- <paths>

## Next action
One sentence the next agent must do first. No recap of chat.
```

## Rules

- Facts only: paths, commands, ids. No Maker optimism.
- The next session reads this file, the Goal Contract, and `.ai-engineering-loop/glossary.md` before grilling again.
- Do not restart Stage 1 if the contract is already frozen.
