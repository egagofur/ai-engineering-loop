---
name: generate-adapter
description: Grill then write a Stage 8 delivery adapter for this repo. Use when the user says generate-adapter, buat adapter, or each team needs its own forge. Not a substitute for ai-engineering-loop.
---

# Generate Adapter

Write **this repo's** Stage 8 delivery adapter. Every team has different tools. Do not copy DOT, and do not invent Slack/Jira/bots the user did not name.

This skill is not the engineering OS. After the adapter file exists, commit-bound work still runs `ai-engineering-loop`. Stage 8 reads the file this skill writes.

## Hard gate

Do not edit production code. Do not create a feature branch for the product.

Do not write `.ai-engineering-loop/adapter.md` until:

1. Look-up is done (remote, CI, existing adapter).
2. Q1–Q5 are on screen with a recommended answer.
3. The user has answered or waived.

## When to use

- `generate-adapter`, `buat adapter`, `adapter sendiri`
- `.ai-engineering-loop/adapter.md` missing, `adapter_type` unknown, or Stage 8 would have to guess
- The user wants GitHub / GitLab / standard / custom delivery

If Stage 1 grill for a **product task** is already running, do not start this skill as a second interview. Finish that Goal Contract first.

## Host notes

Claude Code / Kiro: no mermaid, no LaTeX, no extra tool keys.

Grok: do not spawn children. Stay in the parent.

Look up facts. Grill only **decisions**.

## Steps

### 1. Look up

Read, in order. Skip if missing.

1. `git remote -v` and `.git/config`
2. `.github/workflows/`, `.gitlab-ci.yml`
3. `.ai-engineering-loop/adapter.md`
4. Shipped specs: `adapters/standard/`, `adapters/github/`, `adapters/gitlab/`, `adapters/dot/` (in the ai-engineering-loop package)

Or run `npx ai-engineering-loop generate-adapter` and use its detected block.

Cite the remote host. Do not ask what git already shows.

Recommended type:

- `github.com` → `github`
- GitLab host that is not a named company adapter → `gitlab`
- no remote / unknown → `standard`
- user said they need the DOT pipeline → `dot` (load `adapters/dot/`, do not invent extra tools)

### 2. Grill (wait)

Ask all five in one round. Number them. Give Recommended. Wait.

```text
Q1 - Forge: github | gitlab | standard (git only) | custom
Recommended: <from look-up>

Q2 - Open the change with: gh | glab | human copies the URL
Recommended: <binary that exists, else human>

Q3 - Extra environment branches after the default: none | list them
Recommended: none

Q4 - Notify after the PR/MR: none | name the tool you already use
Recommended: none

Q5 - Issue tracker: github | gitlab | none | name it
Recommended: same as forge, or none
```

If the user picks **custom**, they must name the tools. Do not fill Linear/Slack/Bitbucket unless they said so.

### 3. Write

Write `.ai-engineering-loop/adapter.md` (create `.ai-engineering-loop/` if needed).

- `adapter_type`: `standard` | `github` | `gitlab` | `dot` | `custom`
- `spec`: shipped folder (`adapters/github/`) or `.ai-engineering-loop/adapter/delivery.md` for custom
- remote, default branch, ci_provider from look-up
- extra branches and notify only if the user named them
- no tokens, no webhooks with secrets, no coworker handles, no internal ticket URLs

If `custom`, also write `.ai-engineering-loop/adapter/delivery.md` from their answers, following the same hard gate as `adapters/standard/` (Judge PASS first, no silent installs).

Headless alternative the user can run:

```bash
npx ai-engineering-loop generate-adapter --type github
```

`--type` skips this interview. Do not pass `--type` yourself unless they waived the grill.

### 4. Stop

Print the path written and the type. Do not start Maker. Do not open a PR.

## Output

```text
Generate adapter
Detected: <remote> <ci>
Questions: Q1..Q5 with Recommended
Wrote: .ai-engineering-loop/adapter.md (type=<type>)
Next: /ai-engineering-loop for product work. Stage 8 uses this file.
```

## Forbidden

- Copying `adapters/dot/` onto a non-DOT repo
- Inventing company chat, review bots, or extra branches
- Mermaid or LaTeX
- Putting secrets or private ticket URLs in adapter.md
- Running the 8-stage product loop inside this skill
