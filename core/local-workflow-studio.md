# Local Workflow Studio

Workflow Studio is a localhost-only visual control plane for declarative recipes and recipe-bound runs. It can create a named run and start the controlled local workflow runtime after an audited Goal Freeze. It does not execute models, shell commands, arbitrary node code, or inject prompts into an external AI conversation. The existing recipe compiler and controlled workflow runtime remain the source of truth.

## Start

```bash
ai-engineering-loop studio
```

The CLI binds only to `127.0.0.1`, creates a random process-local session token, and opens a tokenized bootstrap URL. The server exchanges that URL for an `HttpOnly; SameSite=Strict` cookie and removes the token from the address bar. Use `--no-open` when you want to copy the printed URL manually, or `--port 0` to let the operating system choose an available port.

The server rejects non-local `Host` headers. Static assets are bundled in the npm package; there are no CDNs, analytics, remote fonts, or browser-side model calls. Responses use a restrictive Content Security Policy and are not cached.

## Authoring model

The canvas loads built-in and project recipes through the same APIs as the CLI:

1. Select a recipe.
2. Fork a protected built-in by changing its ID.
3. Drag allowlisted node types from the library, use the global Add Node control, or use the contextual output `+` to create and connect a successor.
4. Move or multi-select nodes, drag an output port to connect existing nodes, and remove a connection from its midpoint control.
5. Edit a node Display Name inline without changing its stable Technical ID.
6. Import validated JSON through an explicit Replace, Merge with deterministic conflict renaming, or Cancel preview; export the current workflow as JSON.
7. Pan, lasso, zoom, fit, auto-layout, and use undo/redo without changing recipe semantics.
8. Review graph validation and hashes for every compatible mode.
9. Install only after explicit confirmation.

Installation writes a private temporary candidate, invokes the existing atomic installer, and removes the candidate. Built-ins cannot be overwritten. Replacing a project recipe still requires the version policy enforced by `recipe install --replace`.

Canvas positions and viewport state are not recipe fields and never contribute to the graph hash. Studio stores them under private `.ai-engineering-loop/studio-layouts/` files, validates IDs and coordinate bounds, rejects symlinks, and writes atomically. This keeps visual organization independent from execution semantics.

Visual connections are first-class `edges[]` with stable Edge IDs and Technical ID endpoints. Legacy `dependsOn` recipes migrate in memory without modifying their source; Save or Export emits the current Edge representation. The compiler projects Edges back to runtime dependencies so legacy and migrated recipes retain the same execution order and graph hash. Studio rejects duplicate, dangling, self-referential, and cyclic Edges, then applies the complete safety-backbone and mode validation before installation.

## Custom Agents

**Create Custom Agent** adds an `agent` node with a basic prompt, explicit capability and MCP references, input/output artifact contracts, token limit, timeout, and retry policy. Unsupported authority, arbitrary shell fields, raw secret values, and unsafe schema paths are rejected.

A Custom Agent reaching `READY` waits for an external operator. Studio can mark it running, record redacted activity, retry it, or complete it with a valid run-bound evidence artifact. Readiness is not represented as independent model execution.

## Stage 8 delivery adapter

The default canvas labels the lifecycle coverage from Stage 1 through Stage 8; Maker contains the Stage 2–4 diagnosis, planning, and implementation sequence. Delivery nodes expose the project-level Stage 8 adapter selected in `.ai-engineering-loop/adapter.md`. Studio can select the shipped `standard`, `github`, `gitlab`, or `dot` adapters and shows the adapter inferred from the repository remote.

An adapter belongs to the project, not to one delivery node. For a custom adapter, **Custom with AI** copies a bounded builder request that tells an agent to use the existing `generate-adapter` Q1–Q5 protocol, preserve Stages 0–7, require Judge `PASS`, and keep credentials out of configuration. Once that agent writes `.ai-engineering-loop/adapter.md`, Studio discovers the custom adapter on refresh. The browser never accepts arbitrary adapter code or executes delivery commands.

## Live execution

The trigger/root node owns the task input and local Execute control. Studio first creates a Run with an immutable Technical ID and human-readable Display Name. A deterministic task-derived name is used when no safe proposal is available. The Goal Contract must contain numbered acceptance criteria with evidence and failure cases and must pass an explicit Goal Freeze before Execute can start the local runtime.

Goal Freeze records actor, timestamp, version, and content hash. Unfreeze requires an actor and reason, increments the Goal version, resets the workflow to its Goal gate, and leaves previous evidence bound to the previous version.

For a recipe-bound current run, Studio polls a small live snapshot rather than reloading the recipe catalog. It displays:

- current node states and the append-only event stream;
- an animated connector leaving the running node;
- provider-recorded run token spend and configured limit;
- explicit approval and retry controls;
- a short redacted activity message reported by the host:

```bash
ai-engineering-loop node activity <node-id> \
  --message "Comparing the failing test with the implementation"
```

Activity can only be attached to a `RUNNING` node. It is capped at 240 printable characters, secret-redacted before persistence, and added to the integrity-bound workflow event chain.

## Run History

The separate **Runs** workspace reads every valid persisted Run rather than replacing Workflows with execution records. It supports text, status, mode, and date filters and shows human-readable names, technical IDs, Goal state, decisions, events, evidence presence, and bounded artifacts. Corrupt Run records are isolated so valid siblings remain available.

Run History is read-only. Artifact inspection accepts only regular files inside the owning Run, rejects path traversal and symlinks, enforces a size bound, and redacts recognized secrets before returning content.

## Decision memory

Studio can record a concise decision and rationale against the current run. Decision memory is private runtime data under the run directory, is bounded to 100 entries, and is redacted before persistence. It becomes part of exported handoffs so the next developer or agent receives the “why,” not only the final state.

Do not use decision memory as a credential store or as a replacement for a repository ADR when a durable architectural decision belongs in version control.

## Knowledge handoff

The top bar provides two forms:

- **Copy Brief** creates a human-readable developer summary.
- **Export Handoff** downloads a machine-readable `.ael-handoff.json` bundle for another agent.

The bundle contains objective, workflow state, artifact descriptors, decisions, transitions, and ready next actions. It deliberately excludes source contents. Strings pass through secret and home-path redaction, and the complete canonical manifest is bound to `bundleHash`.

Verify a received bundle before trusting it:

```bash
ai-engineering-loop handoff inspect run-id.ael-handoff.json
ai-engineering-loop handoff brief run-id.ael-handoff.json
```

Inspection accepts only regular files smaller than 1 MiB inside the repository, rejects symlinks and path escapes, and fails if any field no longer matches the bundle hash.

## Trust boundary

Studio improves authoring and observability; it does not weaken runtime gates:

- graph validation does not imply execution permission;
- local execution requires exactly one permitted trigger/root and an audited frozen Goal;
- command nodes remain disabled;
- Custom Agents wait for an external operator and cannot grant undeclared authority;
- approvals remain explicit state transitions;
- connector edits cannot bypass the required safety backbone;
- Run History cannot mutate persisted runs or artifacts;
- delivery adapters cannot run before Judge `PASS`;
- token data comes only from the provider-recorded usage ledger;
- handoff integrity proves the bundle has not changed after export, not that every original claim was true.
