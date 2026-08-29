# GitLab merge request

```bash
glab mr create \
  --source-branch <branch-name> \
  --target-branch <default-branch> \
  --title "<type>(<scope>): <summary>" \
  --description "$(cat <<'EOF'
## Goal Contract
`.ai-engineering-loop/tasks/goal-contract.md` (or the path this repo uses)

## What changed
- <root cause or behaviour>
- <edge cases>
- <tests added>

## Verification
Commands from `.ai-engineering-loop/verification.md` (exit 0).
EOF
)" \
  --yes
```

Link the issue URL in the description when an issue exists.

Do not paste raw diffs, tokens, or local machine paths.
