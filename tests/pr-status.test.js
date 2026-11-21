'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verdictOf, prStatus, loadMerge } = require('../lib/pr-status.js');

const FAKE = path.join(__dirname, 'fixtures', 'fake-gh.js');

function withGh(fixture, fn) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-gh-')), 'gh.json');
  fs.writeFileSync(file, JSON.stringify(fixture));
  const saved = { bin: process.env.AEL_GH_BIN, file: process.env.AEL_FAKE_GH_FILE };
  process.env.AEL_GH_BIN = FAKE;
  process.env.AEL_FAKE_GH_FILE = file;
  try {
    return fn();
  } finally {
    if (saved.bin === undefined) delete process.env.AEL_GH_BIN; else process.env.AEL_GH_BIN = saved.bin;
    if (saved.file === undefined) delete process.env.AEL_FAKE_GH_FILE; else process.env.AEL_FAKE_GH_FILE = saved.file;
  }
}

const open = (extra = {}) => ({ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED', statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }], headRefName: 'ael/x', ...extra });

test('C-42 verdicts and named blockers come from the PR state', () => {
  assert.strictEqual(verdictOf(open()).verdict, 'ready');
  assert.strictEqual(verdictOf(open({ state: 'MERGED' })).verdict, 'merged');
  assert.strictEqual(verdictOf(open({ state: 'CLOSED' })).verdict, 'closed');
  const blocked = verdictOf(open({ isDraft: true, mergeable: 'CONFLICTING', reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: [{ name: 'lint', conclusion: 'FAILURE' }, { name: 'test', conclusion: 'SUCCESS' }] }));
  assert.deepStrictEqual(blocked, { verdict: 'blocker', blockers: ['draft', 'merge-conflicts', 'failing-checks: lint', 'changes-requested'] });
  assert.deepStrictEqual(verdictOf(open({ statusCheckRollup: [{ name: 'test', status: 'IN_PROGRESS' }] })), { verdict: 'waiting', blockers: [], waitingOn: ['test'] });
  assert.deepStrictEqual(verdictOf(open({ reviewDecision: 'REVIEW_REQUIRED' })).waitingOn, ['review']);
});

test('C-42 a merged PR is recorded once in merge.json for the Run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-pr-'));
  const runDir = path.join(root, '.ai-engineering-loop', 'runs', 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'delivery.json'), JSON.stringify({ destination: 'ael/x' }));
  withGh({ view: open({ state: 'MERGED', mergedAt: '2026-11-21T01:00:00Z', mergeCommit: { oid: 'abc123' } }) }, () => {
    const first = prStatus(root, { runId: 'run-1' });
    assert.strictEqual(first.verdict, 'merged');
    assert.strictEqual(first.mergeRecorded, true);
    assert.strictEqual(prStatus(root, { runId: 'run-1' }).mergeRecorded, false);
  });
  assert.deepStrictEqual({ pr: loadMerge(root, 'run-1').pr, commit: loadMerge(root, 'run-1').mergeCommit }, { pr: 7, commit: 'abc123' });
});

test('C-42 missing or signed-out gh fails with a fix, never a guess', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-pr-'));
  const saved = process.env.AEL_GH_BIN;
  process.env.AEL_GH_BIN = path.join(root, 'no-such-gh');
  try {
    assert.throws(() => prStatus(root, { pr: 7 }), (err) => err.code === 'GH_UNAVAILABLE' && /Install gh/.test(err.fix));
  } finally {
    if (saved === undefined) delete process.env.AEL_GH_BIN; else process.env.AEL_GH_BIN = saved;
  }
  withGh({ view: { exit: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' } }, () => {
    assert.throws(() => prStatus(root, { pr: 7 }), (err) => err.code === 'GH_UNAVAILABLE' && /auth login/.test(err.fix));
  });
  assert.throws(() => prStatus(root, {}), (err) => err.code === 'INVALID_USAGE');
});
