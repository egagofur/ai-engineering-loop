# Repository Configuration Schema (`.ai-engineering-loop/`)

## 1. Overview & Purpose

The `.ai-engineering-loop/` directory serves as the **Living Project Context** for autonomous agents working in a repository:

```text
<target-repository>/
└── .ai-engineering-loop/
    ├── metadata.json       # Baseline tracking, git revisions, & manifest hashes
    ├── config.md           # Basic project metadata, type, and stack
    ├── architecture.md     # System architecture, layers, & boundaries
    ├── conventions.md      # Code standards, patterns, & forbidden practices
    ├── verification.md     # Exact CLI verification commands
    └── adapter.md          # Configured delivery pipeline & CI/CD tools
```

---

## 2. File Specifications

### 1. `metadata.json` — Context Baseline & Drift Tracking
Maintains lightweight state for instant drift detection:
- `contextVersion`: Schema version (e.g. `"1.0.0"`).
- `generatedAt`: ISO timestamp of initial generation.
- `repositoryRevision`: Full git commit SHA corresponding to this context baseline.
- `projectProfile`: Active archetype profile (`web-app`, `backend-api`, `mobile-app`, `library`, `monorepo`).
- `manifestChecksums`: Hash map of manifest files (`package.json`, `go.mod`, `Cargo.toml`).
- `lastReconciliation`: Timestamp, trigger, and impact of the last update.

### 2. `config.md` — Project Identity & Metadata
- `project_name`: Name of the repository / service.
- `project_profile`: Bound profile archetype.
- `languages`: Primary languages and versions.
- `frameworks`: Core runtime frameworks.
- `package_manager`: Detected package manager (`pnpm`, `npm`, `yarn`, `bun`, `cargo`, `go`, `poetry`).
- `default_base_branch`: Primary target branch (`main`, `master`, `develop`).
- `observed_evidence`: File paths used to infer project identity.

### 3. `architecture.md` — System Design & Boundaries
- **Presentation / Ingress**: UI components, API routers, controllers.
- **Application / Domain**: Services, business logic actions, use cases.
- **Data Access**: Repositories, ORMs, query builders, cache stores.
- **Infrastructure / Integrations**: External third-party APIs, message brokers, queues.
- **Critical Boundaries**: Rules regarding circular dependencies and forbidden layer leaps.
- **Evidence & Confidence**: Observed directories and confidence rating (`HIGH`, `MEDIUM`, `LOW`).

### 4. `conventions.md` — Engineering Standards & Invariants
- **Design System / UI Tokens**: Approved token sets, component libraries.
- **Naming Conventions**: File naming (`kebab-case`, `PascalCase`), interface naming, test file suffixes.
- **Error Handling Patterns**: Standard error classes, result types, domain exceptions.
- **Forbidden Anti-Patterns**: Explicit list of banned practices.

### 5. `verification.md` — Deterministic Commands
- `test_unit`: Command for focused unit testing.
- `test_all`: Command for full regression suite.
- `typecheck`: Command for static typechecking (`tsc --noEmit`, `mypy`).
- `lint`: Command for linting with auto-fix.
- `build`: Command for production bundle / binary compilation.
- `e2e`: (Optional) End-to-end / browser test command.

### 6. `adapter.md` — Delivery Pipeline Configuration
- `adapter_type`: Configured adapter (`dot`, `github`, `gitlab`, `standard`).
- `remote_repository`: Git remote repository slug.
- `default_target_branch`: Base target branch.
- `ci_provider`: Detected CI engine (GitHub Actions, GitLab CI).

---

## 3. Version Control Recommendation

It is strongly recommended to **commit the `.ai-engineering-loop/` directory (including `metadata.json`) to git**. This ensures all developers and AI agent sessions share consistent, up-to-date repository context without repeated re-discovery overhead.
