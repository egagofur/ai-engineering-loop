'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync, spawnSync } = require('node:child_process');
const { hashFile } = require('../lib/gates.js');
const { validateVerificationEvidence } = require('../lib/orchestration.js');
const {
  createRun,
  loadRun,
  runsDir,
  transitionRun
} = require('../lib/run-state.js');
const {
  MAX_CAPTURE_BYTES,
  recordVerificationCommand
} = require('../lib/verification-recorder.js');
const {
  scaffoldArtifact,
  validateArtifactFile
} = require('../lib/agent-artifacts.js');
const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-agent-ux-'));
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
  fs.mkdirSync(runsDir(root), { recursive: true });
  createRun(root, { runId: 'run-001', task: 'Improve agent-facing diagnostics' });

  const runDir = path.join(runsDir(root), 'run-001');
  const diffPath = path.join(runDir, 'diff.patch');
  fs.writeFileSync(diffPath, 'diff --git a/a.js b/a.js\n+const value = 1;\n');
  transitionRun(root, 'run-001', 'GOAL_FROZEN', { gate: 'goal' });
  transitionRun(root, 'run-001', 'MAKER_COMPLETE', {
    gate: 'maker',
    artifacts: {
      diff: {
        path: path.relative(root, diffPath).split(path.sep).join('/'),
        sha256: hashFile(diffPath)
      }
    }
  });
  return root;
}

test('verification record captures a real command and refreshes the summary', async () => {
  const root = tempRepo();
  const result = await recordVerificationCommand(root, {
    runId: 'run-001',
    command: process.execPath,
    args: ['-e', 'process.stdout.write("2 tests 2 passed\\n")']
  });

  assert.equal(result.command.exitCode, 0);
  assert.equal(result.command.timeoutStatus, 'COMPLETED');
  assert.match(result.command.executionIdentity, /^pid:\d+$/);
  assert.equal(validateVerificationEvidence(result.command).valid, true);
  assert.equal(result.summary.testCounts.passed, 2);
  assert.ok(fs.existsSync(path.join(runsDir(root), 'run-001', 'verification-summary.json')));
  const bundle = JSON.parse(fs.readFileSync(path.join(root, result.path), 'utf8'));
  assert.equal(bundle.commands.length, 1);
});

test('verification record preserves failure evidence without treating it as a pass', async () => {
  const root = tempRepo();
  const result = await recordVerificationCommand(root, {
    runId: 'run-001',
    command: process.execPath,
    args: ['-e', 'process.stderr.write("test failed\\n"); process.exit(7)']
  });

  assert.equal(result.command.exitCode, 7);
  assert.equal(result.command.stderr, 'test failed\n');
  assert.equal(result.summary.passed, false);
});

test('verification record redacts secrets and local paths from captured output', async () => {
  const root = tempRepo();
  const result = await recordVerificationCommand(root, {
    runId: 'run-001',
    command: process.execPath,
    args: ['-e', 'process.stdout.write("api_key=secret-value /Users/alice/private")']
  });

  assert.match(result.command.stdout, /api_key=\[REDACTED\] \[REDACTED HOME\]/);
  assert.doesNotMatch(result.command.stdout, /secret-value|\/Users\/alice/);
});

test('verification record refuses to run against a changed gated Maker diff', async () => {
  const root = tempRepo();
  fs.appendFileSync(path.join(runsDir(root), 'run-001', 'diff.patch'), 'changed after gate\n');
  const marker = path.join(root, 'verification-command-ran');

  await assert.rejects(
    recordVerificationCommand(root, {
      runId: 'run-001',
      command: process.execPath,
      args: ['-e', 'require("fs").writeFileSync(process.argv[1], "ran")', marker]
    }),
    { code: 'STALE_DIFF' }
  );
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.existsSync(path.join(runsDir(root), 'run-001', 'verification.json')), false);
});

test('verification record rejects a stale existing bundle before running another command', async () => {
  const root = tempRepo();
  const marker = path.join(root, 'verification-command-ran');
  fs.writeFileSync(path.join(runsDir(root), 'run-001', 'verification.json'), JSON.stringify({
    schemaVersion: 1,
    runId: 'run-001',
    gitRevision: 'stale-revision',
    diffHash: 'stale-diff',
    commands: []
  }));

  await assert.rejects(
    recordVerificationCommand(root, {
      runId: 'run-001',
      command: process.execPath,
      args: ['-e', 'require("fs").writeFileSync(process.argv[1], "ran")', marker]
    }),
    { code: 'STALE_VERIFICATION' }
  );
  assert.equal(fs.existsSync(marker), false);
});

test('verification record bounds output, marks timeouts, and never invokes a shell implicitly', async () => {
  const root = tempRepo();
  const marker = path.join(root, 'shell-was-run');
  const output = await recordVerificationCommand(root, {
    runId: 'run-001',
    command: process.execPath,
    args: ['-e', 'process.stdout.write(process.argv[1])', '$(touch shell-was-run)']
  });

  assert.equal(output.command.stdout, '$(touch shell-was-run)');
  assert.equal(fs.existsSync(marker), false);

  const oversized = await recordVerificationCommand(root, {
    runId: 'run-001',
    command: process.execPath,
    args: ['-e', 'process.stdout.write("x".repeat(300000))']
  });
  assert.equal(Buffer.byteLength(oversized.command.stdout), MAX_CAPTURE_BYTES);
  assert.equal(oversized.command.stdoutTruncated, true);

  const empty = await recordVerificationCommand(root, {
    runId: 'run-001',
    command: process.execPath,
    args: ['-e', 'process.exit(0)']
  });
  assert.equal(empty.command.stdout, '(no stdout)');
  assert.equal(empty.command.stdoutWasEmpty, true);
  assert.equal(validateVerificationEvidence(empty.command).valid, true);

  const timedOut = await recordVerificationCommand(root, {
    runId: 'run-001',
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    timeoutMs: 30
  });
  assert.equal(timedOut.command.timeoutStatus, 'TIMED_OUT');
  assert.ok(timedOut.command.exitCode !== 0);
});

test('artifact scaffolds are private, non-overwriting, and explicitly non-gatable', () => {
  const root = tempRepo();
  const result = scaffoldArtifact(root, { type: 'findings', runId: 'run-001' });
  const templatePath = path.join(root, result.path);
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));

  assert.equal(template._templateOnly, true);
  assert.equal(validateArtifactFile(root, { file: result.path }).valid, false);
  assert.throws(
    () => scaffoldArtifact(root, { type: 'findings', runId: 'run-001' }),
    { code: 'ARTIFACT_EXISTS' }
  );
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(templatePath).mode & 0o777, 0o600);
  }
});

test('artifact validator reports missing fields before a gate is attempted', () => {
  const root = tempRepo();
  const file = path.join(root, 'delivery.json');
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    runId: 'run-001',
    destination: ''
  }));

  const result = validateArtifactFile(root, { file: 'delivery.json' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('destination')));
  assert.ok(result.errors.some((error) => error.includes('summary')));
});

test('CLI records commands, scaffolds artifacts, and validates without advancing gates', () => {
  const root = tempRepo();
  const recorded = spawnSync(process.execPath, [
    CLI,
    'verification',
    'record',
    '--run',
    'run-001',
    '--json',
    '--',
    process.execPath,
    '-e',
    'process.stdout.write("2 tests 2 passed\\n")'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(recorded.status, 0, recorded.stderr);
  assert.equal(JSON.parse(recorded.stdout).ok, true);

  const scaffolded = JSON.parse(execFileSync(process.execPath, [
    CLI, 'scaffold', 'delivery', '--run', 'run-001', '--json'
  ], { cwd: root, encoding: 'utf8' }));
  assert.equal(scaffolded.templateOnly, true);
  const validated = spawnSync(process.execPath, [
    CLI, 'validate', scaffolded.path, '--json'
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(validated.status, 1);
  assert.equal(JSON.parse(validated.stdout).ok, false);
  assert.equal(loadRun(root, 'run-001').state, 'MAKER_COMPLETE');
});

test('gate diagnostics include the exact retry command for the same Run', () => {
  const root = tempRepo();
  const failed = spawnSync(process.execPath, [
    CLI, 'gate', 'verification', '--run', 'run-001', '--json'
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(failed.status, 1);
  const result = JSON.parse(failed.stdout);
  assert.equal(result.ok, false);
  assert.ok(result.details.some((detail) =>
    detail.includes('npx ai-engineering-loop gate verification --run run-001')
  ));
});

test('CLI claimed-vs-reality context command writes rows from the frozen Goal', () => {
  const root = tempRepo();
  const run = createRun(root, { runId: 'run-002', task: 'Generate an evidence checklist' });
  const runDir = path.join(runsDir(root), run.runId);
  const goalPath = path.join(runDir, 'goal-contract.json');
  fs.writeFileSync(goalPath, JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    objective: 'Make the Goal discoverable.',
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'Render every acceptance criterion.',
      evidenceRequired: 'A CLI test.',
      failureCases: ['The generated table omits AC-1.']
    }]
  }));
  transitionRun(root, run.runId, 'GOAL_FROZEN', {
    gate: 'goal',
    artifacts: {
      goalContract: {
        path: path.relative(root, goalPath).split(path.sep).join('/'),
        sha256: hashFile(goalPath)
      }
    }
  });

  const output = JSON.parse(execFileSync(process.execPath, [
    CLI, 'context', 'claimed-vs-reality', '--run', run.runId, '--json'
  ], { cwd: root, encoding: 'utf8' }));
  const markdown = fs.readFileSync(path.join(root, output.path), 'utf8');
  assert.match(markdown, /AC-1: Render every acceptance criterion/);
  assert.match(markdown, /\| AC \| Claimed \| Reality from command log \|/);
  assert.equal(output.runId, run.runId);
});
