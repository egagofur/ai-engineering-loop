'use strict';

// Issue #37: project registry, cached non-blocking version check, semver
// policy, opt-outs, offline behavior, lock, *.ael-new preservation, rollback.
// Every test uses a sandbox HOME; npm is never called (exec is injected or
// AEL_UPDATE_DIST_TAGS / AEL_UPDATE_OFFLINE are set).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const au = require('../lib/auto-update.js');
const reg = require('../lib/project-registry.js');

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-au-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  delete env.CI;
  delete env.AEL_NO_AUTO_UPDATE;
  return { home, env };
}

function project(home, name = 'p') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ael-au-${name}-`));
  fs.writeFileSync(path.join(dir, 'package.json'), `{"name":"${name}"}\n`);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

const cli = (dir, env, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8' });

test('init/run/status register the project; list prunes deleted folders; scan is bounded', () => {
  const { home, env } = sandbox();
  const a = project(home, 'a');
  assert.strictEqual(cli(a, env, 'init').status, 0);
  const listed = JSON.parse(cli(a, env, 'projects', 'list', '--json').stdout);
  assert.deepStrictEqual(listed.projects.map((p) => p.path), [fs.realpathSync(a)]);
  assert.ok(listed.projects[0].contextVersion);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-au-scan-'));
  for (const rel of ['one/.ai-engineering-loop', 'two/deep/.ai-engineering-loop', 'x/node_modules/pkg/.ai-engineering-loop', 'a/b/c/d/e/f/.ai-engineering-loop']) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  const scanned = JSON.parse(cli(a, env, 'projects', 'scan', '--root', root, '--depth', '4', '--json').stdout);
  const found = scanned.found.map((p) => path.relative(fs.realpathSync(root), p.path).split(path.sep).join('/')).sort();
  assert.deepStrictEqual(found, ['one', 'two/deep']);

  fs.rmSync(path.join(root, 'one'), { recursive: true });
  const after = reg.listProjects({ home });
  assert.ok(after.removed.some((p) => p.endsWith('one')));
  assert.strictEqual(reg.readRegistry(home).projects.length, 2);
});

test('registry never writes inside the test runner without a sandbox AEL_HOME', () => {
  assert.strictEqual(reg.registryEnabled({ NODE_TEST_CONTEXT: 'child' }), false);
  assert.strictEqual(reg.registryEnabled({ NODE_TEST_CONTEXT: 'child', AEL_HOME: '/tmp/x' }), true);
  assert.strictEqual(reg.registryEnabled({ AEL_NO_REGISTRY: '1' }), false);
  assert.strictEqual(au.autoUpdateAllowedHere({ NODE_TEST_CONTEXT: 'child', AEL_HOME: '/tmp/x' }), false);
});

test('policy resolution: env and CI opt-outs win; unset is notify; invalid values rejected', () => {
  assert.strictEqual(au.resolvePolicy({ config: { autoUpdate: 'all' }, env: { AEL_NO_AUTO_UPDATE: '1' } }).policy, 'off');
  assert.strictEqual(au.resolvePolicy({ config: { autoUpdate: 'all' }, env: { CI: 'true' } }).source, 'CI');
  assert.deepStrictEqual(au.resolvePolicy({ config: {}, env: {} }), { policy: 'notify', source: 'unset', channel: 'latest', pin: null });
  assert.strictEqual(au.resolvePolicy({ config: { autoUpdate: 'patch' }, env: {} }).policy, 'patch');
  const { home } = sandbox();
  assert.throws(() => au.setPolicy({ policy: 'sometimes', home }), /Invalid auto-update policy/);
  assert.throws(() => au.setPolicy({ pin: '^1', home }), /Invalid pin/);
  assert.strictEqual(au.DEFAULT_POLICY, 'minor');
});

test('semver decisions: patch/minor apply per policy, major is notice-only under every policy', () => {
  const d = (latest, policy, extra = {}) => au.decideUpdate({ current: '1.13.0', distTags: { latest, next: '1.15.0-rc.1' }, policy, ...extra });
  assert.strictEqual(d('1.13.0', 'all').action, 'none');
  assert.strictEqual(d('1.13.1', 'patch').action, 'apply');
  assert.strictEqual(d('1.14.0', 'patch').reason, 'POLICY_PATCH_ONLY');
  assert.strictEqual(d('1.14.0', 'minor').action, 'apply');
  assert.strictEqual(d('1.14.0', 'notify').action, 'notify');
  assert.strictEqual(d('1.14.0', 'off').action, 'none');
  for (const policy of ['notify', 'patch', 'minor', 'all']) {
    assert.deepStrictEqual([d('2.0.0', policy).action, d('2.0.0', policy).reason], ['notify', 'MAJOR_NOTICE_ONLY'], policy);
  }
  assert.strictEqual(d('1.14.0', 'minor', { pin: '1.13.x' }).reason, 'PINNED');
  assert.strictEqual(d('1.14.0', 'minor', { channel: 'next' }).reason, 'PRERELEASE');
  assert.strictEqual(d('1.14.0', 'all', { channel: 'next' }).action, 'apply');
});

test('version check: cached 24h, offline never fails and keeps the last known tags', () => {
  const { home } = sandbox();
  const t0 = new Date('2026-10-10T00:00:00Z');
  const first = au.refreshCache({ packageName: 'ai-engineering-loop', home, env: { AEL_UPDATE_DIST_TAGS: '{"latest":"1.14.0"}' }, now: t0 });
  assert.deepStrictEqual(first.distTags, { latest: '1.14.0' });
  assert.strictEqual(au.cacheStale(au.readCache(home), new Date('2026-10-10T23:00:00Z')), false);
  assert.strictEqual(au.cacheStale(au.readCache(home), new Date('2026-10-11T00:00:01Z')), true);
  const offline = au.refreshCache({ packageName: 'ai-engineering-loop', home, env: { AEL_UPDATE_OFFLINE: '1' }, now: new Date('2026-10-11T01:00:00Z') });
  assert.strictEqual(offline.error, 'OFFLINE');
  assert.deepStrictEqual(offline.distTags, { latest: '1.14.0' });
  assert.strictEqual(au.CHECK_TIMEOUT_MS <= 3000, true);
});

test('offline `update auto` and `status` succeed quickly and never error', () => {
  const { home, env } = sandbox();
  const dir = project(home);
  const offlineEnv = { ...env, AEL_UPDATE_OFFLINE: '1', AEL_INSTALL_SCOPE: 'project' };
  assert.strictEqual(cli(dir, { ...offlineEnv, AEL_NO_AUTO_UPDATE: '1' }, 'init').status, 0);
  const auto = cli(dir, offlineEnv, 'update', 'auto', '--json');
  assert.strictEqual(auto.status, 0, auto.stderr);
  const parsed = JSON.parse(auto.stdout);
  assert.strictEqual(parsed.offline, 'OFFLINE');
  assert.strictEqual(parsed.decision.action, 'none');
  const started = Date.now();
  assert.strictEqual(cli(dir, offlineEnv, 'status').status, 0);
  assert.ok(Date.now() - started < 5000);
});

test('opt-out: AEL_NO_AUTO_UPDATE, CI, and policy off make `update auto` a no-op', () => {
  const { home, env } = sandbox();
  const dir = project(home);
  for (const extra of [{ AEL_NO_AUTO_UPDATE: '1' }, { CI: 'true' }]) {
    const r = JSON.parse(cli(dir, { ...env, ...extra, AEL_UPDATE_DIST_TAGS: '{"latest":"1.99.0"}' }, 'update', 'auto', '--json').stdout);
    assert.match(r.reason, /POLICY_OFF/);
  }
  assert.strictEqual(cli(dir, env, 'update', 'policy', 'off').status, 0);
  const r = JSON.parse(cli(dir, env, 'update', 'auto', '--json').stdout);
  assert.match(r.reason, /POLICY_OFF \(config\)/);
  assert.ok(!fs.existsSync(path.join(home, '.ai-engineering-loop', 'update-check.json')));
});

test('project-scope installs are notify-only: package.json is never changed', () => {
  const { home, env } = sandbox();
  const dir = project(home);
  const pkg = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  assert.strictEqual(cli(dir, env, 'update', 'policy', 'minor').status, 0);
  const r = JSON.parse(cli(dir, { ...env, AEL_UPDATE_DIST_TAGS: '{"latest":"1.99.0"}', AEL_INSTALL_SCOPE: 'project' }, 'update', 'auto', '--force', '--json').stdout);
  assert.strictEqual(r.decision.action, 'apply');
  assert.deepStrictEqual(r.result, { applied: false, reason: 'PROJECT_SCOPE_NOTIFY_ONLY' });
  assert.strictEqual(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), pkg);
});

function fakeExec() {
  const calls = [];
  const exec = (cmd, args, options = {}) => {
    calls.push([cmd, ...args, ...(options.cwd ? [`@${path.basename(options.cwd)}`] : [])].join(' '));
  };
  return { calls, exec };
}
const goodRelease = () => ({ repository: 'git+https://github.com/egagofur/ai-engineering-loop.git', integrity: 'sha512-x' });

test('global apply: install, sync-hosts, refresh every project; active runs stay pending', () => {
  const { home } = sandbox();
  const projects = [{ path: '/tmp/idle' }, { path: '/tmp/busy' }];
  const { calls, exec } = fakeExec();
  const readCurrentRun = (dir) => (dir === '/tmp/busy' ? { state: 'MAKER_COMPLETE', mode: 'ASSISTED', terminal: false } : null);
  const result = au.applyUpdate({
    packageName: 'ai-engineering-loop', current: '1.13.0', target: '1.14.0', scope: 'global', projects, home, exec, readCurrentRun,
    expectedRepository: 'git+https://github.com/egagofur/ai-engineering-loop.git', viewRelease: goodRelease
  });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(calls, [
    'npm install --global ai-engineering-loop@1.14.0',
    'ai-engineering-loop sync-hosts',
    'ai-engineering-loop refresh --non-destructive @idle'
  ]);
  assert.deepStrictEqual(result.pending, ['/tmp/busy']);
  assert.match(au.consumeSummary(home), /updated 1\.13\.0 -> 1\.14\.0; hosts synced; 1\/2 projects refreshed, 1 pending/);
  assert.strictEqual(au.consumeSummary(home), null);

  const later = fakeExec();
  const done = au.processPending({ projects, home, exec: later.exec, readCurrentRun: () => null });
  assert.deepStrictEqual(done.refreshed, ['/tmp/busy']);
  assert.deepStrictEqual(au.readState(home).pendingProjects, []);
});

test('apply refuses during an UNATTENDED run, on a foreign repository, or while locked', () => {
  const { home } = sandbox();
  const base = { packageName: 'ai-engineering-loop', current: '1.13.0', target: '1.14.0', scope: 'global', home, expectedRepository: 'https://github.com/egagofur/ai-engineering-loop', viewRelease: goodRelease };
  const { calls, exec } = fakeExec();
  const unattended = au.applyUpdate({ ...base, exec, projects: [{ path: '/tmp/u' }], readCurrentRun: () => ({ mode: 'UNATTENDED', terminal: false }) });
  assert.strictEqual(unattended.reason, 'UNATTENDED_RUN_ACTIVE');
  const foreign = au.applyUpdate({ ...base, exec, projects: [], readCurrentRun: () => null, viewRelease: () => ({ repository: 'https://github.com/evil/fork', integrity: 'sha512-x' }) });
  assert.strictEqual(foreign.reason, 'REPOSITORY_MISMATCH');
  const noIntegrity = au.applyUpdate({ ...base, exec, projects: [], readCurrentRun: () => null, viewRelease: () => ({ repository: base.expectedRepository, integrity: '' }) });
  assert.strictEqual(noIntegrity.reason, 'NO_INTEGRITY');
  const release = au.acquireLock(home);
  assert.ok(release);
  assert.strictEqual(au.acquireLock(home), null);
  assert.strictEqual(au.applyUpdate({ ...base, exec, projects: [], readCurrentRun: () => null }).reason, 'LOCKED');
  release();
  const again = au.acquireLock(home);
  assert.ok(again, 'lock is free again after release');
  again();
  assert.deepStrictEqual(calls, []);
});

test('a stale lock is reclaimed', () => {
  const { home } = sandbox();
  assert.ok(au.acquireLock(home));
  assert.strictEqual(au.acquireLock(home), null);
  const later = Date.now() + 60 * 60 * 1000;
  const release = au.acquireLock(home, { now: later });
  assert.ok(release);
  release();
});

test('rollback reinstalls the previous version and re-syncs hosts', () => {
  const { home } = sandbox();
  const first = fakeExec();
  au.applyUpdate({ packageName: 'ai-engineering-loop', current: '1.13.0', target: '1.14.0', scope: 'global', projects: [], home, exec: first.exec, readCurrentRun: () => null, viewRelease: goodRelease });
  const { calls, exec } = fakeExec();
  const record = au.rollback({ packageName: 'ai-engineering-loop', home, exec });
  assert.deepStrictEqual(record.to, '1.13.0');
  assert.deepStrictEqual(calls, ['npm install --global ai-engineering-loop@1.13.0', 'ai-engineering-loop sync-hosts']);
  assert.throws(() => au.rollback({ packageName: 'ai-engineering-loop', home, exec }), /No previous version/);
  const refused = spawnSync(process.execPath, [CLI, 'update', 'rollback'], { env: { ...process.env, AEL_HOME: home, HOME: home }, encoding: 'utf8' });
  assert.notStrictEqual(refused.status, 0);
});

test('refresh --non-destructive keeps user edits (writes *.ael-new) and skips active runs', () => {
  const { home, env } = sandbox();
  const dir = project(home);
  const quiet = { ...env, AEL_NO_AUTO_UPDATE: '1' };
  assert.strictEqual(cli(dir, quiet, 'init').status, 0);
  const ctx = path.join(dir, '.ai-engineering-loop');
  fs.appendFileSync(path.join(ctx, 'conventions.md'), '\n- Team rule: never use default exports.\n');
  const edited = fs.readFileSync(path.join(ctx, 'conventions.md'), 'utf8');
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}\n');
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  pkg.scripts = { test: 'vitest', lint: 'eslint .' };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  const r = cli(dir, quiet, 'refresh', '--non-destructive', '--json');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(fs.readFileSync(path.join(ctx, 'conventions.md'), 'utf8'), edited);
  assert.ok(report.aelNew.includes('conventions.md.ael-new'), JSON.stringify(report));
  assert.ok(fs.existsSync(path.join(ctx, 'conventions.md.ael-new')));
  assert.ok(report.updated.includes('metadata.json'));

  const run = JSON.parse(cli(dir, quiet, 'run', '--json', 'Add a feature').stdout);
  assert.ok(run.runId);
  const busy = cli(dir, quiet, 'refresh', '--non-destructive');
  assert.strictEqual(busy.status, 3);
});

test('update and projects help never write; unknown update flags are rejected', () => {
  const { home, env } = sandbox();
  const dir = project(home);
  for (const args of [['update', '--help'], ['projects', '-h'], ['update', 'auto', '--help']]) {
    const r = cli(dir, env, ...args);
    assert.strictEqual(r.status, 0);
  }
  assert.strictEqual(cli(dir, env, 'update', 'auto', '--frce').status, 2);
  assert.ok(!fs.existsSync(path.join(home, '.ai-engineering-loop')));
});

test('status starts a detached background check and later prints a rate-limited notice with highlights', async () => {
  const { home, env } = sandbox();
  const dir = project(home);
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const changelog = path.join(home, 'CHANGELOG.md');
  fs.writeFileSync(changelog, [
    '# Changelog', '', '## 1.99.0', '', '### Faster tiered runs (#33)', '- detail', '',
    '## 1.50.0', '', '### Combined verify command', '- detail', '', '## 1.0.0', '', '### Old stuff', ''
  ].join('\n'));
  const live = {
    ...env,
    AEL_ALLOW_AUTO_UPDATE_IN_TESTS: '1',
    AEL_UPDATE_DIST_TAGS: '{"latest":"1.99.0"}',
    AEL_INSTALL_SCOPE: 'project',
    AEL_UPDATE_CHANGELOG_FILE: changelog,
    AEL_FORCE_UPDATE_NOTICE: '1'
  };
  assert.strictEqual(cli(dir, { ...live, AEL_NO_AUTO_UPDATE: '1' }, 'init').status, 0);
  assert.strictEqual(cli(dir, live, 'update', 'policy', 'minor').status, 0);
  const started = Date.now();
  const first = cli(dir, live, 'status');
  assert.strictEqual(first.status, 0);
  assert.ok(Date.now() - started < 5000, 'status must not wait for the check');
  const cacheFile = path.join(home, '.ai-engineering-loop', 'update-check.json');
  const ready = () => fs.existsSync(cacheFile) && JSON.parse(fs.readFileSync(cacheFile, 'utf8')).highlights;
  for (let i = 0; i < 100 && !ready(); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(ready(), 'background check cached the highlights');

  // Never in --json output or with the notice silenced.
  assert.doesNotMatch(cli(dir, live, 'status', '--json').stderr, /available/);
  assert.doesNotMatch(cli(dir, { ...live, AEL_NO_UPDATE_NOTICE: '1' }, 'status').stderr, /available/);
  // Without a TTY (and no force flag) there is no notice either.
  const { AEL_FORCE_UPDATE_NOTICE, ...noTty } = live;
  assert.doesNotMatch(cli(dir, noTty, 'status').stderr, /available/);

  const second = cli(dir, live, 'status');
  assert.match(second.stderr, /ai-engineering-loop \d+\.\d+\.\d+ -> 1\.99\.0 available \(minor\)/);
  assert.match(second.stderr, /• Faster tiered runs/);
  assert.match(second.stderr, /• Combined verify command/);
  assert.doesNotMatch(second.stderr, /Old stuff/);
  assert.match(second.stderr, /Update: +pnpm add -D ai-engineering-loop@1\.99\.0/);
  assert.match(second.stderr, /Silence: AEL_NO_UPDATE_NOTICE=1/);
  // Once per day per project.
  assert.doesNotMatch(cli(dir, live, 'status').stderr, /available/);
  const other = project(home);
  assert.match(cli(other, live, 'status').stderr, /Update: +npm install -D ai-engineering-loop@1\.99\.0/);
  // Package files never change: notify-only.
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), /1\.99\.0/);
});

test('update notice: package manager detection, highlights, global and major wording', () => {
  const notice = require('../lib/update-notice.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-pm-'));
  assert.strictEqual(notice.detectPackageManager(dir), 'npm');
  fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
  assert.strictEqual(notice.detectPackageManager(dir), 'yarn');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"packageManager":"bun@1.1.0"}');
  assert.strictEqual(notice.detectPackageManager(dir), 'bun');
  assert.strictEqual(notice.detectGlobalPackageManager('/home/u/.local/share/pnpm/global/5/node_modules/ai-engineering-loop'), 'pnpm');
  assert.strictEqual(notice.updateCommand({ packageName: 'p', target: '2.0.0', scope: 'project', manager: 'bun' }), 'bun add -d p@2.0.0');
  assert.strictEqual(notice.updateCommand({ packageName: 'p', target: '2.0.0', scope: 'global', manager: 'yarn' }), 'yarn global add p@2.0.0');

  const changelog = '## 1.3.0\n- **Added:** `docs` command (#27)\n- b\n- c\n- d\n- e\n## 1.2.0\n- old\n';
  assert.deepStrictEqual(notice.changelogHighlights(changelog, { current: '1.2.0', target: '1.3.0' }), ['Added: docs command', 'b', 'c', 'd']);

  const global = notice.formatNotice({ packageName: 'p', current: '1.2.0', target: '1.3.0', bump: 'minor', scope: 'global', manager: 'npm', policy: 'notify' });
  assert.match(global, /npm install -g p@1\.3\.0 +\(or auto-apply: ai-engineering-loop update policy minor\)/);
  assert.match(global, /Then: +ai-engineering-loop sync-hosts/);
  const major = notice.formatNotice({ packageName: 'p', current: '1.2.0', target: '2.0.0', bump: 'major', scope: 'global', manager: 'npm', policy: 'minor', highlights: ['x'] });
  assert.match(major, /Major release/);
  assert.doesNotMatch(major, /auto-apply/);
  assert.ok(major.split('\n').length <= 8, 'notice stays short');

  assert.strictEqual(notice.noticeAllowed({ env: { CI: 'true' }, argv: [], stderrIsTTY: true }), false);
  assert.strictEqual(notice.noticeAllowed({ env: {}, argv: ['--json'], stderrIsTTY: true }), false);
  assert.strictEqual(notice.noticeAllowed({ env: {}, argv: [], stderrIsTTY: false }), false);
  assert.strictEqual(notice.noticeAllowed({ env: {}, argv: [], stderrIsTTY: true }), true);
  const now = new Date('2026-10-10T00:00:00Z');
  const shown = notice.markNoticeShown({}, '/p', '1.3.0', now);
  assert.strictEqual(notice.noticeDue(shown, '/p', new Date('2026-10-10T23:00:00Z')), false);
  assert.strictEqual(notice.noticeDue(shown, '/p', new Date('2026-10-11T00:00:01Z')), true);
  assert.strictEqual(notice.noticeDue(shown, '/q', now), true);
});
