'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function box({ git = true, commit = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-nux-home-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-nux-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p","scripts":{"test":"node -e 0"}}\n');
  if (git) execFileSync('git', ['init', '-q'], { cwd: dir });
  if (git && commit) execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8', input: '' });
  return { dir, home, cli };
}

const lastJson = (result) => {
  const text = String(result.stdout);
  const start = text.search(/^\{/m);
  return JSON.parse(text.slice(start));
};

test('C-48 run refuses before creating a Run when the folder is not a repo or has no commit, with a FIX command', () => {
  const plain = box({ git: false });
  const refused = plain.cli('run', '--json', 'Add export');
  assert.strictEqual(refused.status, 1);
  const out = lastJson(refused);
  assert.strictEqual(out.code, 'GIT_NOT_A_REPO');
  assert.match(out.fix, /git init/);
  assert.ok(!fs.existsSync(path.join(plain.dir, '.ai-engineering-loop', 'runs')), 'no Run created');
  const human = plain.cli('run', 'Add export');
  assert.match(human.stderr, /FIX: `git init/);
  assert.doesNotMatch(human.stdout + human.stderr, /usage: git/);

  const empty = box({ commit: false });
  assert.strictEqual(lastJson(empty.cli('run', '--json', 'Add export')).code, 'GIT_NO_COMMIT');
  assert.strictEqual(lastJson(empty.cli('quick', 'start', 'Fix typo', '--json')).code, 'GIT_NO_COMMIT');
});

test('C-48 status says git is not ready instead of claiming the context is current', () => {
  const plain = box({ git: false });
  assert.strictEqual(plain.cli('init').status, 0);
  const status = plain.cli('status');
  assert.match(status.stdout + status.stderr, /Git: NOT READY \(this folder is not a git repository\)/);
  assert.match(status.stdout, /Context Baseline Git: none/);
  assert.doesNotMatch(status.stdout, /untracke\b/);
});

test('C-54 quick start on a different task while a Run is unfinished returns RUN_CONFLICT and leaves current.json alone', () => {
  const { dir, cli } = box();
  assert.strictEqual(cli('init').status, 0);
  const first = lastJson(cli('run', '--json', 'Build the export page with filters'));
  const currentFile = path.join(dir, '.ai-engineering-loop', 'runs', 'current.json');
  const before = fs.readFileSync(currentFile, 'utf8');
  const quick = cli('quick', 'start', 'Fix typo in README', '--json');
  assert.strictEqual(quick.status, 3);
  const out = lastJson(quick);
  assert.strictEqual(out.code, 'RUN_CONFLICT');
  assert.strictEqual(out.conflict.runId, first.runId);
  assert.strictEqual(fs.readFileSync(currentFile, 'utf8'), before);
});
