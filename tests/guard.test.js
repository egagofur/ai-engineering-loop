'use strict';

// Issue #59: hook-enforced runtime guardrails (scope freeze + destructive commands).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { checkGuard, claudeHookOutput, destructiveFindings, loadGuardEvents, parseGuardInput } = require('../lib/guard.js');
const { installHooks, uninstallHooks, hooksStatus, CLAUDE_COMMAND } = require('../lib/guard-hooks.js');
const { validateGoalContract } = require('../lib/gates.js');
const { HOSTS, guardrailSupport } = require('../lib/hosts/registry.js');
const { renderHostTable } = require('../lib/hosts/table.js');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');

function setupRepo({ mode } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-guard-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-guard-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/list.js'), 'module.exports = (items) => items.slice(0, 10);\n');
  fs.writeFileSync(path.join(repo, 'src/secret-config.js'), 'module.exports = {};\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (args, input) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8', input });
  assert.strictEqual(cli(['init']).status, 0);
  if (mode === 'unattended') assert.strictEqual(cli(['policy', 'set', '--allow-unattended', 'true']).status, 0);
  return { repo, cli };
}

function ok(result, label) {
  assert.strictEqual(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  return result;
}

function frozenRun({ repo, cli }, { mode = 'assisted', scope } = {}) {
  const run = JSON.parse(ok(cli(['run', '--json', '--mode', mode, 'Paginate the list']), 'run').stdout);
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop', 'goal-draft.json'), JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    objective: 'Paginate the list',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'returns page 2', evidenceRequired: 'tests', failureCases: ['page beyond end'] }],
    ...(scope ? { scope } : {})
  }));
  ok(cli(['goal', 'draft', '--run', run.runId, '--file', '.ai-engineering-loop/goal-draft.json', '--revision', '0']), 'draft');
  ok(cli(['goal', 'freeze', '--latest', '--run', run.runId, '--by', 'human']), 'freeze');
  return run.runId;
}

test('every destructive pattern is detected; safe look-alikes are allowed', () => {
  const cases = {
    'rm -rf build': 'rm-recursive-force',
    'rm -fr build': 'rm-recursive-force',
    'rm -r -f build': 'rm-recursive-force',
    'rm --recursive --force build': 'rm-recursive-force',
    'cd x && sudo rm -Rf /': 'rm-recursive-force',
    'psql -c "DROP TABLE users"': 'sql-drop',
    'mysql -e "drop database app"': 'sql-drop',
    'echo "TRUNCATE TABLE logs" | psql': 'sql-truncate',
    'truncate users;': 'sql-truncate',
    'git push --force': 'git-push-force',
    'git push -f origin main': 'git-push-force',
    'git push --force-with-lease origin x': 'git-push-force',
    'git push origin +main': 'git-push-force',
    'git -C repo push -uf origin x': 'git-push-force',
    'git reset --hard HEAD~1': 'git-reset-hard',
    'git clean -fd': 'git-clean-force',
    'git clean -dfx': 'git-clean-force',
    'git clean -f -d': 'git-clean-force'
  };
  for (const [command, rule] of Object.entries(cases)) {
    assert.deepStrictEqual(destructiveFindings(command).map((item) => item.id), [rule], command);
  }
  for (const command of ['rm -r dir', 'rm -f file', 'git push origin main', 'git push -u origin x', 'git reset --soft HEAD~1', 'git clean -n', 'git clean -f', 'truncate -s 0 app.log', 'npm test', 'ls -rf']) {
    assert.deepStrictEqual(destructiveFindings(command), [], command);
  }
});

test('Goal scope is optional and validated; absent scope is backward compatible', () => {
  const base = { objective: 'x', acceptanceCriteria: [{ id: 'AC-1', statement: 's', evidenceRequired: 'e', failureCases: ['f'] }] };
  assert.strictEqual(validateGoalContract(base).valid, true);
  assert.strictEqual(validateGoalContract({ ...base, scope: { allowedPaths: ['src/**'], deniedPaths: ['src/secret*'] } }).valid, true);
  for (const scope of [[], { allowedPaths: 'src' }, { allowedPaths: [''] }, { allowedPaths: ['/etc/**'] }, { deniedPaths: ['../x'] }, { other: [] }]) {
    assert.strictEqual(validateGoalContract({ ...base, scope }).valid, false, JSON.stringify(scope));
  }
});

test('ASSISTED warns: edits outside Goal scope, denied paths, and destructive bash are recorded in the Run', () => {
  const ctx = setupRepo();
  const runId = frozenRun(ctx, { scope: { allowedPaths: ['src/**'], deniedPaths: ['src/secret-*'] } });
  const inside = checkGuard(ctx.repo, { tool: 'edit', input: { path: 'src/list.js' } });
  assert.strictEqual(inside.decision, 'allow');
  const outside = checkGuard(ctx.repo, { tool: 'edit', input: { path: path.join(ctx.repo, 'README.md') } });
  assert.strictEqual(outside.decision, 'warn');
  assert.deepStrictEqual(outside.rules, ['scope-outside']);
  assert.deepStrictEqual(checkGuard(ctx.repo, { tool: 'edit', input: { path: 'src/secret-config.js' } }).rules, ['scope-denied']);
  assert.strictEqual(checkGuard(ctx.repo, { tool: 'edit', input: { path: '.ai-engineering-loop/runs/x/findings.json' } }).decision, 'allow', 'run artifacts are always writable');
  assert.strictEqual(checkGuard(ctx.repo, { tool: 'bash', input: { command: 'git reset --hard' } }).decision, 'warn');
  assert.strictEqual(checkGuard(ctx.repo, { tool: 'bash', input: { command: 'npm test' } }).decision, 'allow');
  const events = loadGuardEvents(ctx.repo, runId);
  assert.deepStrictEqual(events.map((event) => event.rules[0]), ['scope-outside', 'scope-denied', 'git-reset-hard']);
  assert.ok(events.every((event) => event.decision === 'warn' && event.mode === 'ASSISTED'));
  assert.strictEqual(events[0].target, 'README.md', 'targets are repository-relative, never absolute');
  // Hosts may report the path through a symlink (macOS /var -> /private/var).
  const link = `${ctx.repo}-link`;
  fs.symlinkSync(ctx.repo, link);
  assert.strictEqual(checkGuard(ctx.repo, { tool: 'edit', input: { path: path.join(link, 'src/list.js') } }).decision, 'allow');
  assert.strictEqual(checkGuard(ctx.repo, { tool: 'edit', input: { path: path.join(link, 'src/new/file.js') } }).decision, 'allow', 'new files under a symlinked root');
  assert.deepStrictEqual(checkGuard(ctx.repo, { tool: 'edit', input: { path: path.join(link, 'README.md') } }).rules, ['scope-outside']);
});

test('UNATTENDED blocks; the confirmed impact map defines scope when the Goal has none', () => {
  const ctx = setupRepo({ mode: 'unattended' });
  const runId = frozenRun(ctx, { mode: 'unattended' });
  assert.strictEqual(checkGuard(ctx.repo, { tool: 'edit', input: { path: 'README.md' } }).decision, 'allow', 'no confirmed scope = no path enforcement');
  ok(ctx.cli(['impact', 'confirm', '--run', runId, '--by', 'ega', '--allow', 'src/list.js']), 'confirm');
  const blocked = checkGuard(ctx.repo, { tool: 'edit', input: { path: 'README.md' } });
  assert.strictEqual(blocked.decision, 'block');
  assert.match(blocked.reasons[0], /impact-map/);
  assert.strictEqual(checkGuard(ctx.repo, { tool: 'edit', input: { path: 'src/list.js' } }).decision, 'allow');
  assert.strictEqual(checkGuard(ctx.repo, { tool: 'bash', input: { command: 'rm -rf src' } }).decision, 'block');
  const cli = ctx.cli(['guard', 'check', '--tool', 'bash', '--command', 'git push --force', '--json']);
  assert.strictEqual(cli.status, 2);
  assert.strictEqual(JSON.parse(cli.stdout).decision, 'block');
});

test('Claude hook payloads map to deny / ask / silent allow', () => {
  const ctx = setupRepo();
  frozenRun(ctx, { scope: { allowedPaths: ['src/**'] } });
  const payload = (tool_name, tool_input) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input });
  const ask = ok(ctx.cli(['guard', 'check', '--hook', 'claude'], payload('Write', { file_path: path.join(ctx.repo, 'README.md') })), 'ask');
  assert.strictEqual(JSON.parse(ask.stdout).hookSpecificOutput.permissionDecision, 'ask');
  const allow = ok(ctx.cli(['guard', 'check', '--hook', 'claude'], payload('Edit', { file_path: path.join(ctx.repo, 'src/list.js') })), 'allow');
  assert.strictEqual(allow.stdout, '');
  const bash = ok(ctx.cli(['guard', 'check', '--hook', 'claude'], payload('Bash', { command: 'git clean -fd' })), 'bash');
  assert.match(JSON.parse(bash.stdout).hookSpecificOutput.permissionDecisionReason, /git clean/);
  assert.deepStrictEqual(parseGuardInput({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'a.ipynb' } }), { tool: 'edit', toolName: 'NotebookEdit', path: 'a.ipynb', command: null });
  assert.strictEqual(claudeHookOutput({ decision: 'block', mode: 'UNATTENDED', reasons: ['x'] }).hookSpecificOutput.permissionDecision, 'deny');
});

test('gate output shows guard events', () => {
  const ctx = setupRepo();
  const runId = frozenRun(ctx);
  ok(ctx.cli(['guard', 'check', '--tool', 'bash', '--command', 'rm -rf dist']), 'warn exits 0');
  fs.writeFileSync(path.join(ctx.repo, 'src/list.js'), 'module.exports = (items, page = 1) => items.slice((page - 1) * 10, page * 10);\n');
  const gate = JSON.parse(ok(ctx.cli(['gate', 'maker', '--from-git', '--run', runId, '--json']), 'gate maker').stdout);
  assert.deepStrictEqual(gate.guard, { warn: 1, block: 0, rules: ['rm-recursive-force'] });
});

test('Claude hook install is idempotent, keeps user hooks, and uninstalls cleanly', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-hooks-'));
  const settingsFile = path.join(repo, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile));
  const user = { permissions: { allow: ['Bash(npm test)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  fs.writeFileSync(settingsFile, JSON.stringify(user));
  assert.strictEqual(installHooks(repo).changed, true);
  const once = fs.readFileSync(settingsFile, 'utf8');
  assert.strictEqual(installHooks(repo).changed, false);
  assert.strictEqual(fs.readFileSync(settingsFile, 'utf8'), once);
  const installed = JSON.parse(once);
  assert.strictEqual(installed.hooks.PreToolUse.length, 2);
  assert.strictEqual(installed.hooks.PreToolUse[1].hooks[0].command, CLAUDE_COMMAND);
  assert.strictEqual(hooksStatus(repo).installed, true);
  assert.strictEqual(uninstallHooks(repo).changed, true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), user);
  assert.strictEqual(uninstallHooks(repo).changed, false);
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-hooks-'));
  installHooks(fresh);
  uninstallHooks(fresh);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(fresh, '.claude/settings.json'), 'utf8')), {});
  assert.throws(() => installHooks(repo, { host: 'codex' }), { code: 'HOOKS_UNSUPPORTED' });
});

test('host registry and table mark enforced vs advisory guardrails', () => {
  assert.deepStrictEqual(HOSTS.filter((host) => guardrailSupport(host) === 'enforced').map((host) => host.id), ['claude']);
  const table = renderHostTable();
  assert.match(table, /\| Guardrails \|/);
  assert.match(table, /\| Claude Code \| `claude` \| [^|]+ \| enforced \|/);
  assert.match(table, /\| Codex CLI \| `codex` \| [^|]+ \| advisory \|/);
});
