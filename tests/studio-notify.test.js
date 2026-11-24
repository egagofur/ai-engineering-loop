'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createWaitTracker, osNotifier, quoteAppleScript } = require('../lib/studio/notify.js');

function runSummary(runId, kind) {
  return { runId, waiting: kind ? { kind, since: '2026-01-01T00:00:00Z' } : null };
}

function projectSummary(run, worktreeRuns = []) {
  return { id: 'p1', name: 'Acme', state: 'ok', run, worktreeRuns };
}

function recorder() {
  const calls = [];
  return { calls, notify: (title, body) => calls.push([title, body]) };
}

test('the same wait across updates notifies once', () => {
  const { calls, notify } = recorder();
  const tracker = createWaitTracker({ notify });
  const summaries = [projectSummary(runSummary('r1', 'freeze'))];
  tracker.update([]);
  tracker.update(summaries);
  tracker.update(summaries);
  assert.deepEqual(calls, [['AEL: Acme', 'Goal waiting for Freeze']]);
});

test('waits already open when Studio starts are seeded silently, so a restart does not repeat them', () => {
  const { calls, notify } = recorder();
  const tracker = createWaitTracker({ notify });
  tracker.update([projectSummary(runSummary('r1', 'freeze'))]);
  assert.deepEqual(calls, []);
  tracker.update([projectSummary(runSummary('r1', 'freeze'), [runSummary('w1', 'question')])]);
  assert.deepEqual(calls, [['AEL: Acme', 'Agent has a question']]);
});

test('a wait that clears and returns notifies again', () => {
  const { calls, notify } = recorder();
  const tracker = createWaitTracker({ notify });
  tracker.update([]);
  tracker.update([projectSummary(runSummary('r1', 'approval'))]);
  tracker.update([projectSummary(runSummary('r1', null))]);
  tracker.update([projectSummary(runSummary('r1', 'approval'))]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1], 'Delivery waiting for approval');
});

test('waits on worktree runs notify with the question copy', () => {
  const { calls, notify } = recorder();
  const tracker = createWaitTracker({ notify });
  tracker.update([]);
  tracker.update([projectSummary(null, [runSummary('w1', 'question')])]);
  assert.deepEqual(calls, [['AEL: Acme', 'Agent has a question']]);
});

test('run content never reaches the notification', () => {
  const { calls, notify } = recorder();
  const tracker = createWaitTracker({ notify });
  const run = Object.assign(runSummary('r1', 'freeze'), { title: 'He said "hi" \\ now' });
  tracker.update([]);
  tracker.update([projectSummary(run)]);
  assert.ok(!JSON.stringify(calls).includes('He said'));
});

test('quoteAppleScript escapes backslashes and quotes and flattens newlines', () => {
  assert.equal(quoteAppleScript('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(quoteAppleScript('a\nb\r\nc'), '"a b c"');
});

test('macOS runs osascript with an argument array', () => {
  const seen = [];
  osNotifier({ platform: 'darwin', run: (cmd, args) => seen.push([cmd, args]) })('AEL: "X"', 'Agent has a question');
  assert.deepEqual(seen, [['osascript', ['-e', 'display notification "Agent has a question" with title "AEL: \\"X\\""']]]);
});

test('linux uses notify-send only when found', () => {
  const seen = [];
  const run = (cmd, args) => seen.push([cmd, args]);
  osNotifier({ platform: 'linux', run, which: () => false })('t', 'b');
  assert.deepEqual(seen, []);
  osNotifier({ platform: 'linux', run, which: () => true })('t', 'b');
  assert.deepEqual(seen, [['notify-send', ['t', 'b']]]);
});

test('unsupported platforms do nothing and a throwing run is swallowed', () => {
  const run = () => { throw new Error('boom'); };
  assert.doesNotThrow(() => osNotifier({ platform: 'win32', run })('t', 'b'));
  assert.doesNotThrow(() => osNotifier({ platform: 'darwin', run })('t', 'b'));
});

test('the notifier runs asynchronously with a timeout and looks up notify-send once', () => {
  const seen = [];
  let lookups = 0;
  const run = (cmd, args, options, done) => seen.push({ cmd, args, options, done });
  const notifier = osNotifier({ platform: 'linux', run, which: () => { lookups += 1; return true; } });
  notifier('t', 'b');
  notifier('t2', 'b2');
  assert.equal(lookups, 1);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0].options, { timeout: 5000 });
  assert.equal(typeof seen[0].done, 'function');
  assert.doesNotThrow(() => seen[0].done(new Error('timed out')));
  osNotifier({ platform: 'darwin', run })('t', 'b');
  assert.deepEqual(seen[2].options, { timeout: 5000 });
});
