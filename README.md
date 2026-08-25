# AI Engineering Loop 🔄

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/egagofur/ai-engineering-loop/pulls)
[![AI Engineering](https://img.shields.io/badge/AI-Engineering%20Loop-orange.svg)](https://github.com/egagofur/ai-engineering-loop)
[![Release](https://img.shields.io/badge/release-v1.0.0-purple.svg)](https://github.com/egagofur/ai-engineering-loop/releases)
[![Status](https://img.shields.io/badge/status-production--ready-success.svg)](https://github.com/egagofur/ai-engineering-loop)

**A Reusable, Framework-Agnostic AI Engineering Operating System for Autonomous Coding Agents**

*Move beyond linear AI pipelines and optimistic self-evaluation toward contract-driven execution, deterministic proof, and independent adversarial review.*

[Features](#-key-features) • [Architecture](#-architecture) • [Project Profiles](#-project-profiles) • [Quickstart](#-quickstart) • [Repository Structure](#-repository-structure) • [Examples](#-real-world-examples) • [Contributing](#-contributing)

</div>

---

## 🌟 The Paradigm Shift

Traditional AI coding assistants rely on **optimistic self-evaluation**: a single agent analyzes, edits, runs tests, and announces completion. This frequently leads to hallucinated passes, unhandled edge cases, and premature victory claims.

The **AI Engineering Loop** replaces naive linear workflows (`Analyze ──▶ Implement ──▶ Test ──▶ Build ──▶ MR`) with a **rigorous multi-agent engineering lifecycle**:

```mermaid
flowchart TD
    Human([Human Request]) --> GC[Goal Contract: Explicit Acceptance Criteria]
    
    subgraph CoreEngine [AI ENGINEERING OPERATING SYSTEM]
        GC --> MA[Maker Agent: Surgical Diff & Unit Tests]
        MA --> DV{Deterministic Verification}
        
        DV -->|Fail| MA
        DV -->|Pass| DA[Devil's Advocate: Adversarial Review]
        
        DA --> JD[Judge Agent: Impartial Magistrate]
        
        JD -->|ITERATE: Valid Findings| MA
        JD -->|ESCALATE: Stalled / Max Iterations| HE([Human Escalation])
    end
    
    JD -->|PASS: Verified Proof| Adapter[Delivery Adapter: GitLab / GitHub / Release]
    Adapter --> TargetRepo[(Target Repository)]
```

### 🎯 Core Axiom

> **"Do not ask whether the agent thinks the task is finished. Define how the system can prove that the task is finished."**

---

## 🚀 Key Features

- **📑 Goal-Contracted Execution**: Work is bound to explicit Acceptance Criteria (AC-1..N), technical invariants, and out-of-scope boundaries before touching code.
- **🤖 Triad Agent Model**:
  - **[Maker Agent](agents/maker.md)**: Deep data-flow analysis, surgical diffs, and comprehensive test authoring.
  - **[Devil's Advocate Agent](agents/devil-advocate.md)**: Independent adversary evaluating correctness, security, concurrency, performance, and testing gaps.
  - **[Judge Agent](agents/judge.md)**: Impartial magistrate with sole authority to issue `PASS`, `ITERATE`, or `ESCALATE` verdicts.
- **⚡ Deterministic Precedence**: Machine-checkable tests, typechecks (`tsc`), linters, and builds are non-negotiable prerequisites.
- **🛡️ Bounded Iteration & Stagnation Detection**: Enforces `MAX_ITERATIONS = 3` and detects recurring finding signatures to prevent thrashing.
- **🌐 5-Layer Configuration Precedence**: Seamlessly adapts across multiple repositories without a central database monolith.
- **🔌 Decoupled Delivery Adapters**: Generic core is isolated from GitLab, GitHub, Jira, `@coreview-bot`, Mattermost, or Slack.

---

## 🏗️ 5-Layer Configuration Hierarchy

The engine dynamically resolves context using a cascading 5-layer precedence model:

$$\text{GLOBAL} \longrightarrow \text{ENGINEERING CORE} \longrightarrow \text{PROJECT TYPE PROFILE} \longrightarrow \text{PROJECT CONFIG (`.ai-engineering-loop/`)} \longrightarrow \text{TASK CONTRACT}$$

1. **GLOBAL**: Host safety boundaries, maximum iteration ceilings (`MAX_ITERATIONS <= 5`).
2. **ENGINEERING CORE**: Universal loop invariants ([Goal Contract](core/goal-contract.md), [Verification Loop](core/verification-loop.md), [Definition of Done](core/definition-of-done.md)).
3. **PROJECT TYPE PROFILE ([`profiles/`](profiles/README.md))**: Archetype defaults for web, backend, mobile, library, or monorepo.
4. **PROJECT CONFIGURATION (`<repo>/.ai-engineering-loop/`)**: Target repository facts ([`verification.md`](templates/repo-config/verification.md), [`architecture.md`](templates/repo-config/architecture.md), [`conventions.md`](templates/repo-config/conventions.md)).
5. **TASK CONTRACT**: Active task-scoped acceptance criteria and diff constraints.

---

## 📦 Project Profiles

| Profile | Spec | Archetype | Active Review Focus |
|---|---|---|---|
| **`web-app`** | [web-app.md](profiles/web-app.md) | Next.js, Remix, Vite, React, Vue | DOM rendering, responsiveness (320px–4k), accessibility (a11y/ARIA), client state, Core Web Vitals |
| **`backend-api`** | [backend-api.md](profiles/backend-api.md) | Go, Node.js, Python, Java, PostgreSQL | Auth/IDOR, database transactions & ACID rollbacks, concurrency locks (`SELECT FOR UPDATE`), N+1 query loops |
| **`mobile-app`** | [mobile-app.md](profiles/mobile-app.md) | Flutter, React Native, iOS (Swift), Android (Kotlin) | Offline sync queues, OS lifecycle termination & state loss, permission denials, battery/GPS hygiene |
| **`library`** | [library.md](profiles/library.md) | npm/PyPI packages, SDKs, crates | SemVer public API stability, zero dependency bloat, cross-runtime compatibility, bundle tree-shaking |
| **`monorepo`** | [monorepo.md](profiles/monorepo.md) | Turborepo, Nx, Cargo/pnpm workspaces | Cross-package boundaries, circular dependencies, affected scope testing, workspace cache invalidation |

---

## 📂 Repository Structure

```text
ai-engineering-loop/
│
├── README.md                           # Operating system overview & architecture
├── LICENSE                             # MIT Open Source License
│
├── core/                               # Generic engineering loop specifications
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
│   ├── dot/attendance-confirmation/    # Scenario A: DOT Web Application bugfix & multi-branch MRs
│   ├── backend-api/payment-idempotency/# Scenario B: Go/PostgreSQL race condition & idempotency fix
│   └── mobile-app/offline-sync-queue/  # Scenario C: Flutter/SQLite offline sync queue
│
└── docs/                               # Meta-documentation & integration guides
    ├── migration-plan.md               # 8-phase legacy workflow mapping & rationale
    └── antigravity-feasibility.md      # Antigravity runtime evaluation & subagent orchestration
```

---

## ⚡ Quickstart

### Step 1: Add Configuration to Your Repository (Optional but Recommended)
Copy the starter templates into your repository's `.ai-engineering-loop/` directory:

```bash
mkdir -p .ai-engineering-loop
# Copy templates from templates/repo-config/ into your project:
# config.md, architecture.md, conventions.md, verification.md, adapter.md
```

### Step 2: Formulate the Goal Contract
Before editing code, define a [Goal Contract](core/goal-contract.md) with numbered Acceptance Criteria.

### Step 3: Run the Engineering Loop
1. **Maker**: Write surgical changes and tests.
2. **Verification**: Execute deterministic gates (`test`, `typecheck`, `lint`, `build`).
3. **Devil's Advocate**: Review the diff against active profile rules.
4. **Judge**: Obtain formal `PASS`, `ITERATE`, or `ESCALATE` evaluation.

---

## 💡 Real-World Examples

- **[Scenario A: DOT Web Application](examples/dot/attendance-confirmation/README.md)**: Resolves complex attendance status bug across `main`, `staging`, and `develop` with `@coreview-bot` triage and Mattermost dispatch.
- **[Scenario B: Backend API Service](examples/backend-api/payment-idempotency/README.md)**: Eliminates double-spend race condition in Go/PostgreSQL with `SELECT FOR UPDATE` and automated race tests.
- **[Scenario C: Mobile Application](examples/mobile-app/offline-sync-queue/README.md)**: Implements offline SQLite mutation queue in Flutter with network flapping tolerance.

---

## 🤝 Contributing

Contributions, feedback, and new adapter profiles are warmly welcome!
1. Fork the repository (`https://github.com/egagofur/ai-engineering-loop/fork`).
2. Create your feature branch (`git checkout -b feature/new-adapter`).
3. Ensure all changes adhere to [core/definition-of-done.md](core/definition-of-done.md).
4. Open a Pull Request.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">
Built with ❤️ to empower engineers and autonomous AI agents everywhere.
</div>
