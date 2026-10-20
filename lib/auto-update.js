'use strict';

// Auto-update (issue #37). The CLI, never an agent, checks the npm registry at
// most once per 24 hours in a detached background process and applies
// patch/minor releases only under the policy the user chose. Majors are always
// notice-only. Offline or slow registries never block a command.
//
// Conservative choices (see the PR):
// - Project-scoped installs (devDependency/npx) are notify-only: package.json
//   and lockfiles are never edited automatically.
// - Agents never initiate updates; only this CLI under a user-set policy does.
// - With no policy configured and no interactive answer, the policy is
//   `notify` (the first-run prompt offers `minor` as the default answer).

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { homeDir, userStatePath, readJsonFile, writeJsonFile, readUserConfig, writeUserConfig } = require('./user-state.js');
const { compareVersions, parseVersion } = require('./update-manager.js');

const POLICIES = Object.freeze(['off', 'notify', 'patch', 'minor', 'all']);
const DEFAULT_POLICY = 'minor';
const UNSET_POLICY = 'notify';
const CHANNELS = Object.freeze(['latest', 'next']);
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 3000;
const LOCK_STALE_MS = 15 * 60 * 1000;

const truthy = (value) => ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());

// Background checks are disabled inside the Node test runner (no network,
// no orphan processes) unless a test opts in with AEL_ALLOW_AUTO_UPDATE_IN_TESTS.
function autoUpdateAllowedHere(env = process.env) {
  if (env.NODE_TEST_CONTEXT && !truthy(env.AEL_ALLOW_AUTO_UPDATE_IN_TESTS)) return false;
  return true;
}

function resolvePolicy({ config = readUserConfig(), env = process.env } = {}) {
  const channel = CHANNELS.includes(config.updateChannel) ? config.updateChannel : 'latest';
  const pin = typeof config.updatePin === 'string' && config.updatePin.trim() ? config.updatePin.trim() : null;
  if (truthy(env.AEL_NO_AUTO_UPDATE)) return { policy: 'off', source: 'AEL_NO_AUTO_UPDATE', channel, pin };
  if (truthy(env.CI)) return { policy: 'off', source: 'CI', channel, pin };
  if (POLICIES.includes(config.autoUpdate)) return { policy: config.autoUpdate, source: 'config', channel, pin };
  return { policy: UNSET_POLICY, source: 'unset', channel, pin };
}

function setPolicy({ policy, channel, pin, home = homeDir() } = {}) {
  const patch = {};
  if (policy !== undefined) {
    if (!POLICIES.includes(policy)) {
      const err = new Error(`Invalid auto-update policy "${policy}". Use: ${POLICIES.join(', ')}`);
      err.code = 'INVALID_POLICY';
      throw err;
    }
    patch.autoUpdate = policy;
  }
  if (channel !== undefined) {
    if (!CHANNELS.includes(channel)) {
      const err = new Error(`Invalid update channel "${channel}". Use: ${CHANNELS.join(', ')}`);
      err.code = 'INVALID_CHANNEL';
      throw err;
    }
    patch.updateChannel = channel;
  }
  if (pin !== undefined) {
    if (pin !== null && !/^\d+(\.(\d+|x))?(\.(\d+|x))?$/.test(pin)) {
      const err = new Error(`Invalid pin "${pin}". Use forms like 1, 1.13, or 1.13.x`);
      err.code = 'INVALID_PIN';
      throw err;
    }
    patch.updatePin = pin;
  }
  return writeUserConfig(patch, home);
}

// ---- cache ---------------------------------------------------------------

const cachePath = (home) => userStatePath('update-check.json', home);
const statePath = (home) => userStatePath('update-state.json', home);
const lockPath = (home) => userStatePath('update.lock', home);

function readCache(home = homeDir()) {
  return readJsonFile(cachePath(home), null);
}

function cacheStale(cache, now = new Date()) {
  if (!cache || !cache.checkedAt) return true;
  const age = now.getTime() - Date.parse(cache.checkedAt);
  return !(age >= 0 && age < CHECK_INTERVAL_MS);
}

function fetchDistTags(packageName, { env = process.env, timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  if (truthy(env.AEL_UPDATE_OFFLINE)) {
    const err = new Error('offline (AEL_UPDATE_OFFLINE)');
    err.code = 'OFFLINE';
    throw err;
  }
  if (env.AEL_UPDATE_DIST_TAGS) return JSON.parse(env.AEL_UPDATE_DIST_TAGS);
  const output = execFileSync('npm', ['view', packageName, 'dist-tags', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: timeoutMs,
    windowsHide: true
  });
  return JSON.parse(output);
}

// Never throws. A failed check keeps the previous dist-tags.
function refreshCache({ packageName, home = homeDir(), env = process.env, now = new Date() } = {}) {
  const previous = readCache(home) || {};
  let next;
  try {
    const distTags = fetchDistTags(packageName, { env });
    if (!distTags || typeof distTags !== 'object' || Array.isArray(distTags)) throw new Error('unexpected npm response');
    next = { schemaVersion: 1, packageName, checkedAt: now.toISOString(), distTags, error: null, notified: previous.notified || null, notices: previous.notices || {}, highlights: previous.highlights || null };
  } catch (error) {
    next = { schemaVersion: 1, packageName, checkedAt: now.toISOString(), distTags: previous.distTags || null, error: error.code || 'CHECK_FAILED', notified: previous.notified || null, notices: previous.notices || {}, highlights: previous.highlights || null };
  }
  try {
    writeJsonFile(cachePath(home), next);
  } catch {
    // Unwritable home: still return the result.
  }
  return next;
}

// ---- decision ------------------------------------------------------------

function bumpType(current, target) {
  if (compareVersions(target, current) <= 0) return 'none';
  const [cMajor, cMinor] = parseVersion(current);
  const [tMajor, tMinor] = parseVersion(target);
  if (tMajor !== cMajor) return 'major';
  if (tMinor !== cMinor) return 'minor';
  return 'patch';
}

function matchesPin(version, pin) {
  if (!pin) return true;
  const parts = parseVersion(version);
  return pin.split('.').every((part, index) => part === 'x' || Number(part) === parts[index]);
}

function decideUpdate({ current, distTags, policy, channel = 'latest', pin = null }) {
  const target = distTags && (distTags[channel] || distTags.latest);
  if (!target) return { action: 'none', reason: 'NO_DATA', target: null, bump: 'none' };
  let bump;
  try {
    bump = bumpType(current, target);
  } catch {
    return { action: 'none', reason: 'INVALID_VERSION', target, bump: 'none' };
  }
  if (bump === 'none') return { action: 'none', reason: 'UP_TO_DATE', target, bump };
  if (policy === 'off') return { action: 'none', reason: 'POLICY_OFF', target, bump };
  const notify = (reason) => ({ action: 'notify', reason, target, bump });
  if (bump === 'major') return notify('MAJOR_NOTICE_ONLY');
  if (!matchesPin(target, pin)) return notify('PINNED');
  if (/-/.test(target) && policy !== 'all') return notify('PRERELEASE');
  if (policy === 'notify') return notify('POLICY_NOTIFY');
  if (policy === 'patch' && bump !== 'patch') return notify('POLICY_PATCH_ONLY');
  return { action: 'apply', reason: `POLICY_${policy.toUpperCase()}`, target, bump };
}

// ---- lock ----------------------------------------------------------------

function acquireLock(home = homeDir(), { now = Date.now() } = {}) {
  const file = lockPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() }));
      fs.closeSync(fd);
      return () => {
        try {
          fs.unlinkSync(file);
        } catch {
          // Already gone.
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        stale = now - fs.statSync(file).mtimeMs > LOCK_STALE_MS;
      } catch {
        stale = true;
      }
      if (!stale) return null;
      try {
        fs.unlinkSync(file);
      } catch {
        // Raced with another process.
      }
    }
  }
  return null;
}

// ---- state, apply, rollback ----------------------------------------------

function readState(home = homeDir()) {
  return readJsonFile(statePath(home), null) || { schemaVersion: 1 };
}

function writeState(state, home = homeDir()) {
  writeJsonFile(statePath(home), { schemaVersion: 1, ...state });
}

function defaultExec(cmd, args, options = {}) {
  return execFileSync(cmd, args, { stdio: 'ignore', windowsHide: true, timeout: 10 * 60 * 1000, ...options });
}

// Projects whose current run is not terminal are skipped and retried later.
function activeRun(projectDir, { readCurrentRun }) {
  try {
    const run = readCurrentRun(projectDir);
    return run && !run.terminal ? run : null;
  } catch {
    return null;
  }
}

function refreshProjects({ projects, exec, readCurrentRun, bin }) {
  const refreshed = [];
  const pending = [];
  const failed = [];
  for (const project of projects) {
    if (activeRun(project.path, { readCurrentRun })) {
      pending.push(project.path);
      continue;
    }
    try {
      exec(bin.cmd, [...bin.args, 'refresh', '--non-destructive'], { cwd: project.path });
      refreshed.push(project.path);
    } catch {
      failed.push(project.path);
    }
  }
  return { refreshed, pending, failed };
}

const GLOBAL_BIN = Object.freeze({ cmd: 'ai-engineering-loop', args: [] });

// Refuses a release whose registry metadata names a different repository than
// this package, or has no integrity hash. npm itself verifies the tarball
// against dist.integrity during install.
function defaultViewRelease(packageName, version) {
  const out = execFileSync('npm', ['view', `${packageName}@${version}`, 'repository.url', 'dist.integrity', '--json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000, windowsHide: true
  });
  const parsed = JSON.parse(out);
  return { repository: parsed['repository.url'] || '', integrity: parsed['dist.integrity'] || '' };
}

function repoSlug(url) {
  const match = String(url || '').match(/github\.com[/:]([^/]+\/[^/.#]+)/i);
  return match ? match[1].toLowerCase() : null;
}

function verifyRelease({ packageName, version, expectedRepository, viewRelease = defaultViewRelease }) {
  let info;
  try {
    info = viewRelease(packageName, version);
  } catch {
    return { ok: false, reason: 'RELEASE_LOOKUP_FAILED' };
  }
  if (!info.integrity) return { ok: false, reason: 'NO_INTEGRITY' };
  const expected = repoSlug(expectedRepository);
  if (expected && repoSlug(info.repository) !== expected) return { ok: false, reason: 'REPOSITORY_MISMATCH' };
  return { ok: true };
}

// Applies `target` for a global install: npm install -g, sync-hosts, then a
// non-destructive refresh of every registered project.
function applyUpdate({
  packageName,
  current,
  target,
  scope,
  projects = [],
  home = homeDir(),
  exec = defaultExec,
  readCurrentRun,
  bin = GLOBAL_BIN,
  expectedRepository = null,
  viewRelease = defaultViewRelease,
  now = new Date()
}) {
  if (scope !== 'global') return { applied: false, reason: 'PROJECT_SCOPE_NOTIFY_ONLY' };
  const verified = verifyRelease({ packageName, version: target, expectedRepository, viewRelease });
  if (!verified.ok) return { applied: false, reason: verified.reason };
  if (projects.some((p) => {
    const run = activeRun(p.path, { readCurrentRun });
    return run && run.mode === 'UNATTENDED';
  })) {
    return { applied: false, reason: 'UNATTENDED_RUN_ACTIVE' };
  }
  const release = acquireLock(home);
  if (!release) return { applied: false, reason: 'LOCKED' };
  const state = readState(home);
  try {
    writeState({ ...state, inProgress: { from: current, to: target, at: now.toISOString() } }, home);
    try {
      exec('npm', ['install', '--global', `${packageName}@${target}`]);
    } catch (error) {
      writeState({ ...state, inProgress: null, lastError: { to: target, step: 'install', at: now.toISOString(), message: String(error.message).slice(0, 300) } }, home);
      return { applied: false, reason: 'INSTALL_FAILED' };
    }
    let hosts = 'synced';
    try {
      exec(bin.cmd, [...bin.args, 'sync-hosts']);
    } catch {
      hosts = 'failed';
    }
    const result = refreshProjects({ projects, exec, readCurrentRun, bin });
    const summary = {
      from: current,
      to: target,
      at: now.toISOString(),
      hosts,
      refreshed: result.refreshed.length,
      total: projects.length,
      pending: result.pending,
      failed: result.failed,
      shown: false
    };
    writeState({ ...state, inProgress: null, previousVersion: current, currentVersion: target, lastApplied: summary, pendingProjects: result.pending }, home);
    return { applied: true, ...summary };
  } finally {
    release();
  }
}

function processPending({ projects, home = homeDir(), exec = defaultExec, readCurrentRun, bin = GLOBAL_BIN }) {
  const state = readState(home);
  const wanted = new Set(state.pendingProjects || []);
  if (!wanted.size) return { refreshed: [], pending: [] };
  const release = acquireLock(home);
  if (!release) return { refreshed: [], pending: [...wanted], reason: 'LOCKED' };
  try {
    const result = refreshProjects({ projects: projects.filter((p) => wanted.has(p.path)), exec, readCurrentRun, bin });
    writeState({ ...readState(home), pendingProjects: result.pending }, home);
    return result;
  } finally {
    release();
  }
}

// Undo the legacy first-update overwrite (decision 5 on #37): copy snapshot
// files back and drop the hash files so the project is exactly as before.
function restoreLegacySnapshots({ projects = [], since }) {
  const restored = [];
  if (!since) return restored;
  for (const project of projects) {
    const contextDir = path.join(project.path, '.ai-engineering-loop');
    const backupRoot = path.join(contextDir, '.ael-backup');
    let entries = [];
    try {
      entries = fs.readdirSync(backupRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch {
      continue;
    }
    for (const name of entries) {
      const dir = path.join(backupRoot, name);
      const metaPath = path.join(dir, 'snapshot.json');
      const meta = readJsonFile(metaPath, null);
      if (!meta || meta.reason !== 'LEGACY_FIRST_UPDATE' || meta.restoredAt) continue;
      if (Date.parse(meta.at) < Date.parse(since)) continue;
      for (const rel of meta.files || []) {
        const from = path.resolve(dir, rel);
        const to = path.resolve(contextDir, rel);
        if (!from.startsWith(path.resolve(dir) + path.sep) || !to.startsWith(path.resolve(contextDir) + path.sep)) continue;
        try {
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(from, to);
        } catch {
          // Keep going; the snapshot stays for manual recovery.
        }
      }
      for (const hashFile of [path.join(contextDir, '.ael-generated.json'), path.join(contextDir, 'adrs', '.ael-generated.json')]) {
        try {
          fs.unlinkSync(hashFile);
        } catch {
          // Not present.
        }
      }
      writeJsonFile(metaPath, { ...meta, restoredAt: new Date().toISOString() });
      restored.push({ project: project.path, snapshot: path.relative(project.path, dir).split(path.sep).join('/'), files: (meta.files || []).length });
    }
  }
  return restored;
}

function rollback({ packageName, home = homeDir(), exec = defaultExec, bin = GLOBAL_BIN, now = new Date(), projects = [] }) {
  const state = readState(home);
  if (!state.previousVersion) {
    const err = new Error('No previous version recorded; nothing to roll back.');
    err.code = 'NO_ROLLBACK';
    throw err;
  }
  const release = acquireLock(home);
  if (!release) {
    const err = new Error('Another update is running (update.lock).');
    err.code = 'LOCKED';
    throw err;
  }
  try {
    exec('npm', ['install', '--global', `${packageName}@${state.previousVersion}`]);
    exec(bin.cmd, [...bin.args, 'sync-hosts']);
    const restored = restoreLegacySnapshots({ projects, since: state.lastApplied && state.lastApplied.at });
    const record = { from: state.currentVersion || null, to: state.previousVersion, at: now.toISOString(), restored };
    writeState({ ...state, currentVersion: state.previousVersion, previousVersion: null, lastRollback: record }, home);
    return record;
  } finally {
    release();
  }
}

// One-line summary of the last automatic update, returned once.
function consumeSummary(home = homeDir()) {
  const state = readState(home);
  const last = state.lastApplied;
  if (!last || last.shown) return null;
  writeState({ ...state, lastApplied: { ...last, shown: true } }, home);
  const pending = last.pending && last.pending.length
    ? `, ${last.pending.length} pending (active run; if abandoned: ai-engineering-loop run --abandon --reason "<why>" --by <name> in that project)`
    : '';
  const failed = last.failed && last.failed.length ? `, ${last.failed.length} failed` : '';
  return `ai-engineering-loop updated ${last.from} -> ${last.to}; hosts ${last.hosts}; ${last.refreshed}/${last.total} projects refreshed${pending}${failed}.`;
}

// Starts `update auto --background` detached; returns immediately.
function spawnBackgroundCheck({ cliPath, env = process.env }) {
  try {
    const child = spawn(process.execPath, [cliPath, 'update', 'auto', '--background'], {
      detached: true,
      stdio: 'ignore',
      env,
      windowsHide: true
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  restoreLegacySnapshots,
  POLICIES,
  DEFAULT_POLICY,
  UNSET_POLICY,
  CHANNELS,
  CHECK_INTERVAL_MS,
  CHECK_TIMEOUT_MS,
  autoUpdateAllowedHere,
  resolvePolicy,
  setPolicy,
  readCache,
  cacheStale,
  fetchDistTags,
  refreshCache,
  bumpType,
  matchesPin,
  decideUpdate,
  acquireLock,
  readState,
  applyUpdate,
  verifyRelease,
  processPending,
  rollback,
  consumeSummary,
  spawnBackgroundCheck
};
