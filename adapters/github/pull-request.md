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

## Steps to Reproduce & Testing (QA)
### Pre-conditions
- <environment / data / permissions>
### Steps to Reproduce
1. <action>
2. <action that triggers the bug or the new path>
### How to Test
1. <same path after the fix, or the feature path>
2. <what QA should click / call / assert>
### Actual Result (before the fix)
- <error / status / log — N/A on a pure feature>
### Expected Result (after the fix)
- <normal behaviour / status>
- <no error popup, no crash, no new error logs>

## Verification
Commands from `.ai-engineering-loop/verification.md` (exit 0).
EOF
)"
```

Link an issue with `Fixes #n` in the body when an issue exists.

Do not paste raw diffs, tokens, or local machine paths.
