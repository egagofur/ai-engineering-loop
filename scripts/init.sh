#!/usr/bin/env bash
# Deprecated: this script wrote the v1.0 context layout. It will be removed in the next release.
set -euo pipefail
echo "scripts/init.sh is deprecated. Use the CLI instead:" >&2
echo "  npm i -g ai-engineering-loop && ael setup && ael init" >&2
if command -v npx >/dev/null 2>&1; then
  exec npx --yes ai-engineering-loop init "$@"
fi
echo "npx not found: install Node.js 18+ first (https://nodejs.org)." >&2
exit 1
