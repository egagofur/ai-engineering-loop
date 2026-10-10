#!/usr/bin/env node
'use strict';

// Usage: node scripts/measure.js [--json]
// Drives three fixture scenarios (T0 docs, T1 small feature, T2 auth) through
// the real CLI in temporary repositories with a sandboxed HOME and reports, per
// scenario: parent context characters loaded, parent tool calls, subagents, and
// child context. Subagent outputs are simulated (no model is called);
// everything else is the real gated flow. Issue #35.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const SKILL_DIR = '.claude/skills/ai-engineering-loop';

// Pre-#25 baseline (v1.13.0, Claude Code, ASSISTED, one iteration) from the
// Pareto analysis: SKILL.md + command (12,960) + mandatory reads runtime-safety,
// grill-policy, tdd-policy, goal-contract (22,759); ~56 parent orchestration
// calls; every task ran DA and Judge.
const BASELINE = Object.freeze({ parentContextChars: 35719, parentCalls: 56, subagents: 2 });

const SCENARIOS = Object.freeze([
  { id: 'T0-docs', task: 'Fix typo in README', file: 'README.md', before: '# Demo\n\nTeh list helper.\n', after: '# Demo\n\nThe list helper.\n' },
  {
    id: 'T1-feature',
    task: 'Add pagination to the list helper',
    file: 'src/list.js',
    before: 'module.exports = (items) => items.slice(0, 10);\n',
    after: 'module.exports = (items, page = 1) => items.slice((page - 1) * 10, page * 10);\n'
  },
  {
    id: 'T2-auth',
    task: 'Fix auth session token refresh',
    file: 'src/auth/session.js',
    before: 'module.exports = (s) => s.token;\n',
    after: 'module.exports = (s) => (s.expiresAt > Date.now() ? s.token : null);\n'
  }
]);

function size(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function measureScenario(scenario) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-measure-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-measure-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_AUTO_UPDATE: '1' };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  const calls = [];
  let parentChars = 0;
  let projectChars = 0;
  let childChars = 0;
  let subagents = 0;

  const cli = (label, ...args) => {
    calls.push(`cli:${label}`);
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${scenario.id} ${label} failed: ${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const write = (label, rel, content) => {
    calls.push(`write:${label}`);
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  };
  const readRef = (name) => {
    calls.push(`read:${name}`);
    parentChars += size(path.join(ROOT, SKILL_DIR, 'references', `${name}.md`));
  };
  const readDoc = (name, rel) => {
    calls.push(`read:docs ${name}`);
    parentChars += size(path.join(ROOT, rel));
  };
  const readProject = (rel) => {
    calls.push(`read:${rel}`);
    projectChars += size(path.join(repo, rel));
  };
  const spawn = (agent, extraChars) => {
    calls.push(`spawn:${agent}`);
    subagents += 1;
    childChars += size(path.join(ROOT, `agents/shared/${agent}.body.md`)) + extraChars;
  };

  // Fixture repository (setup is not counted).
  fs.mkdirSync(path.join(repo, path.dirname(scenario.file)), { recursive: true });
  fs.writeFileSync(path.join(repo, scenario.file), scenario.before);
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo","scripts":{"test":"node --version"}}\n');
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.email=m@e.t', '-c', 'user.name=m', 'commit', '-qm', 'init');
  spawnSync(process.execPath, [CLI, 'init'], { cwd: repo, env, encoding: 'utf8' });
  git('add', '-A');
  git('-c', 'user.email=m@e.t', '-c', 'user.name=m', 'commit', '-qm', 'ctx', '--allow-empty');

  // The host loads SKILL.md itself (no tool call).
  parentChars += size(path.join(ROOT, SKILL_DIR, 'SKILL.md'));

  const run = JSON.parse(cli('run --json', 'run', '--json', scenario.task));
  const runDir = path.join('.ai-engineering-loop/runs', run.runId);
  readProject('.ai-engineering-loop/glossary.md');
  readProject('.ai-engineering-loop/workflow.md');

  readRef('loop-goal');
  if (run.tier === 'T2') {
    readRef('loop-risky');
    readDoc('grill-policy', 'core/grill-policy.md');
  }
  const goal = {
    schemaVersion: 1,
    runId: run.runId,
    objective: scenario.task,
    acceptanceCriteria: [{ id: 'AC-1', statement: scenario.task, evidenceRequired: 'node --version exit 0', failureCases: ['regression in existing behavior'] }]
  };
  if (run.tier === 'T0') {
    write('goal-contract.json', path.join(runDir, 'goal-contract.json'), JSON.stringify(goal));
    cli('gate goal', 'gate', 'goal');
  } else {
    write('goal draft file', '.ai-engineering-loop/goal-draft.json', JSON.stringify(goal));
    cli('goal draft', 'goal', 'draft', '--run', run.runId, '--file', '.ai-engineering-loop/goal-draft.json', '--revision', '0');
    cli('interaction question', 'interaction', 'question', '--run', run.runId, '--id', 'freeze', '--message', 'Freeze this Goal?');
    calls.push('human:freeze');
    cli('goal freeze --latest', 'goal', 'freeze', '--latest', '--run', run.runId, '--by', 'human');
  }

  // The code edit itself is task work, not orchestration.
  readRef('loop-maker');
  if (run.tier !== 'T0') readDoc('tdd-policy', 'policies/tdd-policy.md');
  fs.writeFileSync(path.join(repo, scenario.file), scenario.after);
  cli('gate maker --from-git', 'gate', 'maker', '--from-git');

  readRef('loop-verify');
  cli('verify', 'verify', '--run', run.runId, '--cmd', 'node --version', '--json');
  write('claimed-vs-reality.md', '.ai-engineering-loop/tasks/claimed-vs-reality.md', '| AC | Claimed | Reality from command log |\n|---|---|---|\n| AC-1 | done | node --version exit 0 |\n');

  const state = () => JSON.parse(fs.readFileSync(path.join(repo, runDir, 'state.json'), 'utf8'));
  const tier = () => (state().tier || {}).current;
  if (tier() !== 'T0') {
    readRef('loop-review');
    const pack = JSON.parse(cli('review-pack', 'review-pack', '--run', run.runId, '--json'));
    spawn('devil-advocate', size(path.join(repo, pack.packPath)) + size(path.join(repo, '.ai-engineering-loop/tasks/claimed-vs-reality.md')));
    cli('budget record', 'budget', 'record', '--unavailable', '--run', run.runId);
    write('findings.json', path.join(runDir, 'findings.json'), JSON.stringify({ schemaVersion: 1, runId: run.runId, diffHash: state().artifacts.diff.sha256, findings: [] }));
  }
  const review = JSON.parse(cli('gate review', 'gate', 'review', '--json'));
  if (review.judgeRequired) {
    cli('escalation', 'escalation', '--run', run.runId, '--json');
    spawn('judge', ['run-summary.md', 'verification-summary.json', 'findings.json'].reduce((n, f) => n + size(path.join(repo, runDir, f)), 0));
    cli('budget record', 'budget', 'record', '--unavailable', '--run', run.runId);
    write('verdict.json', path.join(runDir, 'verdict.json'), JSON.stringify({ schemaVersion: 1, runId: run.runId, verdict: 'PASS', reason: 'no open findings', action: 'deliver', modelTier: 'STRONG_MODEL' }));
  }
  cli('gate judge', 'gate', 'judge');

  readRef('loop-deliver');
  calls.push('human:approve delivery');
  cli('deliver', 'deliver', '--run', run.runId, '--destination', 'pr', '--summary', scenario.task, '--approve', '--by', 'human', '--json');

  return {
    id: scenario.id,
    tier: tier(),
    finalState: state().state,
    // Skill + references + specs; comparable to the baseline, which also
    // excluded the project's own living context.
    parentContextChars: parentChars,
    parentTokens: Math.round(parentChars / 4),
    projectContextChars: projectChars,
    parentCalls: calls.filter((c) => !c.startsWith('human:')).length,
    humanStops: calls.filter((c) => c.startsWith('human:')).length,
    subagents,
    childContextChars: childChars,
    calls
  };
}

function pct(after, before) {
  return `${Math.round(((after - before) / before) * 100)}%`;
}

function measureAll() {
  return { baseline: BASELINE, results: SCENARIOS.map(measureScenario) };
}

function main() {
  const report = measureAll();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('| Scenario | Tier | Final state | Skill+spec chars (~tokens) | Project ctx chars | Parent calls | Human stops | Subagents | Child chars |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of report.results) {
    console.log(`| ${r.id} | ${r.tier} | ${r.finalState} | ${r.parentContextChars} (~${r.parentTokens}) | ${r.projectContextChars} | ${r.parentCalls} | ${r.humanStops} | ${r.subagents} | ${r.childContextChars} |`);
  }
  const t1 = report.results.find((r) => r.id === 'T1-feature');
  console.log(`\nT1 vs pre-#25 baseline: skill+spec context ${BASELINE.parentContextChars} -> ${t1.parentContextChars} chars (${pct(t1.parentContextChars, BASELINE.parentContextChars)}), parent calls ${BASELINE.parentCalls} -> ${t1.parentCalls} (${pct(t1.parentCalls, BASELINE.parentCalls)}), subagents ${BASELINE.subagents} -> ${t1.subagents}.`);
}

if (require.main === module) main();

module.exports = { BASELINE, SCENARIOS, measureScenario, measureAll };
