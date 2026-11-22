'use strict';

// `pr babysit` keeps an open PR moving after delivery. It reuses `pr status`
// (including GH_UNAVAILABLE) and the same T0/T1/T2 classifier as `run`.
// The only git write is `git push origin <branch>`. Merge stays with the human.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { classifyTier } = require('./tier.js');
const { sleepSync, writePrivateJson } = require('./fsutil.js');

const BACKOFF_MS = Object.freeze([2000, 4000, 8000, 16000, 30000]);
const MAX_POLLS = 8;

const fail = (message, code, fix, why) => Object.assign(new Error(message), { code, fix, ...(why ? { why } : {}) });

function backoffMs(waitIndex) {
  return BACKOFF_MS[Math.min(Math.max(0, waitIndex), BACKOFF_MS.length - 1)];
}

function pushArgs(branch) {
  const name = String(branch || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(name) || name.includes('..') || name.endsWith('/') || name.endsWith('.lock')) {
    throw fail(`Refusing to push "${branch || ''}"`, 'INVALID_BRANCH', 'Pass a plain branch name. pr babysit only runs `git push origin <branch>`.');
  }
  return ['push', 'origin', name];
}

function pushSameBranch(rootDir, branch) {
  const args = pushArgs(branch);
  const result = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = `${result.stderr || ''}${result.stdout || ''}`.trim().split('\n').pop() || `git exited ${result.status}`;
    throw fail(`Could not push ${branch}: ${detail}`, 'PUSH_FAILED', `git ${args.join(' ')}`);
  }
  return { pushed: true };
}

function failingCheckNames(status) {
  const line = (status?.blockers || []).find((item) => String(item).startsWith('failing-checks:'));
  if (!line) return [];
  return [...new Set(line.slice('failing-checks:'.length).split(',').map((part) => part.trim()).filter(Boolean))];
}

function fixTask(checks) {
  return `Fix failing checks: ${checks.join(', ')}`;
}

function classifyFix(checks, changedPaths = []) {
  return classifyTier({ task: fixTask(checks), changedPaths });
}

function porcelainPaths(rootDir) {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: rootDir, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return String(result.stdout || '').split('\n')
    .map((line) => line.slice(3).trim())
    .filter((line) => line && !line.startsWith('.ai-engineering-loop/'))
    .map((line) => (line.includes(' -> ') ? line.split(' -> ').pop() : line));
}

function currentBranch(rootDir) {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: rootDir, encoding: 'utf8' });
  if (result.status !== 0) return null;
  const name = String(result.stdout || '').trim();
  return name || null;
}

function decide(status, tier = null) {
  const pr = status?.pr ?? '?';
  if (status?.verdict === 'ready') {
    return { action: 'stop', reason: 'ready', message: `PR #${pr} is ready to merge. You merge it. This command stops here.` };
  }
  if ((status?.blockers || []).includes('changes-requested')) {
    return { action: 'stop', reason: 'changes-requested', message: `PR #${pr} has changes requested. Ask the human. This command stops here.` };
  }
  const checks = failingCheckNames(status);
  if (checks.length) {
    if (tier !== 'T0' && tier !== 'T1') {
      return { action: 'stop', reason: 'tier-t2', checks, message: `Failing checks (${checks.join(', ')}) classify as T2. This command only starts a T0 or T1 fix. A human takes this one.` };
    }
    return { action: 'fix', reason: 'failing-checks', checks, tier, message: '' };
  }
  if (status?.verdict === 'waiting') return { action: 'poll', reason: 'waiting', message: '' };
  if (status?.verdict === 'merged') return { action: 'stop', reason: 'merged', message: `PR #${pr} is merged.` };
  if (status?.verdict === 'closed') return { action: 'stop', reason: 'closed', message: `PR #${pr} is closed.` };
  const named = (status?.blockers || []).join(', ') || status?.verdict || 'blocked';
  return { action: 'stop', reason: 'blocker', message: `PR #${pr} is blocked (${named}). This command only starts a fix for failing checks. A human takes the rest.` };
}

function present(status, extra) {
  return {
    pr: status?.pr ?? null,
    url: status?.url ?? null,
    branch: status?.branch ?? null,
    verdict: status?.verdict ?? null,
    blockers: status?.blockers || [],
    ...(status?.waitingOn ? { waitingOn: status.waitingOn } : {}),
    ...extra
  };
}

function runDir(rootDir, runId) {
  return path.join(rootDir, '.ai-engineering-loop', 'runs', runId);
}

function readFixPass(rootDir, runId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir(rootDir, runId), 'fix-pass.json'), 'utf8'));
  } catch {
    return null;
  }
}

function sameChecks(left, right) {
  return [...left].sort().join('\0') === [...right].sort().join('\0');
}

function nextStep(tier, runId, branch, parentRunId, startedNext) {
  const stay = `Stay on ${branch}.`;
  const again = `Then: ai-engineering-loop pr babysit --run ${parentRunId}`;
  if (startedNext) return `${stay} ${startedNext} ${again}`;
  if (tier === 'T0') return `${stay} Make the fix, then: npx ai-engineering-loop quick finish --run ${runId}. ${again}`;
  return `${stay} Continue the T1 loop for Run ${runId} (Goal Contract, Maker, verify, review). ${again}`;
}

function startFixPass(rootDir, { task, checks, branch, parentRunId }) {
  const { getCurrentRun, TERMINAL_STATES } = require('./run-state.js');
  const current = getCurrentRun(rootDir);
  if (current && !TERMINAL_STATES.has(current.state)) {
    const recorded = readFixPass(rootDir, current.runId);
    if (recorded && recorded.parentRunId === parentRunId && sameChecks(recorded.checks || [], checks)) {
      const tier = current.tier?.current || recorded.tier;
      return { runId: current.runId, tier, resumed: true, next: nextStep(tier, current.runId, branch, parentRunId) };
    }
    throw fail(
      `Run ${current.runId} is still ${current.state}, so pr babysit will not start another fix pass.`,
      'ACTIVE_RUN',
      `Finish Run ${current.runId}, or abandon it, then retry \`ai-engineering-loop pr babysit --run ${parentRunId}\``,
      'One checkout keeps one unfinished Run. A fix pass waits until that Run is finished.'
    );
  }
  const started = require('./quick.js').startQuick(rootDir, { task });
  if (started.tier !== 'T0' && started.tier !== 'T1') {
    return { runId: started.runId, tier: started.tier, refused: true, next: started.next };
  }
  writePrivateJson(path.join(runDir(rootDir, started.runId), 'fix-pass.json'), {
    schemaVersion: 1,
    parentRunId,
    branch,
    tier: started.tier,
    checks
  });
  return {
    runId: started.runId,
    tier: started.tier,
    resumed: false,
    next: nextStep(started.tier, started.runId, branch, parentRunId, started.next)
  };
}

function babysit(rootDir, {
  runId = null,
  maxPolls = MAX_POLLS,
  sleep = sleepSync,
  readStatus = null,
  startFix = null,
  push = null
} = {}) {
  if (!runId) {
    throw fail('Use: pr babysit --run <id> [--json]', 'INVALID_USAGE', 'ai-engineering-loop pr babysit --run <id>');
  }
  const read = readStatus || (() => require('./pr-status.js').prStatus(rootDir, { runId }));
  const start = startFix || ((spec) => startFixPass(rootDir, spec));
  const pushFn = push || ((branch) => pushSameBranch(rootDir, branch));
  const limit = Math.max(1, Number(maxPolls) || MAX_POLLS);
  let waits = 0;
  for (let poll = 1; poll <= limit; poll += 1) {
    const status = read();
    const checks = failingCheckNames(status);
    const blockedByReview = (status.blockers || []).includes('changes-requested');
    const assessed = checks.length && !blockedByReview && status.verdict !== 'ready'
      ? classifyFix(checks, porcelainPaths(rootDir))
      : null;
    const decision = decide(status, assessed?.tier || null);
    if (decision.action === 'poll') {
      if (poll === limit) {
        return present(status, {
          action: 'waiting',
          reason: 'pending',
          message: `PR #${status.pr} is still waiting after ${poll} polls. Run pr babysit again.`,
          polls: poll,
          runId
        });
      }
      sleep(backoffMs(waits));
      waits += 1;
      continue;
    }
    if (decision.action === 'stop') {
      return present(status, {
        action: 'stop',
        reason: decision.reason,
        message: decision.message,
        polls: poll,
        runId,
        ...(assessed ? { tier: assessed.tier } : {}),
        ...(decision.checks ? { checks: decision.checks } : {})
      });
    }
    const branch = status.branch;
    pushArgs(branch);
    const here = currentBranch(rootDir);
    if (here && here !== branch) {
      return present(status, {
        action: 'stop',
        reason: 'wrong-branch',
        message: `The PR branch is ${branch} and this checkout is on ${here}. Continue on ${branch}, then run pr babysit again.`,
        next: `git checkout ${branch}`,
        polls: poll,
        runId,
        tier: decision.tier,
        checks: decision.checks
      });
    }
    const fix = start({
      task: fixTask(decision.checks),
      checks: decision.checks,
      tier: decision.tier,
      branch,
      parentRunId: runId
    });
    if (fix.refused || (fix.tier !== 'T0' && fix.tier !== 'T1')) {
      return present(status, {
        action: 'stop',
        reason: 'tier-t2',
        message: `The fix pass classified as ${fix.tier || 'T2'}. This command only continues a T0 or T1 fix. A human takes this one.`,
        polls: poll,
        runId,
        tier: fix.tier || 'T2',
        checks: decision.checks,
        ...(fix.runId ? { fixRunId: fix.runId } : {})
      });
    }
    const pushed = pushFn(branch);
    const verb = fix.resumed ? 'Continuing' : 'Started';
    return present(status, {
      action: 'fix',
      reason: 'failing-checks',
      message: `${verb} a ${fix.tier} fix pass (${fix.runId}) for ${decision.checks.join(', ')} on ${branch}. Pushed ${branch}. You merge when the PR is ready.`,
      next: fix.next,
      tier: fix.tier,
      checks: decision.checks,
      fixRunId: fix.runId,
      resumed: Boolean(fix.resumed),
      pushed: pushed?.pushed !== false,
      polls: poll,
      runId
    });
  }
  throw fail('pr babysit stopped without a decision', 'PR_BABYSIT_FAILED', 'ai-engineering-loop pr babysit --run <id>');
}

module.exports = {
  BACKOFF_MS,
  MAX_POLLS,
  backoffMs,
  babysit,
  classifyFix,
  decide,
  failingCheckNames,
  fixTask,
  pushArgs,
  pushSameBranch,
  startFixPass
};
