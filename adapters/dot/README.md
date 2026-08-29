# DOT Ecosystem Delivery Adapter

## 1. Overview & Architecture

The **DOT Delivery Adapter** connects the generic [AI Engineering Loop](file:///Users/egagofur/Development/work/ai-engineering-loop/README.md) to the specific development infrastructure of **DOT Indonesia**.

The generic engineering loop guarantees that code is correct, verified, and adversarially tested. The DOT adapter is responsible for downstream release engineering, collaboration tools, issue tracking, and multi-environment synchronization.

```mermaid
flowchart TD
    subgraph CoreLoop [Generic AI Engineering Loop]
        PASS([Judge Verdict: PASS])
    end

    subgraph DOTAdapter [DOT Delivery Pipeline]
        PASS --> Issue[1. GitLab Issue Card via glab]
        Issue --> BaseMR[2. Base Merge Request via glab]
        BaseMR --> MultiBranch[3. Multi-Branch Cherry-Pick: staging & develop]
        MultiBranch --> CoreviewTriage[4. External @coreview-bot Review Triage]
        CoreviewTriage --> MattermostDispatch[5. Mattermost Markdown Notification via MCP]
    end
```

---

## 2. Adapter Modules

The DOT adapter is organized into four dedicated specification modules:

1. **[GitLab Integration (`gitlab.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/adapters/dot/gitlab.md)**:
   - CLI automation with `glab`.
   - Standardized issue card templates with actual vs expected tables and QA testing steps.
   - Standardized MR descriptions linking issue IDs and change summaries.
2. **[Multi-Branch Propagation (`multi-branch.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/adapters/dot/multi-branch.md)**:
   - Multi-environment branching model across `main`, `staging`, and `develop`.
   - Clean cherry-picking workflow and target-specific test verification.
3. **[Coreview External Reviewer Triage (`coreview.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/adapters/dot/coreview.md)**:
   - Ingestion of `@coreview-bot` automated PR comments.
   - Mandatory Phase 8 Triage reporting gate before Mattermost dispatch.
   - Rigorous evaluation of bot suggestions into `VALID` (fix & propagate) vs `HALU` (false positive pushback) using principles from `gitlab-mr-feedback` and `receiving-code-review`.
4. **[Mattermost Notifications (`mattermost.md`)](file:///Users/egagofur/Development/work/ai-engineering-loop/adapters/dot/mattermost.md)**:
   - Repository-to-channel resolution using persistent configuration.
   - MCP `mattermost_send_message` dispatch with mandatory `from: "AI Agent"` attribution.
   - Environment-tagged Markdown blocks (`[MR DEV]`, `[MR STAGING]`, `[MR MAIN]`) formatted with strict **`no-ai-slop`** human-written standards.

---

## 3. Official DOT Engineering Skills Integration

This adapter composes the DOT skill suite that Antigravity loads from `~/.gemini/config/skills/` (not from `~/.claude/skills/` and not from this npm package). Claude Code and Grok do not get these skills unless the same files are installed on those hosts.

On a DOT repo (`adapter_type: dot`), **run `ai-engineering-loop`**, not the old 9-phase `dot-dev-workflow`, as the engineering OS. Stage 1 grill **includes** `task-impact-inquiry`. Do not run a second interview. After Judge `PASS`, Stage 8 is `dot-dev-workflow` delivery (GitLab, cherry-pick, Coreview, Mattermost). Canonical copies: `adapters/dot/skills/`. See `core/grill-policy.md`.

| Skill | Primary Role & Governance |
| :--- | :--- |
| **`ai-engineering-loop`** | Engineering OS (Stages 0-7). Use this for DOT bugfix/feature/refactor. |
| **`dot-dev-workflow`** | Stage 8 delivery only after Judge PASS. Not a parallel engineering loop. |
| **`dot-dev-skill-router`** | Routes commit-bound DOT work to `ai-engineering-loop`, then Stage 8. |
| **`task-impact-inquiry`** | Antigravity skill at `~/.gemini/config/skills/task-impact-inquiry/`. Four-pillar blast radius (state, sibling, approval, downstream queues). Fills Stage 1 grill on DOT; then freeze the Goal Contract. |
| **`backend-development`** | Framework-agnostic backend guidelines (clean naming, database queries, security, error handling). |
| **`backend-safety-guardrails`** | 6 architectural backend safety invariants (queue bypass, BigInt, status recalculation loops). |
| **`devils-advocate`** | Legacy DOT pre-commit skill. On AEL, Stages 6-7 are package Devil's Advocate + Judge. Do not re-run this skill after Judge PASS. |
| **`requesting-code-review`** | Optional peer-review dispatch. AEL Judge is the pre-commit gate. |
| **`receiving-code-review`** | Technical rigor in evaluating review feedback without blind compliance. |
| **`gitlab-mr-feedback`** | GitLab API patterns and thread resolution on MR discussions. |
| **`auto-mr-issue`** | Automated issue, MR creation, and Mattermost Markdown formatting. |
| **`no-ai-slop`** | Human-written, crisp, active-voice release notes without AI puffery. |

---

## 4. Separation of Concerns

| Generic Core Responsibility | DOT Adapter Responsibility |
|---|---|
| Goal Contract & Acceptance Criteria | GitLab Issue Card drafting |
| Unit testing, typecheck, lint, build | Running DOT-specific scripts (`npx jest --testPathIgnorePatterns="dotify-api"`) |
| Internal Devil's Advocate Review | External `@coreview-bot` triage on GitLab MRs |
| Judge verdict & completion certificate | Multi-environment cherry-picking & branch synchronization |
| Evidence collection & finding logs | Mattermost channel notifications & MR link delivery |
