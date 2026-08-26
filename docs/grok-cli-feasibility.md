# Grok CLI Feasibility & Execution Strategy

## 1. Executive Summary

Grok CLI (verified `grok 1.0.5`) is a **first-class host** for the AI Engineering Loop. Unlike Antigravity standalone mode, Grok exposes `spawn_subagent` as a real independent child session: own context window, no parent transcript unless `resume_from` is set, and a captured `subagent_id` plus model response.

When those evidence fields are present, the capability registry **must** select `TRUE_INDEPENDENT_AGENT` (skill alias: `NATIVE_SUBAGENT`).

```text
Parent (Maker + orchestrator)
  ├─ spawn_subagent type=devil-advocate  → Finding Ledger
  └─ spawn_subagent type=judge           → PASS | ITERATE | ESCALATE
```

Children cannot spawn children (depth 1). The parent therefore remains the orchestrator.

---

## 2. Empirical Discovery Record

| Surface | Tested command / API | Classification | Result |
|---|---|---|---|
| Grok CLI binary | `~/.grok/bin/grok` (`grok 1.0.5`) | `CONFIGURATION_SUPPORTED` | Installed and authenticated in TUI sessions |
| Native child session | `spawn_subagent` | `INVOCATION_AVAILABLE` | Enabled by default; disabled only when `GROK_SUBAGENTS=0` or `--disallowed-tools Agent` |
| Child execution | child `subagent_id` + model response | `EXECUTION_PROVEN` | Proven only after the child returns; binary presence is not proof |
| Project agents | `.grok/agents/devil-advocate.md`, `.grok/agents/judge.md` | `CONFIGURATION_SUPPORTED` | Registered as `subagent_type` values |
| Skill + slash command | `.grok/skills/ai-engineering-loop/`, `.grok/commands/ai-engineering-loop.md` | `CONFIGURATION_SUPPORTED` | Grok discovers repo-local skills and command markdown |
| Headless child | `grok -p "..."` | `FRESH_PROCESS_AGENT` | Valid fallback **after** stdout contains a model response |
| Compressed reviewer | `caveman:cavecrew-reviewer` | `GROK_COMPRESSED_REVIEW_PRESET` | **Rejected** — output schema is `path:line: emoji severity`, not the Finding Ledger |
| Browser tools | `browser_*` | `BROWSER_AUTOMATION_TOOL` | Not an LLM reviewer |
| `resume_from` Maker | `spawn_subagent(resume_from=makerId)` | tainted history | **Rejected** — inherits Maker transcript |

### What is NOT execution proof on Grok

1. `~/.grok/bin/grok` existing on disk
2. `.grok/agents/*.md` being discoverable
3. Subagents being enabled in `config.toml`
4. A persona named "reviewer" without a child response
5. Cavecrew reviewer output that looks like a review

---

## 3. Mapping Loop Roles → Grok Types

| Loop role | Grok `subagent_type` | `capability_mode` | `isolation` | `resume_from` |
|---|---|---|---|---|
| Orchestrator / Maker | parent session (or `general-purpose` if parent is orchestrator-only) | `all` | `none` | n/a |
| Devil's Advocate | `devil-advocate` (fallback `general-purpose`) | `execute` | `none` | **omit** |
| Judge | `judge` (fallback `general-purpose`) | `execute` | `none` | **omit** |

`execute` allows git/read/search and forbids source edits. Do not use `read-only` if the child needs `git diff`. Do not use `worktree` isolation: DA and Judge must see the Maker working tree.

`description` prefixes `[devil-advocate]` and `[judge]` so the Grok TUI labels the child correctly when falling back to `general-purpose`.

---

## 4. Artifact Barrier (still required)

Grok children do not inherit parent chat, but they do receive compacted `AGENTS.md` / project instructions. That is acceptable (project context, not Maker thoughts).

Still write artifacts to disk and pass **paths**, not Maker narration:

- Goal Contract
- git diff file
- verification log (command, exit code, stdout, test counts)
- `.ai-engineering-loop/`

---

## 5. Disable / fallback matrix

| Condition | Selected mode |
|---|---|
| `spawn_subagent` available, child response captured, no `resume_from` | `TRUE_INDEPENDENT_AGENT` |
| `spawn_subagent` missing, `grok -p` returns a model response | `FRESH_PROCESS_AGENT` |
| `GROK_SUBAGENTS=0` or `--disallowed-tools Agent` | `CONTEXT_ISOLATION_ONLY` |
| No grok, no spawn, no headless | `UNAVAILABLE` or artifact barrier if the same session can still read the diff |

---

## 6. Answers to the eight host questions

1. **Independent sub-agents?** Yes — `spawn_subagent`, own context window.
2. **Pass context?** Yes — prompt + on-disk artifacts. Do not pass Maker chat.
3. **Same repository?** Yes — `isolation: none` shares the workspace.
4. **Structured findings?** Yes — DA agent contract is Finding Ledger JSON.
5. **Parent consume findings?** Yes — child summary returns to parent; Judge spawn gets the ledger.
6. **Repeat the loop?** Yes — parent iterates; each DA/Judge spawn is fresh (no `resume_from`).
7. **Persist state?** Yes — files under `.ai-engineering-loop/` and task artifact paths. Grok also keeps session logs under `~/.grok/sessions/`.
8. **Token limits?** Pass artifact paths, not full transcripts. Do not dump Maker reasoning into the DA prompt.

---

## 7. Practical limits on Grok CLI

- **Depth 1**: a DA child cannot spawn a Judge. Parent must spawn both.
- **Plan mode**: a write-capable child is not gated by the parent's plan-mode lock. Keep DA/Judge on `capability_mode: execute` (no writes) so they cannot edit source while the parent is in plan mode.
- **Headless `--disallowed-tools Agent`**: kills native review. Disclose `CONTEXT_ISOLATION_ONLY`.
- **Cavecrew**: useful for cheap locate/review, **not** for this loop's Judge input.
