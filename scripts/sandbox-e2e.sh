#!/usr/bin/env bash
# Newcomer end-to-end test of AEL in throwaway Docker images.
#
#   scripts/sandbox-e2e.sh                     # pack this checkout, run every scenario
#   scripts/sandbox-e2e.sh --ref main          # pack a git ref instead of the working tree
#   scripts/sandbox-e2e.sh --npm [version]     # install from the npm registry instead
#   scripts/sandbox-e2e.sh happy no-git        # only these scenarios
#   scripts/sandbox-e2e.sh --list
#
# Needs: docker, git, npm. Images get only Node (+ git / gh where a scenario says so).
# Transcripts land in $AEL_SANDBOX_OUT (default: a new temp dir), with summary.txt.
# Exit 1 when any PASS/FAIL check fails. UX lines are tracked friction, never failures.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$ROOT/bench/sandbox"

# scenario -> image variant
scenario_image() {
  case "$1" in
    no-git|empty-folder) echo nogit ;;
    gh-logged-out) echo gh ;;
    old-node) echo node16 ;;
    registry) echo npm ;;
    *) echo git ;;
  esac
}
ALL=(happy quick no-git non-git-folder no-commit no-identity gh-missing gh-logged-out rework cli-errors empty-folder host-stale old-node registry)

REF=""
SOURCE=tarball
NPM_VERSION=latest
PICK=()
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --npm) SOURCE=npm; if [ $# -gt 1 ] && [[ "$2" != -* ]] && [[ ! " ${ALL[*]} " =~ " $2 " ]]; then NPM_VERSION="$2"; shift; fi; shift ;;
    --list) printf '%s\n' "${ALL[@]}"; exit 0 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) PICK+=("$1"); shift ;;
  esac
done
[ ${#PICK[@]} -eq 0 ] && PICK=("${ALL[@]}")

for tool in docker git npm; do
  command -v "$tool" >/dev/null || { echo "missing $tool on the host" >&2; exit 2; }
done
docker info >/dev/null 2>&1 || { echo "docker daemon is not reachable; start Docker and retry" >&2; exit 2; }

OUT_DIR="${AEL_SANDBOX_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/ael-sandbox.XXXXXX")}"
mkdir -p "$OUT_DIR"
CTX="$(mktemp -d "${TMPDIR:-/tmp}/ael-sandbox-ctx.XXXXXX")"
trap 'rm -rf "$CTX"' EXIT

echo "== packing AEL (${SOURCE}${REF:+ ref $REF})"
if [ "$SOURCE" = tarball ]; then
  if [ -n "$REF" ]; then
    SRC="$CTX/src"; mkdir -p "$SRC"
    git -C "$ROOT" archive "$REF" | tar -x -C "$SRC"
    (cd "$SRC" && npm pack --silent --pack-destination "$CTX" >/dev/null)
  else
    (cd "$ROOT" && npm pack --silent --pack-destination "$CTX" >/dev/null)
  fi
  mv "$CTX"/ai-engineering-loop-*.tgz "$CTX/ael.tgz"
else
  : > "$CTX/ael.tgz"
fi
cp "$SANDBOX/Dockerfile" "$SANDBOX/scenario.sh" "$CTX/"

build() {
  local tag="ael-sandbox:$1-$SOURCE"; shift
  docker build -q -t "$tag" --build-arg "AEL_SOURCE=$SOURCE" --build-arg "AEL_VERSION=$NPM_VERSION" "$@" "$CTX" >/dev/null
  echo "$tag"
}

# Each variant is built once per invocation (bash 3.2 has no associative arrays).
image_for() {
  local variant="$1"
  if [ ! -f "$CTX/built-$variant" ]; then
    case "$variant" in
      git) build git --build-arg WITH_GIT=1 ;;
      nogit) build nogit --build-arg WITH_GIT=0 ;;
      gh) build gh --build-arg WITH_GIT=1 --build-arg WITH_GH=1 ;;
      node16) build node16 --build-arg NODE_IMAGE=node:16-slim --build-arg WITH_GIT=0 ;;
      npm) build npm --build-arg WITH_GIT=0 --build-arg AEL_SOURCE=npm --build-arg "AEL_VERSION=$NPM_VERSION" --no-cache ;;
    esac > "$CTX/built-$variant"
  fi
  cat "$CTX/built-$variant"
}

FAILED=0
: > "$OUT_DIR/summary.txt"
for scenario in "${PICK[@]}"; do
  variant=$(scenario_image "$scenario")
  echo "== $scenario ($variant)"
  image=$(image_for "$variant")
  log="$OUT_DIR/$scenario.log"
  if docker run --rm -e AEL_NO_AUTO_UPDATE=1 -e AEL_NO_SETUP_HINT=1 "$image" ael-scenario "$scenario" > "$log" 2>&1; then status=ok; else status=FAILED; FAILED=1; fi
  grep -E '^(RESULT FAIL|UX OPEN)' "$log" | sed "s/^/  /" || true
  {
    echo "## $scenario ($variant): $status"
    grep -E '^(RESULT|UX) ' "$log" || true
  } >> "$OUT_DIR/summary.txt"
  echo "   $status ($(grep -c '^RESULT PASS' "$log" || true) checks passed, $(grep -c '^UX OPEN' "$log" || true) UX issues open) -> $log"
done

echo
echo "summary: $OUT_DIR/summary.txt"
echo "UX open: $(grep -c '^UX OPEN' "$OUT_DIR/summary.txt" || true), fixed: $(grep -c '^UX FIXED' "$OUT_DIR/summary.txt" || true)"
[ "$FAILED" -eq 0 ] && echo "sandbox e2e: GREEN" || echo "sandbox e2e: RED"
exit "$FAILED"
