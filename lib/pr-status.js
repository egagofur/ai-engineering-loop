'use strict';

const fs = require('fs');
const path = require('path');
const { ghJson } = require('./gh.js');

const FIELDS = 'number,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,mergedAt,mergeCommit,headRefName';
const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);
const PENDING = new Set(['QUEUED', 'IN_PROGRESS', 'PENDING', 'WAITING', 'REQUESTED', 'EXPECTED']);

const fail = (message, code, fix) => Object.assign(new Error(message), { code, fix });
const runDir = (rootDir, runId) => path.join(rootDir, '.ai-engineering-loop', 'runs', runId);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function branchForRun(rootDir, runId) {
  const registry = readJson(path.join(rootDir, '.ai-engineering-loop', 'worktrees.json'));
  const entry = (registry?.worktrees || []).find((item) => item.runId === runId);
  if (entry?.branch) return entry.branch;
  const destination = readJson(path.join(runDir(rootDir, runId), 'delivery.json'))?.destination;
  if (destination && !/^https?:\/\//.test(destination) && !/\s/.test(destination)) return destination;
  return null;
}

function checkName(check) {
  return check.name || check.context || check.workflowName || 'check';
}

function verdictOf(pr) {
  if (pr.state === 'MERGED') return { verdict: 'merged', blockers: [] };
  if (pr.state === 'CLOSED') return { verdict: 'closed', blockers: [] };
  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  const failing = checks.filter((check) => FAILED.has(String(check.conclusion || check.state || '').toUpperCase())).map(checkName);
  const pending = checks.filter((check) => PENDING.has(String(check.status || check.state || '').toUpperCase()) && !check.conclusion).map(checkName);
  const blockers = [];
  if (pr.isDraft) blockers.push('draft');
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') blockers.push('merge-conflicts');
  if (failing.length) blockers.push(`failing-checks: ${[...new Set(failing)].join(', ')}`);
  if (pr.reviewDecision === 'CHANGES_REQUESTED') blockers.push('changes-requested');
  if (blockers.length) return { verdict: 'blocker', blockers };
  if (pending.length || pr.mergeable === 'UNKNOWN') return { verdict: 'waiting', blockers: [], waitingOn: [...new Set(pending)] };
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return { verdict: 'waiting', blockers: [], waitingOn: ['review'] };
  return { verdict: 'ready', blockers: [] };
}

function recordMerge(rootDir, runId, pr) {
  if (!runId || !fs.existsSync(runDir(rootDir, runId))) return false;
  const file = path.join(runDir(rootDir, runId), 'merge.json');
  if (fs.existsSync(file)) return false;
  const value = { schemaVersion: 1, runId, pr: pr.number, url: pr.url, mergedAt: pr.mergedAt || null, mergeCommit: pr.mergeCommit?.oid || null, branch: pr.headRefName || null };
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return true;
}

function loadMerge(rootDir, runId) {
  return runId ? readJson(path.join(runDir(rootDir, runId), 'merge.json')) : null;
}

function prStatus(rootDir, { runId = null, branch = null, pr = null } = {}) {
  const target = pr ? String(pr).replace(/^#/, '') : branch || (runId ? branchForRun(rootDir, runId) : null);
  if (!target) {
    throw fail('No PR to check: pass --pr <number>, --branch <name>, or a --run whose delivery or worktree names a branch', 'INVALID_USAGE', 'ai-engineering-loop pr status --pr <number>');
  }
  const result = ghJson(['pr', 'view', target, '--json', FIELDS], { cwd: rootDir });
  if (!result.ok) {
    if (result.reason === 'missing') throw fail('GitHub CLI (gh) is not installed, so the PR state cannot be read', 'GH_UNAVAILABLE', 'Install gh (https://cli.github.com), run `gh auth login`, then retry');
    if (result.reason === 'auth') throw fail('gh is not signed in, so the PR state cannot be read', 'GH_UNAVAILABLE', 'Run `gh auth login`, then retry');
    if (result.reason === 'not-found') throw fail(`No pull request found for ${target}`, 'PR_NOT_FOUND', 'Open the PR first, or pass --pr <number>');
    throw fail(`gh could not read the PR: ${result.message}`, 'GH_FAILED', 'Run the same `gh pr view` by hand to see why');
  }
  const value = result.value;
  const outcome = verdictOf(value);
  const recorded = outcome.verdict === 'merged' ? recordMerge(rootDir, runId, value) : false;
  return { pr: value.number, url: value.url, branch: value.headRefName || null, ...outcome, ...(runId ? { runId, mergeRecorded: recorded } : {}) };
}

module.exports = { branchForRun, loadMerge, prStatus, recordMerge, verdictOf };
