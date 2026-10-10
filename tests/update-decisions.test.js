'use strict';

// Decisions 5 and 6 on #37: legacy first update (overwrite + delete obsolete
// AEL-managed files, snapshot, hashes recorded), obsolete host files, and
// major-version migrations. Sandbox HOME only; npm is never called.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const au = require('../lib/auto-update.js');
const migrations = require('../lib/migrations.js');
const { applyHostSync } = require('../lib/sync-hosts.js');
const { buildUpdatePlan } = require('../lib/update-manager.js');

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-dec-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_AUTO_UPDATE: '1' };
  delete env.CI;
  return { home, env };
}

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-dec-p-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p"}\n');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'user file outside AEL\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

const cli = (dir, env, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8' });
const read = (file) => fs.readFileSync(file, 'utf8');

// Make an init'ed project look like one from a version without hashes.
function makeLegacy(ctx) {
  for (const file of [path.join(ctx, '.ael-generated.json'), path.join(ctx, 'adrs', '.ael-generated.json')]) fs.rmSync(file, { force: true });
}

test('legacy project: first update overwrites AEL-managed files, snapshots them, records hashes; later updates are hash-checked', () => {
  const { home, env } = sandbox();
  const dir = project();
  assert.strictEqual(cli(dir, env, 'init').status, 0);
  const ctx = path.join(dir, '.ai-engineering-loop');
  makeLegacy(ctx);
  fs.writeFileSync(path.join(ctx, 'conventions.md'), '# old generated conventions\n');
  const lessonsBefore = read(path.join(ctx, 'lessons.md'));
  fs.writeFileSync(path.join(ctx, 'my-notes.md'), 'user-created inside context dir\n');

  const r = cli(dir, env, 'refresh', '--non-destructive', '--json');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.mode, 'legacy-first-update');
  assert.deepStrictEqual(report.aelNew, []);
  assert.ok(report.updated.includes('conventions.md'));
  assert.notStrictEqual(read(path.join(ctx, 'conventions.md')), '# old generated conventions\n');
  assert.ok(!fs.existsSync(path.join(ctx, 'conventions.md.ael-new')));
  // Snapshot keeps the old copy.
  assert.ok(report.snapshot && report.snapshot.startsWith('.ai-engineering-loop/.ael-backup/'));
  assert.strictEqual(read(path.join(dir, report.snapshot, 'conventions.md')), '# old generated conventions\n');
  const meta = JSON.parse(read(path.join(dir, report.snapshot, 'snapshot.json')));
  assert.strictEqual(meta.reason, 'LEGACY_FIRST_UPDATE');
  // Untouched: append-only knowledge files, user files inside and outside the context dir.
  assert.strictEqual(read(path.join(ctx, 'lessons.md')), lessonsBefore);
  assert.strictEqual(read(path.join(ctx, 'my-notes.md')), 'user-created inside context dir\n');
  assert.strictEqual(read(path.join(dir, 'notes.md')), 'user file outside AEL\n');
  // Hashes recorded: the next refresh preserves edits via *.ael-new.
  assert.ok(fs.existsSync(path.join(ctx, '.ael-generated.json')));
  fs.appendFileSync(path.join(ctx, 'conventions.md'), '\n- my rule\n');
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}\n');
  const second = JSON.parse(cli(dir, env, 'refresh', '--non-destructive', '--json').stdout);
  assert.strictEqual(second.mode, 'hash-checked');
  assert.match(read(path.join(ctx, 'conventions.md')), /my rule/);
  assert.strictEqual(second.snapshot, null);

  // update rollback restores the snapshot and the legacy (hash-less) state.
  const us = require('../lib/user-state.js');
  us.writeJsonFile(us.userStatePath('update-state.json', home), { previousVersion: '1.12.0', currentVersion: '1.13.0', lastApplied: { at: new Date(Date.parse(meta.at) - 1000).toISOString() } });
  const calls = [];
  const record = au.rollback({ packageName: 'ai-engineering-loop', home, exec: (cmd, args) => calls.push([cmd, ...args].join(' ')), projects: [{ path: dir }] });
  assert.strictEqual(record.restored.length, 1);
  assert.strictEqual(read(path.join(ctx, 'conventions.md')), '# old generated conventions\n');
  assert.ok(!fs.existsSync(path.join(ctx, '.ael-generated.json')));
  assert.ok(calls.some((c) => c.includes('npm install --global ai-engineering-loop@1.12.0')));
});

test('obsolete AEL-managed context files: removed when unedited, kept when edited; never others', () => {
  const { env } = sandbox();
  const dir = project();
  assert.strictEqual(cli(dir, env, 'init').status, 0);
  const ctx = path.join(dir, '.ai-engineering-loop');
  const hashesFile = path.join(ctx, '.ael-generated.json');
  const hashes = JSON.parse(read(hashesFile));
  const sha = (text) => require('crypto').createHash('sha256').update(text).digest('hex');
  fs.writeFileSync(path.join(ctx, 'old-template.md'), 'from an older AEL\n');
  fs.writeFileSync(path.join(ctx, 'old-edited.md'), 'edited by user\n');
  hashes['old-template.md'] = sha('from an older AEL\n');
  hashes['old-edited.md'] = sha('original\n');
  hashes['../escape.md'] = sha('x');
  fs.writeFileSync(path.join(dir, 'escape.md'), 'x');
  fs.writeFileSync(hashesFile, JSON.stringify(hashes));
  const report = JSON.parse(cli(dir, env, 'refresh', '--non-destructive', '--json').stdout);
  assert.deepStrictEqual(report.removed, ['old-template.md']);
  assert.deepStrictEqual(report.obsoleteKept, ['old-edited.md']);
  assert.ok(!fs.existsSync(path.join(ctx, 'old-template.md')));
  assert.ok(fs.existsSync(path.join(ctx, 'old-edited.md')));
  assert.ok(fs.existsSync(path.join(dir, 'escape.md')));
  assert.ok(!Object.hasOwn(JSON.parse(read(hashesFile)), 'old-template.md'));
});

test('sync-hosts removes obsolete AEL host files from its manifest (renamed skills), keeps edited ones and user files', () => {
  const { home } = sandbox();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  applyHostSync({ home });
  const manifestFile = path.join(home, '.ai-engineering-loop', 'host-manifest.json');
  const manifest = JSON.parse(read(manifestFile));
  const sha = (text) => require('crypto').createHash('sha256').update(text).digest('hex');
  const oldSkill = path.join(home, '.claude/skills/code-simplifier/SKILL.md');
  const edited = path.join(home, '.claude/skills/old-edited/SKILL.md');
  const userSkill = path.join(home, '.claude/skills/my-own/SKILL.md');
  for (const [file, text] of [[oldSkill, 'old ael skill\n'], [edited, 'user changed\n'], [userSkill, 'mine\n']]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  manifest.files[oldSkill] = { sha256: sha('old ael skill\n'), pack: 'quality' };
  manifest.files[edited] = { sha256: sha('original\n'), pack: 'quality' };
  manifest.files[path.join(home, '.claude/skills/gone/SKILL.md')] = { sha256: 'x', pack: 'core' };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const applied = applyHostSync({ home });
  assert.ok(applied.some((i) => i.dest === oldSkill && i.action === 'prune' && i.reason === 'obsolete'));
  assert.ok(!fs.existsSync(path.dirname(oldSkill)), 'empty skill dir removed');
  assert.ok(fs.existsSync(edited));
  assert.strictEqual(read(userSkill), 'mine\n');
  const after = JSON.parse(read(manifestFile)).files;
  assert.ok(!after[oldSkill] && !after[path.join(home, '.claude/skills/gone/SKILL.md')]);
  assert.ok(after[edited], 'edited obsolete file stays tracked');
});

test('major migrations: run once per major crossed, idempotent, new projects still migrated', () => {
  const { home } = sandbox();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-mig-'));
  fs.writeFileSync(path.join(dir, '2.js'), `module.exports = {
    major: 2, description: 'add marker',
    migrateHome({ home }) { require('fs').appendFileSync(require('path').join(home, 'home-runs'), 'x'); },
    migrateProject({ projectDir }) { require('fs').appendFileSync(require('path').join(projectDir, 'runs'), 'x'); }
  };`);
  fs.writeFileSync(path.join(dir, '3.js'), "module.exports = { major: 3, description: 'later' };");
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-mig-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-mig-b-'));
  assert.deepStrictEqual(migrations.pendingMigrations({ from: '1.13.0', to: '2.1.0', dir }).map((m) => m.major), [2]);
  assert.deepStrictEqual(migrations.pendingMigrations({ from: '2.0.0', to: '2.5.0', dir }), []);
  const first = migrations.runMigrations({ from: '1.13.0', to: '2.0.0', projects: [{ path: a }], home, dir });
  assert.strictEqual(first.migrations[0].home, 'ran');
  migrations.runMigrations({ from: '1.13.0', to: '2.0.0', projects: [{ path: a }, { path: b }], home, dir });
  assert.strictEqual(read(path.join(home, 'home-runs')), 'x');
  assert.strictEqual(read(path.join(a, 'runs')), 'x');
  assert.strictEqual(read(path.join(b, 'runs')), 'x');
  const dry = migrations.runMigrations({ from: '1.0.0', to: '3.0.0', projects: [], home, dir, dryRun: true });
  assert.deepStrictEqual(dry.migrations.map((m) => m.major), [2, 3]);

  fs.writeFileSync(path.join(dir, '4.js'), 'module.exports = { major: 5 };');
  assert.throws(() => migrations.loadMigrations(dir), /must export \{ major: 4/);
});

test('update plan inserts migrate right after the install only when crossing a major; CLI migrate is a no-op today', () => {
  const minor = buildUpdatePlan({ packageName: 'ai-engineering-loop', currentVersion: '1.13.0', latestVersion: '1.14.0', installScope: 'global' });
  assert.ok(!minor.commands.some((c) => c.display.includes('migrate')));
  const major = buildUpdatePlan({ packageName: 'ai-engineering-loop', currentVersion: '1.13.0', latestVersion: '2.0.0', installScope: 'project' });
  assert.strictEqual(major.commands[1].display, 'npx ai-engineering-loop migrate --from 1.13.0');
  const { env } = sandbox();
  const dir = project();
  const r = cli(dir, env, 'migrate', '--from', '0.9.0', '--json');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout).migrations, []);
  assert.notStrictEqual(cli(dir, env, 'migrate', '--json').status, 0);
  assert.notStrictEqual(cli(dir, env, 'migrate', '--bogus').status, 0);
  assert.deepStrictEqual(migrations.loadMigrations(), [], 'no migration ships in 1.x');
});
