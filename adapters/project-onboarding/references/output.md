# Onboarding output template

## architecture.md (sections owned by project-onboarding)

```
## Overview (onboarding)
<2-4 lines: what the system does, main runtime, deployment shape>

## Modules and seams
| Area | Path | Responsibility | Evidence |
|---|---|---|---|

## Request / job path
<ingress> -> <handler> -> <domain> -> <store> -> <side effects>  (file:line for each hop)

## Hot spots (last 100 commits)
- <path>: <n> commits; <why it churns, with commit refs>
```

## conventions.md (sections owned by project-onboarding)

```
## Observed conventions (onboarding)
| Topic | Rule the code follows | Example (file:line) |
|---|---|---|

## Gotchas (proven)
- <gotcha> — evidence: <file:line | commit | test | command + exit code>
```
