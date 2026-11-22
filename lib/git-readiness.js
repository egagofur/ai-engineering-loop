'use strict';

const { spawnSync } = require('child_process');

function git(rootDir, args) {
  const result = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { missing: Boolean(result.error && result.error.code === 'ENOENT'), ok: result.status === 0, out: String(result.stdout || '').trim() };
}

const INSTALL = process.platform === 'darwin' ? '`xcode-select --install` (or `brew install git`)' : process.platform === 'win32' ? '`winget install Git.Git`' : '`sudo apt-get install -y git` (or your package manager)';

function gitReadiness(rootDir) {
  const version = git(rootDir, ['--version']);
  if (version.missing || !version.ok) {
    return { ok: false, code: 'GIT_MISSING', message: 'git is not installed', why: 'AEL binds every Run to a git commit: the Maker diff, impact map, receipts and worktrees all come from git.', fix: `Install git: ${INSTALL}, then rerun this command.`, warnings: [] };
  }
  if (git(rootDir, ['rev-parse', '--is-inside-work-tree']).out !== 'true') {
    return { ok: false, code: 'GIT_NOT_A_REPO', message: 'this folder is not a git repository', why: 'AEL reads the change from git, so the project must be a git repository.', fix: '`git init && git add -A && git commit -m "init"`, then rerun this command.', warnings: [] };
  }
  if (!git(rootDir, ['rev-parse', '--verify', '-q', 'HEAD']).ok) {
    return { ok: false, code: 'GIT_NO_COMMIT', message: 'the repository has no commit yet', why: 'A Run starts from the current commit; without one there is nothing to diff against.', fix: '`git add -A && git commit -m "init"`, then rerun this command.', warnings: [] };
  }
  const warnings = [];
  if (!git(rootDir, ['config', 'user.email']).out || !git(rootDir, ['config', 'user.name']).out) {
    warnings.push('git user.name / user.email are not set, so you cannot commit before `deliver`. FIX: `git config --global user.name "<name>" && git config --global user.email "<email>"`.');
  }
  return { ok: true, code: 'GIT_READY', message: 'git ready', warnings };
}

function assertGitReady(rootDir) {
  const result = gitReadiness(rootDir);
  if (!result.ok) throw Object.assign(new Error(`Git is not ready: ${result.message}.`), { code: result.code, why: result.why, fix: result.fix });
  return result;
}

function gitTopLevel(rootDir) {
  const result = git(rootDir, ['rev-parse', '--show-toplevel']);
  return result.ok && result.out ? result.out : null;
}

module.exports = { assertGitReady, gitReadiness, gitTopLevel };
