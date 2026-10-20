'use strict';

// Verification lanes: related tests during iterations, one full run before
// delivery, and reuse of passing evidence for an unchanged diff.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function setupRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-lanes-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-lanes-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.mkdirSync(path.join(repo, 'tools'));
  fs.writeFileSync(path.join(repo, 'src/list.js'), 'module.exports = (items) => items.slice(0, 10);\n');
  // Echoes the files it was given so the test can see the {files} expansion.
  fs.writeFileSync(path.join(repo, 'tools/related.js'), 'console.log("related:" + process.argv.slice(2).join(","));\n');
  fs.writeFileSync(path.join(repo, 'tools/flaky.js'), 'process.exit(require("fs").existsSync("ok.flag") ? 0 : 1);\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo","scripts":{"test":"node --version"}}\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  fs.appendFileSync(path.join(repo, '.ai-engineering-loop/verification.md'), '\n- **test_related**: `node tools/related.js {files}`\n');
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx', '--allow-empty');
  return { repo, cli };
}

function ok(result, label) {
  assert.strictEqual(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  return result;
}

function toMaker({ repo, cli }) {
  const run = JSON.parse(ok(cli('run', '--json', 'Add pagination to the list'), 'run').stdout);
  const runDir = path.join(repo, '.ai-engineering-loop/runs', run.runId);
  fs.writeFileSync(path.join(runDir, 'goal-contract.json'), JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    objective: 'Paginate the list',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'returns page 2', evidenceRequired: 'tests exit 0', failureCases: ['page beyond end returns empty'] }]
  }));
  ok(cli('gate', 'goal', '--run', run.runId), 'gate goal');
  fs.writeFileSync(path.join(repo, 'src/list.js'), 'module.exports = (items, page = 1) => items.slice((page - 1) * 10, page * 10);\n');
  ok(cli('gate', 'maker', '--from-git', '--run', run.runId), 'gate maker');
  return { runId: run.runId, runDir };
}

function toJudgePass({ repo, cli }, { runId, runDir }) {
  fs.writeFileSync(
    path.join(repo, '.ai-engineering-loop/tasks/claimed-vs-reality.md'),
    '| AC | Claimed | Reality from command log |\n|---|---|---|\n| AC-1 | paginated | related tests exit 0 |\n'
  );
  const diffHash = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')).artifacts.diff.sha256;
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify({ schemaVersion: 1, runId, diffHash, findings: [] }));
  ok(cli('gate', 'review', '--run', runId), 'gate review');
  ok(cli('gate', 'judge', '--run', runId), 'gate judge');
}

test('verify --related runs test_related on the changed files and tags the scope', () => {
  const ctx = setupRepo();
  const { runId, runDir } = toMaker(ctx);
  const verify = JSON.parse(ok(ctx.cli('verify', '--related', '--run', runId, '--json'), 'verify --related').stdout);
  assert.strictEqual(verify.scope, 'related');
  assert.strictEqual(verify.commands[0].scope, 'related');
  const bundle = JSON.parse(fs.readFileSync(path.join(runDir, 'verification.json'), 'utf8'));
  assert.match(bundle.commands[0].stdout, /related:src\/list\.js/);
});

test('related-only verification needs verify --final before delivery', () => {
  const ctx = setupRepo();
  const target = toMaker(ctx);
  ok(ctx.cli('verify', '--related', '--run', target.runId), 'verify --related');
  toJudgePass(ctx, target);
  const blocked = ctx.cli('deliver', '--run', target.runId, '--destination', 'pr', '--summary', 's', '--approve', '--by', 'human', '--json');
  assert.notStrictEqual(blocked.status, 0);
  assert.match(blocked.stdout + blocked.stderr, /Full verification required before delivery/);
  const final = JSON.parse(ok(ctx.cli('verify', '--final', '--run', target.runId, '--cmd', 'node --version', '--json'), 'verify --final').stdout);
  assert.strictEqual(final.ok, true);
  assert.ok(fs.existsSync(path.join(target.runDir, 'final-verification.json')));
  const again = JSON.parse(ok(ctx.cli('verify', '--final', '--run', target.runId, '--cmd', 'node --version', '--json'), 'verify --final again').stdout);
  assert.strictEqual(again.final.reused, true, 'a passing final run for the same diff is not repeated');
  ok(ctx.cli('deliver', '--run', target.runId, '--destination', 'pr', '--summary', 's', '--approve', '--by', 'human', '--json'), 'deliver');
});

test('full verification needs no final run', () => {
  const ctx = setupRepo();
  const target = toMaker(ctx);
  ok(ctx.cli('verify', '--run', target.runId, '--cmd', 'node --version'), 'verify');
  toJudgePass(ctx, target);
  const final = JSON.parse(ok(ctx.cli('verify', '--final', '--run', target.runId, '--json'), 'verify --final').stdout);
  assert.strictEqual(final.final.reused, true);
  assert.ok(!fs.existsSync(path.join(target.runDir, 'final-verification.json')));
  ok(ctx.cli('deliver', '--run', target.runId, '--destination', 'pr', '--summary', 's', '--approve', '--by', 'human', '--json'), 'deliver');
});

test('re-running verify on the same diff reuses passes and supersedes the failure', () => {
  const ctx = setupRepo();
  const { runId, runDir } = toMaker(ctx);
  const first = ctx.cli('verify', '--run', runId, '--cmd', 'node --version', '--cmd', 'node tools/flaky.js', '--json');
  assert.notStrictEqual(first.status, 0);
  fs.writeFileSync(path.join(ctx.repo, 'ok.flag'), '');
  const second = JSON.parse(ok(ctx.cli('verify', '--run', runId, '--cmd', 'node --version', '--cmd', 'node tools/flaky.js', '--json'), 'verify again').stdout);
  assert.strictEqual(second.state, 'VERIFIED');
  assert.deepStrictEqual(second.commands.map((c) => Boolean(c.reused)), [true, false]);
  const bundle = JSON.parse(fs.readFileSync(path.join(runDir, 'verification.json'), 'utf8'));
  assert.strictEqual(bundle.commands.length, 2);
  assert.strictEqual(bundle.superseded.length, 1);
  assert.strictEqual(bundle.superseded[0].exitCode, 1);
});

test('verify --related without test_related explains how to configure it', () => {
  const ctx = setupRepo();
  const file = path.join(ctx.repo, '.ai-engineering-loop/verification.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/.*test_related.*\n/, ''));
  const { runId } = toMaker(ctx);
  const result = ctx.cli('verify', '--related', '--run', runId, '--json');
  assert.notStrictEqual(result.status, 0);
  assert.match(result.stdout, /NO_RELATED_COMMAND/);
});
