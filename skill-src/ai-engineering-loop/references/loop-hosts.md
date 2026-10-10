# Host rules: subagent tools per host

Read only your host's section, before the first Devil's Advocate (DA) or Judge spawn. Every host shares the loop, budgets, and gates; only the spawn mechanics differ. Modes: `TRUE_INDEPENDENT_AGENT`, `ISOLATED_AGENT_INSTANCE`, `FRESH_PROCESS_AGENT`, `CONTEXT_ISOLATION_ONLY`, `UNAVAILABLE`.

## Claude Code (and Kiro-backed strict proxies)

Strict proxies (including Kiro) return HTTP 400 `REQUEST_BODY_INVALID` on unknown keys:
1. Use only tools that exist in this session. Spawn subagents with **Task** (or **Agent** if that is the only one), passing only `subagent_type`, `description`, `prompt`, and `run_in_background: false` only if the schema has it. Never invent other keys.
2. `subagent_type: devil-advocate` / `judge`; `general-purpose` only if rejected. No Task/Agent tool: review in this session as `CONTEXT_ISOLATION_ONLY`.
3. Bash or Write says "cannot determine the safety" or 400: stop that tool, do not retry, use Read/Grep/Glob, and tell the user to leave auto permission mode or add a permissions.allow rule, then start a new session.
4. Models: `/models` when it exists; never type a model name.

## Grok CLI

1. `spawn_subagent` present and `GROK_SUBAGENTS` not `0`: review is **INVOCATION_AVAILABLE**; **PROVEN** only after a child returns its own `subagent_id`. Otherwise use `CONTEXT_ISOLATION_ONLY`, disclosed; never call it a subagent review.
2. Siblings only (depth limit 1): `capability_mode: "execute"`, `background: false`, `isolation: none`, no `resume_from`. Forbidden `subagent_type` for DA/Judge: `caveman:cavecrew-reviewer`, `caveman:cavecrew-builder`, `caveman:cavecrew-investigator`, `explore`, `plan`. Unregistered: `general-purpose`, agent spec prepended, `description` prefixed `[devil-advocate]`/`[judge]`.
3. Models: `grok models` (drop grok-imagine-* and video); never type a model name. Headless `grok -p` is `FRESH_PROCESS_AGENT` only once it prints a model response.
4. Alias: `NATIVE_SUBAGENT` → `TRUE_INDEPENDENT_AGENT`.

## Antigravity (IDE, 2.0, `agy` CLI)

1. If `invoke_subagent` (or Task) exists, spawn `devil-advocate` then `judge` (custom agents with `subagent: true`) as siblings, wait for each, never in the background; `general-purpose` only if the named type is rejected. Do not use `browser_subagent` (or the `browser` subagent).
2. No subagent tool: run the same budgets in this session as `CONTEXT_ISOLATION_ONLY`; do not claim independent agent execution.
3. Models: the host catalog (`/models` when it exists); never type a model name.

## Gemini CLI

1. Subagents `devil-advocate` and `judge` live in `~/.gemini/agents/` after `sync-hosts`; delegate to them by name when the session exposes them, one at a time, and wait.
2. Otherwise `CONTEXT_ISOLATION_ONLY`. Models: `/model`; never type a model name.

## Codex CLI

1. Custom agents `devil-advocate` and `judge` live in `~/.codex/agents/*.toml` after `sync-hosts`; spawn them as sibling agents when the session has a spawn tool, and wait for each result.
2. Otherwise `CONTEXT_ISOLATION_ONLY`. Models: the host catalog; never type a model name.

## Cursor, GitHub Copilot, OpenCode, Factory Droid, Augment, Qwen Code, Kiro

1. `sync-hosts` installs `devil-advocate` and `judge` in the host's own agent format. Delegate with the host's subagent tool by that name (Cursor subagents, Copilot custom agents, OpenCode `@devil-advocate`, Droid Task `subagent_type`, Auggie subagents, Qwen `/agents`, Kiro custom agents), one at a time, and wait.
2. No subagent tool, or the agent is missing: `CONTEXT_ISOLATION_ONLY`.

## Other hosts (Windsurf/Devin, Amp, Zed, Goose, Cline, Roo, Junie, unknown)

1. Use a native subagent only if it can run the DA or Judge prompt with a fresh context and return its own result; read-only research subagents qualify only for DA.
2. Otherwise run DA and Judge in this session as `CONTEXT_ISOLATION_ONLY`, disclosed, with the same budgets.
