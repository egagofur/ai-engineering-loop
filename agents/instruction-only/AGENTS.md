<!-- Generated from skill-src/ by npm run build:skills; do not edit. -->
# AI Engineering Loop (digest)

For hosts with no subagent tool (certification `instruction-only`). Full skill: `~/.agents/skills/ai-engineering-loop/SKILL.md` after `sync-hosts`. Stage details: `npx ai-engineering-loop docs loop-<goal|maker|verify|review|deliver>`.

Loop: Specify (0-1), Make (2-4), Review (5-7), Deliver (8). You are Maker. Devil's Advocate (DA) and Judge run in this session as `CONTEXT_ISOLATION_ONLY`, with the same budgets; never claim independent review.

1. `npx ai-engineering-loop run --json` gives runId, tier, budget. Read `.ai-engineering-loop/glossary.md`.
2. Goal Contract: AC is a failure table (happy, empty, boundary, error). Only after the human freezes: `goal freeze --latest --run <runId> --by human`. Chat agreement is not freeze.
3. Maker: one red test per AC row before the fix, then `gate maker`.
4. `verify --cmd <test command>`, then write claimed-vs-reality.md.
5. DA: re-read only the diff, Goal, and evidence; log findings; `gate review`. Judge: write the verdict from the evidence, then `gate judge`. ITERATE at most 3 times.
6. Deliver per `.ai-engineering-loop/adapter.md`. ASSISTED: `deliver --approve --by <human>` only after the human says so.

Never: edit `state.json`/`current.json`, skip a gate, infer approval, invent usage counts, or put secrets in messages. A gate failure overrides prose.

Report header:

```
Execution Mode: CONTEXT_ISOLATION_ONLY
Independent LLM Execution: NOT PROVEN
Native Subagent Invocation: UNAVAILABLE
Review Method: Clean-Slate Artifact Isolation Barrier
```
