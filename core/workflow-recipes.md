# Declarative Workflow Recipes

Workflow recipes describe a directed acyclic graph of engineering stages in JSON. They are an additive authoring layer over the existing AI Engineering Loop: `recipe` commands provide deterministic validation and inspection, while `run --recipe` opts into the controlled runtime. Runs without a recipe keep their established behavior.

This separation is deliberate. A visual editor or an AI agent may eventually author the JSON, but the compiler—not the authoring interface—owns safety invariants.

## Sources and precedence

Recipes are loaded from two locations:

1. Package presets in `recipes/*.json`
2. Project recipes in `.ai-engineering-loop/recipes/*.json`

Built-in IDs are reserved and cannot be shadowed by a project file. Recipe IDs and node IDs use lowercase letters, numbers, and hyphens. Recipe files and the project recipe directory must be regular filesystem entries; symlinks are rejected.

The package includes:

| Recipe | Purpose | Modes |
| --- | --- | --- |
| `default` | Existing production safety loop | `ASSISTED`, `UNATTENDED` |
| `audit` | Read-only structured analysis | `REPORT_ONLY` |
| `bugfix` | Root-cause-first repair | `ASSISTED`, `UNATTENDED` |
| `docs-light` | Bounded documentation change | `ASSISTED`, `UNATTENDED` |
| `high-risk` | Blast-radius analysis and pre-mutation approval | `ASSISTED`, `UNATTENDED` |
| `refactor` | Behavior-baseline-first refactor | `ASSISTED`, `UNATTENDED` |

## Safety backbone

The graph compiler fails closed.

- `REPORT_ONLY` requires `goal-contract → ... → report` and rejects every mutation or remote-side-effect node.
- `ASSISTED` and `UNATTENDED` require the ordered backbone `goal-contract → maker → verification → devil-advocate → judge → delivery`.
- `ASSISTED` additionally requires human approval after Judge and before delivery.
- Required safety nodes cannot be conditional.
- `report` and `delivery` are graph terminals. Every node must lead to one terminal.
- Cycles, duplicate singleton safety nodes, missing dependencies, unknown node types, and incompatible modes are invalid.

Dependencies may include additional nodes between required stages. A custom analysis node before `maker`, for example, does not weaken the mandatory backbone.

## Node catalog

| Type | Intended use | Model | Repository mutation | Remote side effect |
| --- | --- | ---: | ---: | ---: |
| `goal-contract` | Acceptance contract | No | No | No |
| `agent` | Bounded structured analysis | Yes | No | No |
| `command` | Trusted repository executable | No | No | No |
| `condition` | Structured branch predicate | No | No | No |
| `approval` | Human checkpoint | No | No | No |
| `artifact-check` | Deterministic artifact assertion | No | No | No |
| `maker` | Implementation | Yes | Yes | No |
| `verification` | Evidence collection | No | No | No |
| `devil-advocate` | Adversarial review | Yes | No | No |
| `judge` | Independent verdict | Yes | No | No |
| `report` | Read-only terminal | No | No | No |
| `delivery` | Delivery terminal | No | No | Yes |

An `agent` node must declare a role, bounded `maxFiles` and `maxTokens`, and a repository-relative output schema. A `command` node must use a bare executable name, an argument array, a bounded timeout, and expected exit codes. Shells and general-purpose interpreters are rejected; command nodes are for trusted repository tools, not arbitrary script text.

## Authoring example

Project recipe:

```json
{
  "schemaVersion": 1,
  "id": "api-bugfix",
  "version": 1,
  "description": "Analyze an API regression before entering the standard repair loop.",
  "compatibleModes": ["ASSISTED"],
  "nodes": [
    { "id": "goal", "type": "goal-contract" },
    {
      "id": "api-analysis",
      "type": "agent",
      "dependsOn": ["goal"],
      "role": "api-regression-analyst",
      "context": { "maxFiles": 25, "maxTokens": 8000 },
      "output": {
        "artifact": "api-analysis",
        "schema": "schemas/report.schema.json"
      }
    },
    { "id": "maker", "type": "maker", "dependsOn": ["api-analysis"] },
    { "id": "verification", "type": "verification", "dependsOn": ["maker"] },
    { "id": "review", "type": "devil-advocate", "dependsOn": ["verification"] },
    { "id": "judge", "type": "judge", "dependsOn": ["review"] },
    {
      "id": "approval",
      "type": "approval",
      "dependsOn": ["judge"],
      "message": "Approve delivery."
    },
    { "id": "delivery", "type": "delivery", "dependsOn": ["approval"] }
  ]
}
```

Validate and inspect it:

```bash
ai-engineering-loop recipe validate api-bugfix --mode assisted
ai-engineering-loop recipe explain api-bugfix --mode assisted
ai-engineering-loop recipe graph api-bugfix --mode assisted
ai-engineering-loop recipe simulate api-bugfix --mode assisted
```

`simulate` compiles the graph and reports capability counts. It never calls a model, mutates the repository, executes a command, or performs delivery.

## AI-assisted authoring protocol

Until a visual editor exists, an AI agent can safely act as the recipe builder:

1. Ask the user for the outcome, allowed run modes, required checkpoints, context limits, and delivery risk.
2. Start from the closest built-in preset rather than a blank graph.
3. Add only nodes that change the workflow meaningfully.
4. Write the candidate to `.ai-engineering-loop/recipes/<id>.json`.
5. Run `recipe validate`, `recipe explain`, `recipe graph`, and `recipe simulate`.
6. Present the explanation, graph hash, warnings, and capability counts for human confirmation.
7. Do not claim execution from validation or simulation. Execution is proven only by a recipe-bound run and its validated event chain.

Machine consumers should use `--json`. The compiled plan includes a canonical source hash and graph hash so execution and audit logs bind to the exact graph reviewed by the user. Runtime behavior is specified in `core/controlled-workflow-runtime.md`.

## Schemas

- `schemas/recipe.schema.json`: top-level authoring document
- `schemas/node-definition.schema.json`: node shape and type catalog
- `schemas/compiled-plan.schema.json`: deterministic compiler output

Semantic safety checks are stricter than JSON Schema and are enforced by `recipe validate` and the compiler.
