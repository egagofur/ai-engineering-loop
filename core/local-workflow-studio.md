# Local Workflow Studio

Workflow Studio is a localhost-only visual control plane for declarative recipes and recipe-bound runs. It does not execute models, shell commands, or arbitrary node code. The existing recipe compiler and controlled workflow runtime remain the source of truth.

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
3. Add or edit allowlisted node types.
4. Connect nodes with dependency IDs.
5. Review graph validation and hashes for every compatible mode.
6. Install only after explicit confirmation.

Installation writes a private temporary candidate, invokes the existing atomic installer, and removes the candidate. Built-ins cannot be overwritten. Replacing a project recipe still requires the version policy enforced by `recipe install --replace`.

## Live execution

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
- command nodes remain disabled;
- approvals remain explicit state transitions;
- token data comes only from the provider-recorded usage ledger;
- handoff integrity proves the bundle has not changed after export, not that every original claim was true.
