#!/usr/bin/env bash
# Runs inside the sandbox image (see Dockerfile). One scenario per call:
#   ael-scenario <name>
# Prints a transcript, then result lines the host script parses:
#   RESULT PASS|FAIL <check> <detail>
#   UX OPEN|FIXED <id> <detail>      (known newcomer friction; never fails the run)
# PASS/FAIL checks pin the behaviour a newcomer depends on. UX probes track the
# friction reported in docs/archive/cards/novice-ux-*.md: OPEN = still present,
# FIXED = the probe no longer sees it (update the card).

set -u
SCENARIO="${1:?usage: ael-scenario <name>}"
APP=/work/app
OUT=""
RC=0
FAILS=0

say() { printf '\n################ %s\n' "$*"; }

# c <cmd...>: run, keep output in $OUT and exit code in $RC, echo a bounded transcript.
c() {
  say "\$ $*"
  "$@" > /tmp/ael-cmd.out 2>&1
  RC=$?
  OUT="$(sed 's/\x1b\[[0-9;]*m//g' /tmp/ael-cmd.out)"
  printf '%s\n' "$OUT" | head -n "${MAX_LINES:-40}"
  local n; n=$(printf '%s\n' "$OUT" | wc -l)
  [ "$n" -gt "${MAX_LINES:-40}" ] && echo "... ($n lines total)"
  echo "[exit=$RC]"
}

pass() { echo "RESULT PASS $1 ${2:-}"; }
fail() { echo "RESULT FAIL $1 ${2:-}"; FAILS=$((FAILS + 1)); }
expect_rc() { if [ "$RC" -eq "$2" ]; then pass "$1" "exit=$RC"; else fail "$1" "expected exit $2, got $RC"; fi; }
expect_rc_not0() { if [ "$RC" -ne 0 ]; then pass "$1" "exit=$RC"; else fail "$1" "expected non-zero exit"; fi; }
expect_out() { if printf '%s' "$OUT" | grep -qE -- "$2"; then pass "$1" "/$2/"; else fail "$1" "output lacks /$2/"; fi; }
# ux <id> <detail> <shell-test>: the test is true while the friction is present.
ux() { if eval "$3"; then echo "UX OPEN $1 $2"; else echo "UX FIXED $1 $2"; fi; }
lines() { printf '%s\n' "$OUT" | wc -l | tr -d ' '; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=s.trim().split("\n");let v;for(let i=t.length-1;i>=0&&v===undefined;i--){try{v=JSON.parse(t.slice(i).join("\n"))}catch{}}const r=process.argv[1].split(".").reduce((o,k)=>o==null?o:o[k],v);console.log(r===undefined?"":typeof r==="object"?JSON.stringify(r):r)})' "$1"; }

identity() { git config --global user.email newbie@example.invalid; git config --global user.name newbie; }

sample_app() {
  rm -rf "$APP" && mkdir -p "$APP/src" "$APP/test" && cd "$APP" || exit 1
  cat > package.json <<'J'
{"name":"tiny","version":"1.0.0","scripts":{"test":"node --test"}}
J
  echo 'exports.add = (a, b) => a + b;' > src/math.js
  cat > test/math.test.js <<'J'
const test = require('node:test');
const assert = require('node:assert');
const { add } = require('../src/math.js');
test('add', () => assert.strictEqual(add(1, 2), 3));
J
  printf '# tiny\n\nTeh tiny app.\n' > README.md
  if [ "${1:-git}" = git ] && command -v git >/dev/null; then
    git init -q -b main
    if [ "${2:-commit}" = commit ]; then git add . && git -c user.name=seed -c user.email=seed@example.invalid commit -qm init; fi
  fi
}

run_id() { ael state --json 2>/dev/null | json runId; }

write_goal() {
  mkdir -p .ai-engineering-loop/drafts
  cat > .ai-engineering-loop/drafts/goal.json <<J
{"schemaVersion":1,"runId":"$1","objective":"Add subtract(a, b) to src/math.js",
 "acceptanceCriteria":[{"id":"AC-1","statement":"subtract(5, 3) returns 2","evidenceRequired":"npm test exit 0",
   "failureCases":["subtract(1, 3) returns -2, not 2"]}]}
J
}

make_change() {
  cat >> test/math.test.js <<'J'
const { subtract } = require('../src/math.js');
test('subtract', () => { assert.strictEqual(subtract(5, 3), 2); assert.strictEqual(subtract(1, 3), -2); });
J
  echo 'exports.subtract = (a, b) => a - b;' >> src/math.js
}

fill_claimed() {
  cat > .ai-engineering-loop/tasks/claimed-vs-reality.md <<'J'
| AC | Claimed | Reality from command log | Layer |
|---|---|---|---|
| AC-1 | subtract added | npm test exit 0, 2 pass | L2 |
J
}

# Goal -> Maker -> verify -> review -> judge, as far as the CLI goes without an LLM.
# The Devil's Advocate output is a stand-in ledger with no findings.
drive_to_pass() {
  c ael run --json "Add a subtract function to src/math.js"; expect_rc run-json 0
  local run; run=$(printf '%s' "$OUT" | json runId)
  write_goal "$run"
  c ael goal draft --file .ai-engineering-loop/drafts/goal.json --revision 0; expect_rc goal-draft 0
  c ael goal freeze --latest --by newbie; expect_rc goal-freeze 0
  c ael impact confirm --by newbie; expect_rc impact-confirm 0
  c ael verify --baseline; expect_rc verify-baseline 0
  make_change
  c ael gate maker --from-git; expect_rc gate-maker 0
  c ael verify; expect_rc verify 0; expect_out verify-state 'VERIFIED'
  fill_claimed
  c ael review-pack --json; expect_rc review-pack 0
  echo '{"findings":[]}' > /tmp/da.json
  c ael review ingest --child-id da-1 --file /tmp/da.json --json; expect_rc review-ingest 0
  expect_out judged-pass 'JUDGED_PASS'
}

case "$SCENARIO" in

happy)
  identity; sample_app
  c ael --version; expect_rc version 0
  c ael init; expect_rc init 0
  ux init-gitignore-untracked "init leaves .gitignore untracked and says nothing; it later shows up as out-of-scope in the gated diff" '! printf "%s" "$OUT" | grep -q "Commit it on its own"'
  c ael status; expect_rc status 0
  ux status-hosts-current-when-none "status says Host skills CURRENT with zero hosts installed" 'printf "%s" "$OUT" | grep -q "CURRENT (0 managed"'
  c ael doctor; expect_rc doctor 0
  ux doctor-no-git-or-host-checks "doctor checks package internals but not git, git identity, or an agent host" '! printf "%s" "$OUT" | grep -qiE "git|host-skill"'
  c ael doctor --harness; expect_rc doctor-harness 0
  c ael run "Add a subtract function to src/math.js"; expect_rc run 0
  ux run-says-agent-ready-without-agent "run prints 'AI Agent Ready' though no agent host has the skill" 'printf "%s" "$OUT" | grep -q "AI Agent Ready"'
  c ael goal draft
  ux goal-draft-no-template "goal draft without --file gives no template or schema pointer" '! printf "%s" "$OUT" | grep -qE "scaffold goal|schema|example"'
  c ael scaffold goal
  ux scaffold-goal-missing "gate goal FIX says 'scaffold can create a template' but scaffold has no goal type" '[ "$RC" -ne 0 ]'
  c ael run --json "Add a subtract function to src/math.js"; expect_rc run-resume 0; expect_out run-resumed '"resumed": true'
  RUNID=$(printf '%s' "$OUT" | json runId)
  write_goal "$RUNID"
  c ael goal draft --file .ai-engineering-loop/drafts/goal.json --revision 0; expect_rc goal-draft 0
  ux goal-draft-json-without-flag "goal draft/freeze print JSON without --json" 'printf "%s" "$OUT" | grep -q "^{"'
  c ael goal freeze --latest --by newbie; expect_rc goal-freeze 0
  MAX_LINES=8 c ael impact show; expect_rc impact-show 0
  c ael impact confirm --by newbie; expect_rc impact-confirm 0
  c ael verify --baseline; expect_rc verify-baseline 0
  make_change
  c ael gate maker --from-git; expect_rc gate-maker 0
  c ael verify; expect_rc verify 0; expect_out verify-state 'VERIFIED'
  fill_claimed
  c ael review-pack; expect_rc review-pack 0
  echo 'No findings: the diff adds subtract and covers both failure cases.' > /tmp/da.md
  c ael review ingest --child-id da-0 --file /tmp/da.md --json
  ux ingest-prose-no-fix "review ingest of prose fails with no WHY/FIX or ledger example" '[ "$RC" -ne 0 ] && ! printf "%s" "$OUT" | grep -q "fix"'
  echo '{"findings":[]}' > /tmp/da.json
  c ael review ingest --child-id da-1 --file /tmp/da.json --json; expect_rc review-ingest 0; expect_out judged-pass 'JUDGED_PASS'
  c ael gate judge
  ux gate-judge-after-ingest "gate judge after review ingest fails with 'Node judge is PASSED, not READY'" '[ "$RC" -ne 0 ]'
  c ael deliver --destination pr --summary "add subtract"; expect_rc deliver-needs-approve 2
  c ael deliver --destination pr --summary "add subtract" --approve --by newbie
  ux deliver-uncommitted "deliver passes while the gated change is uncommitted; receipt base == head" '[ "$RC" -eq 0 ]'
  expect_out deliver-names-uncommitted 'not committed'
  git add -A src test && git commit -qm "add subtract"
  c ael deliver --destination pr --summary "add subtract" --approve --by newbie; expect_rc deliver 0; expect_out delivered 'DELIVERED'
  c ael state --json; expect_out state-delivered '"DELIVERED"'
  ;;

quick)
  identity; sample_app; ael init >/dev/null; git add -A && git commit -qm ctx
  c ael quick start "Fix typo in README" --json; expect_rc quick-start 0; expect_out quick-t0 '"tier":"T0"'
  RUNID=$(printf '%s' "$OUT" | json runId)
  sed -i 's/Teh/The/' README.md
  c ael quick finish --run "$RUNID" --cmd "npm test" --json; expect_rc quick-finish 0; expect_out quick-pass 'JUDGED_PASS'
  git commit -qam "fix typo"
  c ael deliver --run "$RUNID" --destination pr --summary typo --approve --by newbie --json; expect_rc quick-deliver 0
  ;;

no-git)
  sample_app nogit
  c ael init; expect_rc init 0
  c ael status; expect_rc status 0
  ux status-claims-git-current "status says 'Git HEAD ... match' and 'Baseline Git: untracke' with no git" 'printf "%s" "$OUT" | grep -q "untracke$"'
  c ael doctor; expect_rc_not0 doctor-not-ready-without-git; expect_out doctor-git-fix 'FIX: Install git'
  ux doctor-ready-without-git "doctor says READY although git is not installed" 'printf "%s" "$OUT" | grep -q "doctor: READY"'
  c ael run --json "Add a subtract function"; expect_rc_not0 run-refused-without-git; expect_out run-git-missing 'GIT_MISSING'
  ux run-starts-without-git "run starts a Run that cannot pass the Maker gate (git missing)" '[ "$RC" -eq 0 ]'
  RUNID=$(printf '%s' "$OUT" | json runId); write_goal "$RUNID"
  ael goal draft --file .ai-engineering-loop/drafts/goal.json --revision 0 >/dev/null; ael goal freeze --latest --by newbie >/dev/null
  make_change
  c ael gate maker --from-git; expect_rc_not0 gate-maker-fails
  ux maker-raw-enoent "gate maker without git prints 'spawnSync git ENOENT' with no WHY/FIX" 'printf "%s" "$OUT" | grep -q "spawnSync git ENOENT" && ! printf "%s" "$OUT" | grep -q "FIX"'
  ;;

non-git-folder)
  sample_app nogit
  c ael init; expect_rc init 0
  c ael run --json "Add a subtract function"; expect_rc_not0 run-refused-not-a-repo; expect_out run-git-init-fix 'git init'
  RUNID=$(printf '%s' "$OUT" | json runId); write_goal "$RUNID"
  ael goal draft --file .ai-engineering-loop/drafts/goal.json --revision 0 >/dev/null; ael goal freeze --latest --by newbie >/dev/null
  c ael impact show
  ux impact-empty-without-git "impact map is empty outside git (0 files), and confirm accepts it" 'printf "%s" "$OUT" | grep -q "files: 0"'
  make_change
  MAX_LINES=6 c ael gate maker --from-git; expect_rc_not0 gate-maker-fails
  ux maker-git-usage-dump "gate maker in a non-git folder dumps git diff usage (wall of text) instead of 'run git init'" '[ "$(lines)" -gt 20 ]'
  ;;

no-commit)
  sample_app git nocommit
  c ael init; expect_rc init 0
  c ael run --json "Add a subtract function"; expect_rc_not0 run-refused-no-commit; expect_out run-first-commit-fix 'git commit'
  make_change
  c ael gate maker --from-git; expect_rc_not0 gate-maker-fails
  ux maker-bad-head "gate maker on a repo with no commits: raw 'bad revision HEAD', no FIX" 'printf "%s" "$OUT" | grep -q "bad revision" && ! printf "%s" "$OUT" | grep -q "FIX"'
  c ael run --worktree "another task"; expect_rc_not0 worktree-fails
  ux worktree-bad-head "run --worktree with no commits: raw git rev-parse error" 'printf "%s" "$OUT" | grep -q "rev-parse HEAD"'
  ;;

no-identity)
  sample_app
  c ael init; expect_rc init 0
  c ael doctor; expect_rc doctor 0
  ux doctor-no-identity-check "doctor does not warn that git user.name/email are unset (the human cannot commit before deliver)" '! printf "%s" "$OUT" | grep -qi "identity\|user.email"'
  drive_to_pass
  c git commit -qam "add subtract"; expect_rc_not0 commit-fails-without-identity
  c ael deliver --destination pr --summary "add subtract" --approve --by newbie; expect_rc_not0 deliver-refuses-uncommitted; expect_out deliver-names-uncommitted 'not committed'
  ;;

gh-missing|gh-logged-out)
  identity; sample_app
  git remote add origin https://github.com/example/tiny.git
  c ael init; expect_rc init 0
  c cat .ai-engineering-loop/adapter.md
  c ael doctor; expect_rc doctor 0
  if [ "$SCENARIO" = gh-missing ]; then expect_out adapter-auth-warn 'gh not installed'; else expect_out adapter-auth-warn 'gh not logged in'; fi
  ux adapter-auth-no-fix "adapter-auth warning names no command (gh auth login / install link)" '! printf "%s" "$OUT" | grep -q "gh auth login\|cli.github.com"'
  ux doctor-ready-adapter-broken "doctor prints READY and exits 0 while the delivery adapter cannot run" 'printf "%s" "$OUT" | grep -q "doctor: READY$"'
  drive_to_pass
  git add -A src test && git commit -qm "add subtract"
  c ael deliver --destination pr --summary "add subtract" --approve --by newbie; expect_rc deliver 0
  expect_out deliver-warns-adapter 'adapter-auth'
  ;;

cli-errors)
  identity; sample_app
  c ael int
  ux unknown-command-exit0 "unknown command exits 0 and prints the full help (no 'did you mean init')" '[ "$RC" -eq 0 ]'
  c ael help
  ux help-subcommand-missing "'ael help' is an unknown command" 'printf "%s" "$OUT" | grep -q "Unknown command: help"'
  c ael --help
  ux help-wall "--help is a wall of text" '[ "$(lines)" -gt 80 ]'
  c ael status; expect_rc status-before-init 1
  c ael init; expect_rc init 0
  c ael run; expect_rc_not0 run-without-task
  ux run-empty-task "run with no task creates a Run with an empty task" '[ "$RC" -eq 0 ] && printf "%s" "$OUT" | grep -q "(created)"'
  ael run --abandon --reason test --by newbie --yes --force-live >/dev/null 2>&1
  c ael run --json "Add subtract"; expect_rc run 0
  c ael gate
  ux gate-no-name "gate without a name reports the delivery-approval node instead of usage" 'printf "%s" "$OUT" | grep -q "delivery-approval"'
  c ael deliver
  ux deliver-early-misleading "deliver before any gate says only 'needs --approve'" '! printf "%s" "$OUT" | grep -q "deliver comes after the Judge"'
  c ael run --json "Rewrite the parser"; expect_out run-conflict 'RUN_CONFLICT'; expect_rc run-conflict-exit 3
  c ael quick start "Fix typo in README" --json
  ux quick-start-skips-conflict "quick start opens a second Run while another is unfinished (no RUN_CONFLICT)" 'printf "%s" "$OUT" | grep -q "\"ok\":true"'
  ;;

empty-folder)
  mkdir -p /work/empty && cd /work/empty
  c ael
  ux bare-ael-inits "bare 'ael' runs init and writes files (skill says: offer a menu, no files)" '[ -d .ai-engineering-loop ]'
  ux init-guesses-empty "init in an empty folder claims backend-api / npm / 'npm test'" 'printf "%s" "$OUT" | grep -q "Unit Test Command: npm test"'
  ;;

host-stale)
  identity; sample_app; mkdir -p ~/.claude
  c ael init; expect_rc init 0
  ux init-no-skill-install "init does not install or offer the agent skill" '! printf "%s" "$OUT" | grep -q "ael setup"'
  c ael status
  ux status-stale-not-missing "status says skills STALE when they were never installed" 'printf "%s" "$OUT" | grep -q "STALE"'
  c ael sync-hosts; expect_rc sync-hosts 0
  [ -f ~/.claude/skills/ael/SKILL.md ] && pass skill-installed || fail skill-installed "~/.claude/skills/ael/SKILL.md missing"
  ;;

old-node)
  sample_app nogit
  c ael init
  ux old-node-init-silent "init succeeds on an unsupported Node without a warning" '[ "$RC" -eq 0 ] && ! printf "%s" "$OUT" | grep -q "Node"'
  c ael doctor; expect_rc_not0 doctor-not-ready
  ;;

registry)
  c ael --version; expect_rc version 0
  ;;

*) echo "unknown scenario: $SCENARIO"; exit 2 ;;
esac

echo
echo "SCENARIO $SCENARIO fails=$FAILS"
[ "$FAILS" -eq 0 ]
