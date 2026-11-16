'use strict';

// C-10 baseline verification and C-02 cheapest-first default plan.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { classifyAgainstBaseline, extractFailingTests } = require('../lib/baseline.js');
const { defaultCommandPlan, layerOfCommand } = require('../lib/verification-lanes.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function setupRepo(verificationMd) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-base-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-base-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'tools'));
  fs.writeFileSync(path.join(repo, 'tools/pass.js'), 'console.log("ok " + process.argv[2]);\n');
  fs.writeFileSync(path.join(repo, 'tools/fail.js'), 'console.log("✖ legacy widget renders (3ms)"); process.exit(1);\n');
  fs.writeFileSync(path.join(repo, 'tools/mark.js'), 'require("fs").writeFileSync("ran-" + process.argv[2], "1");\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo"}\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop/verification.md'), verificationMd);
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx', '--allow-empty');
  return { repo, cli, git };
}

function freeze({ repo, cli }) {
  const run = JSON.parse(cli('run', '--json', 'Fix the list').stdout);
  const runDir = path.join(repo, '.ai-engineering-loop/runs', run.runId);
  fs.writeFileSync(path.join(runDir, 'goal-contract.json'), JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    objective: 'Fix the list',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'works', evidenceRequired: 'tests', failureCases: ['empty'] }]
  }));
  assert.strictEqual(cli('gate', 'goal', '--run', run.runId).status, 0);
  return { runId: run.runId, runDir };
}

test('extractFailingTests reads node:test, TAP, jest, vitest and pytest output', () => {
  const names = extractFailingTests([
    '✖ adds two numbers (1.2ms)',
    'not ok 3 - parses dates',
    '  ● Cart › removes item',
    ' × renders empty state 12ms',
    'FAILED tests/test_api.py::test_login'
  ].join('\n'));
  assert.deepStrictEqual(names, ['Cart › removes item', 'adds two numbers', 'parses dates', 'renders empty state', 'tests/test_api.py::test_login']);
});

test('classifyAgainstBaseline excuses only failures that were all failing before', () => {
  const baseline = { commands: [{ command: 'npm test', exitCode: 1, timeoutStatus: 'COMPLETED', failingTests: ['old flaky'] }] };
  const same = classifyAgainstBaseline(baseline, [{ command: 'npm test', exitCode: 1, timeoutStatus: 'COMPLETED', stdout: '✖ old flaky (2ms)' }]);
  assert.strictEqual(same[0].preExisting, true);
  const worse = classifyAgainstBaseline(baseline, [{ command: 'npm test', exitCode: 1, timeoutStatus: 'COMPLETED', stdout: '✖ old flaky (2ms)\n✖ new break (1ms)' }]);
  assert.strictEqual(worse[0].preExisting, false);
  assert.deepStrictEqual(worse[0].newFailures, ['new break']);
  const unnamed = classifyAgainstBaseline(baseline, [{ command: 'npm test', exitCode: 1, timeoutStatus: 'COMPLETED', stdout: 'boom' }]);
  assert.strictEqual(unnamed[0].preExisting, false, 'unknown failures are never excused');
  assert.strictEqual(classifyAgainstBaseline(null, [{ command: 'x', exitCode: 1, timeoutStatus: 'COMPLETED' }])[0].preExisting, false);
});

test('C-02 default plan orders L1 before L2 and maps commands to layers', () => {
  const ctx = setupRepo('# V\n- **test_unit**: `node tools/pass.js unit`\n- **lint**: `node tools/pass.js lint`\n- **e2e**: `node tools/pass.js e2e`\n');
  const plan = defaultCommandPlan(ctx.repo);
  assert.deepStrictEqual(plan.map((step) => [step.key, step.layer]), [['lint', 'L1'], ['test_unit', 'L2']]);
  assert.strictEqual(layerOfCommand(ctx.repo, 'node tools/pass.js e2e'), 'L3');
  assert.strictEqual(layerOfCommand(ctx.repo, 'node other.js'), null);
});

test('C-10 verify --baseline records a RED baseline and later labels the same failure pre-existing', () => {
  const ctx = setupRepo('# V\n- **lint**: `node tools/pass.js lint`\n- **test_unit**: `node tools/fail.js`\n');
  const { runId, runDir } = freeze(ctx);
  const base = ctx.cli('verify', '--baseline', '--run', runId, '--json');
  assert.strictEqual(base.status, 0, base.stderr);
  const out = JSON.parse(base.stdout);
  assert.strictEqual(out.baseline.status, 'RED');
  assert.ok(out.baseline.problems.some((p) => p.includes('FIX:')));
  const saved = JSON.parse(fs.readFileSync(path.join(runDir, "baseline.json"), "utf8"));
  assert.deepStrictEqual(saved.commands[1].failingTests, ['legacy widget renders']);

  fs.writeFileSync(path.join(ctx.repo, 'tools/pass.js'), 'console.log("ok2 " + process.argv[2]);\n');
  assert.strictEqual(ctx.cli('gate', 'maker', '--from-git', '--run', runId).status, 0);
  const verify = ctx.cli('verify', '--run', runId, '--json');
  assert.strictEqual(verify.status, 1);
  const result = JSON.parse(verify.stdout);
  assert.deepStrictEqual(result.commands.map((c) => c.layer), ['L1', 'L2']);
  assert.strictEqual(result.failures[0].preExisting, true);

  const late = ctx.cli('verify', '--baseline', '--run', runId, '--json');
  assert.strictEqual(late.status, 1);
  assert.match(late.stdout, /BASELINE_TOO_LATE/);
});

test('C-10 a missing command makes the baseline BROKEN with a FIX', () => {
  const ctx = setupRepo('# V\n- **test_unit**: `definitely-not-a-real-binary-ael --x`\n');
  const { runId } = freeze(ctx);
  const base = ctx.cli('verify', '--baseline', '--run', runId, '--json');
  assert.strictEqual(base.status, 1);
  const out = JSON.parse(base.stdout);
  assert.strictEqual(out.baseline.status, 'BROKEN');
  assert.match(out.baseline.problems[0], /command not found.*FIX: correct the test_unit entry/);
});

test('C-02 default verify stops at the first failing L1 check', () => {
  const ctx = setupRepo('# V\n- **lint**: `node tools/fail.js`\n- **test_unit**: `node tools/mark.js unit`\n');
  const { runId } = freeze(ctx);
  fs.writeFileSync(path.join(ctx.repo, 'tools/pass.js'), 'console.log(1);\n');
  assert.strictEqual(ctx.cli('gate', 'maker', '--from-git', '--run', runId).status, 0);
  const verify = ctx.cli('verify', '--run', runId, '--json');
  assert.strictEqual(verify.status, 1);
  const result = JSON.parse(verify.stdout);
  assert.strictEqual(result.commands.length, 1);
  assert.deepStrictEqual(result.skipped, ['node tools/mark.js unit']);
  assert.strictEqual(fs.existsSync(path.join(ctx.repo, 'ran-unit')), false);
});

test('C-02 T1 verification gate refuses a bundle with no L1 check when lint is configured', () => {
  const ctx = setupRepo('# V\n- **lint**: `node tools/pass.js lint`\n- **test_unit**: `node tools/pass.js unit`\n');
  const run = JSON.parse(ctx.cli('run', '--json', 'Add pagination to the list endpoint').stdout);
  const runDir = path.join(ctx.repo, '.ai-engineering-loop/runs', run.runId);
  fs.writeFileSync(path.join(runDir, 'goal-contract.json'), JSON.stringify({
    schemaVersion: 1, runId: run.runId, objective: 'Paginate',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'page 2', evidenceRequired: 'tests', failureCases: ['empty'] }]
  }));
  assert.strictEqual(ctx.cli('gate', 'goal', '--run', run.runId).status, 0);
  fs.writeFileSync(path.join(ctx.repo, 'tools/pass.js'), 'console.log("ok3 " + process.argv[2]);\n');
  assert.strictEqual(ctx.cli('gate', 'maker', '--from-git', '--run', run.runId).status, 0);
  const unitOnly = ctx.cli('verify', '--run', run.runId, '--cmd', 'node tools/pass.js unit', '--json');
  assert.strictEqual(unitOnly.status, 1);
  assert.match(unitOnly.stdout, /L1_MISSING/);
  assert.match(unitOnly.stdout, /FIX:/);
  const full = ctx.cli('verify', '--run', run.runId, '--json', '--fresh');
  assert.strictEqual(full.status, 0, full.stdout);
});

test('init does not guess typecheck, lint or build commands the project does not have', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-discover-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-discover-home-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"plain","scripts":{"test":"node --test"}}\n');
  const res = spawnSync(process.execPath, [CLI, 'init'], { cwd: repo, env: { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home }, encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
  const md = fs.readFileSync(path.join(repo, '.ai-engineering-loop/verification.md'), 'utf8');
  assert.match(md, /\*\*test_unit\*\*: `npm test`/);
  assert.doesNotMatch(md, /npx tsc|eslint --fix|\*\*build\*\*/);
});
