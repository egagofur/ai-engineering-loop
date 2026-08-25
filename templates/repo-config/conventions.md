# Project Conventions

## Code Standards & Style
- File naming: `kebab-case.ts` (e.g. `user-service.ts`, `auth-guard.ts`).
- Test file placement: Colocated `*.spec.ts` alongside implementation.
- Types: Explicit return types on all exported service functions.

## Error Handling
- Use domain errors inheriting from `AppException(message, status, code)`.
- Never throw generic `new Error()`.
- Never leave empty catch blocks.

## Forbidden Anti-Patterns
- Zero `any` types (use `unknown` with type guards).
- Zero raw unescaped SQL strings.
- Do not import external modules directly into domain entities.
