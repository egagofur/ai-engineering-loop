'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { readDoc } = require('../lib/docs.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function repo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-base-home-'));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-base-')));
  const main = path.join(root, 'app');
  fs.mkdirSync(main);
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(main, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(main, 'a.js'), 'module.exports = 1;\n');
  git(main, 'add', '.');
  git(main, '-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: main, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  git(main, 'add', '-A');
  git(main, '-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx');
  git(main, 'checkout', '-q', '-b', 'stack');
  fs.writeFileSync(path.join(main, 'stack.js'), 'module.exports = 2;\n');
  git(main, 'add', 'stack.js');
  git(main, '-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'stack');
  git(main, 'checkout', '-q', 'main');
  return { main, cli, git };
}

const json = (result) => JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));

test('docs coordinator explains stacked worktrees and refuses a coordinator process', () => {
  const doc = readDoc('coordinator');
  assert.strictEqual(doc.rel, 'core/coordinator.md');
  for (const word of ['RUN_CONFLICT', '--worktree --base', 'does not fetch', 'No coordinator process', 'no arena']) {
    assert.ok(doc.text.includes(word), word);
  }
  const isolation = fs.readFileSync(path.join(__dirname, '..', 'core', 'run-isolation.md'), 'utf8');
  assert.match(isolation, /--base <branch>/);
});

test('run --worktree --base starts from that commit and leaves this checkout alone', () => {
  const { main, cli, git } = repo();
  const trees = git(main, 'worktree', 'list');
  const started = cli('run', '--worktree', '--base', 'stack', '--json', 'Add export');
  assert.strictEqual(started.status, 0, started.stdout + started.stderr);
  const out = json(started);
  assert.strictEqual(out.worktree.baseRef, 'stack');
  assert.match(out.worktree.branch, /^ael\/add-export-/);
  assert.match(fs.readFileSync(path.join(out.worktree.path, 'stack.js'), 'utf8'), /module\.exports = 2/);
  assert.ok(!fs.existsSync(path.join(main, 'stack.js')));
  assert.strictEqual(git(main, 'branch', '--show-current'), 'main');
  const state = JSON.parse(fs.readFileSync(path.join(out.worktree.path, '.ai-engineering-loop', 'runs', out.runId, 'state.json'), 'utf8'));
  assert.strictEqual(state.task, 'Add export');

  const alone = cli('run', '--base', 'stack', '--json', 'Other task');
  assert.strictEqual(alone.status, 1);
  assert.strictEqual(json(alone).code, 'INVALID_USAGE');
  assert.match(json(alone).fix, /--worktree --base/);
  assert.strictEqual(git(main, 'branch', '--show-current'), 'main');

  const missing = cli('run', '--worktree', '--base', 'no-such', '--json', 'Nope');
  assert.strictEqual(missing.status, 1);
  assert.strictEqual(json(missing).code, 'INVALID_USAGE');
  assert.strictEqual(git(main, 'worktree', 'list').split('\n').length, trees.split('\n').length + 1);
});
