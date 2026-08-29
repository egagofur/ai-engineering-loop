# Architecture Decision Records

Hard decisions that would otherwise live only in chat. Write one ADR when Stage 1 grill settles a choice that future agents must not re-litigate.

## When to write

- Two viable designs were on the table and one was chosen
- A boundary, schema, or public seam is now load-bearing
- The Goal Contract's Technical Constraints need a durable why

Do not write an ADR for a typo fix, a local rename, or a test-only change.

## File name

`NNN-short-kebab-title.md` in this directory. Increment `NNN`.

## Template

```markdown
# ADR NNN: <title>

## Status
Accepted | Superseded by ADR NNN

## Context
What forced a choice.

## Decision
What we chose, in glossary terms.

## Consequences
What becomes easier, harder, or forbidden.
```
