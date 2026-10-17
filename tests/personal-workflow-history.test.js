'use strict';

// Issue #81 ACs 1 and 5-8: no-task onboarding text, read-only suggest,
// precedence (project-required > personal > built-in), and secret-free
// workflow-history.jsonl. Sandboxed HOME/AEL_HOME and temp repos only.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sandbox() {
  const home = tmp('ael-pwh-home-');
  const aelHome = tmp('ael-pwh-ael-');
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    AEL_HOME: aelHome,
    AEL_NO_AUTO_UPDATE: '1',
    AEL_NO_SETUP_HINT: '1'
  };
  delete env.CI;
  return { home, aelHome, env, dirs: [home, aelHome] };
}

function repo(box) {
  const dir = tmp('ael-pwh-repo-');
  box.dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p"}\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const result = cli(box, dir, ['init']);
  assert.equal(result.status, 0, result.stderr);
  return dir;
}

function cleanup(box) {
  for (const dir of box.dirs) fs.rmSync(dir, { recursive: true, force: true });
}

function cli(box, cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, env: box.env, encoding: 'utf8', input: '' });
}

function ok(result, label) {
  assert.equal(result.status, 0, `${label}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function stateDir(box) {
  return path.join(box.aelHome, '.ai-engineering-loop');
}

function historyPath(box) {
  return path.join(stateDir(box), 'workflow-history.jsonl');
}

function setWorkflowPolicy(dir, workflow) {
  const file = path.join(dir, '.ai-engineering-loop', 'runtime-policy.json');
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, `${JSON.stringify({ ...current, workflow }, null, 2)}\n`);
}

function installPersonal(box, dir) {
  const answers = path.join(box.home, 'answers.json');
  fs.writeFileSync(answers, JSON.stringify({ usualTier: 'T1', mode: 'ASSISTED', makerIntern: 'none' }));
  const proposed = ok(cli(box, dir, ['workflow', 'propose', '--answers', answers, '--json']), 'propose');
  ok(cli(box, dir, ['workflow', 'accept', '--proposal', proposed.id, '--by', 'ada', '--json']), 'accept');
  fs.rmSync(answers);
}

function startRun(box, dir, extra = []) {
  return ok(cli(box, dir, ['run', '--json', '--new', ...extra, 'Add pagination to the list helper']), `run ${extra.join(' ')}`);
}

function hashTree(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      if (entry.isDirectory()) walk(abs);
      else out[rel] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

function seedHistory(box, rows) {
  fs.mkdirSync(stateDir(box), { recursive: true });
  fs.appendFileSync(historyPath(box), rows.map((row) => `${JSON.stringify({ schemaVersion: 1, ...row })}\n`).join(''));
}

function t1Rows(prefix, drifted, clean) {
  const rows = [];
  for (let index = 0; index < clean; index += 1) {
    rows.push({ runId: `${prefix}-clean-${index}`, state: 'DELIVERED', mode: 'ASSISTED', tier: 'T1', outOfMapCount: 0 });
  }
  for (let index = 0; index < drifted; index += 1) {
    rows.push({ runId: `${prefix}-drift-${index}`, state: 'DELIVERED', mode: 'ASSISTED', tier: 'T1', outOfMapCount: 2 });
  }
  return rows;
}

test('AC 1: the no-task branch offers the personal workflow without creating a Run', () => {
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'ai-engineering-loop', 'SKILL.md'), 'utf8');
  assert.match(skill, /No task: offer `workflow interview` or a task; no Run\./);
  const commands = fs.readFileSync(path.join(ROOT, 'skill-src', 'ai-engineering-loop', 'references', 'loop-commands.md'), 'utf8');
  assert.match(commands, /Do not create a Run or edit files/);
  assert.match(commands, /workflow accept --proposal <id> --by <name>/);
  assert.match(commands, /Never accept for the user/);
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals', 'cases', '25-no-task-onboarding.json'), 'utf8'));
  assert.deepEqual(fixture.oracle.requiredSignals, ['no-run-created', 'workflow-onboarding-offer']);

  const box = sandbox();
  try {
    const dir = repo(box);
    const before = hashTree(path.join(dir, '.ai-engineering-loop'));
    const body = ok(cli(box, dir, ['workflow', 'interview', '--json']), 'interview');
    assert.ok(body.questions.length > 0);
    assert.deepEqual(hashTree(path.join(dir, '.ai-engineering-loop')), before);
    assert.equal(fs.existsSync(path.join(dir, '.ai-engineering-loop', 'runs', 'current.json')), false);
  } finally {
    cleanup(box);
  }
});

test('AC 5: workflow suggest is read-only, cites evidence, and keeps a rejected proposal quiet until evidence grows', () => {
  const box = sandbox();
  try {
    const dir = repo(box);
    installPersonal(box, dir);
    seedHistory(box, t1Rows('a', 4, 6));
    const projectBefore = hashTree(path.join(dir, '.ai-engineering-loop'));
    const personalBefore = hashTree(path.join(stateDir(box), 'workflow'));
    const configBefore = hashTree(path.join(stateDir(box), 'config.json').replace(/config\.json$/, ''));
    const proposalsBefore = fs.readdirSync(path.join(stateDir(box), 'workflow-proposals')).sort();

    const first = ok(cli(box, dir, ['workflow', 'suggest', '--json']), 'suggest 1');
    const checkpoint = first.proposals.find((item) => item.kind === 'impact-checkpoint-t1');
    assert.ok(checkpoint, JSON.stringify(first));
    assert.equal(checkpoint.status, 'pending');
    assert.deepEqual(checkpoint.evidence.runIds, ['a-drift-0', 'a-drift-1', 'a-drift-2', 'a-drift-3']);
    assert.equal(checkpoint.evidence.counts.drifted, 4);
    assert.equal(checkpoint.evidence.counts.window, 10);
    for (const proposal of first.proposals) assert.ok(proposal.evidence.runIds.length > 0, proposal.kind);

    assert.deepEqual(hashTree(path.join(dir, '.ai-engineering-loop')), projectBefore);
    assert.deepEqual(hashTree(path.join(stateDir(box), 'workflow')), personalBefore);
    const after = hashTree(stateDir(box));
    const changed = Object.keys(after).filter((rel) => configBefore[rel] !== after[rel]);
    assert.ok(changed.length > 0);
    for (const rel of changed) assert.match(rel, /^workflow-proposals\//, rel);
    const added = fs.readdirSync(path.join(stateDir(box), 'workflow-proposals')).filter((name) => !proposalsBefore.includes(name));
    assert.equal(added.length, first.proposals.length);

    const again = ok(cli(box, dir, ['workflow', 'suggest', '--json']), 'suggest while pending');
    assert.equal(again.proposals.some((item) => item.kind === 'impact-checkpoint-t1'), false);

    ok(cli(box, dir, ['workflow', 'reject', '--proposal', checkpoint.id, '--by', 'ada', '--json']), 'reject');
    const quiet = ok(cli(box, dir, ['workflow', 'suggest', '--json']), 'suggest after reject');
    assert.equal(quiet.proposals.some((item) => item.kind === 'impact-checkpoint-t1'), false);

    seedHistory(box, t1Rows('b', 2, 0));
    const louder = ok(cli(box, dir, ['workflow', 'suggest', '--json']), 'suggest with new evidence');
    const reemitted = louder.proposals.find((item) => item.kind === 'impact-checkpoint-t1');
    assert.ok(reemitted, JSON.stringify(louder));
    assert.ok(reemitted.evidence.runIds.length > checkpoint.evidence.runIds.length);
    assert.notEqual(reemitted.id, checkpoint.id);
  } finally {
    cleanup(box);
  }
});

test('AC 6: a full run plus suggest never changes recipes; only workflow accept installs one', () => {
  const box = sandbox();
  try {
    const dir = repo(box);
    installPersonal(box, dir);
    const personalBefore = hashTree(path.join(stateDir(box), 'workflow'));
    const recipesBefore = hashTree(path.join(dir, '.ai-engineering-loop', 'recipes'));
    const builtinsBefore = hashTree(path.join(ROOT, 'recipes'));
    const run = startRun(box, dir);
    ok(cli(box, dir, ['run', '--abandon', '--run', run.runId, '--reason', 'test', '--by', 'ada', '--yes', '--json']), 'abandon');
    seedHistory(box, t1Rows('c', 4, 6));
    ok(cli(box, dir, ['workflow', 'suggest', '--json']), 'suggest');
    assert.deepEqual(hashTree(path.join(stateDir(box), 'workflow')), personalBefore);
    assert.deepEqual(hashTree(path.join(dir, '.ai-engineering-loop', 'recipes')), recipesBefore);
    assert.deepEqual(hashTree(path.join(ROOT, 'recipes')), builtinsBefore);
  } finally {
    cleanup(box);
  }
});

test('AC 7: run resolves project-required > personal > built-in and reports workflowSource', () => {
  const box = sandbox();
  try {
    const plain = repo(box);
    const pinned = repo(box);
    const closed = repo(box);
    const rows = [];
    const resolve = (label, dir, extra) => {
      const body = startRun(box, dir, extra);
      rows.push(label);
      ok(cli(box, dir, ['run', '--abandon', '--run', body.runId, '--reason', 'test', '--by', 'ada', '--yes', '--json']), `abandon ${label}`);
      return body;
    };

    let body = resolve('no personal', plain, []);
    assert.equal(body.workflowSource, 'builtin');
    assert.equal(body.recipe, 'default');
    body = resolve('report-only', plain, ['--mode', 'report-only']);
    assert.equal(body.workflowSource, 'builtin');
    assert.equal(body.recipe, 'audit');

    installPersonal(box, plain);
    setWorkflowPolicy(pinned, { requiredRecipe: 'high-risk' });
    setWorkflowPolicy(closed, { allowPersonal: false });

    body = resolve('personal', plain, []);
    assert.equal(body.workflowSource, 'personal');
    assert.equal(body.recipe, 'personal');
    body = resolve('required recipe', pinned, []);
    assert.equal(body.workflowSource, 'project-required');
    assert.equal(body.recipe, 'high-risk');
    body = resolve('required beats --recipe', pinned, ['--recipe', 'bugfix']);
    assert.equal(body.workflowSource, 'project-required');
    assert.equal(body.recipe, 'high-risk');
    body = resolve('allowPersonal false', closed, []);
    assert.equal(body.workflowSource, 'project-required');
    assert.equal(body.recipe, 'default');
    body = resolve('explicit recipe', plain, ['--recipe', 'bugfix']);
    assert.equal(body.recipe, 'bugfix');
    assert.notEqual(body.workflowSource, 'personal');
    assert.equal(rows.length, 7);
  } finally {
    cleanup(box);
  }
});

test('AC 8: workflow-history.jsonl summaries hold counts and a repo hash, never task text, paths, or secrets', () => {
  const box = sandbox();
  try {
    const dir = repo(box);
    const canary = 'sk-live-CANARY0123456789abcdefABCDEF';
    const pathCanary = 'src/secret-canary-dir/customer-ledger.js';
    const run = ok(cli(box, dir, [
      'run', '--json', '--new', `Rotate ${canary} used by ${pathCanary}`
    ]), 'run with canary');
    ok(cli(box, dir, ['run', '--abandon', '--run', run.runId, '--reason', `cleanup ${canary}`, '--by', 'ada', '--yes', '--json']), 'abandon');
    const text = fs.readFileSync(historyPath(box), 'utf8');
    const lines = text.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(lines.length, 1);
    const [row] = lines;
    assert.equal(row.runId, run.runId);
    assert.equal(row.state, 'CANCELLED');
    assert.equal(row.workflowSource, 'builtin');
    assert.match(row.repoHash, /^[a-f0-9]{64}$/);
    for (const forbidden of [canary, 'CANARY', pathCanary, 'secret-canary-dir', 'Rotate', 'pagination', dir, fs.realpathSync(dir), box.home]) {
      assert.equal(text.includes(forbidden), false, `history leaked ${forbidden}`);
    }
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'task'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'reason'), false);
    const mode = fs.statSync(historyPath(box)).mode & 0o777;
    if (process.platform !== 'win32') assert.equal(mode, 0o600);
  } finally {
    cleanup(box);
  }
});
