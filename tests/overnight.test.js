'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createRun, runsDir } = require('../lib/run-state.js');
const { appendRunQuestion } = require('../lib/run-interactions.js');
const { readDoc } = require('../lib/docs.js');
const { CONTRACT, morningReview } = require('../lib/overnight.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-night-'));
  fs.mkdirSync(path.join(dir, '.ai-engineering-loop'), { recursive: true });
  return dir;
}

function writeState(dir, run, patch) {
  const file = path.join(runsDir(dir), run.runId, 'state.json');
  const state = { ...JSON.parse(fs.readFileSync(file, 'utf8')), ...patch };
  fs.writeFileSync(file, JSON.stringify(state));
  return state;
}

function packet(dir, run) {
  const folder = path.join(runsDir(dir), run.runId);
  fs.writeFileSync(path.join(folder, 'diff.patch'), 'diff --git a/a.js b/a.js\n');
  fs.writeFileSync(path.join(folder, 'verification.json'), '{"commands":[{"exitCode":0,"timeoutStatus":"COMPLETED"}]}\n');
  fs.writeFileSync(path.join(folder, 'verdict.json'), '{"verdict":"PASS"}\n');
}

test('docs overnight-contract states the may, must-not, stop, and morning rules', () => {
  const doc = readDoc('overnight-contract');
  assert.strictEqual(doc.rel, 'core/overnight-contract.md');
  for (const word of ['UNATTENDED', 'must not', 'JUDGED_PASS', 'diff.patch', 'overnight check', 'deliver --approve']) {
    assert.ok(doc.text.includes(word), word);
  }
  for (const code of CONTRACT.stopWhen) assert.ok(doc.text.includes(code), code);
});

test('an unattended run with no frozen Goal stops as GOAL_NOT_FROZEN and may not continue', () => {
  const dir = project();
  const run = createRun(dir, { task: 'Night job', mode: 'UNATTENDED' });
  const report = morningReview(dir, { runId: run.runId });
  assert.strictEqual(report.applies, true);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.mayContinue, false);
  assert.strictEqual(report.stopReason, 'GOAL_NOT_FROZEN');
  assert.deepStrictEqual(report.morning.missing, []);
  assert.deepStrictEqual(report.violations, []);
});

test('JUDGED_PASS without the morning files fails the check; the files make it pass', () => {
  const dir = project();
  const run = createRun(dir, { task: 'Night job', mode: 'UNATTENDED' });
  writeState(dir, run, { state: 'JUDGED_PASS', goal: { frozen: true, version: 1 } });
  const open = morningReview(dir, { runId: run.runId });
  assert.strictEqual(open.ok, false);
  assert.strictEqual(open.stopReason, 'JUDGED_PASS');
  assert.deepStrictEqual(open.morning.missing, ['diff.patch', 'verification.json', 'verdict.json']);
  packet(dir, run);
  const ready = morningReview(dir, { runId: run.runId });
  assert.strictEqual(ready.ok, true);
  assert.strictEqual(ready.mayContinue, false);
  assert.deepStrictEqual(ready.morning.missing, []);
});

test('delivery without a person is a violation; a named human approval is the morning close', () => {
  const dir = project();
  const run = createRun(dir, { task: 'Night job', mode: 'UNATTENDED' });
  writeState(dir, run, { state: 'DELIVERED', goal: { frozen: true, version: 1 } });
  const shipped = morningReview(dir, { runId: run.runId });
  assert.strictEqual(shipped.ok, false);
  assert.strictEqual(shipped.violations[0].id, 'DELIVERED_WITHOUT_HUMAN');
  packet(dir, run);
  fs.writeFileSync(path.join(runsDir(dir), run.runId, 'delivery.json'), JSON.stringify({ humanApproved: true, approvedBy: 'ael-agent' }));
  assert.strictEqual(morningReview(dir, { runId: run.runId }).violations[0].id, 'DELIVERED_WITHOUT_HUMAN');
  fs.writeFileSync(path.join(runsDir(dir), run.runId, 'delivery.json'), JSON.stringify({ humanApproved: true, approvedBy: 'ada' }));
  const closed = morningReview(dir, { runId: run.runId });
  assert.strictEqual(closed.ok, true);
  assert.strictEqual(closed.stopReason, 'MORNING_APPROVED');
});

test('a pending question, a guard block, the kill switch, and a red verify at the cap each stop the run', () => {
  const dir = project();
  const run = createRun(dir, { task: 'Night job', mode: 'UNATTENDED' });
  writeState(dir, run, { state: 'GOAL_FROZEN', goal: { frozen: true, version: 1 }, iteration: 1 });
  appendRunQuestion(dir, run.runId, { message: 'Which column is the total?' });
  assert.strictEqual(morningReview(dir, { runId: run.runId }).stopReason, 'NEEDS_HUMAN');

  const blocked = createRun(dir, { task: 'Blocked', mode: 'UNATTENDED' });
  writeState(dir, blocked, { state: 'GOAL_FROZEN', goal: { frozen: true, version: 1 } });
  fs.writeFileSync(path.join(runsDir(dir), blocked.runId, 'guard-events.json'), JSON.stringify({ events: [{ decision: 'block', rules: ['scope-outside'] }] }));
  assert.strictEqual(morningReview(dir, { runId: blocked.runId }).stopReason, 'GUARD_BLOCK');

  const red = createRun(dir, { task: 'Red', mode: 'UNATTENDED' });
  writeState(dir, red, { state: 'MAKER_COMPLETE', goal: { frozen: true, version: 1 }, iteration: 1 });
  fs.writeFileSync(path.join(runsDir(dir), red.runId, 'verification.json'), JSON.stringify({ commands: [{ exitCode: 1, timeoutStatus: 'COMPLETED' }] }));
  assert.strictEqual(morningReview(dir, { runId: red.runId }).mayContinue, true);
  writeState(dir, red, { state: 'MAKER_COMPLETE', goal: { frozen: true, version: 1 }, iteration: 3 });
  assert.strictEqual(morningReview(dir, { runId: red.runId }).stopReason, 'VERIFY_STILL_RED');

  const paused = createRun(dir, { task: 'Paused', mode: 'UNATTENDED' });
  writeState(dir, paused, { state: 'GOAL_FROZEN', goal: { frozen: true, version: 1 } });
  fs.writeFileSync(path.join(dir, '.ai-engineering-loop', 'runtime-policy.json'), JSON.stringify({
    schemaVersion: 1, defaultMode: 'ASSISTED', reviewProfile: 'lean', allowUnattended: true,
    requireSandboxForUnattended: true, perRunTokenLimit: 50000, dailyTokenLimit: 200000, killSwitch: true
  }));
  assert.strictEqual(morningReview(dir, { runId: paused.runId }).stopReason, 'BUDGET');
});

test('an assisted run does not apply, and the CLI exits 1 only when the contract fails', () => {
  const dir = project();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-night-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8' });
  const none = cli('overnight', 'check', '--json');
  const assisted = createRun(dir, { task: 'Day job', mode: 'ASSISTED' });
  const quiet = morningReview(dir, { runId: assisted.runId });
  assert.strictEqual(quiet.applies, false);
  assert.strictEqual(quiet.ok, true);
  assert.strictEqual(none.status, 0, none.stdout + none.stderr);
  assert.strictEqual(JSON.parse(none.stdout).reason, 'NO_RUN');
  assert.strictEqual(JSON.parse(none.stdout).contract.id, 'overnight-v1');
  writeState(dir, assisted, { state: 'JUDGED_PASS', goal: { frozen: true, version: 1 }, mode: 'UNATTENDED' });
  fs.writeFileSync(path.join(dir, '.ai-engineering-loop', 'runs', 'current.json'), JSON.stringify({ schemaVersion: 1, runId: assisted.runId }));
  const failed = cli('overnight', 'check', '--json');
  assert.strictEqual(failed.status, 1);
  assert.strictEqual(JSON.parse(failed.stdout).stopReason, 'JUDGED_PASS');
  assert.match(cli('overnight', 'nope').stderr + cli('overnight', 'nope').stdout, /overnight check/);
});
