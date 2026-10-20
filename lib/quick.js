'use strict';

// `quick start|finish`: the T0 path in two calls. Each step is the regular
// CLI command run as a child process, so every gate behaves exactly as in the
// long form; quick only removes the hand-written glue between them.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { extractChangedPaths } = require('./escalation.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');
const CLAIMED_PATH = '.ai-engineering-loop/tasks/claimed-vs-reality.md';

function quickError(message, code, details = []) {
  return Object.assign(new Error(message), { code, details });
}

function invoke(rootDir, args) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--json'], {
    cwd: rootDir,
    env: { ...process.env, AEL_NO_AUTO_UPDATE: '1' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  const lines = String(result.stdout || '').trim().split('\n');
  let parsed = null;
  for (let index = lines.length - 1; index >= 0 && !parsed; index -= 1) {
    try {
      parsed = JSON.parse(lines.slice(index).join('\n'));
    } catch {
      // keep widening until the trailing JSON document parses
    }
  }
  if (result.status !== 0 || !parsed || parsed.ok === false) {
    const message = parsed?.error || String(result.stderr || result.stdout || 'command failed').trim().split('\n').pop();
    throw quickError(`\`${args.slice(0, 2).join(' ')}\` failed: ${message}`, parsed?.code || 'QUICK_STEP_FAILED', parsed?.details || []);
  }
  return parsed;
}

function oneLine(value, limit = 300) {
  return String(value || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function quickGoal(runId, task) {
  return {
    schemaVersion: 1,
    runId,
    objective: oneLine(task, 500),
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: `The change does exactly what the task says: ${oneLine(task, 200)}`,
      evidenceRequired: 'verify command output (exit 0) and the gated diff',
      failureCases: [
        'files unrelated to the task are changed',
        'the verification command fails'
      ]
    }],
    derivedBy: 'quick start (T0)'
  };
}

function startQuick(rootDir, { task, mode = null } = {}) {
  if (!String(task || '').trim()) throw quickError('quick start needs a task: quick start "<task>"', 'INVALID_USAGE');
  const run = invoke(rootDir, ['run', '--new', ...(mode ? ['--mode', mode] : []), task]);
  if (run.tier !== 'T0') {
    return {
      ok: true,
      runId: run.runId,
      tier: run.tier,
      quick: false,
      learnings: run.learnings || [],
      next: `Tier ${run.tier} is not trivial; continue the normal loop for Run ${run.runId} (Goal Contract, Maker, verify, review).`
    };
  }
  const runDir = path.join(rootDir, '.ai-engineering-loop', 'runs', run.runId);
  fs.writeFileSync(path.join(runDir, 'goal-contract.json'), `${JSON.stringify(quickGoal(run.runId, task), null, 2)}\n`, { mode: 0o600 });
  const gate = invoke(rootDir, ['gate', 'goal', '--run', run.runId]);
  return {
    ok: true,
    runId: run.runId,
    tier: 'T0',
    quick: true,
    state: gate.state,
    learnings: run.learnings || [],
    next: `Make the change, then: npx ai-engineering-loop quick finish --run ${run.runId}`
  };
}

function writeClaimedVsReality(rootDir, { changedPaths, commands }) {
  const reality = commands
    .map((c) => `\`${oneLine(c.command, 120)}\` exit ${c.exitCode}${c.testCounts ? ` (${c.testCounts.passed ?? '?'} passed, ${c.testCounts.failed ?? 0} failed)` : ''}`)
    .join('; ');
  const claimed = `Changed ${changedPaths.length} file(s): ${changedPaths.slice(0, 10).join(', ')}${changedPaths.length > 10 ? ', …' : ''}`;
  const text = [
    '# Claimed vs Reality',
    '',
    '> Written by `quick finish` from the gated diff and the recorded verification output.',
    '',
    '| AC | Claimed | Reality from command log |',
    '|---|---|---|',
    `| AC-1 | ${oneLine(claimed, 600)} | ${oneLine(reality, 600)} |`,
    ''
  ].join('\n');
  const filePath = path.join(rootDir, CLAIMED_PATH);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, text, { mode: 0o600 });
  return CLAIMED_PATH;
}

function finishQuick(rootDir, { runId, commands = [], shell = false, serial = false, timeoutMs = null } = {}) {
  const runArgs = runId ? ['--run', runId] : [];
  const maker = invoke(rootDir, ['gate', 'maker', '--from-git', ...runArgs]);
  const id = maker.runId;
  if (maker.tier && maker.tier !== 'T0') {
    return {
      ok: false,
      code: 'TIER_RAISED',
      runId: id,
      tier: maker.tier,
      state: maker.state,
      next: `The diff raised the tier to ${maker.tier}. Continue the normal loop: verify --run ${id}, then the Devil's Advocate review.`
    };
  }
  const verify = invoke(rootDir, [
    'verify', '--run', id,
    ...commands.flatMap((command) => ['--cmd', command]),
    ...(shell ? ['--shell'] : []),
    ...(serial ? ['--serial'] : []),
    ...(timeoutMs ? ['--timeout-ms', String(timeoutMs)] : [])
  ]);
  const diffPath = path.join(rootDir, '.ai-engineering-loop', 'runs', id, 'diff.patch');
  const changedPaths = [...new Set(extractChangedPaths(fs.readFileSync(diffPath, 'utf8')))];
  const claimed = writeClaimedVsReality(rootDir, { changedPaths, commands: verify.commands.map((c) => ({ ...c, testCounts: verify.testCounts })) });
  invoke(rootDir, ['gate', 'review', '--run', id]);
  const judge = invoke(rootDir, ['gate', 'judge', '--run', id]);
  return {
    ok: true,
    runId: id,
    tier: 'T0',
    state: judge.state,
    commands: verify.commands,
    changedPaths,
    claimedVsReality: claimed,
    next: judge.state === 'JUDGED_PASS'
      ? `After the human approves: npx ai-engineering-loop deliver --run ${id} --destination <where> --summary "<text>" --approve --by <name>`
      : `Judge returned ${judge.state}; fix and run quick finish again.`
  };
}

module.exports = { startQuick, finishQuick, quickGoal };
