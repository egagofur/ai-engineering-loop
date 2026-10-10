# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/). Entries under **Unreleased** ship with the next version bump.

## Unreleased

### P0 — slim context and round-trips without weakening gates (#26)

- **Fixed (#25):** `--help` / `-h` on any command prints that command's usage and exits without side effects. `sync-hosts --help` no longer runs a real sync. Writer commands (`init`, `refresh`, `sync-hosts`, `update`, `generate-adapter`, `generate-workflow`) reject unknown flags with exit code 2 before writing anything.
- **Fixed (#25):** `sync-hosts` records what it wrote in `~/.ai-engineering-loop/host-manifest.json`. A host file that was edited by hand (or that predates the manifest) is copied to `<file>.ael-backup` before it is overwritten.
- **Changed (#27):** Host skills no longer tell agents to read all of `core/`, `agents/`, and `policies/` (files that do not exist in target repositories). New read-only `ai-engineering-loop docs <name> [--section <heading>]` prints one packaged spec, and skills cite specs only at the stage that needs them.
- **Changed (#28):** Devil's Advocate / Judge budgets live in the agent bodies. Parent skills keep only the one-line spawn prompt (needed when a host falls back to a `general-purpose` child); the Claude command no longer repeats them.
- **Changed (#29):** When the host exposes no provider usage, `budget record --unavailable` notes the gap once. `ASSISTED` continues and discloses it at delivery instead of asking the human; `UNATTENDED` fails closed with `USAGE_UNAVAILABLE_UNATTENDED`. `budget status` runs once per iteration instead of before every child.
- **Changed (#30):** `run` no longer syncs host skills, and Stage 0 no longer calls `sync-hosts`. `status` / new `status --json` report `hostSkills` freshness (`installedVersion`, `packageVersion`, `stale`, `staleFiles`) without writing.
- **Changed (#31):** `sync-hosts` installs only the `core` pack by default. `--pack backend,design` opts in (saved in `~/.ai-engineering-loop/config.json`); `--prune` removes unmodified files of unselected packs. Existing installs keep any optional pack already on disk.
- **Fixed (#32):** `dot-dev-skill-router` names only skills that exist in AEL or dot-plugin (`verification-before-completion`, `design-openapi-contract`, `generate-api-test`, ...) or are explicitly marked *optional, if installed*. Plan-execution and brainstorming routes now go through the AEL loop instead of around it.
