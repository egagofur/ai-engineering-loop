'use strict';

// #148 headless setup. #150 unknown run flags must not become the task.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

const INHERITED_PATH = Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || '';

function cli(home, args, cwd = home, { pathValue = [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) } = {}) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...base,
      HOME: home,
      USERPROFILE: home,
      AEL_HOME: home,
      AEL_NO_SETUP_HINT: '1',
      AEL_NO_AUTO_UPDATE: '1',
      PATH: pathValue
    }
  });
}

test('setup --yes with no coding agent exits non-zero and writes nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-nohost-'));
  const result = cli(home, ['setup', '--yes', '--json']);
  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  const body = JSON.parse(result.stdout);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.code, 'NO_HOSTS');
  assert.strictEqual(body.wrote, false);
  assert.match(body.error, /No coding agent detected/);
  assert.match(body.fix, /setup --yes/);
  assert.ok(!fs.existsSync(path.join(home, '.ai-engineering-loop')));
});

test('an unknown run flag is rejected and does not replace the active Run', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-runflag-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-runflag-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"p","scripts":{"test":"node -e 0"}}\n');
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: repo });
  const runCli = (args) => cli(home, args, repo, { pathValue: INHERITED_PATH });
  assert.strictEqual(runCli(['init']).status, 0);
  const started = runCli(['run', '--json', 'Add CSV export']);
  assert.strictEqual(started.status, 0, started.stdout + started.stderr);
  const runId = JSON.parse(started.stdout.slice(started.stdout.search(/^\{/m))).runId;
  const bogus = runCli(['run', '--new', '--totally-bogus', '1', '--json']);
  assert.strictEqual(bogus.status, 1);
  const body = JSON.parse(bogus.stdout);
  assert.strictEqual(body.code, 'INVALID_USAGE');
  assert.match(body.error, /--totally-bogus/);
  assert.match(body.why, /active Run/);
  assert.match(body.fix, /ael run/);
  const near = runCli(['run', '--from-issu', '99', '--json']);
  assert.strictEqual(near.status, 1);
  assert.match(JSON.parse(near.stdout).error, /--from-issue/);
  const current = JSON.parse(fs.readFileSync(path.join(repo, '.ai-engineering-loop/runs/current.json'), 'utf8'));
  assert.strictEqual(current.runId, runId);
  const state = JSON.parse(fs.readFileSync(path.join(repo, '.ai-engineering-loop/runs', runId, 'state.json'), 'utf8'));
  assert.strictEqual(state.task, 'Add CSV export');
});
