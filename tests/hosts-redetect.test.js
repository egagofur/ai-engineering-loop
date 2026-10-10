'use strict';

// Issue #52: re-detect agents installed after setup, hosts doctor, and the
// README host table generated from the registry. Temporary HOME only.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const redetect = require('../lib/hosts/redetect.js');
const { applySetup } = require('../lib/hosts/commands.js');
const { hostsDoctor } = require('../lib/hosts/doctor.js');
const { replaceHostTable, renderHostTable } = require('../lib/hosts/table.js');
const { HOSTS } = require('../lib/hosts/registry.js');
const { applyHostSync, planHostSync, resolveHostSelection } = require('../lib/sync-hosts.js');
const { readUserConfig } = require('../lib/user-state.js');

const QUIET_OFF = { PATH: '' };
const DAY = 24 * 60 * 60 * 1000;

function home(dirs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-redetect-'));
  for (const rel of dirs) fs.mkdirSync(path.join(dir, rel), { recursive: true });
  return dir;
}

function listFiles(dir) {
  return fs.readdirSync(dir, { recursive: true }).map(String).sort();
}

function cli(dir, args) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...base, HOME: dir, USERPROFILE: dir, AEL_HOME: dir, AEL_NO_AUTO_UPDATE: '1', PATH: path.dirname(process.execPath) }
  });
}

test('new hosts: none before setup; a host added after setup is found once', () => {
  const dir = home(['.claude']);
  assert.strictEqual(redetect.findNewHosts({ home: dir, env: QUIET_OFF }), null, 'legacy mode already follows config folders');
  applySetup({ home: dir, ids: ['claude'], mode: 'manual' });
  assert.deepStrictEqual(redetect.findNewHosts({ home: dir, env: QUIET_OFF }), []);
  fs.mkdirSync(path.join(dir, '.cursor'));
  assert.deepStrictEqual(redetect.findNewHosts({ home: dir, env: QUIET_OFF }), ['cursor']);
});

test('mode auto: update auto enables new hosts on a global install only, never in CI or with AEL_NO_AUTO_UPDATE', () => {
  const dir = home(['.claude']);
  applySetup({ home: dir, ids: ['claude'], mode: 'auto' });
  fs.mkdirSync(path.join(dir, '.qwen'));
  assert.deepStrictEqual(redetect.autoEnableNewHosts({ home: dir, env: QUIET_OFF, scope: 'project' }), { added: [], reason: 'not-global' });
  assert.deepStrictEqual(redetect.autoEnableNewHosts({ home: dir, env: { ...QUIET_OFF, CI: 'true' }, scope: 'global' }).added, []);
  assert.deepStrictEqual(redetect.autoEnableNewHosts({ home: dir, env: { ...QUIET_OFF, AEL_NO_AUTO_UPDATE: '1' }, scope: 'global' }).added, []);
  assert.deepStrictEqual(readUserConfig(dir).hosts.enabled, ['claude'], 'nothing written while quiet');
  assert.deepStrictEqual(redetect.autoEnableNewHosts({ home: dir, env: QUIET_OFF, scope: 'global' }), { added: ['qwen'] });
  assert.deepStrictEqual(readUserConfig(dir).hosts.enabled, ['claude', 'qwen']);
  assert.strictEqual(readUserConfig(dir).hosts.mode, 'auto');
  // A host the user disabled is never re-enabled.
  const off = home(['.claude', '.kiro']);
  applySetup({ home: off, ids: ['claude'], mode: 'auto' });
  require('../lib/hosts/commands.js').changeHosts({ home: off, selection: resolveHostSelection(off), disable: ['kiro'] });
  assert.deepStrictEqual(redetect.autoEnableNewHosts({ home: off, env: QUIET_OFF, scope: 'global' }).added, []);
});

test('mode manual: one notice per new host, at most once a day, never in CI', () => {
  const dir = home(['.claude']);
  applySetup({ home: dir, ids: ['claude'], mode: 'manual' });
  assert.strictEqual(redetect.autoEnableNewHosts({ home: dir, env: QUIET_OFF, scope: 'global' }).added.length, 0, 'manual never enables');
  fs.mkdirSync(path.join(dir, '.cursor'));
  const stamp = path.join(dir, '.ai-engineering-loop', 'hosts-notice.json');
  assert.strictEqual(redetect.newHostsNotice({ home: dir, env: { ...QUIET_OFF, CI: '1' } }), null);
  assert.ok(!fs.existsSync(stamp), 'CI writes nothing');
  const t0 = Date.parse('2026-10-11T00:00:00Z');
  const first = redetect.newHostsNotice({ home: dir, env: QUIET_OFF, now: t0 });
  assert.match(first, /new agent detected: cursor/);
  assert.match(first, /hosts enable cursor/);
  assert.strictEqual(redetect.newHostsNotice({ home: dir, env: QUIET_OFF, now: t0 + 1000 }), null, 'once');
  fs.mkdirSync(path.join(dir, '.kiro'));
  assert.strictEqual(redetect.newHostsNotice({ home: dir, env: QUIET_OFF, now: t0 + DAY / 2 }), null, 'rate limited');
  const later = redetect.newHostsNotice({ home: dir, env: QUIET_OFF, now: t0 + DAY + 1 });
  assert.match(later, /: kiro\./);
  assert.doesNotMatch(later, /cursor/, 'a host is announced only once');
  assert.strictEqual(redetect.newHostsNotice({ home: dir, env: QUIET_OFF, now: t0 + 3 * DAY }), null);
});

test('hosts doctor: counts visible copies, flags different duplicates and files to sync, writes nothing', () => {
  const dir = home(['.claude', '.cursor']);
  applySetup({ home: dir, ids: ['claude', 'cursor'], mode: 'manual' });
  applyHostSync({ packageRoot: ROOT, home: dir });
  const doctor = () => {
    const selection = resolveHostSelection(dir);
    return hostsDoctor({ home: dir, selection, plan: planHostSync({ packageRoot: ROOT, home: dir, hosts: selection }) });
  };
  let report = doctor();
  assert.ok(report.ok, JSON.stringify(report.hosts.filter((h) => !h.ok)));
  const cursor = report.hosts.find((h) => h.id === 'cursor');
  // Cursor scans ~/.claude/skills too: two identical copies.
  assert.strictEqual(cursor.copies.length, 2);
  assert.ok(cursor.identical);
  const stale = path.join(dir, '.cursor/skills/ai-engineering-loop/SKILL.md');
  fs.mkdirSync(path.dirname(stale), { recursive: true });
  fs.writeFileSync(stale, '---\nname: ai-engineering-loop\ndescription: old\n---\nold\n');
  fs.rmSync(path.join(dir, '.agents/skills/ai-engineering-loop/references/loop-hosts.md'));
  const before = listFiles(dir);
  report = doctor();
  assert.strictEqual(report.ok, false);
  const bad = report.hosts.find((h) => h.id === 'cursor');
  assert.strictEqual(bad.identical, false);
  assert.ok(bad.problems.some((p) => /different content/.test(p)));
  assert.ok(bad.resync.some((f) => f.endsWith('loop-hosts.md')));
  assert.ok(report.hosts.find((h) => h.id === 'claude').ok, 'claude only scans its own folder');
  const res = cli(dir, ['hosts', 'doctor', '--json']);
  assert.strictEqual(res.status, 1, res.stderr);
  assert.strictEqual(JSON.parse(res.stdout).ok, false);
  assert.match(cli(dir, ['hosts', 'doctor']).stdout, /DIFFERENT/);
  assert.deepStrictEqual(listFiles(dir), before, 'doctor is read-only');
});

test('README host table is generated from the registry (drift check)', () => {
  // Windows checkouts may use CRLF; the table is compared on LF text.
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/\r\n?/g, '\n');
  assert.strictEqual(replaceHostTable(readme), readme, 'README host table is stale: run npm run build:hosts-table');
  const table = renderHostTable();
  for (const host of HOSTS) assert.ok(table.includes(`\`${host.id}\``), host.id);
  assert.match(table, /Not supported \(no native skills\): Aider, Continue\./);
});
