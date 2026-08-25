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
