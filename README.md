<div align="center">

# AI Engineering Loop

### From idea to trusted code—without babysitting every command.

Give your AI agent a goal. It plans the work, builds it, checks itself, challenges the result, and prepares a safe delivery. You get a visual workflow and a clear history instead of a wall of terminal output.

[![npm](https://img.shields.io/npm/v/ai-engineering-loop?style=flat-square&color=28AD00)](https://www.npmjs.com/package/ai-engineering-loop)
[![GitHub release](https://img.shields.io/github/v/release/egagofur/ai-engineering-loop?style=flat-square&color=28AD00)](https://github.com/egagofur/ai-engineering-loop/releases)
[![license](https://img.shields.io/badge/license-MIT-181c19?style=flat-square)](LICENSE)

[Get started](#get-started-in-a-minute) · [See what it does](#one-workspace-from-idea-to-delivery) · [Open Workflow Studio](#meet-workflow-studio) · [Read the docs](core/)

</div>

[![AI Engineering Loop Workflow Studio](docs/images/studio-hero.svg)](docs/images/studio-hero.svg)

## Software delivery that feels simple

AI coding tools are fast, but important details can disappear between the prompt, the code, and the final answer. AI Engineering Loop gives every task one calm, repeatable path:

| You want | The Loop handles |
|---|---|
| **A clear outcome** | Turns the request into an agreed Goal before code changes |
| **Less supervision** | Guides your agent through planning, building, and checking |
| **Honest progress** | Shows what is ready, running, blocked, or waiting for approval |
| **Fewer surprises** | Tests happy paths, edge cases, and failure cases |
| **A trustworthy result** | Compares every claim with real evidence before delivery |
| **A useful history** | Keeps searchable Runs, decisions, artifacts, and proof |

You stay in control of the product decisions. Your AI agent takes care of the repetitive engineering ceremony.

## Get started in a minute

Install it in any project:

```bash
npx ai-engineering-loop init
```

Then tell your coding agent:

> Use AI Engineering Loop to build this feature: **your idea here**

That is the intended experience. You do not need to memorize the internal commands—the agent can operate the loop for you.

Want the visual workspace?

```bash
npx ai-engineering-loop studio
```

Workflow Studio opens locally in your browser. Your project and run evidence stay on your machine.

On first setup, `.ai-engineering-loop/` is added to your project’s `.gitignore` so plans and Run evidence stay private by default. Want to share that context with your team? Simply remove that line from `.gitignore`.

### Less artifact guesswork for your AI agent

Agents can record test commands directly so verification evidence is tied to the current Run and gated diff:

```bash
npx ai-engineering-loop verification record --run <run-id> -- npm test
```

The command captures bounded, redacted output without invoking a shell implicitly, records failures honestly, and generates a compact test summary. For other stage artifacts, use `scaffold delivery --run <run-id>` (or `verification` / `findings`) to create a private, deliberately incomplete template. Copy or rename it to the gate's real artifact filename, fill it with observed evidence, and remove `_templateOnly`; then `validate <repository-relative-file>` reports schema and Run-binding issues without advancing a gate. Templates are never accepted as evidence. `context claimed-vs-reality --run <run-id>` creates the Goal checklist while leaving claim and evidence cells blank.

Common stage sequences also have one-call forms that gate exactly like the long forms:

```bash
npx ai-engineering-loop verify --run <run-id> --cmd "npm test"          # record (parallel), gate, compact, claimed-vs-reality
npx ai-engineering-loop review-pack --run <run-id> --json               # fast-path + diff-hunk pack + escalation floor
npx ai-engineering-loop deliver --run <run-id> --destination pr --summary "..." --approve --by <name>
```

`deliver` refuses without `--approve` in ASSISTED mode; pass it only after a human approved delivery.

Contributors: the host `ai-engineering-loop` skills are generated. Edit `skill-src/ai-engineering-loop/`, then run `npm run build:skills` (CI checks for drift with `npm run check:skills`). `npm run measure` reports per-tier context and tool calls.

### Staying up to date

`run`, `status`, `init`, and `refresh` check npm in the background at most once a day; the command never waits. What happens next depends on your policy:

```bash
npx ai-engineering-loop update policy minor   # off | notify | patch | minor | all (majors are always notice-only)
npx ai-engineering-loop projects list         # projects refreshed after an update (scan: projects scan --root ~/Development)
npx ai-engineering-loop update rollback --yes
```

Global installs apply patch and minor releases automatically. They then re-sync host skills and refresh every registered project, keeping your edits (new templates arrive as `*.ael-new`). Project installs only show a short notice (current -> latest, a few changelog highlights, the exact `npm`/`pnpm`/`yarn`/`bun` command, how to silence it), at most once a day per project, because AEL never edits your `package.json`. Projects from versions before hash tracking are overwritten on their first update, with the old files kept in `.ai-engineering-loop/.ael-backup/` and restored by `update rollback`. Major updates run `migrate --from <old>` after install. Opt out with `AEL_NO_AUTO_UPDATE=1`; CI is always off. There is no daemon, so other machines pick up an update the next time the CLI runs there.

When context packs exceed their budget, the CLI now reports the limit and a per-file size/token estimate so an agent can choose smaller files without trial and error. For a delivery gate blocked by a recipe approval node, inspect `node status --run <run-id>` and explicitly approve the READY prerequisite; the gate error points to the actionable command.

## Meet Workflow Studio

Workflow Studio makes agent work feel like a product, not a terminal session.

### Build workflows visually

- Connect steps on an open canvas
- Add the next step directly from any node
- Rename nodes in place without breaking their identity
- Select, move, duplicate, or delete groups of nodes
- Turn selected steps into independent Loop Groups
- Label repeat and continue paths in plain language
- Import and export workflow JSON safely
- Create your own prompt-powered Agent nodes

### Start with a Goal—not a vague prompt

Write the task in plain language, add the outcomes that matter, and **Freeze** the Goal when it is ready. The agent cannot quietly move the finish line after work begins.

### Follow every Run

Runs have human-friendly names instead of cryptic hashes. Search previous work, open any Run as a read-only workflow, and see exactly where it stopped.

Select a node to inspect its real **Input**, **Output**, **Evidence**, and timeline. The canvas shows the actual status of every step, so completed work, failures, approvals, and waiting nodes are easy to understand.

### Continue with your AI agent

Use **Copy for AI Agent** to create a ready-to-use handoff for the selected Run. The agent continues with the same Goal, workflow, and evidence instead of starting from scratch.

If the agent needs clarification, its questions can appear inside Workflow Studio. You answer them there, and the answer stays attached to the Run.

### Repeat only the steps that need another pass

Create multiple independent Loop Groups in one workflow:

- Select the steps that belong together
- Choose where the loop starts and where the decision happens
- Give repeat and continue paths clear labels such as `NO · RETRY` and `YES · CONTINUE`
- Set a maximum number of passes
- Follow a separate `Iteration 2 / 3` counter for each group

When a loop reaches its limit, Workflow Studio pauses for approval. You can allow one focused extra pass, continue with the current evidence, or stop the Run safely. Nested and overlapping loops stay disabled so the workflow remains easy to read.

### Execute with confidence

The Execute button lives beside the workflow trigger. A Run starts only when the Goal, workflow, mode, and safety checks are ready.

> **New in v1.9.0:** Run Checkout, AI Agent handoff, live Run questions, and Multiple Loop Groups. [See the release](https://github.com/egagofur/ai-engineering-loop/releases/tag/v1.9.0).

## One workspace from idea to delivery

The experience is organized into four simple moments:

1. **Specify** — agree on what success and failure look like.
2. **Make** — let the agent investigate, plan, and build.
3. **Review** — verify the result and challenge unsupported claims.
4. **Deliver** — ask for human approval before publishing.

Under the hood, these moments use eight evidence-backed stages. The rigor is there when you need it, but it does not have to dominate the experience.

`Specify (stages 0-1)` → `Make (stages 2-4)` → `Review (stages 5-7)` → `Deliver (stage 8)`

## Bring your own AI agent

AI Engineering Loop is designed to work with the tools developers already use:

- **Claude Code**
- **Grok CLI**
- **Gemini / Antigravity**
- Other agent hosts that can read project instructions and run local commands

The project includes ready-to-use skills and reviewer roles for supported hosts. Each host follows the same Goal, verification, review, and approval rules.

`sync-hosts` installs the **core** pack by default: the `ai-engineering-loop` skill, Devil's Advocate and Judge agents, commands, and the small helper skills the loop itself uses. Optional packs stay out of every session's skill index until you ask for them:

```bash
npx ai-engineering-loop sync-hosts --pack backend         # framework-agnostic backend best practices
npx ai-engineering-loop sync-hosts --pack backend,design  # plus Emil Kowalski's MIT-licensed design/animation skills
npx ai-engineering-loop sync-hosts --pack quality         # ael-code-simplifier + ael-receiving-code-review (opt-in)
npx ai-engineering-loop sync-hosts --pack core --prune    # drop unmodified optional-pack files again
```

The choice is saved in `~/.ai-engineering-loop/config.json` and reused by later syncs. Existing installs keep any optional pack that is already on disk. Host files you edited by hand are backed up to `<file>.ael-backup` before they are overwritten, and `--help` or an unknown flag never writes anything.

Runs do not touch your home directory: `run` no longer syncs hosts. `status` (and `status --json`) reports when host skills are behind the package so you can sync and start a new session.

Specs such as the grill, TDD, and runtime-safety policies ship inside the package. Agents read only the one they need with `npx ai-engineering-loop docs <name> [--section <heading>]`.

## Create workflows that fit your team

Start from a built-in workflow or make your own:

- Product feature
- Bug fix
- Security review
- Repository audit
- Refactor
- Custom prompt-powered Agent workflow

Custom Agents can reference approved capabilities, MCP connections, input artifacts, and output formats. They do not receive hidden shell, filesystem, network, or secret access.

## Safety without the scary dashboard

The Loop keeps a few promises:

- **Nothing ships only because an AI says “done.”**
- **Goals are frozen before implementation.**
- **Verification records the real command and result.**
- **A Devil’s Advocate challenges the work before the Judge decides.**
- **Sensitive context is bounded and redacted.**
- **Publishing in assisted mode needs human approval.**
- **The browser never silently runs arbitrary shell commands.**

Choose the level of autonomy that feels right:

| Mode | Best for |
|---|---|
| **Report only** | Explore a codebase without changing it |
| **Assisted** | Everyday work with human approval before delivery |
| **Unattended** | Trusted automation with stricter isolation and limits |

Assisted mode is the default. Unattended mode stays off until you deliberately enable it.

Token-heavy hosts are protected by a lean review profile by default. Lean mode keeps the same Goal, verification, Devil’s Advocate, Judge, and delivery gates, but sends smaller context packs and asks reviewers for compact, finding-first output instead of long audit prose. Upgrade only when the task needs it:

```bash
npx ai-engineering-loop policy set --review-profile standard
npx ai-engineering-loop policy set --review-profile thorough
```

Smart context keeps review path-first instead of transcript-heavy. It can build a private source summary index and a hunk-only diff pack that includes unresolved findings, so reviewers start from changed hunks and open full files only when necessary:

```bash
npx ai-engineering-loop context index
npx ai-engineering-loop context query createStudioRun
npx ai-engineering-loop context related lib/studio-server.js
npx ai-engineering-loop context fast-path --json
npx ai-engineering-loop context diff-hunks --run <run-id>
npx ai-engineering-loop context diff-hunks --run <run-id> --include-ignored
npx ai-engineering-loop verification summarize --run <run-id>
npx ai-engineering-loop context compact --run <run-id>
```

By default, smart context skips high-volume review inputs such as CSS, generated bundles, lockfiles, build output, and paths listed in `.aelcontextignore`. Use `--include-ignored` when the task is explicitly about those files.

## For people who want the controls

The friendly workflow sits on top of a complete local CLI. You can inspect recipes, budgets, evidence, nodes, gates, policies, and handoffs whenever you need to.

<details>
<summary><strong>Show common CLI commands</strong></summary>

```bash
# Project setup and health
npx ai-engineering-loop init
npx ai-engineering-loop status
npx ai-engineering-loop doctor
npx ai-engineering-loop update check
npx ai-engineering-loop update plan
npx ai-engineering-loop update apply --yes

# Start work
npx ai-engineering-loop run "describe the task"
npx ai-engineering-loop studio

# Explore workflows
npx ai-engineering-loop recipe list
npx ai-engineering-loop recipe simulate default --mode assisted

# Inspect the active Run
npx ai-engineering-loop state --json
npx ai-engineering-loop node status
npx ai-engineering-loop budget status --run <run-id>

# Token profile
npx ai-engineering-loop policy set --review-profile lean
npx ai-engineering-loop context diff-hunks --run <run-id>
npx ai-engineering-loop verification summarize --run <run-id>
npx ai-engineering-loop context devil-advocate --profile thorough <files...>

# Emergency stop and resume
npx ai-engineering-loop budget pause
npx ai-engineering-loop budget resume
```

See the [`core/`](core/) documentation for the full runtime, evidence, recipe, security, and adapter contracts.

</details>

## Works locally, delivers anywhere

Your living project context and Run evidence are stored under `.ai-engineering-loop/` and kept out of normal commits by default. You can remove its `.gitignore` entry whenever you want to share that context. Delivery adapters support:

- Standard Git
- GitHub
- GitLab
- Custom team workflows

The same engineering flow stays consistent even when teams use different delivery tools.

## Why open source?

The rules that decide whether AI-generated work is trustworthy should be inspectable. AI Engineering Loop keeps its schemas, safety policies, verification logic, recipes, and agent prompts in the repository.

No hidden cloud control plane is required. No project source is uploaded by Workflow Studio.

## Documentation

- [Workflow Studio](core/local-workflow-studio.md)
- [Workflow recipes](core/workflow-recipes.md)
- [Runtime safety](core/runtime-safety.md)
- [Verification](core/verification-loop.md)
- [Controlled workflow runtime](core/controlled-workflow-runtime.md)
- [Security](SECURITY.md)
- [Support](SUPPORT.md)

## Contributing

Ideas, workflow recipes, bug reports, and pull requests are welcome. Start with an issue or open a focused PR with a clear explanation of the user outcome.

```bash
npm test
npm run doctor
```

## License

MIT © [Ega Gofur](https://github.com/egagofur)

<div align="center">

**Let the agent handle the process. Keep your attention on the product.**

</div>
