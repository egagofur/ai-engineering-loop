# Generated Context Artifacts: `acme-platform`

Below are the exact 5 files generated automatically inside `/workspaces/acme-platform/.ai-engineering-loop/`:

---

## 1. `.ai-engineering-loop/config.md`

```markdown
# Project Configuration

## Metadata
- **project_name**: "acme-platform"
- **project_profile**: "monorepo" # Archetype bound from profiles/monorepo.md
- **languages**:
  - TypeScript 5.4 (Node.js 20.x)
  - Go 1.22
- **frameworks**:
  - Next.js 14 (App Router)
  - Gin Web Framework
  - Prisma ORM
- **package_manager**: "pnpm" (Turborepo workspace)
- **default_base_branch**: "main"

## Evidence
- Topology: `pnpm-workspace.yaml`, `turbo.json`
- Apps: `apps/web/package.json`, `apps/api/go.mod`
- Shared: `packages/ui/package.json`, `packages/database/prisma/schema.prisma`
```

---

## 2. `.ai-engineering-loop/architecture.md`

```markdown
# Project Architecture

## System Overview
Full-stack monorepo featuring a Next.js 14 web application, a Go backend API service, and shared UI/database packages.

## Applications & Packages
- `apps/web`: Next.js 14 frontend client rendering UI.
- `apps/api`: Go Gin REST service handling payments and user records.
- `packages/ui`: Shared React/Tailwind component library.
- `packages/database`: Centralized Prisma client and database schemas.

## Boundary Invariants
- `packages/ui` must not import backend API logic.
- `apps/web` must not connect directly to the database; it queries `apps/api` via REST.
- Shared packages must maintain zero cyclic dependencies.

## Evidence & Confidence
- Observed from: `apps/`, `packages/`, `turbo.json`
- Confidence: HIGH
```

---

## 3. `.ai-engineering-loop/conventions.md`

```markdown
# Project Conventions

## Code Standards
- File naming: `kebab-case` for TypeScript components and Go files.
- Test placement: Colocated `*.test.tsx` in `apps/web`; `*_test.go` in `apps/api`.
- Design tokens: Use Tailwind utility classes with colors defined in `packages/ui/tailwind.config.js`.

## Forbidden Anti-Patterns
- Zero `any` types in TypeScript packages.
- Zero unchecked error returns in Go (`if err != nil` is mandatory).
- Do not commit or hardcode environment URLs.
```

---

## 4. `.ai-engineering-loop/verification.md`

```markdown
# Project Verification Commands

## Workspace Package Manager
pnpm (Turborepo)

## Commands
- **test_unit**: `pnpm test`
- **test_scoped**: `pnpm --filter <package-name> test`
- **typecheck**: `pnpm typecheck`
- **lint**: `pnpm lint`
- **build**: `pnpm build`

## Required Verification by Scope
- **Web changes**: `pnpm --filter @acme/web test` and `pnpm --filter @acme/web typecheck`.
- **API changes**: `cd apps/api && go test -v ./...` and `golangci-lint run`.
- **Database changes**: `pnpm --filter @acme/database test`.
```

---

## 5. `.ai-engineering-loop/adapter.md`

```markdown
# Project Delivery Adapter Configuration

## Delivery Pipeline
- **adapter_type**: "github"
- **repository**: "acme-corp/acme-platform"
- **default_target_branch**: "main"
- **ci_workflows**: GitHub Actions (`.github/workflows/ci.yml`)
```
