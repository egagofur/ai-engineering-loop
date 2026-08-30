---
name: generate-workflow
description: Grill then write a loop overlay and empty lessons.md for this repo. Use when the user says generate-workflow, buat workflow, or their team needs extra steps around AEL. Not a substitute for ai-engineering-loop.
---

# Generate Workflow Overlay

Write **this repo's** loop overlay. Teams add hooks around the 8-stage OS. They do not replace it.

This skill is not the engineering OS. After the files exist, commit-bound work still runs `ai-engineering-loop`. Stage 0 reads the files this skill writes.

## Hard gate

Do not edit production code. Do not create a feature branch for the product.

Do not write `.ai-engineering-loop/workflow.md` until:

1. Look-up is done (existing overlay, lessons, adapter).
2. Q1–Q6 are on screen with a recommended answer.
3. The user has answered or waived.

Never skip Goal Contract, verification, Devil's Advocate, or Judge. If the user asks to skip those, refuse and keep them required.

## When to use

- `generate-workflow`, `buat workflow`, `overlay loop`, `lessons.md`
- `.ai-engineering-loop/workflow.md` missing and the team wants extra steps
- The user wants confirmed process lessons to survive sessions

If Stage 1 grill for a **product task** is already running, do not start this skill as a second interview. Finish that Goal Contract first.

## Host notes

Claude Code / Kiro: no mermaid, no LaTeX, no extra tool keys.

Grok: do not spawn children. Stay in the parent.

Look up facts. Grill only **decisions**.

## Steps

### 1. Look up

Read, in order. Skip if missing.

1. `.ai-engineering-loop/workflow.md`
2. `.ai-engineering-loop/lessons.md`
3. `.ai-engineering-loop/adapter.md`

Or run `npx ai-engineering-loop generate-workflow` and use its protocol block.

Cite what already exists. Do not ask whether those files are present.

### 2. Grill (wait)

Ask all six in one round. Number them. Give Recommended. Wait.

```text
Q1 - Extra step before grill: none | name it
Recommended: none

Q2 - Extra step after Goal Contract freeze: none | name it
Recommended: none

Q3 - Extra step after Judge PASS (before Stage 8): none | name it
Recommended: none

Q4 - Blast radius when the change is not business logic: keep AEL default (skip) | always run
Recommended: keep AEL default

Q5 - Skip generate-adapter when adapter.md already exists: yes | no
Recommended: yes

Q6 - Maker intern: none | any host-native label (gemini-flash, grok-mini, haiku, qwen, ...)
Recommended: none
```

If they name a tool or step, write that name into the matching hook. Do not invent Figma/Jira/Slack unless they said so.

Q6 is a host-native label only (`maker_intern` in workflow.md). Not locked to one vendor. Do not paste API keys or URLs. Default none = parent is Maker.

### 3. Write

Write `.ai-engineering-loop/workflow.md` (create `.ai-engineering-loop/` if needed).

- Required stages listed and not skippable
- Hooks from Q1–Q3 (`none` if they picked none)
- **maker_intern** from Q6 (`none` if they picked none)
- Optional skips only `blast_radius` and/or `generate_adapter`
- No tokens, no coworker handles, no internal ticket URLs

Write `.ai-engineering-loop/lessons.md` only if it is missing. If it already has rows, leave it.

Headless alternative the user can run:

```bash
npx ai-engineering-loop generate-workflow --write
```

`--write` skips this interview and writes default hooks (`none`) and `maker_intern: none`. Do not pass `--write` yourself unless they waived the grill.

### 4. Lessons during later product work

When the user confirms "this is wrong / this is right" and it is not a domain term, a code ban, or an ADR:

- Append one row to `lessons.md`
- Date, lesson, do-not
- Do not paste the chat

Route: term → `glossary.md`. Code ban → `conventions.md`. Load-bearing design → `adrs/`. Process / taste / "user always rejects X" → `lessons.md`.

### 5. Stop

Print the paths written. Do not start Maker. Do not open a PR.

## Output

```text
Generate workflow overlay
Existing: <workflow yes/no> <lessons yes/no>
Questions: Q1..Q6 with Recommended
Wrote: .ai-engineering-loop/workflow.md
Lessons: .ai-engineering-loop/lessons.md (created or left)
Next: /ai-engineering-loop for product work. Stage 0 reads these files.
```

## Forbidden

- Replacing the 8-stage OS
- Skipping Goal Contract, verification, Devil's Advocate, or Judge
- Using a second evaluation filename. The file is `lessons.md`
- Dumping chat into lessons
- Mermaid or LaTeX
- Running the 8-stage product loop inside this skill
