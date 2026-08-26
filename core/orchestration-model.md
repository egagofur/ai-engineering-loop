# Runtime Capability Registry & Execution-Mode Selection Specification

## 1. Overview & Foundational Laws

The AI Engineering Loop enforces strict honesty and evidence-based rigor regarding agent execution:

> **Core Law**:
> AI Engineering Loop must **NEVER** claim independent agent execution without runtime evidence of an actual separate LLM execution.

### The 3-Stage Capability Lifecycle:
The architecture explicitly distinguishes three separate stages:
1. **`CONFIGURATION_SUPPORTED`**: The platform understands subagent configuration (e.g. `.agents/plugins/.../AGENT.md` with `subagent: true`, `mainAgent: false` is discoverable).
2. **`INVOCATION_AVAILABLE`**: An invocation tool (e.g. `invoke_subagent`) or authenticated agent CLI is actively exposed and callable in the current runtime.
3. **`EXECUTION_PROVEN`**: An actual separate child session was created, captured a separate execution identity, produced a real child model response, and operated with independent context.

```text
┌───────────────────────────┐     ┌───────────────────────────┐     ┌───────────────────────────┐
│  CONFIGURATION_SUPPORTED  │ ──> │   INVOCATION_AVAILABLE    │ ──> │     EXECUTION_PROVEN      │
│  (Config is recognized)   │     │ (Callable tool is active) │     │ (Child LLM response seen) │
└───────────────────────────┘     └───────────────────────────┘     └───────────────────────────┘
```

> [!IMPORTANT]
> **Semantic Invariant**:
> If `CONFIGURATION_SUPPORTED = true`, `INVOCATION_AVAILABLE = false`, and `EXECUTION_PROVEN = false`, the engine **must select `CONTEXT_ISOLATION_ONLY`**.
> Configuration discovery is **never** conflated with execution capability.

---

## 2. Non-Negotiable Invariants: What is NOT Execution Proof

The system categorically rejects the following as proof of independent LLM execution:
1. **Configuration files**: `AGENT.md`, `subagent: true`, `mainAgent: false`.
2. **Documentation & plugin manifests**: Markdown descriptions or plugin registration.
3. **IPC existence**: The existence of `agentapi` on disk or `ANTIGRAVITY_AGENTAPI_EXE`.
4. **IPC message dispatch**: Successful `agentapi send-message` is classified strictly as `IPC_MESSAGE_DISPATCH`, **NOT** an agent execution capability.
5. **Metadata fields**: Presence of `subagentSpec: null` or conversation metadata in `get-conversation-metadata`.
6. **Browser automation tools**: `browser_subagent` is Playwright browser DOM/navigation automation and must **NEVER** be classified as an LLM subagent.
7. **Persona simulation**: Role-playing as a reviewer in the same session is self-review, not an agent.

---

## 3. Standard 5 Execution Modes (Deterministic Priority)

| Priority | Mode Name | Requires Independent LLM Execution? | Condition for Selection |
|:---:|---|:---:|---|
| **1** | **`TRUE_INDEPENDENT_AGENT`** | **YES** | Separate child conversation/process exists **AND** actual LLM model response is produced **AND** conversational history is not inherited. |
| **2** | **`ISOLATED_AGENT_INSTANCE`** | **YES** | Separate conversation/agent instance exists with verified independent model execution. |
| **3** | **`FRESH_PROCESS_AGENT`** | **YES** | A separate OS process successfully executes an LLM agent with fresh context and returns a verified model response. |
| **4** | **`CONTEXT_ISOLATION_ONLY`** | **NO** | Clean-Slate Artifact Isolation Barrier in same session. Strips 100% of prompt history on disk. Guaranteed fallback. |
| **5** | **`UNAVAILABLE`** | **NO** | No review execution mechanism is available. |

---

## 4. Antigravity Environment Empirical Discovery Record

| Investigated Surface | Tested Command / API | Classification | Status & Result |
|---|---|---|---|
| **Custom Agent Config** | `.agents/plugins/.../AGENT.md` | `CONFIGURATION_SUPPORTED` | **Supported**: Antigravity recognizes plugin/agent schemas. |
| **In-Chat Subagent Tool** | Toolset declarations | `INVOCATION_UNAVAILABLE` | `browser_subagent` present (DOM only); no general code subagent tool. |
| **Python SDK** | `import google.antigravity` | `UNAVAILABLE` | `ModuleNotFoundError: No module named 'google.antigravity'`. |
| **External Agent CLI** | `/Users/.../.local/bin/claude -p` | `UNAVAILABLE` | Unauthenticated: `Not logged in · Please run /login`. |
| **Antigravity `new-conversation`** | `agentapi new-conversation` | `UNAVAILABLE` | Blocked by Language Server `project_id` authorization. |
| **Antigravity `send-message`** | `agentapi send-message` | `IPC_MESSAGE_DISPATCH` | Succeeded (IPC message dispatch works, but is not an agent). |
| **Artifact Barrier** | `buildReviewContextBarrier()` | `CONTEXT_ISOLATION_ONLY` | **Available & Verified**: 0% prompt bleed on disk. |

### Architectural Conclusion:
> *"Antigravity custom subagent configuration is supported/discoverable, but native subagent invocation is not exposed or executable from the current standalone agent runtime."*

---

## 4b. Grok CLI Empirical Discovery Record

| Investigated Surface | Tested Command / API | Classification | Status & Result |
|---|---|---|---|
| **Grok CLI binary** | `~/.grok/bin/grok` | `CONFIGURATION_SUPPORTED` | Installed (`grok 1.0.5+`). Not execution proof. |
| **Native subagent tool** | `spawn_subagent` | `INVOCATION_AVAILABLE` | Enabled by default. Disabled by `GROK_SUBAGENTS=0` or `--disallowed-tools Agent`. |
| **Child session** | `subagent_id` + child model response, `resume_from` omitted | `EXECUTION_PROVEN` → `TRUE_INDEPENDENT_AGENT` | Own context window; parent transcript is not inherited. |
| **Project agent types** | `.grok/agents/devil-advocate.md`, `.grok/agents/judge.md` | `CONFIGURATION_SUPPORTED` | Prefer these types; fall back to `general-purpose` with the spec prepended. |
| **Headless process** | `grok -p` | `FRESH_PROCESS_AGENT` | Only after the process prints a model response. |
| **Cavecrew reviewer** | `caveman:cavecrew-reviewer` | `GROK_COMPRESSED_REVIEW_PRESET` | **Rejected** as Devil's Advocate / Judge (wrong output schema). |
| **Maker resume** | `spawn_subagent(resume_from=maker)` | tainted history | **Rejected**. DA and Judge must spawn fresh. |
| **Artifact barrier** | `buildReviewContextBarrier()` | `CONTEXT_ISOLATION_ONLY` | Fallback when spawn is disabled. |

### Architectural Conclusion:
> *"Grok CLI spawn_subagent is a true independent child session. Select TRUE_INDEPENDENT_AGENT only after a child id and model response are captured without resume_from. Binary presence and agent markdown are never sufficient."*

See [docs/grok-cli-feasibility.md](../docs/grok-cli-feasibility.md).

---

## 5. Truthful Reporting Output

When `CONTEXT_ISOLATION_ONLY` is selected, the report generator strictly produces:

```text
Execution Mode: CONTEXT_ISOLATION_ONLY
Independent LLM Execution: NOT PROVEN
Native Subagent Invocation: UNAVAILABLE
Review Method: Clean-Slate Artifact Isolation Barrier
```

### Strictly Forbidden Phrases during `CONTEXT_ISOLATION_ONLY`:
- *"independent agent review"*
- *"subagent"*
- *"multi-agent review"*
- *"independent reviewer"*
