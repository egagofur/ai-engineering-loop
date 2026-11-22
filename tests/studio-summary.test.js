'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createRun } = require('../lib/run-state.js');
const { saveGoalDraft, freezeGoal, loadGoalDraft } = require('../lib/goal-runtime.js');
const { STAGES, summarizeProject, runDetail } = require('../lib/studio/summary.js');

function tempRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-summary-')));
  fs.mkdirSync(path.join(root, '.ai-engineering-loop', 'runs'), { recursive: true });
  return root;
}

function contract(runId) {
  return {
    schemaVersion: 1,
    runId,
    objective: 'Show the run',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'It shows', evidenceRequired: 'test', failureCases: ['hidden'] }]
  };
}

function drafted(root, runId, options = {}) {
  createRun(root, { runId, task: 'show the run', ...options });
  saveGoalDraft(root, runId, contract(runId), { actor: 'agent', expectedRevision: 0 });
}

function frozen(root, runId, options) {
  drafted(root, runId, options);
  freezeGoal(root, runId, { actor: 'Ega', studioSession: true, env: {} });
}

function project(root, extra = {}) {
  return { id: 'p1', name: 'x/y', path: root, missing: false, worktrees: [], ...extra };
}

function ringOf(summary) {
  return Object.fromEntries(summary.ring.map((entry) => [entry.stage, entry.status]));
}

test('STAGES lists the six stages in order', () => {
  assert.deepEqual(STAGES, ['goal', 'maker', 'verify', 'review', 'judge', 'deliver']);
});

test('a drafted Goal waits for freeze with the goal stage now', () => {
  const root = tempRoot();
  drafted(root, 'r1');
  const summary = summarizeProject(project(root));
  assert.equal(summary.state, 'waiting');
  assert.equal(summary.run.waiting.kind, 'freeze');
  assert.equal(ringOf(summary.run).goal, 'now');
  assert.equal(summary.run.stage, 'goal');
});

test('a frozen Goal moves the ring to maker and stops waiting', () => {
  const root = tempRoot();
  frozen(root, 'r1');
  const summary = summarizeProject(project(root));
  const ring = ringOf(summary.run);
  assert.equal(ring.goal, 'done');
  assert.equal(ring.maker, 'now');
  assert.equal(summary.run.waiting, null);
  assert.equal(summary.state, 'working');
});

test('a pointer to a missing Run is idle with no run', () => {
  const root = tempRoot();
  fs.writeFileSync(
    path.join(root, '.ai-engineering-loop', 'runs', 'current.json'),
    JSON.stringify({ schemaVersion: 1, runId: 'ghost' })
  );
  const summary = summarizeProject(project(root));
  assert.equal(summary.state, 'idle');
  assert.equal(summary.run, null);
});

test('a corrupt state.json is idle and does not throw', () => {
  const root = tempRoot();
  drafted(root, 'r1');
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'runs', 'r1', 'state.json'), '{nope');
  const summary = summarizeProject(project(root));
  assert.equal(summary.state, 'idle');
  assert.equal(summary.run, null);
});

test('a missing project is missing', () => {
  const summary = summarizeProject(project('/nonexistent/path', { missing: true }));
  assert.equal(summary.state, 'missing');
  assert.equal(summary.run, null);
});

test('a T0 quick Run skips review and judge', () => {
  const root = tempRoot();
  frozen(root, 'r1', { tier: 'T0' });
  const ring = ringOf(summarizeProject(project(root)).run);
  assert.equal(ring.review, 'skipped');
  assert.equal(ring.judge, 'skipped');
  assert.equal(ring.verify, 'pending');
});

test('worktree Runs are summarised from the worktree path', () => {
  const root = tempRoot();
  const wt = tempRoot();
  frozen(wt, 'w1');
  const summary = summarizeProject(project(root, { worktrees: [{ id: 'w', path: wt, branch: 'b', runId: 'w1' }] }));
  assert.equal(summary.run, null);
  assert.equal(summary.worktreeRuns.length, 1);
  assert.equal(summary.worktreeRuns[0].runId, 'w1');
  assert.equal(summary.state, 'working');
});

test('an unanswered question makes the Run wait', () => {
  const root = tempRoot();
  frozen(root, 'r1');
  const { appendRunQuestion } = require('../lib/run-interactions.js');
  appendRunQuestion(root, 'r1', { message: 'Which database?' });
  const summary = summarizeProject(project(root));
  assert.equal(summary.run.waiting.kind, 'question');
  assert.equal(summary.state, 'waiting');
});

test('elapsedMs counts from the Run start with an injected clock', () => {
  const root = tempRoot();
  drafted(root, 'r1');
  const summary = summarizeProject(project(root), { now: Date.now() + 5000 });
  assert.ok(summary.run.elapsedMs >= 5000 && summary.run.elapsedMs < 60000);
});

test('runDetail returns the Goal markdown and unconfirmed assumptions', () => {
  const root = tempRoot();
  frozen(root, 'r1');
  fs.writeFileSync(
    path.join(root, '.ai-engineering-loop', 'runs', 'r1', 'provenance.json'),
    JSON.stringify({ unconfirmed: ['Assumed the DB is local'] })
  );
  const detail = runDetail({ project: project(root), root, worktree: null }, 'r1');
  assert.match(detail.goalMarkdown, /^# Goal for Run/);
  assert.deepEqual(detail.unconfirmed, ['Assumed the DB is local']);
  assert.equal(detail.receipt, 'none');
  assert.equal(detail.findings, null);
  assert.equal(detail.pr, null);
  assert.deepEqual(detail.extraNodes, []);
  assert.equal(detail.summary.runId, 'r1');
});

test('runDetail carries the draft content hash Studio sends back as expectedHash', () => {
  const root = tempRoot();
  drafted(root, 'r1');
  const detail = runDetail({ project: project(root), root, worktree: null }, 'r1');
  assert.equal(detail.goalHash, loadGoalDraft(root, 'r1').metadata.contentHash);
  assert.match(detail.goalHash, /^[0-9a-f]{64}$/);
  createRun(root, { runId: 'r2', task: 'no draft' });
  assert.equal(runDetail({ project: project(root), root, worktree: null }, 'r2').goalHash, null);
});

test('runDetail counts findings and reports a written receipt', () => {
  const root = tempRoot();
  frozen(root, 'r1');
  const dir = path.join(root, '.ai-engineering-loop', 'runs', 'r1');
  fs.writeFileSync(path.join(dir, 'findings.json'), JSON.stringify({
    findings: [{ id: 'F1', severity: 'HIGH' }, { id: 'F2', severity: 'LOW' }]
  }));
  fs.writeFileSync(path.join(dir, 'receipt.json'), '{}');
  const detail = runDetail({ project: project(root), root, worktree: null }, 'r1');
  assert.deepEqual(detail.findings, { total: 2, blocking: 1 });
  assert.equal(detail.receipt, 'written');
});

test('runDetail refuses a run id that escapes the context directory', () => {
  const root = tempRoot();
  assert.throws(() => runDetail({ project: project(root), root, worktree: null }, '../../x'));
});

function outsideFile(content) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-outside-')));
  const file = path.join(dir, 'secret.json');
  fs.writeFileSync(file, content);
  return { dir, file };
}

function replaceWithSymlink(target, to) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.symlinkSync(to, target);
}

test('a symlinked state.json leaks nothing and the Run is idle', () => {
  const root = tempRoot();
  frozen(root, 'r1');
  const state = path.join(root, '.ai-engineering-loop', 'runs', 'r1', 'state.json');
  const outside = outsideFile(fs.readFileSync(state, 'utf8').replace('Show', 'LEAK'));
  replaceWithSymlink(state, outside.file);
  const summary = summarizeProject(project(root));
  assert.equal(summary.state, 'idle');
  assert.equal(summary.run, null);
  assert.throws(() => runDetail({ project: project(root), root, worktree: null }, 'r1'), { code: 'PATH_OUTSIDE_SCOPE' });
});

test('a symlinked provenance.json is refused by runDetail', () => {
  const root = tempRoot();
  frozen(root, 'r1');
  const outside = outsideFile(JSON.stringify({ unconfirmed: ['LEAK'] }));
  replaceWithSymlink(path.join(root, '.ai-engineering-loop', 'runs', 'r1', 'provenance.json'), outside.file);
  assert.throws(() => runDetail({ project: project(root), root, worktree: null }, 'r1'), { code: 'PATH_OUTSIDE_SCOPE' });
  assert.equal(summarizeProject(project(root)).run, null);
});

test('a symlinked run directory is idle and refused by runDetail', () => {
  const root = tempRoot();
  frozen(root, 'r1');
  const runDir = path.join(root, '.ai-engineering-loop', 'runs', 'r1');
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-outside-')));
  fs.cpSync(runDir, outside, { recursive: true });
  replaceWithSymlink(runDir, outside);
  assert.equal(summarizeProject(project(root)).run, null);
  assert.throws(() => runDetail({ project: project(root), root, worktree: null }, 'r1'), { code: 'PATH_OUTSIDE_SCOPE' });
});

test('a symlinked current.json is idle', () => {
  const root = tempRoot();
  frozen(root, 'r1');
  const pointer = path.join(root, '.ai-engineering-loop', 'runs', 'current.json');
  const outside = outsideFile(JSON.stringify({ schemaVersion: 1, runId: 'r1' }));
  replaceWithSymlink(pointer, outside.file);
  assert.equal(summarizeProject(project(root)).run, null);
});

test('a REPORTED Run is finished: idle, goal and maker done, rest skipped', () => {
  const root = tempRoot();
  drafted(root, 'r1');
  const statePath = path.join(root, '.ai-engineering-loop', 'runs', 'r1', 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  fs.writeFileSync(statePath, JSON.stringify({ ...state, state: 'REPORTED' }));
  const summary = summarizeProject(project(root));
  assert.equal(summary.state, 'idle');
  assert.equal(summary.run.stage, null);
  assert.equal(summary.run.waiting, null);
  assert.deepEqual(ringOf(summary.run), {
    goal: 'done', maker: 'done', verify: 'skipped', review: 'skipped', judge: 'skipped', deliver: 'skipped'
  });
});
