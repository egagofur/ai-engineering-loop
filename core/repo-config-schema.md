# Repository Configuration Schema (`.ai-engineering-loop/`)

## 1. Overview & Purpose

To enable the AI Engineering Loop to operate across any codebase without a centralized monolithic database (such as a global `projects.json`), each repository optionally hosts its own local context directory:

```text
<target-repository>/
└── .ai-engineering-loop/
    ├── config.md           # Basic project metadata, type, and stack
    ├── architecture.md     # System architecture, layers, & boundaries
    ├── conventions.md      # Code standards, patterns, & forbidden practices
    ├── verification.md     # Exact CLI verification commands
    └── adapter.md          # Configured delivery pipeline & CI/CD tools
```

When an agent initializes in a workspace, it automatically discovers and loads these documents. If the directory is absent, the agent automatically executes [Project Initialization](file:///Users/egagofur/Development/work/ai-engineering-loop/core/project-initialization.md) to generate evidence-based files.

---

## 2. File Specifications

### 1. `config.md` — Project Identity & Metadata
Defines basic project descriptors:
- `project_name`: Name of the repository / service.
- `project_profile`: Bound profile (`web-app`, `backend-api`, `mobile-app`, `library`, `monorepo`).
- `languages`: Primary languages and versions (e.g. TypeScript 5.4, Go 1.22, Python 3.11).
- `frameworks`: Core runtime frameworks (e.g. Next.js 14, NestJS, FastAPI, Gin, Flutter).
- `package_manager`: Detected package manager (`pnpm`, `npm`, `yarn`, `bun`, `cargo`, `go`, `poetry`).
- `default_base_branch`: Primary target branch (`main`, `master`, `develop`).
- `evidence`: File paths used to infer project identity (e.g. `package.json`, `pnpm-workspace.yaml`).

### 2. `architecture.md` — System Design & Boundaries
Documents key structural layers:
- **Presentation / Ingress**: UI components, API routers, controllers.
- **Application / Domain**: Services, business logic actions, use cases.
- **Data Access**: Repositories, ORMs, query builders, cache stores.
- **Infrastructure / Integrations**: External third-party APIs, message brokers, queues.
- **Critical Boundaries**: Rules regarding circular dependencies and forbidden layer leaps.
- **Evidence & Confidence**: List of observed directories and files with confidence rating (`HIGH`, `MEDIUM`, `LOW`).

### 3. `conventions.md` — Engineering Standards & Invariants
Specifies repository-level rules:
- **Design System / UI Tokens**: Approved token sets, component libraries.
- **Naming Conventions**: File naming (`kebab-case`, `PascalCase`), interface naming, test file suffixes.
- **Error Handling Patterns**: Standard error classes, result types, domain exceptions.
- **Forbidden Anti-Patterns**: Explicit list of practices banned in this codebase (e.g. "Do not use `any`", "Do not execute raw SQL queries without parameterization", "Do not import from `dist/` directly").
- **Observed vs Inferred**: Clearly demarcates rules observed directly in code from inferred suggestions.

### 4. `verification.md` — Deterministic Commands
Specifies exact CLI commands for machine checks:
- `test_unit`: Command for focused unit testing.
- `test_all`: Command for full regression suite.
- `typecheck`: Command for static typechecking (`tsc --noEmit`, `mypy`).
- `lint`: Command for linting with auto-fix.
- `build`: Command for production bundle / binary compilation.
- `e2e`: (Optional) End-to-end / browser test command.
- **Evidence Source**: Exact script names in `package.json` or Makefile rules.

### 5. `adapter.md` — Delivery Pipeline Configuration
Specifies the downstream release workflow:
- `adapter_type`: Configured adapter (`dot`, `github`, `gitlab`, `custom`, `none detected`).
- `issue_tracker`: URL or repository tracker slug.
- `notification_channel`: Channel name or webhook reference for messaging.
- `multi_branch_propagation`: List of target branches (e.g. `main`, `staging`, `develop`).

---

## 3. Automatic Initialization Behavior

If `.ai-engineering-loop/` does not exist:
1. The agent automatically executes the 5-pass discovery workflow in [core/project-initialization.md](file:///Users/egagofur/Development/work/ai-engineering-loop/core/project-initialization.md).
2. Generates all 5 files with evidence citations.
3. Performs a second-pass quality check.
4. Proceeds to the Goal Contract phase without user interruption.
