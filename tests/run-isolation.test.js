'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const isolation = require('../lib/run-isolation.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function repo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-iso-home-'));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-iso-')));
  const main = path.join(root, 'app');
  fs.mkdirSync(main);
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(main, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(main, 'a.js'), 'module.exports = 1;\n');
  git(main, 'add', '.');
  git(main, '-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' });
  assert.strictEqual(cli(main, 'init').status, 0);
  git(main, 'add', '-A');
  git(main, '-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx');
  return { main, cli, git, env };
}

const json = (result) => JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));

test('C-37 a different task does not resume the unfinished Run; it returns RUN_CONFLICT with options', () => {
  const { main, cli } = repo();
  const first = json(cli(main, 'run', '--json', 'Add export'));
  const conflict = cli(main, 'run', '--json', 'Fix login bug');
  assert.strictEqual(conflict.status, 3);
  const out = json(conflict);
  assert.strictEqual(out.code, 'RUN_CONFLICT');
  assert.strictEqual(out.conflict.runId, first.runId);
  assert.strictEqual(out.conflict.live, true);
  assert.deepStrictEqual(out.conflict.options.map((o) => o.id), ['worktree', 'resume', 'abandon']);
  assert.match(out.conflict.options[2].command, /--force-live/);
  assert.strictEqual(json(cli(main, 'run', '--json', 'add   EXPORT')).runId, first.runId, 'same task resumes');
  assert.strictEqual(json(cli(main, 'run', '--json')).runId, first.runId, 'no task resumes');
});

test('C-37 abandoning a live Run needs --force-live', () => {
  const { main, cli } = repo();
  const { runId } = json(cli(main, 'run', '--json', 'Add export'));
  const refused = cli(main, 'run', '--abandon', '--run', runId, '--reason', 'switching', '--by', 'ega', '--yes', '--json');
  assert.notStrictEqual(refused.status, 0);
  assert.strictEqual(json(refused).code, 'RUN_LIVE');
  const done = cli(main, 'run', '--abandon', '--run', runId, '--reason', 'switching', '--by', 'ega', '--yes', '--force-live', '--json');
  assert.strictEqual(done.status, 0, done.stdout + done.stderr);
});

test('C-38 run --worktree starts the task in a new worktree and leaves the main Run alone', () => {
  const { main, cli } = repo();
  const first = json(cli(main, 'run', '--json', 'Add export'));
  fs.writeFileSync(path.join(main, 'a.js'), 'module.exports = 2;\n');
  const started = cli(main, 'run', '--worktree', '--json', 'Fix login bug');
  assert.strictEqual(started.status, 0, started.stdout + started.stderr);
  const out = json(started);
  assert.ok(fs.existsSync(out.worktree.path));
  assert.match(out.worktree.branch, /^ael\/fix-login-bug-/);
  assert.notStrictEqual(out.runId, first.runId);
  assert.strictEqual(fs.readFileSync(path.join(out.worktree.path, 'a.js'), 'utf8').replace(/\r\n/g, '\n'), 'module.exports = 1;\n', 'other Run changes stay behind');
  assert.strictEqual(json(cli(main, 'run', '--json')).runId, first.runId, 'main checkout keeps its Run');
  const registry = isolation.loadRegistry(main);
  assert.strictEqual(registry.worktrees[0].runId, out.runId);
});

test('C-39 Stage 9 copies evidence home and removes a clean worktree but keeps the branch; a dirty one is kept', () => {
  const { main, cli, git } = repo();
  const clean = json(cli(main, 'run', '--worktree', '--json', 'Task one'));
  const result = isolation.cleanupAfterDeliver(clean.worktree.path, clean.runId);
  assert.strictEqual(result.removed, true);
  assert.strictEqual(result.evidenceCopied, true);
  assert.ok(!fs.existsSync(clean.worktree.path));
  assert.ok(fs.existsSync(path.join(main, '.ai-engineering-loop', 'runs', clean.runId, 'state.json')));
  assert.ok(git(main, 'branch', '--list', clean.worktree.branch).includes(clean.worktree.branch), 'branch kept');

  const dirty = json(cli(main, 'run', '--worktree', '--json', 'Task two'));
  fs.writeFileSync(path.join(dirty.worktree.path, 'new.js'), 'x\n');
  const kept = isolation.cleanupAfterDeliver(dirty.worktree.path, dirty.runId);
  assert.strictEqual(kept.removed, false);
  assert.match(kept.keptReason, /uncommitted or untracked/);
  assert.ok(fs.existsSync(dirty.worktree.path));
  assert.strictEqual(isolation.cleanupAfterDeliver(main, 'x'), null, 'main checkout is never cleaned up');
});

test('C-40 prune removes clean finished worktrees and merged branches, never dirty or unregistered ones', () => {
  const { main, cli, git } = repo();
  const merged = json(cli(main, 'run', '--worktree', '--json', 'Merged task'));
  fs.writeFileSync(path.join(merged.worktree.path, 'b.js'), 'module.exports = 3;\n');
  git(merged.worktree.path, 'add', 'b.js');
  git(merged.worktree.path, '-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'b');
  isolation.cleanupAfterDeliver(merged.worktree.path, merged.runId);
  git(main, '-c', 'user.email=a@b.c', '-c', 'user.name=t', 'merge', '-q', '--no-ff', '-m', 'merge', merged.worktree.branch);

  const cancelled = json(cli(main, 'run', '--worktree', '--json', 'Dropped task'));
  assert.strictEqual(cli(cancelled.worktree.path, 'run', '--abandon', '--run', cancelled.runId, '--reason', 'r', '--by', 'e', '--yes', '--force-live', '--json').status, 0);
  const dirty = json(cli(main, 'run', '--worktree', '--json', 'Messy task'));
  assert.strictEqual(cli(dirty.worktree.path, 'run', '--abandon', '--run', dirty.runId, '--reason', 'r', '--by', 'e', '--yes', '--force-live', '--json').status, 0);
  fs.writeFileSync(path.join(dirty.worktree.path, 'wip.js'), 'x\n');
  const foreign = path.join(path.dirname(main), 'mine');
  git(main, 'worktree', 'add', '-q', '-b', 'mine', foreign);

  const { plan } = isolation.planPrune(main);
  const byPath = Object.fromEntries(plan.map((row) => [row.path, row]));
  assert.deepStrictEqual(byPath[merged.worktree.path].actions, ['delete-branch']);
  assert.deepStrictEqual(byPath[cancelled.worktree.path].actions, ['remove-worktree']);
  assert.deepStrictEqual(byPath[dirty.worktree.path].actions, []);
  assert.match(byPath[dirty.worktree.path].notes[0], /kept/);
  assert.strictEqual(byPath[foreign], undefined);
  assert.match(isolation.pruneHint(main), /worktree prune/);

  const applied = cli(main, 'worktree', 'prune', '--yes', '--json');
  assert.strictEqual(applied.status, 0, applied.stdout + applied.stderr);
  assert.ok(!git(main, 'branch', '--list', merged.worktree.branch));
  assert.ok(!fs.existsSync(cancelled.worktree.path));
  assert.ok(fs.existsSync(path.join(main, '.ai-engineering-loop', 'runs', cancelled.runId)), 'evidence kept');
  assert.ok(fs.existsSync(dirty.worktree.path), 'dirty work is never removed');
  assert.ok(fs.existsSync(foreign), 'unregistered worktree untouched');
});
