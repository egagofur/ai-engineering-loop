'use strict';

// #162 freeze is a human act. #164 goal draft names the git toplevel.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { freezeGoal, saveGoalDraft } = require('../lib/goal-runtime.js');
const { createRun, loadRun, RUN_STATES } = require('../lib/run-state.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');
const ROOT = path.join(__dirname, '..');

function contract(runId) {
  return {
    schemaVersion: 1,
    runId,
    objective: 'Implement safe local runtime',
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'The local transition is authenticated',
      evidenceRequired: 'API test',
      failureCases: ['unauthenticated requests are rejected']
    }]
  };
}

function draft(root, runId) {
  createRun(root, { runId, task: 'runtime' });
  saveGoalDraft(root, runId, contract(runId), { actor: 'agent', expectedRevision: 0 });
}

test('goal freeze rejects agent-like and empty actors and keeps the draft unfrozen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-freeze-actor-'));
  const refused = ['', '   ', 'agent', 'Agent', 'ael-agent', 'AEL-AGENT', 'my-agent', 'deepseek-flash', 'claude-sonnet', 'gpt-4o', 'opencode', 'assistant', 'bot'];
  for (const actor of refused) {
    const runId = `run-${refused.indexOf(actor)}`;
    draft(root, runId);
    assert.throws(
      () => freezeGoal(root, runId, { actor }),
      (error) => error.code === 'GOAL_FREEZE_NOT_HUMAN' && /goal freeze/.test(error.fix),
      actor || '(empty)'
    );
    assert.equal(loadRun(root, runId).state, RUN_STATES.STARTED);
    assert.equal(fs.existsSync(path.join(root, '.ai-engineering-loop', 'runs', runId, 'goal-contract.json')), false);
  }
  for (const actor of ['human', 'pengguna', 'alice', 'studio-user', 'scripted-approver', 'ega']) {
    const runId = `ok-${actor}`;
    draft(root, runId);
    const frozen = freezeGoal(root, runId, { actor });
    assert.equal(frozen.goal.actor, actor);
    assert.equal(frozen.state, RUN_STATES.GOAL_FROZEN);
  }
});

function box(cwdDir) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-freeze-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: cwdDir, env, encoding: 'utf8' });
  return { cli };
}

function gitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-repo-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"p","scripts":{"test":"node -e 0"}}\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'add', '-A'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: root });
  return root;
}

const RESTATE = {
  problem: 'People cannot take the filtered rows out of the report.',
  doneWhen: 'Export saves a CSV of only the filtered rows.',
  failIf: 'The CSV still contains rows the filter hid.',
  unknowns: 'None.'
};

test('CLI freeze refuses ael-agent and a missing --by, and accepts the human name', () => {
  const root = gitRepo();
  const { cli } = box(root);
  assert.strictEqual(cli('init').status, 0);
  const started = cli('run', '--json', 'Add CSV export');
  const runId = JSON.parse(started.stdout.slice(started.stdout.search(/^\{/m))).runId;
  const goal = {
    schemaVersion: 1,
    runId,
    objective: 'Export the filtered report as CSV.',
    restatement: RESTATE,
    acceptanceCriteria: [{ id: 'AC-1', statement: 'Export saves only the filtered rows.', evidenceRequired: 'unit test', failureCases: ['The CSV ignores the filter.'] }]
  };
  fs.mkdirSync(path.join(root, '.ai-engineering-loop', 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'drafts', 'goal.json'), JSON.stringify(goal));
  assert.strictEqual(cli('goal', 'draft', '--json', '--run', runId, '--file', '.ai-engineering-loop/drafts/goal.json', '--revision', '0').status, 0);
  const self = cli('goal', 'freeze', '--json', '--latest', '--run', runId, '--by', 'ael-agent', '--confirm-impact');
  assert.notStrictEqual(self.status, 0);
  const body = JSON.parse(self.stdout);
  assert.strictEqual(body.code, 'GOAL_FREEZE_NOT_HUMAN');
  assert.match(body.why, /human/);
  assert.match(body.fix, /goal freeze --latest/);
  const state = JSON.parse(fs.readFileSync(path.join(root, '.ai-engineering-loop', 'runs', runId, 'state.json'), 'utf8'));
  assert.notStrictEqual(state.state, 'GOAL_FROZEN');
  const missing = cli('goal', 'freeze', '--json', '--latest', '--run', runId);
  assert.strictEqual(JSON.parse(missing.stdout).code, 'GOAL_FREEZE_NOT_HUMAN');
  const ok = cli('goal', 'freeze', '--json', '--latest', '--run', runId, '--by', 'pengguna');
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  assert.strictEqual(JSON.parse(ok.stdout).result.goal.actor, 'pengguna');
});

test('goal draft prints the git toplevel, including when the command runs from a subdirectory', () => {
  const root = gitRepo();
  const app = path.join(root, 'app');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'package.json'), '{"name":"app","scripts":{"test":"node -e 0"}}\n');
  const { cli } = box(app);
  assert.strictEqual(cli('init').status, 0);
  const started = cli('run', '--json', 'Add CSV export');
  const runId = JSON.parse(started.stdout.slice(started.stdout.search(/^\{/m))).runId;
  const goal = {
    schemaVersion: 1,
    runId,
    objective: 'Export the filtered report as CSV.',
    restatement: RESTATE,
    acceptanceCriteria: [{ id: 'AC-1', statement: 'Export saves only the filtered rows.', evidenceRequired: 'unit test', failureCases: ['The CSV ignores the filter.'] }]
  };
  fs.mkdirSync(path.join(app, '.ai-engineering-loop', 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(app, '.ai-engineering-loop', 'drafts', 'goal.json'), JSON.stringify(goal));
  const draft = cli('goal', 'draft', '--json', '--run', runId, '--file', '.ai-engineering-loop/drafts/goal.json', '--revision', '0');
  assert.strictEqual(draft.status, 0, draft.stdout + draft.stderr);
  const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: app, encoding: 'utf8' }).trim();
  const body = JSON.parse(draft.stdout);
  assert.strictEqual(body.repoRoot, toplevel);
  assert.notStrictEqual(body.repoRoot, app);
  const plain = cli('goal', 'draft', '--run', runId, '--file', '.ai-engineering-loop/drafts/goal.json', '--revision', '1');
  assert.match(plain.stdout, new RegExp(`- Repo: ${toplevel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('the skill tells the agent to wait on a cancelled question and to pin the repo', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'skill-src', 'ael', 'SKILL.template.md'), 'utf8');
  const overlay = fs.readFileSync(path.join(ROOT, 'skill-src', 'ael', 'overlay.md'), 'utf8');
  const goal = fs.readFileSync(path.join(ROOT, 'skill-src', 'ael', 'references', 'loop-goal.md'), 'utf8');
  assert.match(skill, /Never infer human approval; ask with host buttons \(`loop-hosts`\)/);
  assert.match(skill, /cancelled or unanswered question: stop and wait; never freeze yourself/);
  assert.match(skill, /git toplevel is the project the human named/);
  assert.match(overlay, /please add/);
  assert.match(overlay, /please fix/);
  assert.match(overlay, /fix this bug/);
  assert.match(overlay, /build this feature/);
  assert.match(overlay, /tambahin fitur/);
  assert.match(overlay, /Use AI Engineering Loop/);
  assert.match(overlay, /just change this line/);
  assert.match(goal, /git rev-parse --show-toplevel/);
  assert.match(goal, /repoRoot/);
  assert.match(goal, /never `agent`, `ael-agent`/);
  assert.match(goal, /Never freeze yourself/);
  assert.match(goal, /Do not search parent or sibling repos/);
});
