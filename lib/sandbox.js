'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  RUN_MODES,
  RUN_STATES,
  assertRunId,
  atomicWritePrivateFile,
  atomicWriteJson,
  getCurrentRun,
  loadRun,
  runsDir
} = require('./run-state.js');
const { assertBudgetAvailable } = require('./budget.js');
const { assertModeAllowed } = require('./runtime-policy.js');
const { ensurePrivateRuntimeIgnores } = require('./runtime-files.js');

const LOCK_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function sandboxError(message, code = 'SANDBOX_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function sandboxRoot(rootDir) {
  return path.join(path.resolve(rootDir), '.ai-engineering-loop', 'worktrees');
}

function sandboxPath(rootDir, runId) {
  return path.join(sandboxRoot(rootDir), assertRunId(runId));
}

function lockPath(rootDir) {
  return path.join(rootDir, '.ai-engineering-loop', 'locks', 'maker.json');
}

function metadataPath(rootDir, runId) {
  return path.join(runsDir(rootDir), assertRunId(runId), 'sandbox.json');
}

function evidencePath(rootDir, runId) {
  return path.join(runsDir(rootDir), assertRunId(runId), 'sandbox-evidence.json');
}

function pathEntryExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (cause) {
    if (cause.code === 'ENOENT') return false;
    throw cause;
  }
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, assertRunId(runId));
  const current = getCurrentRun(rootDir);
  if (!current) throw sandboxError('No current run. Start one first.', 'NO_CURRENT_RUN');
  return current;
}

function git(rootDir, args, options = {}) {
  const { trim = true, ...execOptions } = options;
  try {
    const output = execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
      ...execOptions
    });
    return trim ? output.trim() : output;
  } catch (cause) {
    const detail = String(cause.stderr || cause.message || '').trim();
    throw sandboxError(`Git worktree operation failed${detail ? `: ${detail}` : ''}`, 'GIT_WORKTREE_FAILED');
  }
}

function assertGitRoot(rootDir) {
  const discovered = fs.realpathSync(git(rootDir, ['rev-parse', '--show-toplevel']));
  const requested = fs.realpathSync(rootDir);
  if (discovered !== requested) {
    throw sandboxError('Sandbox commands must run from the Git repository root', 'NOT_REPOSITORY_ROOT');
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return cause.code === 'EPERM';
  }
}

function readLock(rootDir) {
  const filePath = lockPath(rootDir);
  if (!fs.existsSync(filePath)) return null;
  if (fs.lstatSync(filePath).isSymbolicLink()) {
    throw sandboxError('Maker lock must not be a symbolic link', 'UNSAFE_RUNTIME_PATH');
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw sandboxError(`Maker lock is unreadable: ${cause.message}`, 'SANDBOX_LOCKED');
  }
}

function staleLocalLock(lock, now) {
  const created = Date.parse(lock.createdAt);
  return (
    lock.hostname === os.hostname() &&
    Number.isSafeInteger(lock.pid) &&
    Number.isFinite(created) &&
    now.getTime() - created > LOCK_MAX_AGE_MS &&
    !processIsAlive(lock.pid)
  );
}

function acquireMakerLock(rootDir, runId, now = new Date()) {
  ensurePrivateRuntimeIgnores(rootDir);
  const filePath = lockPath(rootDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const lock = {
    schemaVersion: 1,
    runId: assertRunId(runId),
    nonce: crypto.randomBytes(16).toString('hex'),
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: now.toISOString()
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    let descriptor;
    try {
      descriptor = fs.openSync(filePath, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(lock, null, 2)}\n`);
      fs.fchmodSync(descriptor, 0o600);
      return lock;
    } catch (cause) {
      if (cause.code !== 'EEXIST') throw cause;
      const existing = readLock(rootDir);
      if (attempt === 0 && staleLocalLock(existing, now)) {
        fs.unlinkSync(filePath);
        continue;
      }
      throw sandboxError(
        `Maker is locked by run ${existing?.runId || 'unknown'} on ${existing?.hostname || 'unknown host'}`,
        'SANDBOX_LOCKED'
      );
    } finally {
      if (descriptor != null) fs.closeSync(descriptor);
    }
  }
  throw sandboxError('Unable to acquire Maker lock', 'SANDBOX_LOCKED');
}

function releaseMakerLock(rootDir, ownedLock) {
  const existing = readLock(rootDir);
  if (!existing) return false;
  if (existing.runId !== ownedLock.runId || existing.nonce !== ownedLock.nonce) {
    throw sandboxError('Refusing to release a Maker lock owned by another process', 'LOCK_OWNERSHIP_MISMATCH');
  }
  fs.unlinkSync(lockPath(rootDir));
  return true;
}

function createSandbox(rootDir, { runId, now = new Date() } = {}) {
  const run = resolveRun(rootDir, runId);
  const mode = run.mode || RUN_MODES.ASSISTED;
  assertModeAllowed(rootDir, mode);
  assertBudgetAvailable(rootDir, { runId: run.runId });
  if (mode === RUN_MODES.REPORT_ONLY) {
    throw sandboxError('REPORT_ONLY mode cannot create a Maker sandbox', 'MODE_FORBIDS_MAKER');
  }
  if (run.state !== RUN_STATES.GOAL_FROZEN) {
    throw sandboxError(`Maker sandbox requires GOAL_FROZEN; run is ${run.state}`, 'INVALID_SANDBOX_STATE');
  }
  assertGitRoot(rootDir);
  ensurePrivateRuntimeIgnores(rootDir);
  const worktree = sandboxPath(rootDir, run.runId);
  if (pathEntryExists(worktree)) {
    throw sandboxError(`Sandbox already exists for run ${run.runId}`, 'SANDBOX_EXISTS');
  }
  const ownedLock = acquireMakerLock(rootDir, run.runId, now);
  try {
    const baseRevision = run.startedRevision;
    if (!/^[a-f0-9]{40,64}$/.test(String(baseRevision || ''))) {
      throw sandboxError('Run did not start from a reproducible Git revision', 'INVALID_BASE_REVISION');
    }
    fs.mkdirSync(path.dirname(worktree), { recursive: true, mode: 0o700 });
    git(rootDir, ['worktree', 'add', '--detach', worktree, baseRevision]);
    const metadata = {
      schemaVersion: 1,
      runId: run.runId,
      baseRevision,
      worktreePath: worktree,
      lockNonce: ownedLock.nonce,
      createdAt: now.toISOString()
    };
    atomicWriteJson(metadataPath(rootDir, run.runId), metadata);
    return metadata;
  } catch (cause) {
    try {
      if (pathEntryExists(worktree)) git(rootDir, ['worktree', 'remove', '--force', worktree]);
    } catch {
      // Preserve the original failure; `git worktree prune` can recover a partial registration.
    }
    releaseMakerLock(rootDir, ownedLock);
    throw cause;
  }
}

function loadOwnedSandbox(rootDir, runId) {
  const run = resolveRun(rootDir, runId);
  const expectedPath = sandboxPath(rootDir, run.runId);
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath(rootDir, run.runId), 'utf8'));
  } catch (cause) {
    throw sandboxError(`Sandbox metadata is unavailable: ${cause.message}`, 'SANDBOX_MISSING');
  }
  if (
    metadata.runId !== run.runId ||
    metadata.worktreePath !== expectedPath ||
    !/^[a-f0-9]{40,64}$/.test(String(metadata.baseRevision || ''))
  ) {
    throw sandboxError('Sandbox metadata is invalid', 'INVALID_SANDBOX_METADATA');
  }
  const lock = readLock(rootDir);
  if (!lock || lock.runId !== run.runId || lock.nonce !== metadata.lockNonce) {
    throw sandboxError('Maker lock does not match sandbox metadata', 'LOCK_OWNERSHIP_MISMATCH');
  }
  if (!fs.existsSync(expectedPath)) throw sandboxError('Sandbox worktree is missing', 'SANDBOX_MISSING');
  return { run, metadata, lock, worktree: expectedPath };
}

function captureSandbox(rootDir, { runId, now = new Date() } = {}) {
  const owned = loadOwnedSandbox(rootDir, runId);
  try {
    fs.unlinkSync(evidencePath(rootDir, owned.run.runId));
  } catch (cause) {
    if (cause.code !== 'ENOENT') throw cause;
  }
  git(owned.worktree, ['add', '--intent-to-add', '--all']);
  const diff = git(
    owned.worktree,
    ['diff', '--binary', '--no-ext-diff', 'HEAD', '--'],
    { trim: false }
  );
  if (!diff.trim()) throw sandboxError('Maker sandbox has no changes to capture', 'EMPTY_SANDBOX_DIFF');
  const diffFile = path.join(runsDir(rootDir), owned.run.runId, 'diff.patch');
  atomicWritePrivateFile(diffFile, diff);
  const evidence = {
    schemaVersion: 1,
    runId: owned.run.runId,
    sandboxed: true,
    baseRevision: owned.metadata.baseRevision,
    diffSha256: crypto.createHash('sha256').update(diff).digest('hex'),
    capturedAt: now.toISOString()
  };
  git(rootDir, ['worktree', 'remove', '--force', owned.worktree]);
  releaseMakerLock(rootDir, owned.lock);
  atomicWriteJson(evidencePath(rootDir, owned.run.runId), evidence);
  return { diffPath: diffFile, evidence };
}

function abortSandbox(rootDir, { runId } = {}) {
  const owned = loadOwnedSandbox(rootDir, runId);
  git(rootDir, ['worktree', 'remove', '--force', owned.worktree]);
  releaseMakerLock(rootDir, owned.lock);
  return { runId: owned.run.runId, aborted: true };
}

function sandboxStatus(rootDir, { runId } = {}) {
  const run = resolveRun(rootDir, runId);
  const filePath = metadataPath(rootDir, run.runId);
  if (!fs.existsSync(filePath)) return { runId: run.runId, exists: false, locked: false };
  const metadata = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const lock = readLock(rootDir);
  return {
    runId: run.runId,
    exists: fs.existsSync(sandboxPath(rootDir, run.runId)),
    locked: lock?.runId === run.runId && lock?.nonce === metadata.lockNonce,
    baseRevision: metadata.baseRevision
  };
}

module.exports = {
  LOCK_MAX_AGE_MS,
  sandboxRoot,
  sandboxPath,
  lockPath,
  metadataPath,
  evidencePath,
  acquireMakerLock,
  releaseMakerLock,
  createSandbox,
  captureSandbox,
  abortSandbox,
  sandboxStatus
};
