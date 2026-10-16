'use strict';

// Issue #63: adapter checks in `doctor` and the `deliver` preflight.
// gh/glab are stubbed (injected runner, or fake binaries on PATH).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const { checkAdapter, nearestType, toolFor } = require('../lib/adapter-check.js');
const { runDoctor } = require('../lib/doctor.js');
const { writeShippedAdapter } = require('../lib/generate-adapter.js');
const { createRun, runsDir } = require('../lib/run-state.js');
const { DOT_GITLAB_HOST } = require('../lib/adapter-detect.js');

function project({ remote, type, body } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-acheck-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  if (type) writeShippedAdapter(dir, { type, hints: { remote: remote || '', ciProvider: 'none' } });
  if (body !== undefined) {
    fs.mkdirSync(path.join(dir, '.ai-engineering-loop'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ai-engineering-loop', 'adapter.md'), body);
  }
  return dir;
}

const authed = () => ({ status: 0 });
const byId = (checks) => Object.fromEntries(checks.map((item) => [item.id, item]));

test('unknown adapter_type is an error with a nearest-match suggestion', () => {
  const dir = project({ body: '- **adapter_type**: "gitlb"\n' });
  const checks = byId(checkAdapter(dir, { run: authed }));
  assert.strictEqual(checks['adapter-type'].passed, false);
  assert.strictEqual(checks['adapter-type'].level, 'error');
  assert.match(checks['adapter-type'].detail, /unknown adapter_type "gitlb".*did you mean "gitlab"\?/);
  assert.strictEqual(nearestType('bitbucket-cloud'), null);
  const empty = byId(checkAdapter(project({ body: '# no type\n' }), { run: authed }));
  assert.match(empty['adapter-type'].detail, /"\(empty\)"/);
});

test('missing spec: shipped type without adapters/<type>/README.md, custom without delivery.md', () => {
  const fakePackage = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-acheck-pkg-'));
  const checks = byId(checkAdapter(project({ type: 'standard' }), { packageRoot: fakePackage, run: authed }));
  assert.strictEqual(checks['adapter-spec'].passed, false);
  assert.match(checks['adapter-spec'].detail, /missing adapters\/standard\/README\.md/);
  assert.strictEqual(byId(checkAdapter(project({ type: 'standard' }), { run: authed }))['adapter-spec'].passed, true);

  const custom = project({ body: '- **adapter_type**: "custom"\n' });
  assert.match(byId(checkAdapter(custom, { run: authed }))['adapter-spec'].detail, /missing \.ai-engineering-loop\/adapter\/delivery\.md/);
  fs.mkdirSync(path.join(custom, '.ai-engineering-loop', 'adapter'));
  fs.writeFileSync(path.join(custom, '.ai-engineering-loop', 'adapter', 'delivery.md'), '# delivery\n');
  assert.strictEqual(byId(checkAdapter(custom, { run: authed }))['adapter-spec'].passed, true);
});

test('auth check uses gh for github, glab for gitlab, glab --hostname for dot; none for standard', () => {
  const calls = [];
  const record = (bin, args) => { calls.push([bin, ...args].join(' ')); return { status: 1 }; };
  const gh = byId(checkAdapter(project({ remote: 'git@github.com:a/b.git', type: 'github' }), { run: record }));
  checkAdapter(project({ remote: 'https://gitlab.com/a/b.git', type: 'gitlab' }), { run: record });
  checkAdapter(project({ remote: `git@${DOT_GITLAB_HOST}:a/b.git`, type: 'dot' }), { run: record });
  const std = byId(checkAdapter(project({ type: 'standard' }), { run: record }));
  assert.deepStrictEqual(calls, ['gh auth status', 'glab auth status', `glab auth status --hostname ${DOT_GITLAB_HOST}`]);
  assert.strictEqual(gh['adapter-auth'].passed, false);
  assert.strictEqual(gh['adapter-auth'].level, 'warn');
  assert.match(gh['adapter-auth'].detail, /gh not logged in/);
  assert.strictEqual(std['adapter-auth'], undefined);
  assert.strictEqual(toolFor('custom'), null);

  const missing = byId(checkAdapter(project({ remote: 'git@github.com:a/b.git', type: 'github' }), {
    run: () => ({ error: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }) })
  }));
  assert.match(missing['adapter-auth'].detail, /gh not installed/);
  const ok = byId(checkAdapter(project({ remote: 'git@github.com:a/b.git', type: 'github' }), { run: authed }));
  assert.strictEqual(ok['adapter-auth'].passed, true);
});

test('configured type that differs from the detector is a warning (DOT repo configured as gitlab)', () => {
  const dir = project({ remote: `git@${DOT_GITLAB_HOST}:a/b.git`, type: 'gitlab' });
  const checks = byId(checkAdapter(dir, { run: authed }));
  assert.strictEqual(checks['adapter-detected'].passed, false);
  assert.strictEqual(checks['adapter-detected'].level, 'warn');
  assert.match(checks['adapter-detected'].detail, /configured "gitlab" but the repo looks like "dot"/);
  assert.strictEqual(byId(checkAdapter(project({ remote: `git@${DOT_GITLAB_HOST}:a/b.git`, type: 'dot' }), { run: authed }))['adapter-detected'], undefined);
});

test('runDoctor: adapter errors fail, warnings do not; package-only doctor is unchanged', () => {
  assert.ok(!runDoctor(ROOT).checks.some((item) => item.id.startsWith('adapter-')));
  const bad = runDoctor(ROOT, { projectDir: project({ body: '- **adapter_type**: "gitlb"\n' }), run: authed });
  assert.strictEqual(bad.ok, false);
  const warnOnly = runDoctor(ROOT, { projectDir: project({ remote: 'git@github.com:a/b.git', type: 'github' }), run: () => ({ status: 1 }) });
  assert.strictEqual(warnOnly.ok, true, JSON.stringify(warnOnly.checks.filter((item) => !item.passed)));
  assert.ok(warnOnly.checks.some((item) => item.id === 'adapter-auth' && !item.passed));
});

// CLI: fake gh/glab on PATH that exit 1 (not logged in).
function stubEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-acheck-home-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-acheck-bin-'));
  for (const name of ['gh', 'glab']) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\necho "not logged in" >&2\nexit 1\n', { mode: 0o755 });
  }
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_AUTO_UPDATE: '1', PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  delete env.CI;
  return env;
}

const cliIn = (dir, env, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8' });

test('CLI doctor prints adapter warnings with ! and errors with ✗', { skip: process.platform === 'win32' }, () => {
  const env = stubEnv();
  const warn = cliIn(project({ remote: 'git@github.com:a/b.git', type: 'github' }), env, 'doctor');
  assert.strictEqual(warn.status, 0, warn.stdout);
  assert.match(warn.stdout, /! adapter-auth: gh not logged in/);
  const bad = cliIn(project({ body: '- **adapter_type**: "gitlb"\n' }), env, 'doctor');
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stdout, /✗ adapter-type: unknown adapter_type "gitlb"/);
});

test('deliver preflight: UNATTENDED fails fast before writing; ASSISTED warns and continues', { skip: process.platform === 'win32' }, () => {
  const env = stubEnv();
  const unattendedDir = project({ remote: 'git@github.com:a/b.git', type: 'github' });
  const run = createRun(unattendedDir, { task: 'Night job', mode: 'UNATTENDED' });
  const failed = cliIn(unattendedDir, env, 'deliver', '--run', run.runId, '--destination', 'pr', '--summary', 'x', '--json');
  assert.strictEqual(failed.status, 1);
  const out = JSON.parse(failed.stdout);
  assert.strictEqual(out.code, 'ADAPTER_PREFLIGHT_FAILED');
  assert.match(out.error, /adapter-auth: gh not logged in/);
  assert.ok(!fs.existsSync(path.join(runsDir(unattendedDir), run.runId, 'delivery.json')));

  const assistedDir = project({ remote: 'git@github.com:a/b.git', type: 'github' });
  const assisted = createRun(assistedDir, { task: 'Day job', mode: 'ASSISTED' });
  const warned = cliIn(assistedDir, env, 'deliver', '--run', assisted.runId, '--destination', 'pr', '--summary', 'x', '--approve', '--by', 'ega', '--json');
  assert.match(warned.stderr, /! adapter-auth: gh not logged in/);
  assert.notStrictEqual(JSON.parse(warned.stdout).code, 'ADAPTER_PREFLIGHT_FAILED');
  assert.ok(fs.existsSync(path.join(runsDir(assistedDir), assisted.runId, 'delivery.json')), 'ASSISTED got past the preflight');

  const mismatchDir = project({ remote: 'git@github.com:a/b.git', type: 'standard' });
  const mismatch = createRun(mismatchDir, { task: 'Night job', mode: 'UNATTENDED' });
  const passed = cliIn(mismatchDir, env, 'deliver', '--run', mismatch.runId, '--destination', 'pr', '--summary', 'x', '--json');
  assert.notStrictEqual(JSON.parse(passed.stdout).code, 'ADAPTER_PREFLIGHT_FAILED', 'a mismatch alone never blocks');
  assert.match(passed.stderr, /! adapter-detected/);
});
