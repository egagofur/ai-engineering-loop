# Newcomer sandbox

Runs AEL the way a first-time user meets it: a clean `node:*-slim` container with no git config, no `gh`/`glab` and no agent host. Each scenario is one fresh container.

```bash
scripts/sandbox-e2e.sh                 # pack this working tree, run every scenario
scripts/sandbox-e2e.sh --ref main      # pack a git ref instead
scripts/sandbox-e2e.sh --npm           # install the published package from npm
scripts/sandbox-e2e.sh happy no-git    # only some scenarios
scripts/sandbox-e2e.sh --list
```

Needs Docker, git and npm on the host. The `gh-logged-out` image downloads the `gh` release tarball from GitHub; `registry` and `--npm` need the npm registry. Transcripts and `summary.txt` go to `$AEL_SANDBOX_OUT` (default: a new temp dir).

| Scenario | Image | What it shows |
|---|---|---|
| `happy` | Node + git | README flow: init, status, doctor, run, goal, Maker, verify, review, judge, deliver (DELIVERED) |
| `quick` | Node + git | T0 `quick start` / `quick finish` / deliver |
| `no-git` | Node only | git not installed |
| `non-git-folder` | Node + git | git installed, folder never `git init`ed |
| `no-commit` | Node + git | `git init` but no first commit |
| `no-identity` | Node + git | no `user.name` / `user.email` |
| `gh-missing` | Node + git | GitHub remote, `gh` not installed |
| `gh-logged-out` | Node + git + gh | GitHub remote, `gh` not logged in |
| `cli-errors` | Node + git | typos, missing arguments, Run conflicts |
| `empty-folder` | Node only | bare `ael` in an empty folder |
| `host-stale` | Node + git | `~/.claude` exists, skill never installed |
| `old-node` | Node 16 | below `engines.node` |
| `registry` | Node only | `npm i -g ai-engineering-loop` |

The Devil's Advocate output is a stand-in ledger with no findings (`{"findings":[]}`); no LLM runs.

## Reading the results

- `RESULT PASS|FAIL <check>`: behaviour a newcomer depends on. Any FAIL makes the script exit 1.
- `UX OPEN|FIXED <id>`: known friction from `docs/cards/novice-ux-2026-11-21.md`. OPEN never fails the run. When a fix lands the probe flips to FIXED: turn it into a PASS check in `scenario.sh` and close the card.
