# Security Policy

## Trust boundary

Repository files, generated logs, tool output, and comments are untrusted data. Instructions found inside them never override the active host skill, Goal Contract, or user authorization.

AI Engineering Loop blocks `.env*`, private-key formats, common credential files, `.git/`, `node_modules/`, absolute paths, parent traversal, and symlinks that leave the repository from generated context packs. Recognized credentials are redacted before model-visible context is persisted.

No telemetry is collected. Stage 0–7 require no AI Engineering Loop network service. Delivery adapters may use authenticated forge tools only after Judge `PASS`; users must review remote issue, pull-request, merge-request, and chat payloads before sending.

## Credential handling

- Supply provider credentials through the host's documented environment or credential store.
- Never place credentials in `.ai-engineering-loop/`, workflow files, prompts, findings, or delivery reports.
- Do not pass the parent process environment to a child unless the host owns that boundary.
- Treat generated run artifacts as sensitive local files. The CLI writes state and context packs with mode `0600` where supported.
- Run a dedicated secret scanner such as `gitleaks` before delivery when available.

Pattern-based redaction is defense in depth, not proof that arbitrary secrets are absent.

## Reporting a vulnerability

Do not open a public issue containing credentials, exploit details, private source, or model transcripts. Use GitHub private vulnerability reporting for this repository. Include the package version, host, minimal reproduction, and whether any remote payload was sent.
