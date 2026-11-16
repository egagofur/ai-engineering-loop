'use strict';

// C-13: post-delivery outcomes calibrate the reviewer.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createRun } = require('../lib/run-state.js');
const { calibrate, recordOutcome } = require('../lib/calibration.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-calib-'));
  createRun(root, { runId: 'run-1', task: 'x' });
  fs.writeFileSync(path.join(root, '.ai-engineering-loop/runs/run-1/findings.json'), JSON.stringify({
    reviewer: { promptSha256: 'abc123def4567890' },
    findings: [
      { id: 'F-1', location: 'src/pay.js:10', validity: 'INVALID', dismissal: { by: 'maker', evidence: 'covered' } },
      { id: 'F-2', location: 'src/list.js:4', validity: 'VALID', severity: 'LOW' }
    ]
  }));
  return root;
}

test('AC-1/AC-2 outcomes are classified as DA miss, false dismissal, or caught-but-shipped', () => {
  const root = fixture();
  recordOutcome(root, { runId: 'run-1', source: 'bug', location: 'src/auth.js:3', summary: 'token not refreshed', by: 'qa' });
  recordOutcome(root, { runId: 'run-1', source: 'revert', location: 'src/pay.js', summary: 'double charge', by: 'ega' });
  recordOutcome(root, { runId: 'run-1', source: 'mr-comment', location: 'src/list.js:9', summary: 'slow page', by: 'rev' });
  const report = calibrate(root);
  assert.deepStrictEqual(report.rows.map((r) => r.verdict), ['DA_MISS', 'FALSE_DISMISS', 'CAUGHT_BUT_SHIPPED']);
  assert.deepStrictEqual(report.rows[1].findings, ['F-1']);
  assert.strictEqual(report.byPrompt.abc123def456.DA_MISS, 1);
});

test('outcome record requires a human reporter, a known source and a location', () => {
  const root = fixture();
  assert.throws(() => recordOutcome(root, { runId: 'run-1', source: 'gossip', location: 'a', summary: 's', by: 'x' }), /--source/);
  assert.throws(() => recordOutcome(root, { runId: 'run-1', source: 'bug', location: 'a', summary: 's' }), /--by/);
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(cli('outcome', 'record', '--run', 'run-1', '--source', 'bug', '--location', 'src/x.js', '--summary', 'boom', '--by', 'qa', '--json').status, 0);
  const report = JSON.parse(cli('calibrate', '--json').stdout);
  assert.strictEqual(report.daMiss, 1);
});
