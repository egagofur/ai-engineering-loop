# Claude Code Feasibility and Kiro Request Safety

## 1. Problem

Claude Code users (including Kiro-backed models such as `kiro/claude-sonnet-5`) hit:

```
API Error: 400 [kiro/claude-sonnet-5] [400]:
{"message":"Improperly formed request.","reason":"REQUEST_BODY_INVALID"}
```

Kiro's `generateAssistantResponse` rejects request bodies that Claude Code will happily send. Two skill-side causes were confirmed:

1. **Extra tool keys.** The shared skill told the model to call `spawn_subagent` with `capability_mode`, `isolation`, and `resume_from`. Claude Code's Task/Agent schema does not have those fields. Proxies that validate additionalProperties fail with `REQUEST_BODY_INVALID`.
2. **Hostile markup in the injected skill.** Mermaid (`<br>`, nested `{braces}`), LaTeX (`$\rightarrow$`), and folded YAML descriptions inflate and corrupt the system/skill payload Kiro receives.

This is separate from 9router bugs that reject any Anthropic `system` field. Those need a router fix. The skill must still not add extra invalid keys or markup.

## 2. Claude Code mapping

| Loop role | Claude Code type | Task keys allowed |
|---|---|---|
| Orchestrator / Maker | parent session | n/a |
| Devil's Advocate | `devil-advocate` (fallback `general-purpose`) | `subagent_type`, `description`, `prompt` |
| Judge | `judge` (fallback `general-purpose`) | `subagent_type`, `description`, `prompt` |

Do not pass Grok keys (`spawn_subagent`, `capability_mode`, `resume_from`, `isolation`, `background`) on Claude Code.

Repo files:

- `.claude/skills/ai-engineering-loop/SKILL.md`
- `.claude/agents/devil-advocate.md`
- `.claude/agents/judge.md`
- `.claude/commands/ai-engineering-loop.md`

## 3. Mode selection

| Condition | Mode |
|---|---|
| Task/Agent tool present, child result returned | `TRUE_INDEPENDENT_AGENT` |
| No subagent tool | `CONTEXT_ISOLATION_ONLY` |

## 4. What stays in Grok-only files

Grok spawn details live in `.grok/skills/ai-engineering-loop/SKILL.md`. Claude Code must not load that file as its skill. Claude Code discovers `.claude/` first.
