'use strict';

// C-05: recurring review lessons become executable L1 rules.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { promoteLearning, promotionCandidates, missingRules } = require('../lib/rules.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function withLearnings(root, entries) {
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'learnings.json'), JSON.stringify({ entries }));
}

test('AC-2 learnings seen in 3+ Runs are promotion candidates until promoted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-rules-'));
  withLearnings(root, [
    { id: 'L-abc', lesson: 'renderer imports fs', runIds: ['r1', 'r2', 'r3'] },
    { id: 'L-def', lesson: 'rare', runIds: ['r1'] }
  ]);
  assert.deepStrictEqual(promotionCandidates(root).map((c) => [c.id, c.runs]), [['L-abc', 3]]);
  assert.throws(() => promoteLearning(root, 'L-abc', { check: 'x', fix: 'y' }), /--by/);
  assert.throws(() => promoteLearning(root, 'L-nope', { check: 'x', fix: 'y', by: 'h' }), /No learning/);
  const rule = promoteLearning(root, 'L-abc', { check: "! grep -rq \"require('fs')\" src/renderer", fix: 'Move file access to preload/file-ops.js', by: 'ega' });
  assert.strictEqual(rule.id, 'R-abc');
  assert.deepStrictEqual(promotionCandidates(root), []);
  assert.deepStrictEqual(missingRules(root, { commands: [{ command: rule.check, exitCode: 1 }] }).map((r) => r.id), ['R-abc']);
  assert.deepStrictEqual(missingRules(root, { commands: [{ command: rule.check, exitCode: 0 }] }), []);
  assert.deepStrictEqual(missingRules(root, { commands: [{ command: 'x', exitCode: 0, scope: 'related' }] }), []);
});

test('AC-1 a promoted rule runs in default verify; a violation fails with the rule FIX, and the gate requires it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-rules-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-rules-repo-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/view.js'), 'module.exports = 1;\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop/verification.md'), '# V\n- **test_unit**: `node --version`\n');
  withLearnings(repo, [{ id: 'L-fs1', lesson: 'view must not use fs', runIds: ['a', 'b', 'c'] }]);
  const promote = cli('learn', 'promote', 'L-fs1', '--check', "! grep -q \"require('fs')\" src/view.js", '--fix', 'Read files through src/io.js', '--by', 'ega', '--json');
  assert.strictEqual(promote.status, 0, promote.stdout + promote.stderr);
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx');
  const run = JSON.parse(cli('run', '--json', 'Change the view').stdout);
  const runDir = path.join(repo, '.ai-engineering-loop/runs', run.runId);
  fs.writeFileSync(path.join(runDir, 'goal-contract.json'), JSON.stringify({
    schemaVersion: 1, runId: run.runId, objective: 'v',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'x', evidenceRequired: 'y', failureCases: ['z'] }]
  }));
  assert.strictEqual(cli('gate', 'goal', '--run', run.runId).status, 0);
  fs.writeFileSync(path.join(repo, 'src/view.js'), "const fs = require('fs');\nmodule.exports = fs;\n");
  assert.strictEqual(cli('gate', 'maker', '--from-git', '--run', run.runId).status, 0);
  const bypass = cli('verify', '--run', run.runId, '--cmd', 'node --version', '--json');
  assert.strictEqual(bypass.status, 1);
  assert.match(bypass.stdout, /RULES_MISSING/);
  const bad = cli('verify', '--run', run.runId);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stdout, /Rule R-fs1 violated.*FIX: Read files through src\/io\.js/);
});

// C-17: ratchet rules judge only what the change adds.
function ratchetRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-ratchet-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-ratchet-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/legacy.js'), 'useEffect(() => {}, []);\n');
  fs.writeFileSync(path.join(repo, 'src/view.js'), 'module.exports = 1;\n');
  // Portable check (cmd.exe has no `!` or $VAR): print and fail on matches.
  fs.mkdirSync(path.join(repo, 'tools'));
  fs.writeFileSync(path.join(repo, 'tools/no-effect.js'), [
    "const file = process.env.AEL_ADDED_LINES_FILE;",
    "const text = file ? require('fs').readFileSync(file, 'utf8') : '';",
    "const hits = text.split('\\n').filter((line) => /useEffect\\(/.test(line));",
    "for (const hit of hits) console.log(hit);",
    "process.exit(hits.length ? 1 : 0);"
  ].join('\n'));
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop/verification.md'), '# V\n- **test_unit**: `node --version`\n');
  withLearnings(repo, [{ id: 'L-fx1', lesson: 'no useEffect in product code', runIds: ['a', 'b', 'c'] }]);
  const promote = cli('learn', 'promote', 'L-fx1', '--scope', 'diff', '--no-shell', '--check', 'node tools/no-effect.js', '--fix', 'Use the framework data hook instead of useEffect', '--by', 'ega', '--json');
  assert.strictEqual(promote.status, 0, promote.stdout + promote.stderr);
  assert.strictEqual(JSON.parse(promote.stdout).rule.scope, 'diff');
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx', '--allow-empty');
  const start = (content) => {
    const run = JSON.parse(cli('run', '--json', '--new', 'Change the view').stdout);
    const runDir = path.join(repo, '.ai-engineering-loop/runs', run.runId);
    fs.writeFileSync(path.join(runDir, 'goal-contract.json'), JSON.stringify({
      schemaVersion: 1, runId: run.runId, objective: 'v',
      acceptanceCriteria: [{ id: 'AC-1', statement: 'x', evidenceRequired: 'y', failureCases: ['z'] }]
    }));
    assert.strictEqual(cli('gate', 'goal', '--run', run.runId).status, 0);
    fs.writeFileSync(path.join(repo, 'src/view.js'), content);
    assert.strictEqual(cli('gate', 'maker', '--from-git', '--run', run.runId).status, 0);
    return run.runId;
  };
  return { repo, cli, git, start };
}

test('C-17 AC-1/AC-2 a diff rule ignores legacy violations and catches a new one with file:line', () => {
  const ctx = ratchetRepo();
  const clean = ctx.start('module.exports = 2;\n');
  const ok = ctx.cli('verify', '--run', clean, '--json');
  assert.strictEqual(ok.status, 0, `legacy src/legacy.js must not fail the rule: ${ok.stdout}`);
  ctx.git('checkout', '--', 'src/view.js');
  const dirty = ctx.start('module.exports = 2;\nuseEffect(() => {});\n');
  const bad = ctx.cli('verify', '--run', dirty);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stdout, /Rule R-fx1 violated.*FIX: Use the framework data hook/);
  const added = fs.readFileSync(path.join(ctx.repo, '.ai-engineering-loop/runs', dirty, 'rule-added-lines.txt'), 'utf8');
  assert.match(added, /^src\/view\.js:2:useEffect/m);
});

test('C-17 AC-3 doctor --harness reports the legacy backlog of a diff rule', () => {
  const ctx = ratchetRepo();
  const { auditHarness } = require('../lib/harness-audit.js');
  const audit = auditHarness(ctx.repo, { budget: false });
  const backlog = audit.items.find((item) => item.id === 'rule-backlog');
  assert.match(backlog.detail, /R-fx1 \(scope diff\): legacy violations remain .*src\/legacy\.js:1/);
  fs.writeFileSync(path.join(ctx.repo, 'src/legacy.js'), 'module.exports = 0;\n');
  ctx.git('add', '-A');
  ctx.git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'cleanup');
  assert.match(auditHarness(ctx.repo, { budget: false }).items.find((item) => item.id === 'rule-backlog').detail, /no legacy violations left/);
  assert.throws(() => promoteLearning(ctx.repo, 'L-fx1', { check: 'x', fix: 'y', by: 'h', scope: 'files' }), /--scope must be repo or diff/);
});
