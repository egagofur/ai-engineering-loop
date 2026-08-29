# Delivery adapters

Stages 0–7 are the same on every host. **Stage 8 is the only place that knows your forge.**

An adapter is not a second engineering OS. It runs **after Judge `PASS`**. It must not start Maker, amend the Goal Contract, or skip Devil's Advocate.

## Shipped types

| Type | Use when | Spec |
|---|---|---|
| **`standard`** | Default. Any git repo. No company tools assumed. | [`standard/`](standard/) |
| **`github`** | `github.com` remote, `gh` CLI | [`github/`](github/) |
| **`gitlab`** | GitLab.com or self-hosted GitLab (not DOT) | [`gitlab/`](gitlab/) |
| **`dot`** | DOT delivery (GitLab + multi-branch + Coreview + Mattermost) | [`dot/`](dot/) |

Pick one with `npx ai-engineering-loop generate-adapter`. The agent **asks** (grill). Do not copy a neighbour's adapter.

Custom tools (Linear, Slack, Bitbucket): still start from `standard`, then name those tools in `.ai-engineering-loop/adapter.md`. Do not put secrets in the file.

## Generate

```bash
npx ai-engineering-loop generate-adapter
npx ai-engineering-loop generate-adapter --type github
```

Interactive path: load skill `generate-adapter`, answer Q1–Q5, then the agent writes `.ai-engineering-loop/adapter.md`.

Loop overlay (not a forge type): skill `generate-workflow` writes `.ai-engineering-loop/workflow.md` and `lessons.md`. It does not replace Stages 0–7.
