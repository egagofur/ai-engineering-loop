# Reference Example: Automatic Project Initialization & Discovery

## 1. Overview & Scenario

This walkthrough demonstrates how the **AI Engineering Loop** automatically initializes an unconfigured full-stack TypeScript and Go monorepo (`acme-platform`) that contains **zero** existing `.ai-engineering-loop/` configuration.

### The Codebase State:
- **Repository**: `acme-corp/acme-platform`
- **Existing Config**: `pnpm-workspace.yaml`, `turbo.json`, `apps/web/package.json` (Next.js), `apps/api/go.mod` (Go/Gin), `packages/ui/`
- **Initial Status**: No `.ai-engineering-loop/` folder present.

---

## 2. Walkthrough Artifacts

1. **[Discovery Execution Trace (`discovery-trace.md`)](./discovery-trace.md)**:
   - Full 5-pass log of directory inspection, manifest parsing, script discovery, architecture tracing, and second-pass quality check.
2. **[Generated Context Artifacts (`generated-context.md`)](./generated-context.md)**:
   - The exact evidence-based `.ai-engineering-loop/` files generated automatically by the agent without user intervention.
