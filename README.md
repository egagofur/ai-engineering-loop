# AI Engineering Loop

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/egagofur/ai-engineering-loop/pulls)
[![AI Engineering](https://img.shields.io/badge/AI-Engineering%20Loop-orange.svg)](https://github.com/egagofur/ai-engineering-loop)
[![Release](https://img.shields.io/badge/release-v1.0.0-purple.svg)](https://github.com/egagofur/ai-engineering-loop/releases)
[![Status](https://img.shields.io/badge/status-production--ready-success.svg)](https://github.com/egagofur/ai-engineering-loop)

**A Reusable, Framework-Agnostic AI Engineering Operating System for Autonomous Coding Agents**

*Featuring a strict separation between deterministic CLI context bootstrap and AI agent engineering reasoning.*

[Overview](#overview--philosophy) • [CLI Commands](#cli-interface--commands) • [Agent Integration](#antigravity-agent-integration) • [Lifecycle](#lifecycle-stages) • [Architecture](#architecture--5-layer-configuration) • [Project Profiles](#project-profiles) • [Repository Structure](#repository-structure) • [Reference Examples](#reference-examples) • [Contributing](#contributing)

</div>

---

## Overview & Philosophy

The AI Engineering Loop enforces a clean architectural separation between **Deterministic Context Bootstrap** and **Agent Intelligence**:

> **"The CLI bootstraps and validates repository context. The AI Agent reasons over that context to execute the engineering lifecycle."**

```mermaid
flowchart TD
    subgraph CLI [DETERMINISTIC CLI BOOTSTRAP: init / status / refresh]
        Discover[Repository Discovery Engine] --> ContextGen[Generate .ai-engineering-loop/]
        ContextGen --> Validate[Context Validation Engine]
    end

    Validate --> ContextDir[(.ai-engineering-loop/ Ground Truth)]

    subgraph Agent [AI AGENT INTELLIGENCE: run]
        ContextDir --> GoalContract[Stage 1: Goal Contract]
        GoalContract --> RCA[Stage 2: Root Cause Analysis]
        RCA --> Plan[Stage 3: Implementation Plan]
        Plan --> Maker[Stage 4: Maker Agent: Code & Tests]
        Maker --> Verify{Stage 5: Deterministic Verification}
        Verify -->|Pass| DA[Stage 6: Devil's Advocate Review]
        DA --> Judge[Stage 7: Judge Evaluation]
        Judge -->|PASS| Adapter[Stage 8: Delivery Pipeline]
    end
```

---

## CLI Interface & Commands

The CLI operates against the current working directory without maintaining a centralized project registry.

```bash
# Bootstrap .ai-engineering-loop/ context from repository discovery
npx ai-engineering-loop init

# Check the validity and readiness of repository context
npx ai-engineering-loop status

# Re-analyze repository and update context non-destructively
npx ai-engineering-loop refresh

# Verify context readiness and begin engineering loop
npx ai-engineering-loop run
```

### Command Responsibilities:

| Command | Purpose | Expected Writes | Mutates App Code? |
|---|---|---|:---:|
| **`init`** | Analyzes repository topology, manifests, and test scripts to generate `.ai-engineering-loop/`. | `.ai-engineering-loop/*` | **NO** |
| **`status`** | Audits the completeness of the 5 required context files. | None | **NO** |
| **`refresh`** | Re-analyzes manifests and surgically updates drifted sections while preserving human notes. | `.ai-engineering-loop/*` | **NO** |
| **`run`** | Loads verified context and triggers the AI Agent to execute task engineering. | Determined by Task Scope | By Agent |

---

## Antigravity Agent Integration

When working inside the Antigravity IDE or compatible agentic platforms, you can invoke the loop via slash commands:

- **`/ai-engineering-loop init`**: Initialize project context only (non-destructive bootstrap).
- **`/ai-engineering-loop status`**: Check repository context health.
- **`/ai-engineering-loop refresh`**: Refresh drifted context files.
- **`/ai-engineering-loop [task description]`**: Load context and execute the full 8-stage engineering lifecycle.

---

## Lifecycle Stages

1. **Stage 0: Project Initialization & Discovery ([`core/project-initialization.md`](core/project-initialization.md))**:
   - State A: If `.ai-engineering-loop/` exists $\rightarrow$ load context, inspect drift, selectively refresh stale sections.
   - State B: If missing $\rightarrow$ automatically discover manifests, infer profile, generate context, and validate quality.
2. **Stage 1: Goal Contract ([`core/goal-contract.md`](core/goal-contract.md))**: Formulate explicit, testable Acceptance Criteria.
3. **Stage 2: Root Cause Analysis**: End-to-end data tracing and git commit history examination.
4. **Stage 3: Implementation Plan**: Structured diff proposal and test plan.
5. **Stage 4: Maker Execution ([`agents/maker.md`](agents/maker.md))**: Surgical implementation and test engineering.
6. **Stage 5: Deterministic Verification ([`core/verification-loop.md`](core/verification-loop.md))**: 100% green pass on tests, typechecks, linters, and builds.
7. **Stage 6: Devil's Advocate Review ([`agents/devil-advocate.md`](agents/devil-advocate.md))**: Layered adversarial critique with concrete alternative diffs.
8. **Stage 7: Judge Evaluation ([`agents/judge.md`](agents/judge.md))**: Impartial evidence evaluation producing `PASS`, `ITERATE`, or `ESCALATE`.
9. **Stage 8: Delivery Pipeline ([`adapters/`](adapters/))**: Automated PR/MR generation, multi-branch propagation, and notification dispatch.

---

## Architecture & 5-Layer Configuration

The system dynamically resolves configuration and review rules through a cascading 5-layer hierarchy:

$$\text{GLOBAL} \longrightarrow \text{ENGINEERING CORE} \longrightarrow \text{PROJECT TYPE PROFILE} \longrightarrow \text{PROJECT CONFIG (`.ai-engineering-loop/`)} \longrightarrow \text{TASK CONTRACT}$$

1. **GLOBAL**: Host execution safety limits and maximum iteration ceilings (`MAX_ITERATIONS <= 5`).
2. **ENGINEERING CORE**: Universal loop invariants ([Goal Contract](core/goal-contract.md), [Verification Loop](core/verification-loop.md), [Definition of Done](core/definition-of-done.md)).
3. **PROJECT TYPE PROFILE ([`profiles/`](profiles/README.md))**: Archetype defaults for web applications, backend APIs, mobile apps, libraries, or monorepos.
4. **PROJECT CONFIGURATION (`<repo>/.ai-engineering-loop/`)**: Target repository ground truth ([`verification.md`](templates/repo-config/verification.md), [`architecture.md`](templates/repo-config/architecture.md), [`conventions.md`](templates/repo-config/conventions.md)).
5. **TASK CONTRACT**: Active task-scoped acceptance criteria and diff constraints.

---

## Project Profiles

Profiles define technology-specific characteristics and activate relevant review domains for the Devil's Advocate without modifying the core engine:

| Profile | Specification | Target Tech Stack | Active Review Focus |
|---|---|---|---|
| **`web-app`** | [web-app.md](profiles/web-app.md) | Next.js, Remix, Vite, React, Vue | DOM rendering, responsiveness (320px–4k), accessibility (a11y/ARIA), client state, Core Web Vitals |
| **`backend-api`** | [backend-api.md](profiles/backend-api.md) | Go, Node.js, Python, Java, PostgreSQL | Auth/IDOR, database transactions & ACID rollbacks, concurrency locks (`SELECT FOR UPDATE`), N+1 query loops |
| **`mobile-app`** | [mobile-app.md](profiles/mobile-app.md) | Flutter, React Native, iOS (Swift), Android (Kotlin) | Offline sync queues, OS lifecycle termination & state loss, permission denials, battery/GPS hygiene |
| **`library`** | [library.md](profiles/library.md) | npm/PyPI packages, SDKs, crates | SemVer public API stability, zero dependency bloat, cross-runtime compatibility, bundle tree-shaking |
| **`monorepo`** | [monorepo.md](profiles/monorepo.md) | Turborepo, Nx, Cargo/pnpm workspaces | Cross-package boundaries, circular dependencies, affected scope testing, workspace cache invalidation |

Profile index: [profiles/README.md](profiles/README.md).

---

## Repository Structure

```text
ai-engineering-loop/
│
├── README.md                           # Operating system overview & architecture
├── LICENSE                             # MIT Open Source License
├── package.json                        # CLI package manifest
│
├── bin/                                # CLI execution entrypoints
│   └── ai-engineering-loop.js          # npx executable CLI (init, status, refresh, run)
│
├── scripts/                            # Shell installers
│   └── init.sh                         # Convenience one-liner installer
│
├── core/                               # Generic engineering loop specifications
│   ├── project-initialization.md       # Auto-discovery & initialization lifecycle
│   ├── context-refresh-policy.md       # Drift detection & selective refresh
│   ├── goal-contract.md                # Task contract schema & acceptance criteria
│   ├── verification-loop.md            # Dual-layer verification lifecycle
│   ├── definition-of-done.md           # 5 pillars of Done & rejection triggers
│   ├── iteration-policy.md             # Bounded autonomous loop (MAX_ITERATIONS = 3)
│   ├── escalation-policy.md            # Deterministic human escalation triggers
│   ├── judge-policy.md                 # Evaluation rules, triage audit, & verdicts
│   ├── configuration-precedence.md     # 5-layer precedence & conflict resolution
│   └── repo-config-schema.md           # Schema for target repo .ai-engineering-loop/
│
├── profiles/                           # Project archetype profiles
│   ├── README.md                       # Profile catalog & auto-detection rules
│   ├── web-app.md                      # Frontend web applications
│   ├── backend-api.md                  # Backend APIs & microservices
│   ├── mobile-app.md                   # Native & cross-platform mobile apps
│   ├── library.md                      # Reusable SDKs & shared packages
│   └── monorepo.md                     # Multi-package monorepo workspaces
│
├── agents/                             # Triad agent role specifications
│   ├── maker.md                        # Maker agent: surgical diffs & unit tests
│   ├── devil-advocate.md               # Adversarial reviewer: layered review rules & concrete diffs
│   └── judge.md                        # Judge agent: neutral magistrate & verdict computation
│
├── policies/                           # Operational schemas & algorithms
│   ├── discovery-safety-policy.md      # Secret protection & non-destructive discovery rules
│   ├── finding-policy.md               # Standardized finding schema & severity matrix
│   ├── evidence-policy.md              # 5-level evidence hierarchy
│   └── no-progress-policy.md           # Finding signature hashing & stagnation detection
│
├── adapters/                           # Pluggable delivery pipelines
│   └── dot/                            # DOT Indonesia delivery adapter
│       ├── README.md                   # DOT adapter overview
│       ├── gitlab.md                   # glab CLI, issue cards, & MR generation
│       ├── multi-branch.md             # main / staging / develop cherry-pick propagation
│       ├── coreview.md                 # @coreview-bot external review triage (Valid vs Halu)
│       └── mattermost.md               # Channel mapping & MCP dispatch (from: "AI Agent")
│
├── templates/                          # Starter templates for target repositories
│   └── repo-config/                    # Ready-to-copy .ai-engineering-loop/ files
│       ├── config.md                   # Project identity & profile binding
│       ├── architecture.md             # Layers & boundary invariants
│       ├── conventions.md              # Code standards & forbidden patterns
│       ├── verification.md             # CLI test/lint/build commands
│       └── adapter.md                  # Configured release pipeline
│
├── examples/                           # End-to-end multi-archetype reference walkthroughs
│   ├── initialization/                 # Unconfigured Monorepo auto-discovery trace
│   ├── dot/attendance-confirmation/    # Scenario A: DOT Web Application bugfix & multi-branch MRs
│   ├── backend-api/payment-idempotency/# Scenario B: Go/PostgreSQL race condition & idempotency fix
│   └── mobile-app/offline-sync-queue/  # Scenario C: Flutter/SQLite offline sync queue
│
└── docs/                               # Meta-documentation & integration guides
    ├── migration-plan.md               # 8-phase legacy workflow mapping & rationale
    └── antigravity-feasibility.md      # Antigravity runtime evaluation & subagent orchestration
```

---

## Reference Examples

- **[Auto-Initialization Trace](examples/initialization/README.md)**: Demonstrates the step-by-step discovery of an unconfigured TypeScript/Go monorepo.
- **[Scenario A: DOT Web Application](examples/dot/attendance-confirmation/README.md)**: Resolves an attendance status bug across `main`, `staging`, and `develop` with `@coreview-bot` triage and Mattermost dispatch.
- **[Scenario B: Backend API Service](examples/backend-api/payment-idempotency/README.md)**: Eliminates double-spend race conditions in Go/PostgreSQL with `SELECT FOR UPDATE` and automated race test suites.
- **[Scenario C: Mobile Application](examples/mobile-app/offline-sync-queue/README.md)**: Implements an offline SQLite mutation queue in Flutter with network flapping tolerance and state preservation.

---

## Contributing

Contributions, feedback, and new adapter profiles are welcome.

1. Fork the repository (`https://github.com/egagofur/ai-engineering-loop/fork`).
2. Create your feature branch (`git checkout -b feature/new-adapter`).
3. Ensure all changes adhere to [core/definition-of-done.md](core/definition-of-done.md).
4. Open a Pull Request.

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">
Designed for software engineering teams and autonomous AI coding agents.
</div>
