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

function resolveBase(mainRoot, baseRef) {
  if (baseRef == null || baseRef === '') {
    return { base: git(mainRoot, ['rev-parse', 'HEAD']), baseRef: 'HEAD' };
  }
  const name = String(baseRef).trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.includes('..') || name.startsWith('-') || name.endsWith('/')) {
    throw fail('--base needs a branch or commit that is already in this repository.', 'INVALID_USAGE', {
      why: 'A stacked Run starts from a local commit. AEL does not fetch.',
      fix: 'ael run --worktree --base <branch> "<task>"'
    });
  }
  const resolved = git(mainRoot, ['rev-parse', '--verify', '--quiet', `${name}^{commit}`], { allowFail: true });
  if (!resolved) {
    throw fail(`--base ${name} is not a commit in this repository.`, 'INVALID_USAGE', {
      why: 'A stacked Run starts from a commit that already exists here. AEL does not fetch.',
      fix: 'git rev-parse --verify <branch>'
    });
  }
  return { base: resolved, baseRef: name };
}

function createWorktree(rootDir, { task, now = new Date(), baseRef = null } = {}) {
  if (!String(task || '').trim()) throw fail('run --worktree needs a task: run --worktree "<task>"');
  const mainRoot = mainCheckout(rootDir);
  if (!mainRoot) throw fail('run --worktree needs a git repository');
  const resolved = resolveBase(mainRoot, baseRef);
  const id = now.toISOString().replace(/\D/g, '').slice(2, 12);
  const slug = `${slugOf(task)}-${id}`;
  const branch = `ael/${slug}`;
  const worktreePath = path.join(path.dirname(mainRoot), `${path.basename(mainRoot)}.ael-worktrees`, slug);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  git(mainRoot, ['worktree', 'add', '--quiet', '-b', branch, worktreePath, resolved.base]);
  copyContext(mainRoot, worktreePath);
  return { mainRoot, path: worktreePath, branch, base: resolved.base, baseRef: resolved.baseRef };
}

function registerWorktree(mainRoot, entry) {
  const registry = loadRegistry(mainRoot);
  registry.worktrees = registry.worktrees.filter((item) => realpath(item.path) !== realpath(entry.path)).concat(entry);
  saveRegistry(mainRoot, registry);
}

function dirtyKind(worktreePath) {
  const out = git(worktreePath, ['status', '--porcelain', '--', '.', ':(exclude).ai-engineering-loop'], { allowFail: true });
  if (out == null) return { kind: 'wip', tracked: 0, untracked: 0 };
  const lines = out.split('\n').filter(Boolean);
  const untracked = lines.filter((line) => line.startsWith('??')).length;
  const tracked = lines.length - untracked;
  return { kind: tracked ? 'wip' : untracked ? 'scratch' : 'clean', tracked, untracked };
}

function isDirty(worktreePath) {
  return dirtyKind(worktreePath).kind !== 'clean';
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

function isMerged(mainRoot, branch, runId = null) {
  if (require('./pr-status.js').loadMerge(mainRoot, runId)) return { merged: true, source: 'merge.json' };
  if (!git(mainRoot, ['rev-parse', '--verify', '--quiet', branch], { allowFail: true })) return { merged: false, gone: true };
  const target = defaultBranch(mainRoot);
  if (target && spawnSync('git', ['merge-base', '--is-ancestor', branch, target], { cwd: mainRoot }).status === 0) return { merged: true, source: 'ancestor' };
  const gh = require('./gh.js').ghJson(['pr', 'list', '--head', branch.replace(/^origin\//, ''), '--state', 'merged', '--json', 'number'], { cwd: mainRoot, timeoutMs: 15000 });
  if (gh.ok && Array.isArray(gh.value) && gh.value.length) return { merged: true, source: 'gh' };
  return { merged: false };
}

function hasOpenPr(mainRoot, branch) {
  if (!branch) return false;
  const gh = require('./gh.js').ghJson(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'], { cwd: mainRoot, timeoutMs: 15000 });
  return gh.ok && Array.isArray(gh.value) && gh.value.length > 0;
}

function sizeOf(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          total += 0;
        }
      }
    }
  }
  return total;
}

function ageDays(worktreePath, now) {
  const stamp = Number(git(worktreePath, ['log', '-1', '--format=%ct'], { allowFail: true }));
  return Number.isFinite(stamp) && stamp > 0 ? Math.floor((now.getTime() - stamp * 1000) / 86400000) : null;
}

function gitWorktrees(mainRoot) {
  const out = git(mainRoot, ['worktree', 'list', '--porcelain'], { allowFail: true }) || '';
  const items = [];
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: path.resolve(line.slice(9)), branch: null };
      items.push(current);
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice(7).replace(/^refs\/heads\//, '');
    }
  }
  return items.filter((item) => realpath(item.path) !== realpath(mainRoot));
}

function runStateOf(entry, mainRoot) {
  for (const root of [entry.path, mainRoot]) {
    const state = readJson(path.join(root, '.ai-engineering-loop', 'runs', entry.runId || '-', 'state.json'));
    if (state) return state;
  }
  return null;
}

function planPrune(rootDir, { now = new Date(), checkMerged = true, checkPrs = true, includeScratch = false, audit = false, sizes = false } = {}) {
  const mainRoot = mainCheckout(rootDir) || rootDir;
  const registry = loadRegistry(mainRoot);
  const plan = [];
  const registered = new Set(registry.worktrees.map((entry) => realpath(entry.path)));
  for (const entry of registry.worktrees) {
    if (entry.branchDeleted) continue;
    const exists = fs.existsSync(entry.path);
    const run = runStateOf(entry, mainRoot);
    const state = run?.state || null;
    const row = { path: entry.path, branch: entry.branch, runId: entry.runId || null, runState: state, registered: true, bucket: 'review', actions: [], notes: [] };
    if (!exists) {
      if (entry.state !== 'removed') {
        row.bucket = 'safe';
        row.actions.push('forget-missing-folder');
      }
    } else {
      const dirty = dirtyKind(entry.path);
      row.dirty = dirty;
      if (sizes) row.sizeBytes = sizeOf(entry.path);
      row.ageDays = ageDays(entry.path, now);
      const finished = TERMINAL.has(state);
      const activity = run && !finished ? runActivity(entry.path, run, { now }) : null;
      if (dirty.kind === 'wip') {
        row.bucket = 'hold-wip';
        row.notes.push(`kept: ${dirty.tracked} changed tracked file(s)`);
      } else if (activity?.live) {
        row.bucket = 'hold-live-run';
        row.notes.push(`kept: run ${run.runId} active ${activity.idleMinutes} minute(s) ago`);
      } else if (checkPrs && hasOpenPr(mainRoot, entry.branch)) {
        row.bucket = 'hold-open-pr';
        row.notes.push('kept: the branch has an open pull request');
      } else if (!finished) {
        row.bucket = 'review';
        if (activity?.idleMinutes != null && activity.idleMinutes >= IDLE_DAYS * 1440) row.notes.push(`run ${run.runId} idle ${Math.floor(activity.idleMinutes / 1440)} days: abandon it there if it is dead`);
      } else if (dirty.kind === 'scratch') {
        row.bucket = 'scratch';
        if (includeScratch) row.actions.push('remove-worktree');
        else row.notes.push(`kept: ${dirty.untracked} untracked file(s); add --include-scratch to remove them with the worktree`);
      } else {
        row.bucket = 'safe';
        row.actions.push('remove-worktree');
      }
    }
    if (checkMerged && entry.branch && (state === 'DELIVERED' || entry.state === 'removed' || entry.state === 'delivered')) {
      const merged = isMerged(mainRoot, entry.branch, entry.runId);
      if (merged.merged) {
        if (exists && !row.actions.includes('remove-worktree')) row.notes.push('branch merged but worktree kept');
        else row.actions.push('delete-branch');
      }
    }
    if (audit || row.actions.length || row.notes.length) plan.push(row);
  }
  if (audit) {
    for (const item of gitWorktrees(mainRoot)) {
      if (registered.has(realpath(item.path))) continue;
      const dirty = dirtyKind(item.path);
      plan.push({ path: item.path, branch: item.branch, runId: null, runState: null, registered: false, bucket: 'foreign', dirty, ...(sizes ? { sizeBytes: sizeOf(item.path) } : {}), ageDays: ageDays(item.path, now), actions: [], notes: ['not created by AEL: never removed by prune'] });
    }
  }
  if (sizes) plan.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
  return { mainRoot, plan };
}

function applyPrune(rootDir, { now = new Date(), includeScratch = false } = {}) {
  const { mainRoot, plan } = planPrune(rootDir, { now, includeScratch });
  const registry = loadRegistry(mainRoot);
  const done = [];
  for (const row of plan) {
    const entry = registry.worktrees.find((item) => item.path === row.path);
    if (!entry) continue;
    for (const action of row.actions) {
      if (action === 'remove-worktree') {
        const dirty = dirtyKind(row.path);
        if (dirty.kind === 'wip' || (dirty.kind === 'scratch' && !includeScratch)) continue;
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
    const { plan } = planPrune(rootDir, { checkMerged: false, checkPrs: false });
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
  dirtyKind,
  loadRegistry,
  mainCheckout,
  planPrune,
  pruneHint,
  registerWorktree,
  runActivity,
  runConflict
};
