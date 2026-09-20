# Security Checklist

Audit guide for authentication, authorization, input handling, and data protection.

## Input validation

Validate at API boundaries: type, length, range, format, enum membership, array size, uniqueness, file type by content, file size, UUID shape, and pagination limits.

Use schema validation libraries. Never trust frontend validation.

## Authentication

- Use short-lived access tokens.
- Use refresh tokens securely and rotate on use when appropriate.
- Support revocation for logout/incidents.
- Hash passwords with bcrypt, argon2, or scrypt.
- Store secrets in env vars or secret managers, not source code.

## Authorization

- Define specific roles/permissions.
- Check permissions at API boundaries.
- Verify resource ownership to prevent IDOR.
- Prevent mass assignment by accepting explicit DTO fields only.
- Test that users cannot access or mutate others’ resources.

## Data protection

- HTTPS everywhere.
- Encrypt sensitive data at rest where required.
- Minimize PII collection.
- Mask PII/secrets in logs and responses.
- Implement retention/deletion policies where applicable.

## HTTP security headers

Configure HSTS, X-Content-Type-Options, X-Frame-Options or CSP frame policy, Content-Security-Policy, Referrer-Policy, and Permissions-Policy according to the app surface.

## Dependency security

Audit dependencies regularly, update vulnerable packages, pin major versions, and review new dependencies for maintenance and risk.

## Common vulnerability prevention

| Vulnerability | Prevention |
|---|---|
| SQL injection | Parameterized queries / query builders |
| NoSQL injection | Validate operators and input shape |
| XSS | Escape output, sanitize HTML, set CSP |
| CSRF | SameSite cookies and CSRF tokens for browser state changes |
| IDOR | Ownership/permission checks |
| Mass assignment | Explicit DTO allow-lists |
| SSRF | URL allow-list and internal network blocking |
| Command injection | Avoid shell; pass args safely |
| Path traversal | Canonicalize and enforce allowed root |
| Open redirect | Allow-list redirect targets |

## Logging security

Log auth events, authorization failures, validation failures, system errors, and admin actions. Do not log passwords, full tokens, API keys, card data, health data, or full request/response bodies with PII.
