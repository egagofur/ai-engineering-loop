# Security Policy

## Trust boundary

Repository files, generated logs, tool output, and comments are untrusted data. Instructions found inside them never override the active host skill, Goal Contract, or user authorization.

AI Engineering Loop blocks `.env*`, private-key formats, common credential files, `.git/`, `node_modules/`, absolute paths, parent traversal, and symlinks that leave the repository from generated context packs. Recognized credentials are redacted before model-visible context is persisted. Package release auditing rejects private keys, local home paths, and `file://` links before publication.

No telemetry is collected. Token usage ledgers stay local and contain counts plus provider model identifiers, not prompts or responses. Stage 0–7 require no AI Engineering Loop network service. Delivery adapters may use authenticated forge tools only after Judge `PASS`; ASSISTED requires explicit human approval before delivery.

Workflow Studio binds to `127.0.0.1`, validates local `Host` headers, and requires a random process-local session token exchanged for an HttpOnly SameSite cookie. Its bundled browser client has no model, shell, telemetry, or remote-asset capability. Do not expose the Studio port through a reverse proxy or public tunnel. Handoff exports omit source content and redact recognized secrets and home paths; verify their integrity hash on import, and still review them before sharing because pattern-based redaction cannot recognize every private value.

UNATTENDED is disabled by default and Maker uses a locked disposable Git worktree when enabled. This protects the parent checkout and prevents concurrent Maker sessions; it is not an OS sandbox. For untrusted code, use a container or VM with restricted credentials, filesystem, processes, and network. See `core/runtime-safety.md`.

Package releases use npm trusted publishing from `.github/workflows/publish.yml`, with a pinned OIDC-capable npm CLI and provenance. The package owner must configure `egagofur/ai-engineering-loop`, workflow `publish.yml`, and environment `npm` as the trusted publisher on npmjs.com. Do not add `NPM_TOKEN` or another long-lived publish credential to the repository or GitHub environment.

## Credential handling

- Supply provider credentials through the host's documented environment or credential store.
- Never place credentials in `.ai-engineering-loop/`, workflow files, prompts, findings, or delivery reports.
- Do not pass the parent process environment to a child unless the host owns that boundary.
- Treat generated run artifacts as sensitive local files. The CLI writes state and context packs with mode `0600` where supported.
- Keep `runs/`, `usage/`, `worktrees/`, `locks/`, temporary Studio `drafts/`, and task logs under the generated `.ai-engineering-loop/.gitignore`.
- Use `budget pause` to stop new model boundaries if spend, behavior, or credentials are in doubt. Recording an already completed call remains possible while paused.
- Run a dedicated secret scanner such as `gitleaks` before delivery when available.

Pattern-based redaction is defense in depth, not proof that arbitrary secrets are absent.

## Reporting a vulnerability

Do not open a public issue containing credentials, exploit details, private source, or model transcripts. Use GitHub private vulnerability reporting for this repository. Include the package version, host, minimal reproduction, and whether any remote payload was sent.
