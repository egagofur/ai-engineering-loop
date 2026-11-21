'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const LIVE_MINUTES = 15;
const IDLE_DAYS = 7;
const REGISTRY = path.join('.ai-engineering-loop', 'worktrees.json');
const TERMINAL = new Set(['REPORTED', 'DELIVERED', 'ESCALATED', 'CANCELLED']);
const CONTEXT_SKIP = new Set(['runs', 'recaps', 'tasks', 'current.json', 'worktrees.json', 'bench-ablation.json']);

const fail = (message, code = 'INVALID_USAGE', extra = {}) => Object.assign(new Error(message), { code, ...extra });

function git(cwd, args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (error) {
    if (allowFail) return null;
    throw error;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function lastLifecycleAt(rootDir, runId) {
  try {
    const lines = fs.readFileSync(path.join(rootDir, '.ai-engineering-loop', 'runs', runId, 'lifecycle.jsonl'), 'utf8').trim().split('\n');
    return Date.parse(JSON.parse(lines[lines.length - 1]).at) || 0;
  } catch {
    return 0;
  }
}

function runActivity(rootDir, run, { now = new Date() } = {}) {
  const last = Math.max(Date.parse(run.updatedAt || run.createdAt || 0) || 0, lastLifecycleAt(rootDir, run.runId));
  const idleMinutes = last ? Math.max(0, Math.floor((now.getTime() - last) / 60000)) : null;
  return { lastActivity: last ? new Date(last).toISOString() : null, idleMinutes, live: idleMinutes != null && idleMinutes < LIVE_MINUTES };
}

const normalizeTask = (text) => String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();

function changedFileCount(rootDir) {
  const out = git(rootDir, ['status', '--porcelain', '--', '.', ':(exclude).ai-engineering-loop'], { allowFail: true });
  return out ? out.split('\n').filter(Boolean).length : 0;
}

function runConflict(rootDir, current, task, { now = new Date() } = {}) {
  if (!current || TERMINAL.has(current.state)) return null;
  const wanted = normalizeTask(task);
  if (!wanted || wanted === normalizeTask(current.task)) return null;
  const activity = runActivity(rootDir, current, { now });
  const quoted = JSON.stringify(String(task).trim());
  return {
    runId: current.runId,
    state: current.state,
    task: current.task || null,
    ...activity,
    changedFiles: changedFileCount(rootDir),
    recommended: activity.live || changedFileCount(rootDir) ? 'worktree' : 'abandon',
    options: [
      { id: 'worktree', label: 'New worktree for this task', command: `ai-engineering-loop run --worktree --json ${quoted}` },
      { id: 'resume', label: `Resume ${current.runId} instead`, command: 'ai-engineering-loop run --json' },
      { id: 'abandon', label: `Abandon ${current.runId}, then start this task`, command: `ai-engineering-loop run --abandon --run ${current.runId} --reason "<why>" --by <name>${activity.live ? ' --force-live' : ''}` }
    ]
  };
}

function mainCheckout(cwd) {
  const common = git(cwd, ['rev-parse', '--git-common-dir'], { allowFail: true });
  if (!common) return null;
  return path.dirname(path.resolve(cwd, common));
}

const realpath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

function loadRegistry(mainRoot) {
  return readJson(path.join(mainRoot, REGISTRY)) || { schemaVersion: 1, worktrees: [] };
}

function saveRegistry(mainRoot, registry) {
  fs.mkdirSync(path.join(mainRoot, '.ai-engineering-loop'), { recursive: true });
  fs.writeFileSync(path.join(mainRoot, REGISTRY), `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
}

function slugOf(task) {
  return normalizeTask(task).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'task';
}

function copyContext(fromRoot, toRoot) {
  const from = path.join(fromRoot, '.ai-engineering-loop');
  const to = path.join(toRoot, '.ai-engineering-loop');
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (CONTEXT_SKIP.has(name)) continue;
    const target = path.join(to, name);
    if (!fs.existsSync(target)) fs.cpSync(path.join(from, name), target, { recursive: true });
  }
}

function createWorktree(rootDir, { task, now = new Date() }) {
  if (!String(task || '').trim()) throw fail('run --worktree needs a task: run --worktree "<task>"');
  const mainRoot = mainCheckout(rootDir);
  if (!mainRoot) throw fail('run --worktree needs a git repository');
  const id = now.toISOString().replace(/\D/g, '').slice(2, 12);
  const slug = `${slugOf(task)}-${id}`;
  const branch = `ael/${slug}`;
  const worktreePath = path.join(path.dirname(mainRoot), `${path.basename(mainRoot)}.ael-worktrees`, slug);
  const base = git(mainRoot, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  git(mainRoot, ['worktree', 'add', '--quiet', '-b', branch, worktreePath, base]);
  copyContext(mainRoot, worktreePath);
  return { mainRoot, path: worktreePath, branch, base };
}

function registerWorktree(mainRoot, entry) {
  const registry = loadRegistry(mainRoot);
  registry.worktrees = registry.worktrees.filter((item) => realpath(item.path) !== realpath(entry.path)).concat(entry);
  saveRegistry(mainRoot, registry);
}

function isDirty(worktreePath) {
  const out = git(worktreePath, ['status', '--porcelain', '--', '.', ':(exclude).ai-engineering-loop'], { allowFail: true });
  return out == null ? true : out.split('\n').filter(Boolean).length > 0;
}

function copyEvidence(worktreePath, mainRoot, runId) {
  if (!runId) return false;
  const from = path.join(worktreePath, '.ai-engineering-loop', 'runs', runId);
  if (!fs.existsSync(from)) return false;
  const to = path.join(mainRoot, '.ai-engineering-loop', 'runs', runId);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true });
  return true;
}

function removeWorktree(mainRoot, worktreePath) {
  git(mainRoot, ['worktree', 'remove', '--force', worktreePath]);
}

function cleanupAfterDeliver(cwd, runId, { now = new Date() } = {}) {
  const mainRoot = mainCheckout(cwd);
  if (!mainRoot || realpath(mainRoot) === realpath(cwd)) return null;
  const registry = loadRegistry(mainRoot);
  const entry = registry.worktrees.find((item) => realpath(item.path) === realpath(cwd));
  if (!entry) return null;
  const evidenceCopied = copyEvidence(cwd, mainRoot, runId || entry.runId);
  const result = { worktree: entry.path, branch: entry.branch, mainCheckout: mainRoot, evidenceCopied, removed: false };
  if (isDirty(cwd)) {
    result.keptReason = 'the worktree has uncommitted or untracked changes; commit or discard them, then run `worktree prune`';
    entry.state = 'delivered';
  } else {
    removeWorktree(mainRoot, cwd);
    result.removed = true;
    entry.state = 'removed';
    entry.removedAt = now.toISOString();
  }
  entry.deliveredAt = now.toISOString();
  saveRegistry(mainRoot, registry);
  return result;
}

function defaultBranch(mainRoot) {
  const head = git(mainRoot, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { allowFail: true });
  if (head) return head.replace('refs/remotes/', '');
  for (const name of ['main', 'master']) {
    if (git(mainRoot, ['rev-parse', '--verify', '--quiet', name], { allowFail: true })) return name;
  }
  return null;
}

function isMerged(mainRoot, branch) {
  if (!git(mainRoot, ['rev-parse', '--verify', '--quiet', branch], { allowFail: true })) return { merged: false, gone: true };
  const target = defaultBranch(mainRoot);
  if (target && spawnSync('git', ['merge-base', '--is-ancestor', branch, target], { cwd: mainRoot }).status === 0) return { merged: true };
  const gh = spawnSync('gh', ['pr', 'list', '--head', branch.replace(/^origin\//, ''), '--state', 'merged', '--json', 'number'], { cwd: mainRoot, encoding: 'utf8', timeout: 15000 });
  if (gh.status === 0) {
    try {
      if (JSON.parse(gh.stdout || '[]').length) return { merged: true };
    } catch {
      return { merged: false };
    }
  }
  return { merged: false };
}

function runStateOf(entry, mainRoot) {
  for (const root of [entry.path, mainRoot]) {
    const state = readJson(path.join(root, '.ai-engineering-loop', 'runs', entry.runId || '-', 'state.json'));
    if (state) return state;
  }
  return null;
}

function planPrune(rootDir, { now = new Date(), checkMerged = true } = {}) {
  const mainRoot = mainCheckout(rootDir) || rootDir;
  const registry = loadRegistry(mainRoot);
  const plan = [];
  for (const entry of registry.worktrees) {
    if (entry.branchDeleted) continue;
    const exists = fs.existsSync(entry.path);
    const run = runStateOf(entry, mainRoot);
    const state = run?.state || null;
    const row = { path: entry.path, branch: entry.branch, runId: entry.runId || null, runState: state, actions: [], notes: [] };
    if (!exists && entry.state !== 'removed') {
      row.actions.push('forget-missing-folder');
    } else if (exists) {
      if (state === 'DELIVERED' || state === 'CANCELLED' || state === 'ESCALATED') {
        if (isDirty(entry.path)) row.notes.push('kept: uncommitted or untracked changes');
        else row.actions.push('remove-worktree');
      } else if (run) {
        const activity = runActivity(entry.path, run, { now });
        if (activity.idleMinutes != null && activity.idleMinutes >= IDLE_DAYS * 1440) row.notes.push(`run ${run.runId} idle ${Math.floor(activity.idleMinutes / 1440)} days: abandon it there if it is dead`);
      }
    }
    if (checkMerged && entry.branch && (state === 'DELIVERED' || entry.state === 'removed' || entry.state === 'delivered')) {
      const merged = isMerged(mainRoot, entry.branch);
      if (merged.merged) {
        if (exists && !row.actions.includes('remove-worktree')) row.notes.push('branch merged but worktree kept until it is clean');
        else row.actions.push('delete-branch');
      }
    }
    if (row.actions.length || row.notes.length) plan.push(row);
  }
  return { mainRoot, plan };
}

function applyPrune(rootDir, { now = new Date() } = {}) {
  const { mainRoot, plan } = planPrune(rootDir, { now });
  const registry = loadRegistry(mainRoot);
  const done = [];
  for (const row of plan) {
    const entry = registry.worktrees.find((item) => item.path === row.path);
    for (const action of row.actions) {
      if (action === 'remove-worktree') {
        if (isDirty(row.path)) continue;
        copyEvidence(row.path, mainRoot, row.runId);
        removeWorktree(mainRoot, row.path);
        entry.state = 'removed';
        entry.removedAt = now.toISOString();
      } else if (action === 'forget-missing-folder') {
        git(mainRoot, ['worktree', 'prune'], { allowFail: true });
        entry.state = 'removed';
        entry.removedAt = now.toISOString();
      } else if (action === 'delete-branch') {
        if (fs.existsSync(row.path)) continue;
        git(mainRoot, ['branch', '-D', row.branch], { allowFail: true });
        entry.branchDeleted = true;
      }
      done.push({ path: row.path, action });
    }
  }
  saveRegistry(mainRoot, registry);
  return { mainRoot, done, plan };
}

function pruneHint(rootDir) {
  try {
    const { plan } = planPrune(rootDir, { checkMerged: false });
    const ready = plan.filter((row) => row.actions.length).length;
    return ready ? `${ready} AEL worktree(s) can be cleaned up: ai-engineering-loop worktree prune` : null;
  } catch {
    return null;
  }
}

module.exports = {
  IDLE_DAYS,
  LIVE_MINUTES,
  applyPrune,
  cleanupAfterDeliver,
  createWorktree,
  loadRegistry,
  mainCheckout,
  planPrune,
  pruneHint,
  registerWorktree,
  runActivity,
  runConflict
};
