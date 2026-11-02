'use strict';

// Issue #99: T2 spec-pack hint in `run`, spec pack status in `hosts doctor`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const { hostsDoctor, formatHostsDoctor } = require('../lib/hosts/doctor.js');
const { applyHostSync, planHostSync } = require('../lib/sync-hosts.js');
const { HOSTS } = require('../lib/hosts/registry.js');

function setupRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-hint-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-hint-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  execFileSync('git', ['init', '-q'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), '# demo\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: repo });
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  return { cli, home };
}

test('T0/T1 runs carry no specHint; a new T2 run shows it once; a resumed T2 run does not', () => {
  const { cli } = setupRepo();
  const t1 = JSON.parse(cli('run', '--json', 'Fix README typo').stdout);
  assert.notStrictEqual(t1.tier, 'T2');
  assert.ok(!Object.hasOwn(t1, 'specHint'));

  const t2 = JSON.parse(cli('run', '--json', '--new', '--tier', 'T2', '--tier-reason', 'new webhook subsystem', 'Add', 'webhooks').stdout);
  assert.strictEqual(t2.tier, 'T2');
  assert.match(t2.specHint, /ael-spec-brainstorm -> ael-spec-draft -> ael-spec-review/);
  assert.match(t2.specHint, /sync-hosts --pack spec/);
  assert.strictEqual((JSON.stringify(t2).match(/ael-spec-brainstorm/g) || []).length, 1);

  const resumed = JSON.parse(cli('run', '--json').stdout);
  assert.strictEqual(resumed.resumed, true);
  assert.ok(!Object.hasOwn(resumed, 'specHint'));
});

test('hosts doctor reports spec pack status and review mode without changing ok', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-hint-doctor-'));
  fs.mkdirSync(path.join(home, '.claude'));
  const selection = { enabled: new Set(['claude', 'kiro']) };
  const before = hostsDoctor({ home, selection, plan: [] });
  for (const row of before.hosts) assert.strictEqual(row.spec.installed, false);
  assert.match(formatHostsDoctor(before), /sync-hosts --pack spec/);

  applyHostSync({ packageRoot: ROOT, home, packs: 'spec' });
  const after = hostsDoctor({ home, selection, plan: [] });
  const claude = after.hosts.find((row) => row.id === 'claude');
  assert.deepStrictEqual(claude.spec, { installed: true, reviewMode: 'FRESH_SUBAGENT' });
  const instructionOnly = HOSTS.find((host) => host.certification === 'instruction-only');
  const other = hostsDoctor({ home, selection: { enabled: new Set([instructionOnly.id]) }, plan: [] }).hosts[0];
  assert.strictEqual(other.spec.reviewMode, 'CONTEXT_ISOLATION_ONLY');
  assert.strictEqual(claude.ok, claude.problems.length === 0);
  assert.ok(before.hosts.every((row) => row.problems.every((problem) => !/spec/.test(problem))));
  assert.match(formatHostsDoctor(after), /spec pack: installed \(reviews in fresh subagents\)/);
  assert.ok(planHostSync({ packageRoot: ROOT, home }).packs.includes('spec'));
});
