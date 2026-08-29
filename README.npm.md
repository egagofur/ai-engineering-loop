# AI Engineering Loop

[![NPM Version](https://img.shields.io/npm/v/ai-engineering-loop.svg?color=cb3837)](https://www.npmjs.com/package/ai-engineering-loop)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-black.svg)](https://github.com/egagofur/ai-engineering-loop)

**A Reusable, Framework-Agnostic AI Engineering Operating System for Autonomous Coding Agents**

Move beyond linear AI pipelines and optimistic self-evaluation toward contract-driven execution, deterministic machine verification, independent adversarial review, and living project context.

---

## Quickstart CLI

Run the CLI in any repository root without global installation:

```bash
# 1. Bootstrap .ai-engineering-loop/ context from repository discovery
npx ai-engineering-loop init

# 2. Check the validity, readiness, and baseline freshness of context
npx ai-engineering-loop status

# 3. Reconcile drifted context against repository non-destructively
npx ai-engineering-loop refresh

# 4. Verify context readiness and begin engineering loop
npx ai-engineering-loop run

# 5. Copy package host skills into ~/.claude ~/.grok ~/.gemini ~/.agents
npx ai-engineering-loop sync-hosts
```

---

## What It Does

1. **Zero-Config Discovery (`init`)**: Analyzes repository topology (monorepo vs single app), package manifests (`package.json`, `go.mod`, `Cargo.toml`, etc.), frameworks, and test scripts to generate `.ai-engineering-loop/` including `glossary.md` and `adrs/`.
2. **Living Project Context**: Tracks repository revisions and manifest checksums in `metadata.json` for instant drift detection. Stage 1 grill freezes a Goal Contract; Maker uses TDD at named seams; DA reports Spec vs Standards without merging them.
3. **Multi-Agent Triad**: Coordinates **Maker** (surgical diffs & tests), **Devil's Advocate** (independent adversarial review), and **Judge** (impartial evaluation & PASS certification).
4. **Context Impact Assessment**: Evaluates completed tasks (`NONE`, `TARGETED`, `MAJOR`) to keep project context fresh without expensive whole-repo re-analysis.
5. **Grok CLI host**: Native `spawn_subagent` for Devil's Advocate and Judge (`TRUE_INDEPENDENT_AGENT`). Disabled by `GROK_SUBAGENTS=0`.

---

## Grok CLI

Inside a Grok TUI session, `/ai-engineering-loop` uses repo-local `.grok/agents/` types. Devil's Advocate and Judge spawn as sibling children (`capability_mode: execute`, no `resume_from`). Do not use `caveman:cavecrew-reviewer` as the loop reviewer.

## Claude Code

Inside Claude Code, `/ai-engineering-loop` uses `.claude/agents/` types via the **Task** tool. Pass only `subagent_type`, `description`, and `prompt`. Do not pass Grok keys (`spawn_subagent`, `capability_mode`, `resume_from`) — extra keys cause Kiro `REQUEST_BODY_INVALID`.

---

## Antigravity IDE Integration

In Antigravity IDE or compatible agentic platforms, invoke the loop directly in chat:

- `/ai-engineering-loop init` — Bootstrap project context only.
- `/ai-engineering-loop status` — Check context health and living freshness.
- `/ai-engineering-loop refresh` — Reconcile drifted context files.
- `/ai-engineering-loop <task>` — Execute the full 8-stage engineering lifecycle.

---

## Complete Documentation & Specifications

For the complete architectural specifications, project profiles (`web-app`, `backend-api`, `mobile-app`, `library`, `monorepo`), delivery adapters (GitLab, GitHub, Mattermost), and reference examples:

👉 **[Visit the GitHub Repository](https://github.com/egagofur/ai-engineering-loop)**

---

## License

MIT License — see [LICENSE](https://github.com/egagofur/ai-engineering-loop/blob/main/LICENSE) for details.
