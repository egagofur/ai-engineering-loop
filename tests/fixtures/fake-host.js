#!/usr/bin/env node
'use strict';

// Fake non-interactive host for `ael bench` tests. Never calls a real model.
// Profiles (AEL_FAKE_HOST_PROFILE): compliant | skip-gate | edit-before-freeze |
// guard-block | out-of-map | bad-receipt | unavailable-usage.
// Invokes the real AEL CLI in the temp repo and prints usage JSON on stdout.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = process.env.AEL_BIN || path.join(__dirname, '..', '..', 'bin', 'ai-engineering-loop.js');
const PROFILE = process.env.AEL_FAKE_HOST_PROFILE || 'compliant';
const CWD = process.cwd();

function fail(message) {
  process.stderr.write(`fake-host: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  let model = 'fake-model';
  let prompt = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-m' || arg === '--model') {
      model = argv[index + 1] || model;
      index += 1;
    } else if (arg === '-p' && argv[index + 1] && !argv[index + 1].startsWith('-')) {
      prompt = argv[index + 1];
      index += 1;
    }
  }
  if (!prompt) {
    try {
      prompt = fs.readFileSync(0, 'utf8');
    } catch {
      prompt = '';
    }
  }
  return { model, prompt };
}

function loadScenario() {
  const file = process.env.AEL_BENCH_SCENARIO;
  if (!file || !fs.existsSync(file)) fail('AEL_BENCH_SCENARIO is missing');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseJson(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.lastIndexOf('\n{') >= 0 ? raw.lastIndexOf('\n{') + 1 : raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error(`stdout is not JSON: ${raw.slice(0, 400)}`);
  }
}

function ael(args, { allowFail = false } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: CWD,
    env: process.env,
    encoding: 'utf8'
  });
  if (!allowFail && result.status !== 0) {
    fail(`${args.join(' ')} exit ${result.status}: ${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function aelJson(args, options) {
  return parseJson(ael(args, options).stdout);
}

function write(rel, content) {
  const abs = path.join(CWD, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function applyFiles(files) {
  for (const file of files || []) write(file.path, file.content);
}

function runDir(runId) {
  return path.join(CWD, '.ai-engineering-loop', 'runs', runId);
}

function stateOf(runId) {
  return JSON.parse(fs.readFileSync(path.join(runDir(runId), 'state.json'), 'utf8'));
}

function goalBody(scenario, runId, extraAc = []) {
  const goal = scenario.goal;
  return {
    schemaVersion: 1,
    runId,
    objective: goal.objective,
    acceptanceCriteria: [...goal.acceptanceCriteria, ...extraAc]
  };
}

function startRun(scenario, { mode } = {}) {
  const runMode = (mode || process.env.AEL_BENCH_MODE || scenario.mode || 'ASSISTED').toLowerCase().replace(/_/g, '-');
  return aelJson([
    'run', '--json',
    '--mode', runMode,
    '--tier', scenario.tier,
    '--tier-reason', `bench ${scenario.id}`,
    scenario.task
  ]);
}

function freezeGoal(scenario, runId, extraAc = []) {
  const body = goalBody(scenario, runId, extraAc);
  const by = scenario.approvals?.by || 'scripted-approver';
  if (scenario.tier === 'T0') {
    write(path.join('.ai-engineering-loop', 'runs', runId, 'goal-contract.json'), `${JSON.stringify(body, null, 2)}\n`);
    ael(['gate', 'goal', '--run', runId]);
  } else {
    write('.ai-engineering-loop/goal-draft.json', `${JSON.stringify(body)}\n`);
    ael(['goal', 'draft', '--run', runId, '--file', '.ai-engineering-loop/goal-draft.json', '--revision', '0']);
    ael(['goal', 'freeze', '--latest', '--run', runId, '--by', by]);
  }
  if (scenario.approvals?.impact === 'skip') {
    ael(['impact', 'skip', '--run', runId, '--by', by, '--reason', 'docs-only']);
  } else {
    const allow = (scenario.expectedImpactPaths || []).flatMap((rel) => ['--allow', rel]);
    ael(['impact', 'confirm', '--run', runId, '--by', by, ...allow]);
  }
}

function maker(runId) {
  ael(['gate', 'maker', '--from-git', '--run', runId]);
}

function verify(scenario, runId) {
  ael(['verify', '--run', runId, '--cmd', scenario.verifyCommand || 'node --version']);
}

function fillClaimed(runId, ids) {
  const rows = ids.map((id) => `| ${id} | done | node --version exit 0 |`).join('\n');
  write('.ai-engineering-loop/tasks/claimed-vs-reality.md', `| AC | Claimed | Reality from command log |\n|---|---|---|\n${rows}\n`);
}

function reviewAndJudge(runId, tier) {
  const state = stateOf(runId);
  if (tier !== 'T0') {
    write(path.join('.ai-engineering-loop', 'runs', runId, 'findings.json'), `${JSON.stringify({
      schemaVersion: 1,
      runId,
      diffHash: state.artifacts.diff.sha256,
      findings: []
    }, null, 2)}\n`);
  }
  ael(['gate', 'review', '--run', runId]);
  if (tier === 'T2') {
    write(path.join('.ai-engineering-loop', 'runs', runId, 'verdict.json'), `${JSON.stringify({
      schemaVersion: 1,
      runId,
      verdict: 'PASS',
      reason: 'Acceptance criteria have current evidence and no blocking findings',
      action: 'Proceed to delivery',
      modelTier: 'STRONG_MODEL',
      decidedBy: 'fake-host'
    }, null, 2)}\n`);
  }
  ael(['gate', 'judge', '--run', runId]);
}

function commitWork() {
  spawnSync('git', ['add', '-A'], { cwd: CWD, encoding: 'utf8' });
  spawnSync('git', ['-c', 'user.email=bench@example.test', '-c', 'user.name=bench', 'commit', '-qm', 'bench'], {
    cwd: CWD,
    encoding: 'utf8'
  });
}

function deliver(scenario, runId, model) {
  const by = scenario.approvals?.by || 'scripted-approver';
  ael([
    'deliver', '--run', runId,
    '--destination', 'bench',
    '--summary', scenario.id,
    '--approve', '--by', by,
    '--host', 'grok',
    '--model', model
  ]);
}

function recordUsage(runId, model, { unavailable = false } = {}) {
  if (unavailable) {
    ael(['budget', 'record', '--unavailable', '--run', runId]);
    return;
  }
  ael(['budget', 'record', '--run', runId, '--input', '12', '--output', '8', '--model', model]);
}

function printUsage({ unavailable = false } = {}) {
  if (unavailable) {
    process.stdout.write(`${JSON.stringify({ usage: 'unavailable' })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ inputTokens: 12, outputTokens: 8, totalTokens: 20 })}\n`);
}

function finish(scenario, runId, model, { unavailable = false, ledger = true, usageJson = null } = {}) {
  verify(scenario, runId);
  const ids = (scenario.goal.acceptanceCriteria || []).map((item) => item.id);
  fillClaimed(runId, ids);
  reviewAndJudge(runId, scenario.tier);
  commitWork();
  deliver(scenario, runId, model);
  if (ledger) recordUsage(runId, model, { unavailable });
  if (usageJson != null) process.stdout.write(usageJson);
  else printUsage({ unavailable });
}

function writeProbe() {
  const file = process.env.AEL_BENCH_PROBE;
  if (!file) return;
  const rels = [
    '.agents/skills/ai-engineering-loop/SKILL.md',
    '.grok/skills/ai-engineering-loop/SKILL.md',
    '.claude/skills/ai-engineering-loop/SKILL.md'
  ];
  const gitignorePath = path.join(CWD, '.gitignore');
  fs.writeFileSync(file, `${JSON.stringify({
    HOME: process.env.HOME || null,
    USERPROFILE: process.env.USERPROFILE || null,
    AEL_HOME: process.env.AEL_HOME || null,
    skills: rels.filter((rel) => fs.existsSync(path.join(CWD, rel))),
    shim: fs.existsSync(path.join(CWD, 'node_modules', '.bin', 'ai-engineering-loop')),
    gitignore: fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : ''
  })}\n`);
}

function runCompliant(scenario, model) {
  const run = startRun(scenario);
  freezeGoal(scenario, run.runId);
  applyFiles(scenario.solution);
  maker(run.runId);
  finish(scenario, run.runId, model);
}

function runSkipGate(scenario, model) {
  const run = startRun(scenario);
  freezeGoal(scenario, run.runId);
  applyFiles(scenario.solution);
  maker(run.runId);
  recordUsage(run.runId, model);
  printUsage();
}

function runEditBeforeFreeze(scenario, model) {
  const run = startRun(scenario);
  applyFiles(scenario.solution);
  const now = Date.now() / 1000;
  for (const file of scenario.solution || []) {
    const abs = path.join(CWD, file.path);
    fs.utimesSync(abs, now - 5, now - 5);
  }
  freezeGoal(scenario, run.runId);
  maker(run.runId);
  finish(scenario, run.runId, model);
}

function runGuardBlock(scenario, model) {
  const run = startRun(scenario, { mode: 'UNATTENDED' });
  freezeGoal(scenario, run.runId);
  ael(['guard', 'check', '--tool', 'bash', '--command', 'git reset --hard HEAD', '--run', run.runId, '--json'], { allowFail: true });
  recordUsage(run.runId, model);
  printUsage();
}

function runOutOfMap(scenario, model) {
  const run = startRun(scenario);
  freezeGoal(scenario, run.runId);
  applyFiles(scenario.solution);
  const trap = (scenario.traps || []).find((item) => item.kind === 'out-of-scope-edit');
  if (trap?.path) write(trap.path, `${fs.existsSync(path.join(CWD, trap.path)) ? fs.readFileSync(path.join(CWD, trap.path), 'utf8') : ''}module.exports.rewritten = true;\n`);
  maker(run.runId);
  finish(scenario, run.runId, model);
}

function runBadReceipt(scenario, model) {
  const extra = [{
    id: 'AC-2',
    statement: 'a second criterion with no evidence',
    evidenceRequired: 'node --version exit 0',
    failureCases: ['missing evidence is accepted']
  }];
  const run = startRun(scenario);
  freezeGoal(scenario, run.runId, extra);
  applyFiles(scenario.solution);
  maker(run.runId);
  verify(scenario, run.runId);
  fillClaimed(run.runId, ['AC-1']);
  reviewAndJudge(run.runId, scenario.tier);
  commitWork();
  deliver(scenario, run.runId, model);
  recordUsage(run.runId, model);
  printUsage();
}

const profiles = {
  compliant: runCompliant,
  'skip-gate': runSkipGate,
  'edit-before-freeze': runEditBeforeFreeze,
  'guard-block': runGuardBlock,
  'out-of-map': runOutOfMap,
  'bad-receipt': runBadReceipt,
  'unavailable-usage': (item, id) => {
    const run = startRun(item);
    freezeGoal(item, run.runId);
    applyFiles(item.solution);
    maker(run.runId);
    finish(item, run.runId, id, { unavailable: true });
  },
  'stdout-usage': (item, id) => {
    const run = startRun(item);
    freezeGoal(item, run.runId);
    applyFiles(item.solution);
    maker(run.runId);
    finish(item, run.runId, id, {
      ledger: false,
      usageJson: `${JSON.stringify({ usage: { input_tokens: 12, output_tokens: 8 } })}\n`
    });
  }
};

writeProbe();
if (PROFILE === 'hang') {
  setInterval(() => {}, 1e9);
} else {
  const { model } = parseArgs(process.argv.slice(2));
  const scenario = loadScenario();
  const run = profiles[PROFILE];
  if (!run) fail(`unknown profile ${PROFILE}`);
  run(scenario, model);
}
