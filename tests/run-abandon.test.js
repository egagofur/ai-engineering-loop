'use strict';

// Issue #46: `run --abandon` closes a stale run (CANCELLED, ledger entry,
// current.json released) so refresh/auto-update process the project again.
// Sandbox HOME only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const { createRun, loadRun, currentRunPath, runStatePath } = require('../lib/run-state.js');
const runAbandon = require('../lib/run-abandon.js');
const au = require('../lib/auto-update.js');

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-ab-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_AUTO_UPDATE: '1' };
  delete env.CI;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-ab-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p"}\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8', input: '' });
  assert.strictEqual(cli('init').status, 0);
  return { home, env, dir, cli };
}

// Put a run into a given state/age directly, as an abandoned session leaves it.
function age(dir, runId, state, days = 10) {
  const file = runStatePath(dir, runId);
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  run.state = state;
  run.updatedAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(run));
}

const snapshot = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(dir, abs)] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(path.join(dir, '.ai-engineering-loop'));
  return out;
};

test('ASSISTED: needs confirmation, then CANCELLED with reason/actor/time in the ledger and current.json released', () => {
  const { dir, cli } = setup();
  const run = createRun(dir, { task: 'Old feature', runId: '20260914T054430Z-ed6447f6' });
  age(dir, run.runId, 'JUDGED_PASS');
  const before = snapshot(dir);

  const unconfirmed = cli('run', '--abandon', '--reason', 'left behind', '--by', 'ega');
  assert.strictEqual(unconfirmed.status, 1);
  assert.match(unconfirmed.stdout, /--yes/);
  assert.deepStrictEqual(snapshot(dir), before, 'nothing written without confirmation');
  for (const missing of [['--by', 'ega'], ['--reason', 'x']]) {
    const r = cli('run', '--abandon', '--yes', ...missing);
    assert.strictEqual(r.status, 1, r.stdout);
  }
  assert.deepStrictEqual(snapshot(dir), before);

  const r = cli('run', '--abandon', '--reason', 'left behind', '--by', 'ega', '--yes', '--json');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.state, 'CANCELLED');
  assert.strictEqual(out.from, 'JUDGED_PASS');
  assert.strictEqual(out.released, true);
  const after = loadRun(dir, run.runId);
  assert.strictEqual(after.state, 'CANCELLED');
  const entry = after.history.at(-1);
  assert.deepStrictEqual([entry.from, entry.to, entry.gate, entry.reason, entry.actor, entry.action], ['JUDGED_PASS', 'CANCELLED', 'run-abandoned', 'left behind', 'ega', 'abandon']);
  assert.ok(Date.parse(entry.at));
  assert.ok(!fs.existsSync(currentRunPath(dir)));
  assert.ok(fs.existsSync(runStatePath(dir, run.runId)), 'run data kept');
});

test('UNATTENDED: refused without --yes (exit 2), allowed with a human --yes', () => {
  const { dir, cli } = setup();
  const run = createRun(dir, { task: 'Night job', mode: 'UNATTENDED' });
  age(dir, run.runId, 'REVIEWED');
  const refused = cli('run', '--abandon', '--reason', 'stuck', '--by', 'agent-x', '--json');
  assert.strictEqual(refused.status, 2);
  assert.strictEqual(JSON.parse(refused.stdout).code, 'UNATTENDED_REQUIRES_HUMAN');
  assert.strictEqual(loadRun(dir, run.runId).state, 'REVIEWED');
  const ok = cli('run', '--abandon', '--reason', 'stuck', '--by', 'ega', '--yes', '--json');
  assert.strictEqual(ok.status, 0, ok.stdout);
  assert.strictEqual(loadRun(dir, run.runId).state, 'CANCELLED');
});

test('terminal runs and no current run exit 2 with a clear message', () => {
  const { dir, cli } = setup();
  const none = cli('run', '--abandon', '--reason', 'x', '--by', 'ega', '--yes');
  assert.strictEqual(none.status, 2);
  assert.match(none.stdout, /No current run to abandon/);
  for (const state of ['DELIVERED', 'REPORTED', 'ESCALATED', 'CANCELLED']) {
    const run = createRun(dir, { task: state });
    age(dir, run.runId, state);
    const r = cli('run', '--abandon', '--run', run.runId, '--reason', 'x', '--by', 'ega', '--yes', '--json');
    assert.strictEqual(r.status, 2, state);
    assert.strictEqual(JSON.parse(r.stdout).code, 'RUN_ALREADY_FINISHED');
    assert.match(JSON.parse(r.stdout).error, new RegExp(`already finished \\(${state}\\)`));
  }
});

test('--run <id> non-current abandons that run and keeps the current pointer', () => {
  const { dir, cli } = setup();
  const old = createRun(dir, { task: 'old' });
  age(dir, old.runId, 'REVIEWED');
  const current = createRun(dir, { task: 'current' });
  assert.strictEqual(JSON.parse(fs.readFileSync(currentRunPath(dir), 'utf8')).runId, current.runId);
  const r = cli('run', '--abandon', '--run', old.runId, '--reason', 'superseded', '--by', 'ega', '--yes', '--json');
  assert.strictEqual(r.status, 0, r.stdout);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.released, false);
  assert.strictEqual(out.current, current.runId);
  assert.strictEqual(loadRun(dir, old.runId).state, 'CANCELLED');
  assert.strictEqual(loadRun(dir, current.runId).state, 'STARTED');
  assert.strictEqual(JSON.parse(fs.readFileSync(currentRunPath(dir), 'utf8')).runId, current.runId);
});

test('--help has no side effects and unknown flags are rejected before writing', () => {
  const { dir, cli } = setup();
  const run = createRun(dir, { task: 't' });
  const before = snapshot(dir);
  for (const flag of ['--help', '-h']) {
    const r = cli('run', '--abandon', flag, '--reason', 'x', '--by', 'ega', '--yes');
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /--abandon \[--run <id>\]/);
  }
  const bad = cli('run', '--abandon', '--reason', 'x', '--by', 'ega', '--yes', '--force');
  assert.strictEqual(bad.status, 2);
  assert.match(bad.stdout, /Unknown argument\(s\) for "run": --force\. Nothing was written\./);
  const stray = cli('run', '--abandon', 'extra-word', '--yes');
  assert.strictEqual(stray.status, 2);
  assert.deepStrictEqual(snapshot(dir), before);
  assert.strictEqual(loadRun(dir, run.runId).state, 'STARTED');
});

test('skipping-refresh message suggests run --abandon; after abandon refresh and update auto process the project', () => {
  const { home, dir, cli } = setup();
  const run = createRun(dir, { task: 'stale' });
  age(dir, run.runId, 'REVIEWED');
  const skipped = cli('refresh', '--non-destructive');
  assert.strictEqual(skipped.status, 3);
  assert.match(skipped.stdout, /skipping refresh/);
  assert.match(skipped.stdout, new RegExp(`run --abandon --run ${run.runId} --reason`));

  // update auto (injected exec) keeps it pending while the run is active ...
  const readCurrentRun = (d) => {
    const r = require('../lib/run-state.js').getCurrentRun(d);
    return r ? { ...r, terminal: require('../lib/run-state.js').TERMINAL_STATES.has(r.state) } : null;
  };
  const us = require('../lib/user-state.js');
  us.writeJsonFile(us.userStatePath('update-state.json', home), { pendingProjects: [dir] });
  const calls = [];
  const exec = (cmd, args, opts) => calls.push({ cmd: [cmd, ...args].join(' '), cwd: opts && opts.cwd });
  let result = au.processPending({ projects: [{ path: dir }], home, exec, readCurrentRun });
  assert.deepStrictEqual(result.pending, [dir]);
  assert.strictEqual(calls.length, 0);

  assert.strictEqual(cli('run', '--abandon', '--reason', 'stale', '--by', 'ega', '--yes').status, 0);
  result = au.processPending({ projects: [{ path: dir }], home, exec, readCurrentRun });
  assert.deepStrictEqual(result.refreshed, [dir]);
  assert.ok(calls.some((c) => c.cmd.endsWith('refresh --non-destructive') && c.cwd === dir));
  const refreshed = cli('refresh', '--non-destructive', '--json');
  assert.strictEqual(refreshed.status, 0, refreshed.stdout);
  assert.strictEqual(JSON.parse(refreshed.stdout).ok, true);
});

test('status/state hint at stale runs (> 7 days); fresh runs get no hint; projects list marks held projects', () => {
  const { env, dir, cli } = setup();
  const run = createRun(dir, { task: 'fresh' });
  assert.doesNotMatch(cli('status').stdout, /If it is abandoned/);
  assert.strictEqual(JSON.parse(cli('status', '--json').stdout).activeRun.stale, false);
  age(dir, run.runId, 'JUDGED_PASS', 9);
  const status = cli('status');
  assert.match(status.stdout, /Active run: .* \(JUDGED_PASS\)/);
  assert.match(status.stdout, /for 9 day\(s\)\. If it is abandoned: ai-engineering-loop run --abandon --run /);
  const json = JSON.parse(cli('status', '--json').stdout).activeRun;
  assert.strictEqual(json.stale, true);
  assert.strictEqual(json.idleDays, 9);
  assert.match(cli('state').stdout, /If it is abandoned/);
  const listed = spawnSync(process.execPath, [CLI, 'projects', 'list'], { cwd: dir, env, encoding: 'utf8' });
  assert.match(listed.stdout, /held by stale run .*JUDGED_PASS, 9d/);
  assert.strictEqual(runAbandon.staleRunInfo({ state: 'DELIVERED', updatedAt: '2000-01-01T00:00:00Z' }).stale, false);
});

test('a pointer renamed by hand to runs/current.stale-*.json does not break anything', () => {
  const { dir, cli } = setup();
  const run = createRun(dir, { task: 'manually released' });
  age(dir, run.runId, 'REVIEWED');
  fs.renameSync(currentRunPath(dir), path.join(path.dirname(currentRunPath(dir)), 'current.stale-20261010.json'));
  assert.strictEqual(cli('status').status, 0);
  assert.strictEqual(cli('status', '--json').status, 0);
  assert.strictEqual(cli('refresh', '--non-destructive', '--json').status, 0);
  const none = cli('run', '--abandon', '--reason', 'x', '--by', 'ega', '--yes');
  assert.strictEqual(none.status, 2);
  const r = cli('run', '--abandon', '--run', run.runId, '--reason', 'cleanup', '--by', 'ega', '--yes', '--json');
  assert.strictEqual(r.status, 0, r.stdout);
  assert.strictEqual(JSON.parse(r.stdout).released, false);
  assert.ok(!fs.existsSync(currentRunPath(dir)), 'no new pointer created');
  assert.ok(fs.existsSync(path.join(path.dirname(currentRunPath(dir)), 'current.stale-20261010.json')));
  const started = cli('run', '--json', 'new task');
  assert.strictEqual(started.status, 0, started.stdout + started.stderr);
});

test('recipe-bound runs record RUN_CANCELLED with actor and reason in events.jsonl', () => {
  const { dir, cli } = setup();
  const started = cli('run', '--json', '--recipe', 'default', 'Workflow task');
  assert.strictEqual(started.status, 0, started.stdout + started.stderr);
  const { runId } = JSON.parse(started.stdout);
  const r = cli('run', '--abandon', '--reason', 'gave up', '--by', 'ega', '--yes', '--json');
  assert.strictEqual(r.status, 0, r.stdout);
  assert.strictEqual(loadRun(dir, runId).state, 'CANCELLED');
  const events = fs.readFileSync(path.join(dir, '.ai-engineering-loop/runs', runId, 'events.jsonl'), 'utf8');
  assert.match(events, /RUN_CANCELLED/);
  assert.match(events, /gave up/);
  assert.match(events, /"ega"/);
  assert.ok(!fs.existsSync(currentRunPath(dir)));
});
