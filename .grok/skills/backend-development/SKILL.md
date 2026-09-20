---
name: backend-development
description: Framework-agnostic backend best practices for clean code, naming, queries/databases, REST APIs, errors, security, performance, scalability, testing, and structure. Trigger on backend implementation, architecture, code quality, naming, magic values, complex conditionals, query optimization, caching, error handling, or security tasks.
---

# Backend Development Guidelines

Universal principles for reliable, maintainable, performant backends — regardless of framework or language.

Framework-specific conventions in `CLAUDE.md`, `AGENTS.md`, README files, or project docs take precedence for implementation details. This skill governs the underlying engineering principles.

## How to use this skill

- Apply these rules during backend implementation, review, refactoring, architecture, naming, database, API, error-handling, security, performance, and testing work.
- Prefer the project’s established patterns when they are coherent. Use this skill to improve unclear, unsafe, or over-complex code.
- Do not introduce speculative architecture. Fix the rule causing the problem, with the smallest coherent design.
- Read reference files only when depth is needed:
  - `references/query-and-database-best-practices.md`
  - `references/api-design-guidelines.md`
  - `references/security-checklist.md`

---

## 1. Clean Code Principles

### Single Responsibility

Every function, class, and module should have one reason to exist. If you need “and” to describe it — validates input and saves to database and sends notification — split it.

- Functions do one thing. A data fetcher should not format presentation output.
- Services/classes own one domain concept. `UserService` handles user logic, not email delivery.
- Modules encapsulate one bounded context. Cross-module access flows through well-defined interfaces.

### Meaningful Names

Names reveal intent without requiring a comment.

- Variables: `activeUserCount`, `invoiceDueDate`, `orderItems`.
- Functions: verb-first and specific, e.g. `calculateShippingCost`, `archiveExpiredCoupons`, `validateEmailFormat`.
- Classes/types: role-suffixed nouns, e.g. `UserService`, `OrderRepository`, `PaymentController`, `ProductDto`.
- Abbreviations: only universally understood ones like `id`, `url`, `dto`, `http`.

### Boolean naming

Boolean names must read as yes/no propositions. Use prefixes that reveal the type and intent:

| Prefix | Reads as | Example |
|---|---|---|
| `is` | Is it in this state? | `isActive`, `isEmailVerified` |
| `has` | Does it own this? | `hasPermission`, `hasSubscription` |
| `can` | Is it allowed or able? | `canRetry`, `canRefund` |
| `should` | Ought it happen? | `shouldNotify`, `shouldRetry` |
| `was` | Did it happen? | `wasDeleted`, `wasCharged` |
| `will` | Is it going to happen? | `willExpire`, `willRenew` |

Avoid ambiguous booleans like `active`, `verified`, `enabled`, `permission`, or `status` unless the type is intentionally not boolean.

```typescript
// Bad: string? number? boolean?
const active = user.status
const verification = checkEmail(email)

// Good: yes/no at a glance
const isActive = user.status === 'active'
const isEmailVerified = checkEmailVerification(email)
```

### DRY, KISS, YAGNI

- Extract repeated logic when changing one copy would force changes everywhere.
- Do not abstract merely because code looks similar twice; similar code may diverge.
- Prefer straightforward solutions. Patterns and abstractions must earn their complexity.
- Build for today’s requirements. Add extension points when the requirement arrives.

### Guard clauses and early returns

Handle edge cases at the top and return early. Keep the happy path at the lowest indentation level.

### Extract complex conditions

A condition should read as intent, not mechanics. Name the rule before testing it.

```typescript
const meetsAgeRequirement = user.age >= MIN_AGE
const isIdentityVerified = user.kycStatus === 'verified'
const isInGoodStanding = !user.isBanned && user.region !== 'restricted'
const hasPremiumAccess = user.accountType === 'premium'
  || user.loyaltyPoints > LOYALTY_THRESHOLD

const isEligibleForAccess = meetsAgeRequirement
  && isIdentityVerified
  && isInGoodStanding
  && hasPremiumAccess

if (isEligibleForAccess) {
  grantAccess()
}
```

Rule of thumb: if the reader must parse operators, extract a named variable. This applies to a single domain comparison too when the mechanism hides the business rule.

### Function size

Aim for 20–30 lines. If a function exceeds 40 lines, look for extraction opportunities. A block that needs a section comment is a candidate for its own function.

### No magic numbers or strings

Extract domain-meaningful literals into named constants: status codes, thresholds, retry counts, timeouts, role IDs, page limits.

```typescript
const ROLE_ADMIN = 3
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const MAX_ITEMS_PER_ORDER = 50

const isAdmin = user.role === ROLE_ADMIN
const isSessionStale = Date.now() - lastLogin > ONE_DAY_MS
const exceedsItemLimit = order.items.length > MAX_ITEMS_PER_ORDER
```

### Comments

A comment is often a failure to make the code say it itself. Before adding one, try renaming or extracting.

Keep comments for intent, protocol details, warning of consequences, public API docs, legal headers, and living TODOs. Delete comments that restate code, drift out of date, journal changes, attribute authors, or preserve commented-out code.

### Command-Query Separation

Functions that return data should avoid side effects. Functions that mutate state should make mutation explicit. Reads are safe; writes are deliberate.

---

## 2. Naming Conventions

| Context | Convention | Examples |
|---|---|---|
| Variables, parameters | Descriptive nouns, language-standard casing | `userId`, `orderItems`, `isValid` |
| Functions, methods | Verb-first | `getUser`, `createOrder`, `validateInput`, `isExpired` |
| Classes, types | PascalCase nouns, role suffix | `UserService`, `OrderRepository`, `PaymentController` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT`, `DEFAULT_PAGE_SIZE` |
| Database columns | snake_case | `created_at`, `user_id`, `is_active` |
| Database tables | snake_case plural | `users`, `order_items`, `payment_transactions` |
| API endpoints | lowercase plural nouns, kebab-case | `/users`, `/order-items` |
| Enum values | UPPER_SNAKE_CASE or language convention | `PENDING`, `IN_PROGRESS` |

Foreign keys: `{referenced_table_singular}_id`, e.g. `user_id`.

Boolean columns: `is_active`, `is_verified`, `has_subscription`.

Timestamp columns: suffix `_at`, e.g. `created_at`, `updated_at`, `deleted_at`, `expires_at`.

---

## 3. Query and Database Best Practices

Poor query patterns are a common backend bottleneck.

- Prevent N+1 queries with joins, eager loading, or batch loading.
- Select only needed columns. Avoid `SELECT *` in application queries.
- Index foreign keys and frequent `WHERE` / `ORDER BY` fields.
- Composite indexes follow leftmost prefix rules.
- Paginate list endpoints; never return unbounded lists.
- Use transactions for multi-step writes. Keep transactions short.
- Use connection pools sized to expected concurrency.

Read `references/query-and-database-best-practices.md` for schema, query, pagination, migration, and pool-sizing details.

---

## 4. API Design Principles

A good API is consistent and predictable.

- Use resource nouns, not verbs: `POST /orders`, not `/create-order`.
- Use plural collections: `/users`, `/orders`, `/products`.
- Nest sub-resources at most two levels; flatten deeper models.
- Keep response envelopes consistent for success and error.
- Version breaking API contracts explicitly, usually `/v1`, `/v2`.
- Validate filters and sort fields against allow-lists.
- Include pagination metadata.
- For long-running work, return `202 Accepted` with a task/status resource.

Read `references/api-design-guidelines.md` for endpoint patterns, envelopes, pagination, filtering, bulk operations, and versioning.

---

## 5. Error Handling

Treat error paths with the same care as success paths.

- Use consistent error shape: HTTP status, machine-readable code, human-readable message, optional details.
- Do not expose stack traces, internal paths, raw SQL errors, secret values, or implementation details.
- Validate at the API boundary and fail fast.
- User-facing messages must answer what went wrong and what to do next.

```text
Bad: ValidationError: field 'shipping_zone_id' violates constraint fk_order_zone
Good: Cannot save this order. The selected shipping zone is no longer available. Choose a different shipping zone and save again.
```

Use specific status codes: `400`, `401`, `403`, `404`, `409`, `422`, `429`, `500`, `502`, `503`.

Structured logs should include request ID, user ID when available, action, and sanitized error context. Never log passwords, tokens, API keys, or PII.

---

## 6. Security

Security is a design constraint.

- Validate all external input at boundaries.
- Use parameterized queries or query builders; never concatenate user input into SQL, shell commands, or template expressions.
- Store secrets in env vars or secret managers, never source code.
- Hash passwords with bcrypt, argon2, or scrypt.
- Enforce authorization at API boundaries and verify resource ownership.
- Never rely solely on frontend checks.
- Mask sensitive fields in API responses and logs.
- Use HTTPS everywhere.

Read `references/security-checklist.md` for auth, authorization, validation, headers, dependency security, and vulnerability prevention.

---

## 7. Performance and Scalability

Design for predictable performance under load.

- Keep services stateless; externalize session/state to Redis/database when needed.
- Cache expensive operations with explicit invalidation strategy.
- Use eager loading when related data is always needed; lazy loading only when rare and safe.
- Use bulk operations for mass writes/deletes.
- Offload long-running work to queues/background jobs.
- Enable response compression.
- Limit request body size and paginate/stream large payloads.

---

## 8. Code Organization

Use layers unless the operation is trivially simple:

1. Controller/handler: request parsing, validation, response mapping. No business logic.
2. Service: business logic and orchestration. Framework-agnostic where possible.
3. Repository/data access: persistence and schema-aware queries.

Rules:

- Services should not know HTTP status codes.
- Controllers should not contain SQL.
- Repositories should not enforce business workflows.
- Use dependency injection; avoid `new` inside services for dependencies.
- Domain modules own their entities, DTOs, services, and repositories.
- Cross-module communication goes through service interfaces.
- Shared utilities must be truly shared; avoid tangled abstractions.
- Externalize configuration into typed config objects.

---

## 9. Testing Strategy

Test behavior and business rules, not framework internals.

- Unit tests: business logic and edge cases.
- Integration tests: repositories, real database behavior, HTTP endpoints.
- E2E tests: critical flows only.

Cover happy paths, empty inputs, boundary values, invalid inputs, authorization failures, and business rule violations.

Avoid testing private methods, simple getters, third-party behavior, and framework plumbing unless your code configures it in a risky way.

Name tests by scenario and outcome: `should return 404 when user does not exist`.

Use factories/builders for test data. Each test owns its setup and cleanup.
