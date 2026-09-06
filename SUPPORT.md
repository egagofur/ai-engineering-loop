# Public Beta Support Matrix

AI Engineering Loop is in public-beta readiness. The workflow contract is stable enough for evaluation, but host tool schemas can change independently.

| Host | Installation source | Independent reviewer path | Fallback |
|---|---|---|---|
| Claude Code / compatible Task hosts | `.claude/` | `Task` or `Agent` siblings | `CONTEXT_ISOLATION_ONLY` |
| Grok CLI | `.grok/` | `spawn_subagent` siblings | `grok -p` or `CONTEXT_ISOLATION_ONLY` |
| Gemini / Antigravity skill hosts | `.gemini/` | `invoke_subagent` or `Task` when present | `CONTEXT_ISOLATION_ONLY` |
| Antigravity workflows | `.agents/` | `invoke_subagent` or `Task` when present | `CONTEXT_ISOLATION_ONLY` |

Independent execution is reported as proven only after a child ID and model response are observed without inherited Maker history.

## Runtime

- Node.js 18 or newer.
- Git is recommended for revision and diff evidence.
- Linux, macOS, and Windows are covered by the Node test matrix.
- No runtime npm dependencies.

Run diagnostics after installation:

```bash
npx ai-engineering-loop doctor
npx ai-engineering-loop eval
```

New hosts need a documented tool schema, context-isolation behavior, secret boundary, independent-execution proof, and conformance tests before being listed as supported.
