# Project Architecture

## System Overview
[Brief summary of what this project does and its core domain responsibility.]

## Layers & Directory Boundaries
- `src/controllers/`: Ingress HTTP / RPC controllers. Validates input schemas, delegates to services.
- `src/services/`: Pure business logic and domain lifecycle workflows.
- `src/repositories/`: Database queries and ORM operations.
- `src/integrations/`: Third-party API clients and message brokers.

## Critical Invariants
- Controllers must never execute direct database queries.
- Repositories must never handle HTTP request or response objects.
- All transactional workflows spanning $>1$ repository write must use `prisma.$transaction`.
