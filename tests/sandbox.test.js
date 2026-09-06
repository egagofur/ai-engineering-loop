const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { applyGate, artifactPath } = require('../lib/gates.js');
const { RUN_MODES, RUN_STATES, createRun } = require('../lib/run-state.js');
const { updatePolicy } = require('../lib/runtime-policy.js');
const {
  abortSandbox,
  captureSandbox,
  createSandbox,
  sandboxPath
} = require('../lib/sandbox.js');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function tempGitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-sandbox-'));
  git(root, ['init']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(root, 'source.js'), 'module.exports = 1;\n');
  git(root, ['add', 'source.js']);
  git(root, ['commit', '-m', 'initial']);
  return root;
}

function freezeGoal(root, runId) {
  const filePath = artifactPath(root, runId, 'goal-contract.json');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({
    schemaVersion: 1,
    runId,
    objective: 'Change the exported value',
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'The value is changed',
      evidenceRequired: 'captured diff',
      failureCases: ['the old value remains']
    }]
  })}\n`);
  applyGate(root, 'goal', { runId });
}

test('unattended Maker captures only a disposable worktree diff with evidence', () => {
  const root = tempGitRepo();
  updatePolicy(root, { allowUnattended: true });
  createRun(root, { runId: 'run-001', mode: RUN_MODES.UNATTENDED });
  freezeGoal(root, 'run-001');
  const metadata = createSandbox(root, { runId: 'run-001' });
  fs.writeFileSync(path.join(metadata.worktreePath, 'source.js'), 'module.exports = 2;\n');
  const diffPath = artifactPath(root, 'run-001', 'diff.patch');
  fs.symlinkSync(path.join(root, 'source.js'), diffPath, 'file');
  const captured = captureSandbox(root, { runId: 'run-001' });
  assert.match(fs.readFileSync(captured.diffPath, 'utf8'), /module\.exports = 2/);
  assert.strictEqual(fs.lstatSync(diffPath).isFile(), true);
  assert.strictEqual(fs.existsSync(sandboxPath(root, 'run-001')), false);
  assert.strictEqual(fs.readFileSync(path.join(root, 'source.js'), 'utf8'), 'module.exports = 1;\n');
  assert.strictEqual(applyGate(root, 'maker', { runId: 'run-001' }).state, RUN_STATES.MAKER_COMPLETE);
});

test('a repository-wide Maker lock prevents concurrent sandboxes', () => {
  const root = tempGitRepo();
  createRun(root, { runId: 'run-001' });
  freezeGoal(root, 'run-001');
  createSandbox(root, { runId: 'run-001' });
  createRun(root, { runId: 'run-002' });
  freezeGoal(root, 'run-002');
  assert.throws(
    () => createSandbox(root, { runId: 'run-002' }),
    (err) => err.code === 'SANDBOX_LOCKED'
  );
  assert.deepStrictEqual(abortSandbox(root, { runId: 'run-001' }), {
    runId: 'run-001',
    aborted: true
  });
});

test('unattended Maker gate rejects a hand-written diff without sandbox evidence', () => {
  const root = tempGitRepo();
  updatePolicy(root, { allowUnattended: true });
  createRun(root, { runId: 'run-001', mode: RUN_MODES.UNATTENDED });
  freezeGoal(root, 'run-001');
  fs.writeFileSync(artifactPath(root, 'run-001', 'diff.patch'), 'diff --git a/a b/a\n+unsafe\n');
  assert.throws(
    () => applyGate(root, 'maker', { runId: 'run-001' }),
    /Missing or invalid sandbox-evidence/
  );
});
