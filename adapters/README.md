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

`init`, `generate-adapter` and Studio share one detector (`lib/adapter-detect.js`):

1. The `origin` remote host (or the first remote; worktrees work): the DOT GitLab host → `dot`, `github.com` → `github`, other GitLab hosts → `gitlab`.
2. If the remote says nothing: `.github/workflows/` → `github`, `.gitlab-ci.yml` → `gitlab`.
3. Otherwise `standard`.

Each prints the reason it chose a type.

## Check

`npx ai-engineering-loop doctor` in a project checks the adapter:

| Check | Level | Meaning |
|---|---|---|
| `adapter-type` | error | `adapter_type` is not `standard`, `github`, `gitlab`, `dot` or `custom` (suggests the nearest) |
| `adapter-spec` | error | `adapters/<type>/README.md` (or `.ai-engineering-loop/adapter/delivery.md` for `custom`) is missing |
| `adapter-auth` | warn | `github` needs `gh auth status`; `gitlab` needs `glab auth status`; `dot` needs `glab auth status --hostname <DOT host>` |
| `adapter-detected` | warn | configured type differs from the detector |
| `adapter-config` | warn | no `.ai-engineering-loop/adapter.md` |

`deliver` runs the same checks first. UNATTENDED stops on any of them except `adapter-detected`, before writing anything. ASSISTED prints them and continues.

Pick one with `npx ai-engineering-loop generate-adapter`. The agent **asks** (grill). Do not copy a neighbour's adapter.

Custom tools (Linear, Slack, Bitbucket): still start from `standard`, then name those tools in `.ai-engineering-loop/adapter.md`. Do not put secrets in the file.

## Generate

```bash
npx ai-engineering-loop generate-adapter
npx ai-engineering-loop generate-adapter --type github
```

Interactive path: load skill `generate-adapter`, answer Q1–Q5, then the agent writes `.ai-engineering-loop/adapter.md`.

Loop overlay (not a forge type): skill `generate-workflow` writes `.ai-engineering-loop/workflow.md` and `lessons.md`. It does not replace Stages 0–7.
