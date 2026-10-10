'use strict';

// Issue #33: automatic task tiers with a deterministic review gate.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const { classifyTier, initialTierState, raiseTierFromDiff } = require('../lib/tier.js');
const { applyGate, artifactPath, hashFile, judgeRequirement } = require('../lib/gates.js');
const { RUN_STATES, createRun, getGitRevision, loadRun } = require('../lib/run-state.js');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');

function tempRepo(tierTask, { override = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-tier-'));
  fs.mkdirSync(path.join(root, '.ai-engineering-loop', 'tasks'), { recursive: true });
  const tier = tierTask == null ? null : initialTierState({ task: tierTask, ...(override || {}) });
  createRun(root, { runId: 'run-001', task: tierTask || 'fixture', ...(tier ? { tier } : {}) });
  return root;
}

function writeArtifact(root, name, value) {
  const filePath = artifactPath(root, 'run-001', name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function goal() {
  return {
    schemaVersion: 1,
    runId: 'run-001',
    objective: 'Tiered change',
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'The change is correct',
      evidenceRequired: 'node --test passes',
      failureCases: ['broken input is rejected']
    }]
  };
}

function verification(root, diffHash, exitCode = 0) {
  return {
    schemaVersion: 1,
    runId: 'run-001',
    gitRevision: getGitRevision(root),
    diffHash,
    commands: [{
      command: 'node --test',
      executionIdentity: 'pid-1',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:00:01.000Z',
      exitCode,
      stdout: '1 test passed',
      timeoutStatus: 'COMPLETED',
      testCounts: { passed: 1, failed: 0 }
    }]
  };
}

function claimedVsReality(root, reality = 'node --test: 1 passed, exit 0') {
  fs.mkdirSync(path.join(root, '.ai-engineering-loop/tasks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.ai-engineering-loop/tasks/claimed-vs-reality.md'),
    `# Claimed vs Reality\n\n| AC | Claimed | Reality from command log |\n|---|---|---|\n| AC-1 | fixed | ${reality} |\n`
  );
}

function advanceToVerified(root, diff) {
  writeArtifact(root, 'goal-contract.json', goal());
  applyGate(root, 'goal');
  const diffPath = writeArtifact(root, 'diff.patch', diff);
  applyGate(root, 'maker');
  const diffHash = hashFile(diffPath);
  writeArtifact(root, 'verification.json', verification(root, diffHash));
  applyGate(root, 'verification');
  return diffHash;
}

const DOC_DIFF = 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-teh\n+the\n';
const CODE_DIFF = 'diff --git a/src/list.js b/src/list.js\n--- a/src/list.js\n+++ b/src/list.js\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n';
const AUTH_DIFF = 'diff --git a/src/auth/session.js b/src/auth/session.js\n--- a/src/auth/session.js\n+++ b/src/auth/session.js\n@@ -1 +1 @@\n-x\n+y\n';

test('classification: trivial, default, and risky tasks with reasons', () => {
  assert.strictEqual(classifyTier({ task: 'Fix typo in README' }).tier, 'T0');
  assert.strictEqual(classifyTier({ task: 'whatever', changedPaths: ['docs/guide.md'] }).tier, 'T0');
  assert.strictEqual(classifyTier({ task: 'Add pagination to the list endpoint' }).tier, 'T1');
  const risky = classifyTier({ task: 'Fix login permission check' });
  assert.strictEqual(risky.tier, 'T2');
  assert.ok(risky.reasons.some((r) => r.code === 'RISKY_TASK_TEXT'));
  assert.strictEqual(classifyTier({ task: 'refactor', changedPaths: Array.from({ length: 11 }, (_, i) => `src/f${i}.js`) }).tier, 'T2');
  assert.strictEqual(classifyTier({ task: 'docs', changedPaths: ['src/payments/charge.js'] }).tier, 'T2');
  // Trivial wording does not win over size.
  assert.strictEqual(classifyTier({ task: 'fix typo', changedPaths: ['a.js', 'b.js', 'c.js', 'd.js'] }).tier, 'T1');
});

test('override requires a recorded reason; tiers rise from the Maker diff but never fall', () => {
  assert.throws(() => initialTierState({ task: 'x', override: 'T0' }), (err) => err.code === 'TIER_REASON_REQUIRED');
  const forced = initialTierState({ task: 'Fix login', override: 't1', overrideReason: 'copy change only' });
  assert.strictEqual(forced.current, 'T1');
  assert.strictEqual(forced.auto, 'T2');
  assert.strictEqual(forced.source, 'override');
  const t0 = initialTierState({ task: 'fix typo in README' });
  assert.strictEqual(raiseTierFromDiff(t0, { task: 'fix typo in README', diff: DOC_DIFF }), null);
  assert.strictEqual(raiseTierFromDiff(t0, { task: 'fix typo in README', diff: AUTH_DIFF }).current, 'T2');
  const big = `diff --git a/src/a.js b/src/a.js\n+++ b/src/a.js\n${'+x\n'.repeat(200)}`;
  assert.strictEqual(raiseTierFromDiff(initialTierState({ task: 'update docs' }), { task: 'update docs', diff: big }).current, 'T1');
  const t2 = initialTierState({ task: 'Fix login' });
  assert.strictEqual(raiseTierFromDiff(t2, { task: 'Fix login', diff: DOC_DIFF }), null);
});

test('T0: no subagents, still requires verification and claimed-vs-reality', () => {
  const root = tempRepo('Fix typo in README');
  writeArtifact(root, 'goal-contract.json', goal());
  applyGate(root, 'goal');
  writeArtifact(root, 'diff.patch', DOC_DIFF);
  applyGate(root, 'maker');
  // Verification cannot be skipped: review is not reachable from MAKER_COMPLETE.
  assert.throws(() => applyGate(root, 'review'));
  const diffHash = hashFile(artifactPath(root, 'run-001', 'diff.patch'));
  writeArtifact(root, 'verification.json', verification(root, diffHash));
  applyGate(root, 'verification');
  assert.throws(() => applyGate(root, 'review'), /claimed-vs-reality/);
  claimedVsReality(root);
  assert.strictEqual(applyGate(root, 'review').state, RUN_STATES.REVIEWED);
  const ledger = JSON.parse(fs.readFileSync(artifactPath(root, 'run-001', 'findings.json'), 'utf8'));
  assert.deepStrictEqual(ledger.findings, []);
  assert.strictEqual(ledger.tier, 'T0');
  assert.strictEqual(judgeRequirement(root, loadRun(root, 'run-001')).required, false);
  assert.strictEqual(applyGate(root, 'judge').state, RUN_STATES.JUDGED_PASS);
  const verdict = JSON.parse(fs.readFileSync(artifactPath(root, 'run-001', 'verdict.json'), 'utf8'));
  assert.strictEqual(verdict.decidedBy, 'deterministic-gate');
  // Delivery approval is unchanged.
  writeArtifact(root, 'delivery.json', { schemaVersion: 1, runId: 'run-001', destination: 'pr', summary: 'typo' });
  assert.throws(() => applyGate(root, 'delivery'), (err) => err.details.some((d) => d.includes('humanApproved')));
});

test('T1 without BLOCKER/HIGH passes deterministically without a Judge subagent', () => {
  const root = tempRepo('Add pagination to the list endpoint');
  const diffHash = advanceToVerified(root, CODE_DIFF);
  claimedVsReality(root);
  writeArtifact(root, 'findings.json', {
    schemaVersion: 1,
    runId: 'run-001',
    diffHash,
    findings: [{ id: 'F-1', location: 'src/list.js:1', failureScenario: 'naming nit', evidence: 'line 1', severity: 'LOW', validity: 'VALID', disposition: 'ACCEPTABLE', axis: 'standards' }]
  });
  applyGate(root, 'review');
  assert.strictEqual(loadRun(root, 'run-001').tier.current, 'T1');
  assert.strictEqual(applyGate(root, 'judge').state, RUN_STATES.JUDGED_PASS);
});

test('T1 with a BLOCKER requires the Judge subagent and then iterates', () => {
  const root = tempRepo('Add pagination to the list endpoint');
  const diffHash = advanceToVerified(root, CODE_DIFF);
  claimedVsReality(root);
  writeArtifact(root, 'findings.json', {
    schemaVersion: 1,
    runId: 'run-001',
    diffHash,
    findings: [{ id: 'F-1', location: 'src/list.js:1', failureScenario: 'off by one drops last page', evidence: 'line 1', severity: 'BLOCKER', validity: 'VALID', disposition: 'WEAK', concreteAlternativeDiff: '- a\n+ b' }]
  });
  applyGate(root, 'review');
  const requirement = judgeRequirement(root, loadRun(root, 'run-001'));
  assert.strictEqual(requirement.required, true);
  assert.ok(requirement.reasons.some((r) => r.startsWith('BLOCKER_OR_HIGH_FINDINGS')));
  assert.throws(() => applyGate(root, 'judge'), /Judge subagent required/);
  writeArtifact(root, 'verdict.json', { schemaVersion: 1, runId: 'run-001', verdict: 'ITERATE', reason: 'F-1 valid', action: 'fix' });
  const run = applyGate(root, 'judge');
  assert.strictEqual(run.state, RUN_STATES.GOAL_FROZEN);
  assert.strictEqual(run.iteration, 2);
});

test('T1 diff that touches auth rises to T2; T2 PASS needs STRONG_MODEL', () => {
  const root = tempRepo('Add pagination to the list endpoint');
  const diffHash = advanceToVerified(root, AUTH_DIFF);
  const run = loadRun(root, 'run-001');
  assert.strictEqual(run.tier.current, 'T2');
  assert.strictEqual(run.tier.history.at(-1).by, 'maker-diff');
  claimedVsReality(root);
  writeArtifact(root, 'findings.json', { schemaVersion: 1, runId: 'run-001', diffHash, findings: [] });
  applyGate(root, 'review');
  assert.throws(() => applyGate(root, 'judge'), /Judge subagent required/);
  writeArtifact(root, 'verdict.json', { schemaVersion: 1, runId: 'run-001', verdict: 'PASS', reason: 'ok', action: 'deliver', modelTier: 'CHEAP_MODEL' });
  assert.throws(() => applyGate(root, 'judge'), /STRONG_MODEL/);
  writeArtifact(root, 'verdict.json', { schemaVersion: 1, runId: 'run-001', verdict: 'PASS', reason: 'ok', action: 'deliver', modelTier: 'STRONG_MODEL' });
  assert.strictEqual(applyGate(root, 'judge').state, RUN_STATES.JUDGED_PASS);
});

test('legacy runs without a tier keep the full Judge requirement', () => {
  const root = tempRepo(null);
  const diffHash = advanceToVerified(root, CODE_DIFF);
  writeArtifact(root, 'findings.json', { schemaVersion: 1, runId: 'run-001', diffHash, findings: [] });
  applyGate(root, 'review');
  assert.throws(() => applyGate(root, 'judge'), /verdict\.json/);
});

test('CLI: run --json reports tier and reasons; recipe-bound T0 completes review and judge without subagents', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-tier-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-tier-cli-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'README.md'), 'teh project\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo","scripts":{"test":"node -e 0"}}\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx', '--allow-empty');
  const started = cli('run', '--json', 'Fix typo in README');
  assert.strictEqual(started.status, 0, started.stderr + started.stdout);
  const run = JSON.parse(started.stdout);
  assert.strictEqual(run.tier, 'T0');
  assert.strictEqual(run.subagents, 0);
  assert.ok(run.tierReasons.some((r) => r.code === 'TRIVIAL_TASK_TEXT'));
  const runDir = path.join(repo, '.ai-engineering-loop/runs', run.runId);
  fs.writeFileSync(path.join(runDir, 'goal-contract.json'), JSON.stringify({ ...goal(), runId: run.runId }));
  assert.strictEqual(cli('gate', 'goal').status, 0);
  fs.writeFileSync(path.join(repo, 'README.md'), 'the project\n');
  fs.writeFileSync(path.join(runDir, 'diff.patch'), execFileSync('git', ['diff'], { cwd: repo, encoding: 'utf8' }));
  const maker = cli('gate', 'maker');
  assert.strictEqual(maker.status, 0, maker.stdout + maker.stderr);
  const verify = cli('verification', 'record', '--', process.execPath, '-e', 'console.log("1 passing")');
  assert.strictEqual(verify.status, 0, verify.stdout + verify.stderr);
  assert.strictEqual(cli('gate', 'verification').status, 0);
  claimedVsReality(repo);
  const review = cli('gate', 'review', '--json');
  assert.strictEqual(review.status, 0, review.stdout + review.stderr);
  const reviewed = JSON.parse(review.stdout);
  assert.strictEqual(reviewed.judgeRequired, false);
  const judge = cli('gate', 'judge', '--json');
  assert.strictEqual(judge.status, 0, judge.stdout + judge.stderr);
  assert.strictEqual(JSON.parse(judge.stdout).state, 'JUDGED_PASS');
});
