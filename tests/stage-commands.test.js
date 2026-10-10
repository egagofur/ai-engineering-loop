'use strict';

// Issue #34: combined stage commands are equivalent to the long command forms.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const { listRunLifecycle } = require('../lib/run-lifecycle.js');

function setupRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-stage-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-stage-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/list.js'), 'module.exports = (items) => items.slice(0, 10);\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo","scripts":{"test":"node --version"}}\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx', '--allow-empty');
  return { repo, cli, git };
}

function ok(result, label) {
  assert.strictEqual(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  return result;
}

function goalFor(runId) {
  return {
    schemaVersion: 1,
    runId,
    objective: 'Paginate the list',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'returns page 2', evidenceRequired: 'node --version exit 0', failureCases: ['page beyond end returns empty'] }]
  };
}

// Drives one T1 run to DELIVERED. `combined` selects the new commands.
function drive({ repo, cli }, combined) {
  const run = JSON.parse(ok(cli('run', '--json', 'Add pagination to the list'), 'run').stdout);
  assert.strictEqual(run.tier, 'T1');
  const runDir = path.join(repo, '.ai-engineering-loop/runs', run.runId);
  const goalFile = path.join(repo, '.ai-engineering-loop', 'goal-draft.json');
  fs.writeFileSync(goalFile, JSON.stringify(goalFor(run.runId)));
  ok(cli('goal', 'draft', '--run', run.runId, '--file', '.ai-engineering-loop/goal-draft.json', '--revision', '0'), 'goal draft');
  if (combined) {
    ok(cli('goal', 'freeze', '--latest', '--run', run.runId, '--by', 'human'), 'goal freeze --latest');
  } else {
    const draft = JSON.parse(ok(cli('goal', 'show', '--run', run.runId), 'goal show').stdout).draft;
    ok(cli('goal', 'freeze', '--run', run.runId, '--revision', String(draft.metadata.revision), '--hash', draft.metadata.contentHash, '--by', 'human'), 'goal freeze');
  }
  fs.writeFileSync(path.join(repo, 'src/list.js'), 'module.exports = (items, page = 1) => items.slice((page - 1) * 10, page * 10);\n');
  fs.writeFileSync(path.join(runDir, 'diff.patch'), execFileSync('git', ['diff'], { cwd: repo, encoding: 'utf8' }));
  ok(cli('gate', 'maker', '--run', run.runId), 'gate maker');
  if (combined) {
    const verify = JSON.parse(ok(cli('verify', '--run', run.runId, '--cmd', 'node --version', '--json'), 'verify').stdout);
    assert.strictEqual(verify.state, 'VERIFIED');
    assert.strictEqual(verify.claimedVsReality.created, true);
  } else {
    ok(cli('verification', 'record', '--run', run.runId, '--', 'node', '--version'), 'verification record');
    ok(cli('gate', 'verification', '--run', run.runId), 'gate verification');
    ok(cli('context', 'compact', '--run', run.runId), 'context compact');
    ok(cli('context', 'claimed-vs-reality', '--run', run.runId), 'claimed-vs-reality');
  }
  fs.writeFileSync(
    path.join(repo, '.ai-engineering-loop/tasks/claimed-vs-reality.md'),
    '| AC | Claimed | Reality from command log |\n|---|---|---|\n| AC-1 | paginated | node --version exit 0 |\n'
  );
  if (combined) {
    const pack = JSON.parse(ok(cli('review-pack', '--run', run.runId, '--json'), 'review-pack').stdout);
    assert.strictEqual(pack.devilAdvocateRequired, true);
    assert.ok(fs.existsSync(path.join(repo, pack.packPath)));
    assert.strictEqual(pack.escalation.requiredTier, 'CHEAP_MODEL');
  } else {
    ok(cli('context', 'fast-path', '--json'), 'fast-path');
    ok(cli('context', 'diff-hunks', '--run', run.runId), 'diff-hunks');
    ok(cli('escalation', '--run', run.runId, '--json'), 'escalation');
  }
  const diffHash = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')).artifacts.diff.sha256;
  fs.writeFileSync(path.join(runDir, 'findings.json'), JSON.stringify({ schemaVersion: 1, runId: run.runId, diffHash, findings: [] }));
  const review = JSON.parse(ok(cli('gate', 'review', '--run', run.runId, '--json'), 'gate review').stdout);
  assert.strictEqual(review.judgeRequired, false);
  ok(cli('gate', 'judge', '--run', run.runId), 'gate judge');
  if (combined) {
    ok(cli('deliver', '--run', run.runId, '--destination', 'pr', '--summary', 'paginate', '--approve', '--by', 'human', '--json'), 'deliver');
  } else {
    ok(cli('node', 'approve', 'delivery-approval', '--yes', '--by', 'human', '--run', run.runId), 'node approve');
    fs.writeFileSync(path.join(runDir, 'delivery.json'), JSON.stringify({ schemaVersion: 1, runId: run.runId, destination: 'pr', summary: 'paginate', humanApproved: true, approvedBy: 'human' }));
    ok(cli('gate', 'delivery', '--run', run.runId), 'gate delivery');
  }
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  const workflow = JSON.parse(fs.readFileSync(path.join(runDir, 'workflow-state.json'), 'utf8'));
  const verification = JSON.parse(fs.readFileSync(path.join(runDir, 'verification.json'), 'utf8'));
  return { runId: run.runId, state, workflow, verification };
}

test('combined commands reach the same gated outcome as the long form', () => {
  const longForm = drive(setupRepo(), false);
  const combined = drive(setupRepo(), true);
  assert.strictEqual(longForm.state.state, 'DELIVERED');
  assert.strictEqual(combined.state.state, 'DELIVERED');
  const gates = (state) => state.history.map((entry) => `${entry.gate}:${entry.from}->${entry.to}`);
  assert.deepStrictEqual(gates(combined.state), gates(longForm.state));
  assert.deepStrictEqual(Object.keys(combined.state.artifacts).sort(), Object.keys(longForm.state.artifacts).sort());
  const nodeStatus = (wf) => Object.fromEntries(Object.entries(wf.nodes).map(([id, node]) => [id, node.status]));
  assert.deepStrictEqual(nodeStatus(combined.workflow), nodeStatus(longForm.workflow));
  assert.deepStrictEqual(
    combined.verification.commands.map((c) => [c.exitCode, c.timeoutStatus]),
    longForm.verification.commands.map((c) => [c.exitCode, c.timeoutStatus])
  );
});

test('combined commands publish Studio lifecycle and heartbeats', () => {
  const ctx = setupRepo();
  const result = drive(ctx, true);
  const events = listRunLifecycle(ctx.repo, result.runId).events || listRunLifecycle(ctx.repo, result.runId);
  const types = (Array.isArray(events) ? events : []).map((event) => event.type);
  assert.ok(types.includes('AGENT_HEARTBEAT'), types.join(','));
  assert.ok(types.includes('NODE_COMPLETED'));
  assert.ok(types.includes('RUN_COMPLETED'));
});

test('verify never gates failing commands; deliver refuses ASSISTED without --approve', () => {
  const { repo, cli } = setupRepo();
  const run = JSON.parse(ok(cli('run', '--json', 'Add pagination to the list'), 'run').stdout);
  const runDir = path.join(repo, '.ai-engineering-loop/runs', run.runId);
  fs.writeFileSync(path.join(runDir, 'goal-contract.json'), JSON.stringify(goalFor(run.runId)));
  ok(cli('gate', 'goal'), 'gate goal');
  fs.writeFileSync(path.join(repo, 'src/list.js'), 'module.exports = () => [];\n');
  fs.writeFileSync(path.join(runDir, 'diff.patch'), execFileSync('git', ['diff'], { cwd: repo, encoding: 'utf8' }));
  ok(cli('gate', 'maker'), 'gate maker');
  const shellNeeded = cli('verify', '--cmd', 'node --version && exit 1', '--json');
  assert.strictEqual(shellNeeded.status, 1);
  assert.match(shellNeeded.stdout, /--shell/);
  const failing = cli('verify', '--cmd', 'node --version', '--cmd', 'node --ael-not-a-real-flag', '--json');
  assert.notStrictEqual(failing.status, 0);
  const parsed = JSON.parse(failing.stdout);
  assert.strictEqual(parsed.code, 'VERIFICATION_FAILED');
  assert.strictEqual(parsed.commands[0].exitCode, 0);
  assert.notStrictEqual(parsed.commands[1].exitCode, 0);
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  assert.strictEqual(state.state, 'MAKER_COMPLETE');
  const refused = cli('deliver', '--destination', 'pr', '--summary', 'x');
  assert.strictEqual(refused.status, 2);
  assert.ok(!fs.existsSync(path.join(runDir, 'delivery.json')));
  const unknown = cli('deliver', '--aprove');
  assert.strictEqual(unknown.status, 2);
  for (const command of ['verify', 'review-pack', 'deliver']) {
    const help = cli(command, '--help');
    assert.strictEqual(help.status, 0);
    assert.match(help.stdout, new RegExp(`Usage: npx ai-engineering-loop ${command}`));
  }
});
