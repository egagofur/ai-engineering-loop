#!/usr/bin/env bash

# AI Engineering Loop — One-line Project Initializer
# Usage: curl -fsSL https://raw.githubusercontent.com/egagofur/ai-engineering-loop/main/scripts/init.sh | bash

set -e

echo -e "\033[1;36m==> AI Engineering Loop: Initializing Project Context...\033[0m"

if [ -d ".ai-engineering-loop" ]; then
  echo -e "\033[1;32m✓ .ai-engineering-loop/ already exists in this repository.\033[0m"
  exit 0
fi

mkdir -p .ai-engineering-loop

# Detect project name
PROJECT_NAME=$(basename "$PWD")
PROFILE="backend-api"

# Infer basic profile
if [ -f "pnpm-workspace.yaml" ] || [ -f "turbo.json" ] || [ -d "apps" ]; then
  PROFILE="monorepo"
elif [ -f "next.config.js" ] || [ -f "next.config.mjs" ] || [ -f "vite.config.ts" ]; then
  PROFILE="web-app"
elif [ -f "pubspec.yaml" ]; then
  PROFILE="mobile-app"
elif [ -f "go.mod" ] || [ -f "Cargo.toml" ] || [ -f "requirements.txt" ]; then
  PROFILE="backend-api"
fi

echo "Creating .ai-engineering-loop/ with profile: $PROFILE"

cat <<EOF > .ai-engineering-loop/config.md
# Project Configuration

## Metadata
- **project_name**: "$PROJECT_NAME"
- **project_profile**: "$PROFILE"
- **default_base_branch**: "main"
EOF

cat <<EOF > .ai-engineering-loop/architecture.md
# Project Architecture

## System Overview
Discovered architecture for $PROJECT_NAME ($PROFILE).

## Boundary Invariants
- Preserve existing component boundaries and module isolation.
- Zero cyclic dependencies.
EOF

cat <<EOF > .ai-engineering-loop/conventions.md
# Project Conventions

## Code Standards
- File naming: kebab-case or standard project convention.
- Error handling: Use domain-specific errors; zero empty catch blocks.

## Forbidden Anti-Patterns
- Zero speculative TODOs or dead code.
- Never commit private secrets or credentials.
EOF

cat <<EOF > .ai-engineering-loop/verification.md
# Project Verification Commands

## Commands
- **test_unit**: \`npm test\`
- **typecheck**: \`npx tsc --noEmit\`
- **lint**: \`npx eslint --fix\`
- **build**: \`npm run build\`
EOF

cat <<EOF > .ai-engineering-loop/adapter.md
# Project Delivery Adapter Configuration

## Delivery Pipeline
- **adapter_type**: "standard"
- **default_target_branch**: "main"
EOF

echo -e "\033[1;32m✓ .ai-engineering-loop/ successfully initialized!\033[0m"
echo -e "You can now run the AI Engineering Loop on this repository."
