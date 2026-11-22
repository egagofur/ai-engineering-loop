'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { verdictOf } = require('../lib/pr-status.js');
const { createRun } = require('../lib/run-state.js');
const { initialTierState } = require('../lib/tier.js');
const {
  backoffMs,
  babysit,
  classifyFix,
  decide,
  pushArgs,
  pushSameBranch
} = require('../lib/pr-babysit.js');
const { unknownWriterArgs } = require('../lib/cli-args.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');
const FAKE = path.join(__dirname, 'fixtures', 'fake-gh.js');

const open = (extra = {}) => ({
  number: 7,
  url: 'https://github.com/o/r/pull/7',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: 'APPROVED',
  statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  headRefName: 'ael/x',
  ...extra
});

function snapshot(extra = {}) {
  const pr = open(extra);
  return { pr: pr.number, url: pr.url, branch: pr.headRefName, ...verdictOf(pr) };
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

function initRepo(branch) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-babysit-'));
  git(root, ['init', '-q', '-b', branch]);
  git(root, ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init', '--allow-empty']);
  return root;
}

function watch(root, statuses, { startFix, push, maxPolls } = {}) {
  const seen = [];
  const sleeps = [];
  const started = [];
  const pushed = [];
  let index = 0;
  const result = babysit(root, {
    runId: 'run-1',
    maxPolls,
    sleep: (ms) => sleeps.push(ms),
    readStatus: () => {
      const status = statuses[Math.min(index, statuses.length - 1)];
      index += 1;
      seen.push(status.verdict);
      return status;
    },
    startFix: startFix || ((spec) => {
      started.push(spec);
      return { runId: 'fix-1', tier: spec.tier, resumed: false, next: `stay ${spec.branch}` };
    }),
    push: push || ((branch) => {
      pushed.push(pushArgs(branch));
      return { pushed: true };
    })
  });
  return { result, sleeps, started, pushed, seen };
}

test('backoff grows while checks are pending, then a ready PR stops for the human', () => {
  const waiting = snapshot({ reviewDecision: '', statusCheckRollup: [{ name: 'test', status: 'IN_PROGRESS' }] });
  const ready = snapshot();
  const { result, sleeps, started, pushed } = watch(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-babysit-')), [waiting, waiting, ready]);
  assert.deepStrictEqual(sleeps, [backoffMs(0), backoffMs(1)]);
  assert.deepStrictEqual(sleeps, [2000, 4000]);
  assert.strictEqual(result.action, 'stop');
  assert.strictEqual(result.reason, 'ready');
  assert.match(result.message, /You merge it/);
  assert.strictEqual(started.length, 0);
  assert.strictEqual(pushed.length, 0);
  assert.strictEqual(result.polls, 3);
});

test('changes requested stops even when checks are failing', () => {
  const status = snapshot({
    reviewDecision: 'CHANGES_REQUESTED',
    statusCheckRollup: [{ name: 'lint', conclusion: 'FAILURE' }]
  });
  assert.strictEqual(decide(status, 'T0').reason, 'changes-requested');
  const { result, started, pushed } = watch(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-babysit-')), [status]);
  assert.strictEqual(result.action, 'stop');
  assert.strictEqual(result.reason, 'changes-requested');
  assert.match(result.message, /Ask the human/);
  assert.strictEqual(started.length, 0);
  assert.strictEqual(pushed.length, 0);
});

test('failing checks use the run tier classifier: lint is T0, unit is T1, auth is T2', () => {
  assert.strictEqual(classifyFix(['lint']).tier, 'T0');
  assert.strictEqual(classifyFix(['unit']).tier, 'T1');
  assert.strictEqual(classifyFix(['auth']).tier, 'T2');
  assert.strictEqual(decide(snapshot({ state: 'MERGED' })).reason, 'merged');
  assert.strictEqual(decide(snapshot({ state: 'CLOSED' })).reason, 'closed');
  assert.strictEqual(decide(snapshot({ isDraft: true })).reason, 'blocker');
});

test('a T0 or T1 failure starts one fix pass and pushes that same branch', () => {
  const root = initRepo('ael/x');
  const lint = watch(root, [snapshot({ statusCheckRollup: [{ name: 'lint', conclusion: 'FAILURE' }] })]);
  assert.strictEqual(lint.result.action, 'fix');
  assert.strictEqual(lint.result.tier, 'T0');
  assert.strictEqual(lint.result.fixRunId, 'fix-1');
  assert.deepStrictEqual(lint.started[0].checks, ['lint']);
  assert.strictEqual(lint.started[0].branch, 'ael/x');
  assert.deepStrictEqual(lint.pushed, [['push', 'origin', 'ael/x']]);
  assert.strictEqual(git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'ael/x');

  const unit = watch(root, [snapshot({ statusCheckRollup: [{ name: 'unit', conclusion: 'FAILURE' }] })]);
  assert.strictEqual(unit.result.tier, 'T1');
  assert.deepStrictEqual(unit.pushed, [['push', 'origin', 'ael/x']]);
});

test('a starter that raises the fix to T2 does not push', () => {
  const root = initRepo('ael/x');
  const { result, pushed } = watch(root, [snapshot({ statusCheckRollup: [{ name: 'unit', conclusion: 'FAILURE' }] })], {
    startFix: () => ({ runId: 'fix-9', tier: 'T2', refused: true })
  });
  assert.strictEqual(result.action, 'stop');
  assert.strictEqual(result.reason, 'tier-t2');
  assert.strictEqual(result.fixRunId, 'fix-9');
  assert.strictEqual(pushed.length, 0);
});

test('a T2 failure stops and does not push', () => {
  const root = initRepo('ael/x');
  const { result, started, pushed } = watch(root, [snapshot({ statusCheckRollup: [{ name: 'auth', conclusion: 'FAILURE' }] })]);
  assert.strictEqual(result.action, 'stop');
  assert.strictEqual(result.reason, 'tier-t2');
  assert.strictEqual(result.tier, 'T2');
  assert.strictEqual(started.length, 0);
  assert.strictEqual(pushed.length, 0);
});

test('a risky dirty path raises the fix to T2 before a pass starts', () => {
  const root = initRepo('ael/x');
  fs.mkdirSync(path.join(root, 'src', 'auth'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'auth', 'session.js'), 'module.exports = {};\n');
  const { result, started, pushed } = watch(root, [snapshot({ statusCheckRollup: [{ name: 'lint', conclusion: 'FAILURE' }] })]);
  assert.strictEqual(classifyFix(['lint'], ['src/auth/session.js']).tier, 'T2');
  assert.strictEqual(result.reason, 'tier-t2');
  assert.strictEqual(started.length, 0);
  assert.strictEqual(pushed.length, 0);
});

test('a checkout on another branch stops before any fix or push', () => {
  const root = initRepo('main');
  const { result, started, pushed } = watch(root, [snapshot({ statusCheckRollup: [{ name: 'unit', conclusion: 'FAILURE' }] })]);
  assert.strictEqual(result.reason, 'wrong-branch');
  assert.strictEqual(result.next, 'git checkout ael/x');
  assert.strictEqual(started.length, 0);
  assert.strictEqual(pushed.length, 0);
  assert.strictEqual(git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'main');
});

test('an unfinished fix pass is pushed again and a second Run is not started', () => {
  const root = initRepo('ael/x');
  const task = 'Fix failing checks: lint';
  const run = createRun(root, { task, runId: 'fix-1', tier: initialTierState({ task }) });
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'runs', run.runId, 'fix-pass.json'), JSON.stringify({
    schemaVersion: 1, parentRunId: 'run-1', branch: 'ael/x', tier: 'T0', checks: ['lint']
  }));
  const { result, pushed } = watch(root, [snapshot({ statusCheckRollup: [{ name: 'lint', conclusion: 'FAILURE' }] })], {
    startFix: (spec) => require('../lib/pr-babysit.js').startFixPass(root, spec)
  });
  assert.strictEqual(result.action, 'fix');
  assert.strictEqual(result.resumed, true);
  assert.strictEqual(result.fixRunId, 'fix-1');
  assert.strictEqual(result.tier, 'T0');
  assert.deepStrictEqual(pushed, [['push', 'origin', 'ael/x']]);
  const runs = fs.readdirSync(path.join(root, '.ai-engineering-loop', 'runs')).filter((name) => name !== 'current.json');
  assert.deepStrictEqual(runs, ['fix-1']);
});

test('an unrelated unfinished Run blocks a new fix pass', () => {
  const root = initRepo('ael/x');
  createRun(root, { task: 'Add pagination', runId: 'busy', tier: initialTierState({ task: 'Add pagination' }) });
  const pushCalls = [];
  assert.throws(() => babysit(root, {
    runId: 'run-1',
    sleep: () => {},
    readStatus: () => snapshot({ statusCheckRollup: [{ name: 'unit', conclusion: 'FAILURE' }] }),
    push: (branch) => {
      pushCalls.push(branch);
      return { pushed: true };
    }
  }), (err) => err.code === 'ACTIVE_RUN' && /Finish Run busy/.test(err.fix));
  assert.deepStrictEqual(pushCalls, []);
});

test('push arguments are only git push origin <branch>', () => {
  assert.deepStrictEqual(pushArgs('ael/x'), ['push', 'origin', 'ael/x']);
  assert.ok(pushArgs('ael/x').every((arg) => !/merge/i.test(arg)));
  assert.throws(() => pushArgs('--force'), (err) => err.code === 'INVALID_BRANCH');
  assert.throws(() => pushArgs('refs/heads/ael/x:main'), (err) => err.code === 'INVALID_BRANCH');
  const source = fs.readFileSync(path.join(__dirname, '../lib/pr-babysit.js'), 'utf8');
  assert.doesNotMatch(source, /pr merge|git merge|gh pr merge/);
  assert.deepStrictEqual(unknownWriterArgs('pr', ['babysit', '--run', 'run-1', '--json']), []);
  assert.deepStrictEqual(unknownWriterArgs('pr', ['babysit', '--merge']), ['--merge']);
});

test('pushSameBranch publishes that branch and leaves HEAD there', () => {
  const repo = initRepo('ael/x');
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-babysit-bare-'));
  fs.writeFileSync(path.join(repo, 'README.md'), '# x\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  git(bare, ['init', '-q', '--bare']);
  git(repo, ['remote', 'add', 'origin', bare]);
  const pushed = pushSameBranch(repo, 'ael/x');
  assert.strictEqual(pushed.pushed, true);
  assert.strictEqual(git(bare, ['rev-parse', 'refs/heads/ael/x']).trim(), git(repo, ['rev-parse', 'HEAD']).trim());
  assert.strictEqual(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'ael/x');
  assert.strictEqual(git(repo, ['rev-list', '--merges', 'HEAD']).trim(), '');
});

test('pending checks give up after the poll cap', () => {
  const waiting = snapshot({ reviewDecision: '', statusCheckRollup: [{ name: 'test', status: 'IN_PROGRESS' }] });
  const { result, sleeps } = watch(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-babysit-')), [waiting], { maxPolls: 3 });
  assert.strictEqual(result.action, 'waiting');
  assert.strictEqual(result.polls, 3);
  assert.deepStrictEqual(sleeps, [2000, 4000]);
  assert.deepStrictEqual(result.waitingOn, ['test']);
});

test('missing gh is GH_UNAVAILABLE, the same fix as pr status', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-babysit-'));
  const runDir = path.join(root, '.ai-engineering-loop', 'runs', 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'delivery.json'), JSON.stringify({ destination: 'ael/x' }));
  const saved = process.env.AEL_GH_BIN;
  process.env.AEL_GH_BIN = path.join(root, 'no-such-gh');
  try {
    assert.throws(() => babysit(root, { runId: 'run-1', sleep: () => {} }), (err) => err.code === 'GH_UNAVAILABLE' && /Install gh/.test(err.fix));
  } finally {
    if (saved === undefined) delete process.env.AEL_GH_BIN;
    else process.env.AEL_GH_BIN = saved;
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-gh-')), 'gh.json');
  fs.writeFileSync(file, JSON.stringify({ view: { exit: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' } }));
  const previous = { bin: process.env.AEL_GH_BIN, ghFile: process.env.AEL_FAKE_GH_FILE };
  process.env.AEL_GH_BIN = FAKE;
  process.env.AEL_FAKE_GH_FILE = file;
  try {
    assert.throws(() => babysit(root, { runId: 'run-1', sleep: () => {} }), (err) => err.code === 'GH_UNAVAILABLE' && /auth login/.test(err.fix));
  } finally {
    if (previous.bin === undefined) delete process.env.AEL_GH_BIN;
    else process.env.AEL_GH_BIN = previous.bin;
    if (previous.ghFile === undefined) delete process.env.AEL_FAKE_GH_FILE;
    else process.env.AEL_FAKE_GH_FILE = previous.ghFile;
  }
  assert.throws(() => babysit(root, {}), (err) => err.code === 'INVALID_USAGE');
});

test('the CLI rejects a merge flag and reports GH_UNAVAILABLE as JSON', () => {
  const usage = spawnSync(process.execPath, [CLI, 'pr', 'babysit', '--json'], { encoding: 'utf8' });
  assert.notStrictEqual(usage.status, 0);
  assert.strictEqual(JSON.parse(usage.stdout).code, 'INVALID_USAGE');

  const refused = spawnSync(process.execPath, [CLI, 'pr', 'babysit', '--run', 'run-1', '--merge'], { encoding: 'utf8' });
  assert.strictEqual(refused.status, 2);
  assert.match(`${refused.stdout}\n${refused.stderr}`, /--merge/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-babysit-'));
  const runDir = path.join(root, '.ai-engineering-loop', 'runs', 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'delivery.json'), JSON.stringify({ destination: 'ael/x' }));
  const missing = spawnSync(process.execPath, [CLI, 'pr', 'babysit', '--run', 'run-1', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, AEL_GH_BIN: path.join(root, 'no-such-gh') }
  });
  assert.strictEqual(missing.status, 1);
  const body = JSON.parse(missing.stdout);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.code, 'GH_UNAVAILABLE');
  assert.match(body.fix, /Install gh/);
});

test('CLI babysit --json stops when the PR is ready to merge', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-babysit-'));
  const runDir = path.join(root, '.ai-engineering-loop', 'runs', 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'delivery.json'), JSON.stringify({ destination: 'ael/x' }));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-gh-')), 'gh.json');
  fs.writeFileSync(file, JSON.stringify({ view: open() }));
  const result = spawnSync(process.execPath, [CLI, 'pr', 'babysit', '--run', 'run-1', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, AEL_GH_BIN: FAKE, AEL_FAKE_GH_FILE: file, AEL_NO_AUTO_UPDATE: '1' }
  });
  assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const body = JSON.parse(result.stdout);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.action, 'stop');
  assert.strictEqual(body.reason, 'ready');
  assert.strictEqual(body.pr, 7);
  assert.match(body.message, /You merge it/);
});

test('a real T0 fix pass stays on the PR branch', () => {
  const root = initRepo('ael/x');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-babysit-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_AUTO_UPDATE: '1' };
  fs.writeFileSync(path.join(root, 'README.md'), '# Demo\n');
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"demo","scripts":{"test":"node --version"}}\n');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  const init = spawnSync(process.execPath, [CLI, 'init'], { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(init.status, 0, `${init.stdout}\n${init.stderr}`);
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx']);
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    AEL_HOME: process.env.AEL_HOME
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.AEL_HOME = home;
  const pushed = [];
  try {
    const result = babysit(root, {
      runId: 'run-1',
      sleep: () => {},
      readStatus: () => snapshot({ statusCheckRollup: [{ name: 'lint', conclusion: 'FAILURE' }] }),
      push: (branch) => {
        pushed.push(pushArgs(branch));
        return { pushed: true };
      }
    });
    assert.strictEqual(result.action, 'fix');
    assert.strictEqual(result.tier, 'T0');
    assert.strictEqual(result.resumed, false);
    assert.strictEqual(git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'ael/x');
    assert.deepStrictEqual(pushed, [['push', 'origin', 'ael/x']]);
    const recorded = JSON.parse(fs.readFileSync(path.join(root, '.ai-engineering-loop', 'runs', result.fixRunId, 'fix-pass.json'), 'utf8'));
    assert.deepStrictEqual({ parent: recorded.parentRunId, branch: recorded.branch, tier: recorded.tier, checks: recorded.checks }, {
      parent: 'run-1', branch: 'ael/x', tier: 'T0', checks: ['lint']
    });
    const state = JSON.parse(fs.readFileSync(path.join(root, '.ai-engineering-loop', 'runs', result.fixRunId, 'state.json'), 'utf8'));
    assert.strictEqual(state.tier.current, 'T0');
    assert.match(result.next, /Stay on ael\/x/);
    assert.match(result.next, /quick finish/);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
