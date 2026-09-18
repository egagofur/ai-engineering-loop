const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  summarizeVerificationBundle,
  writeVerificationSummary
} = require('../lib/verification-summary.js');
const { createRun, runsDir } = require('../lib/run-state.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-verification-summary-'));
  createRun(root, { runId: 'run-001' });
  fs.mkdirSync(path.join(runsDir(root), 'run-001'), { recursive: true });
  return root;
}

function sampleVerification() {
  return {
    schemaVersion: 1,
    runId: 'run-001',
    gitRevision: 'abc123',
    diffHash: 'def456',
    commands: [
      {
        command: 'npm test',
        exitCode: 0,
        timedOut: false,
        durationMs: 1234,
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.234Z',
        stdout: [
          'very long line that should not be copied into the summary',
          'tests 283',
          'pass 283',
          'fail 0'
        ].join('\n'),
        stderr: ''
      },
      {
        command: 'npm run lint',
        exitCode: 1,
        timedOut: false,
        durationMs: 50,
        stdout: '',
        stderr: 'lint failed at src/app.js:12'
      }
    ]
  };
}

test('verification summary preserves decision evidence without raw logs', () => {
  const summary = summarizeVerificationBundle(sampleVerification());

  assert.strictEqual(summary.commandCount, 2);
  assert.strictEqual(summary.exitCode, 1);
  assert.deepStrictEqual(summary.testCounts, { passed: 283, failed: 0, total: 283 });
  assert.deepStrictEqual(summary.commands.map((command) => command.command), ['npm test', 'npm run lint']);
  assert.match(summary.commands[1].failureExcerpt, /lint failed/);
  assert.doesNotMatch(JSON.stringify(summary), /very long line/);
});

test('verification summary writes a private run artifact for Judge context', () => {
  const root = tempRepo();
  fs.writeFileSync(
    path.join(runsDir(root), 'run-001', 'verification.json'),
    `${JSON.stringify(sampleVerification(), null, 2)}\n`
  );

  const result = writeVerificationSummary(root, { runId: 'run-001' });

  assert.strictEqual(result.summary.runId, 'run-001');
  assert.strictEqual(result.summary.exitCode, 1);
  assert.match(result.path, /\.ai-engineering-loop\/runs\/run-001\/verification-summary\.json/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, result.path), 'utf8'), /very long line/);
});

test('CLI verification summarize emits metadata only', () => {
  const root = tempRepo();
  fs.writeFileSync(
    path.join(runsDir(root), 'run-001', 'verification.json'),
    `${JSON.stringify(sampleVerification(), null, 2)}\n`
  );

  const output = execFileSync(process.execPath, [
    CLI,
    'verification',
    'summarize',
    '--run',
    'run-001',
    '--json'
  ], { cwd: root, encoding: 'utf8' });
  const parsed = JSON.parse(output);

  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.exitCode, 1);
  assert.doesNotMatch(output, /very long line/);
});
