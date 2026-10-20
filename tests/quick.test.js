'use strict';

// `quick start|finish`: T0 in two calls with the same gates as the long form.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function setupRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-quick-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-quick-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'README.md'), '# Demo\n\nTeh demo.\n');
  fs.writeFileSync(path.join(repo, 'src/auth.js'), 'module.exports = () => true;\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo","scripts":{"test":"node --version"}}\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx', '--allow-empty');
  return { repo, cli };
}

function json(result, label) {
  assert.strictEqual(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

test('quick start + finish take a T0 docs fix to JUDGED_PASS, then deliver', () => {
  const { repo, cli } = setupRepo();
  const start = json(cli('quick', 'start', 'Fix typo in README', '--json'), 'quick start');
  assert.strictEqual(start.tier, 'T0');
  assert.strictEqual(start.quick, true);
  assert.strictEqual(start.state, 'GOAL_FROZEN');
  fs.writeFileSync(path.join(repo, 'README.md'), '# Demo\n\nThe demo.\n');
  const finish = json(cli('quick', 'finish', '--run', start.runId, '--cmd', 'node --version', '--json'), 'quick finish');
  assert.strictEqual(finish.state, 'JUDGED_PASS');
  assert.deepStrictEqual(finish.changedPaths, ['README.md']);
  const claimed = fs.readFileSync(path.join(repo, finish.claimedVsReality), 'utf8');
  assert.match(claimed, /\| AC-1 \| Changed 1 file\(s\): README\.md \| `node --version` exit 0/);
  const deliver = json(cli('deliver', '--run', start.runId, '--destination', 'pr', '--summary', 'typo', '--approve', '--by', 'human', '--json'), 'deliver');
  assert.strictEqual(deliver.ok, true);
  const state = JSON.parse(fs.readFileSync(path.join(repo, '.ai-engineering-loop/runs', start.runId, 'state.json'), 'utf8'));
  assert.strictEqual(state.state, 'DELIVERED');
  assert.ok(fs.existsSync(path.join(repo, '.ai-engineering-loop/learnings.json')), 'delivery mines learnings automatically');
});

test('quick start hands a non-trivial task to the normal loop', () => {
  const { cli } = setupRepo();
  const start = json(cli('quick', 'start', 'Add pagination to the list endpoint', '--json'), 'quick start');
  assert.strictEqual(start.tier, 'T1');
  assert.strictEqual(start.quick, false);
  assert.match(start.next, /normal loop/);
});

test('quick finish stops when the diff raises the tier', () => {
  const { repo, cli } = setupRepo();
  const start = json(cli('quick', 'start', 'Fix typo in README', '--json'), 'quick start');
  fs.writeFileSync(path.join(repo, 'src/auth.js'), 'module.exports = () => false;\n');
  const result = cli('quick', 'finish', '--run', start.runId, '--cmd', 'node --version', '--json');
  assert.notStrictEqual(result.status, 0);
  const body = JSON.parse(result.stdout.trim().split('\n').pop());
  assert.strictEqual(body.code, 'TIER_RAISED');
  assert.strictEqual(body.tier, 'T2');
});

test('run --json reports learnings from earlier Runs', () => {
  const { cli } = setupRepo();
  const result = cli('run', '--json', 'Fix typo in README');
  assert.strictEqual(result.status, 0, result.stderr);
  const run = JSON.parse(result.stdout);
  assert.ok(Array.isArray(run.learnings));
});
