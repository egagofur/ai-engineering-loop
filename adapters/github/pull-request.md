# GitHub pull request

```bash
gh pr create \
  --title "<type>(<scope>): <summary>" \
  --body "$(cat <<'EOF'
## Goal Contract
`.ai-engineering-loop/tasks/goal-contract.md` (or the path this repo uses)

## What changed
- <root cause or behaviour>
- <edge cases>
- <tests added>

## Verification
Commands from `.ai-engineering-loop/verification.md` (exit 0).
EOF
)"
```

Link an issue with `Fixes #n` in the body when an issue exists.

Do not paste raw diffs, tokens, or local machine paths.
