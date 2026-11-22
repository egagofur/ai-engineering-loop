'use strict';

// #162 freeze is a human act. #164 goal draft names the git toplevel.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { freezeGoal, saveGoalDraft } = require('../lib/goal-runtime.js');
const { assertGoalFreezeApproval, challengeToken } = require('../lib/goal-freeze-approval.js');
const HATCH = { env: { AEL_GOAL_FREEZE_OK: '1' } };
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
      () => freezeGoal(root, runId, { actor, ...HATCH }),
      (error) => error.code === 'GOAL_FREEZE_NOT_HUMAN' && /goal freeze/.test(error.fix),
      actor || '(empty)'
    );
    assert.equal(loadRun(root, runId).state, RUN_STATES.STARTED);
    assert.equal(fs.existsSync(path.join(root, '.ai-engineering-loop', 'runs', runId, 'goal-contract.json')), false);
  }
  for (const actor of ['human', 'pengguna', 'alice', 'studio-user', 'scripted-approver', 'ega']) {
    const runId = `ok-${actor}`;
    draft(root, runId);
    const frozen = freezeGoal(root, runId, { actor, ...HATCH });
    assert.equal(frozen.goal.actor, actor);
    assert.equal(frozen.state, RUN_STATES.GOAL_FROZEN);
  }
});

function box(cwdDir, { allowFreeze = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-freeze-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  if (allowFreeze) env.AEL_GOAL_FREEZE_OK = '1';
  else delete env.AEL_GOAL_FREEZE_OK;
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: cwdDir, env, encoding: 'utf8' });
  return { cli, env };
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

test('a script cannot freeze, whatever --by is; the hatch still refuses an agent name', () => {
  const root = gitRepo();
  const blocked = box(root);
  const allowed = box(root, { allowFreeze: true });
  assert.strictEqual(blocked.cli('init').status, 0);
  const started = blocked.cli('run', '--json', 'Add CSV export');
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
  assert.strictEqual(blocked.cli('goal', 'draft', '--json', '--run', runId, '--file', '.ai-engineering-loop/drafts/goal.json', '--revision', '0').status, 0);
  for (const actor of ['ael-agent', 'scripted-approver', 'pengguna', 'human', 'AEL Round3 Tester']) {
    const refused = blocked.cli('goal', 'freeze', '--json', '--latest', '--run', runId, '--by', actor, '--confirm-impact');
    assert.notStrictEqual(refused.status, 0, actor);
    const body = JSON.parse(refused.stdout);
    assert.strictEqual(body.code, 'GOAL_FREEZE_NEEDS_HUMAN', actor);
    assert.match(body.why, /non-interactive/);
    assert.match(body.fix, /Stop\./);
    assert.match(body.fix, /their own terminal/);
    assert.match(body.fix, /Do not set AEL_GOAL_FREEZE_OK/);
    assert.match(body.fix, /goal freeze --latest/);
  }
  const piped = spawnSync(process.execPath, [CLI, 'goal', 'freeze', '--json', '--latest', '--run', runId, '--by', 'pengguna'], {
    cwd: root,
    env: blocked.env,
    encoding: 'utf8',
    input: 'freeze-abcdef\n'
  });
  assert.strictEqual(JSON.parse(piped.stdout).code, 'GOAL_FREEZE_NEEDS_HUMAN');
  const missing = blocked.cli('goal', 'freeze', '--json', '--latest', '--run', runId);
  assert.strictEqual(JSON.parse(missing.stdout).code, 'GOAL_FREEZE_NEEDS_HUMAN');
  const state = JSON.parse(fs.readFileSync(path.join(root, '.ai-engineering-loop', 'runs', runId, 'state.json'), 'utf8'));
  assert.notStrictEqual(state.state, 'GOAL_FROZEN');
  const self = allowed.cli('goal', 'freeze', '--json', '--latest', '--run', runId, '--by', 'ael-agent');
  assert.strictEqual(JSON.parse(self.stdout).code, 'GOAL_FREEZE_NOT_HUMAN');
  const ok = allowed.cli('goal', 'freeze', '--json', '--latest', '--run', runId, '--by', 'pengguna');
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  assert.strictEqual(JSON.parse(ok.stdout).result.goal.actor, 'pengguna');
});

test('freezeGoal refuses a direct call with no human channel, including scripted-approver', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-freeze-channel-'));
  for (const actor of ['pengguna', 'scripted-approver', 'alice', 'studio-user']) {
    const runId = `run-${actor}`;
    draft(root, runId);
    assert.throws(
      () => freezeGoal(root, runId, { actor, env: {} }),
      (error) => error.code === 'GOAL_FREEZE_NEEDS_HUMAN' && /Do not set AEL_GOAL_FREEZE_OK/.test(error.fix)
    );
    assert.equal(loadRun(root, runId).state, RUN_STATES.STARTED);
  }
  const runId = 'studio';
  draft(root, runId);
  const frozen = freezeGoal(root, runId, { actor: 'studio-user', studioSession: true, env: {} });
  assert.equal(frozen.goal.actor, 'studio-user');
  assert.equal(frozen.state, RUN_STATES.GOAL_FROZEN);
});

test('the terminal challenge accepts only the printed token', () => {
  const token = 'freeze-abc123';
  assert.match(challengeToken(Buffer.from('abcd12', 'hex')), /^freeze-[a-f0-9]{6}$/);
  let prompted = '';
  const ok = assertGoalFreezeApproval({
    runId: 'run-1',
    actor: 'Ada Lovelace',
    env: {},
    stdin: { isTTY: true },
    stderr: { write(chunk) { prompted += chunk; } },
    readLine: () => token,
    token
  });
  assert.strictEqual(ok.via, 'tty');
  assert.match(prompted, /Ada Lovelace/);
  assert.match(prompted, new RegExp(token));
  assert.throws(
    () => assertGoalFreezeApproval({
      runId: 'run-1',
      actor: 'Ada',
      env: { AEL_GOAL_FREEZE_OK: 'true' },
      stdin: { isTTY: false },
      stderr: { write() { throw new Error('should not prompt'); } },
      readLine: () => token
    }),
    (error) => error.code === 'GOAL_FREEZE_NEEDS_HUMAN'
  );
  let reads = 0;
  assert.throws(
    () => assertGoalFreezeApproval({
      runId: 'run-1',
      actor: 'scripted-approver',
      env: {},
      stdin: { isTTY: false },
      stderr: { write() { throw new Error('should not prompt'); } },
      readLine: () => { reads += 1; return token; }
    }),
    (error) => error.code === 'GOAL_FREEZE_NEEDS_HUMAN'
  );
  assert.strictEqual(reads, 0);
  assert.strictEqual(assertGoalFreezeApproval({
    runId: 'run-1',
    actor: 'scripted-approver',
    env: { AEL_GOAL_FREEZE_OK: '1' },
    stdin: { isTTY: false },
    stderr: { write() { throw new Error('should not prompt'); } }
  }).via, 'hatch');
  assert.throws(
    () => assertGoalFreezeApproval({
      runId: 'run-1',
      actor: 'Ada',
      env: {},
      stdin: { isTTY: true },
      stderr: { write() {} },
      readLine: () => 'nope',
      token
    }),
    (error) => error.code === 'GOAL_FREEZE_NEEDS_HUMAN' && /confirmation did not match/.test(error.message)
  );
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

test('an approved freeze accepts a display name with spaces and unicode letters', () => {
  const { ACTOR_ID, HUMAN_NAME } = require('../lib/fsutil.js');
  for (const name of ['a', 'user@host', 'a.b_c-d', 'A'.repeat(64)]) {
    assert.equal(ACTOR_ID.test(name), true, name);
    assert.equal(HUMAN_NAME.test(name), true, name);
  }
  for (const name of ['AEL Round3 Tester', 'José Müller', '李明', "O'Brien"]) {
    assert.equal(HUMAN_NAME.test(name), true, name);
  }
  for (const name of ['a/b', 'a\\b', 'x'.repeat(65), 'has\nnewline']) {
    assert.equal(HUMAN_NAME.test(name), false, JSON.stringify(name));
  }
  const root = gitRepo();
  const { cli } = box(root, { allowFreeze: true });
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
  const ok = cli('goal', 'freeze', '--json', '--latest', '--run', runId, '--by', 'AEL Round3 Tester', '--confirm-impact');
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  assert.strictEqual(JSON.parse(ok.stdout).result.goal.actor, 'AEL Round3 Tester');
  const state = JSON.parse(fs.readFileSync(path.join(root, '.ai-engineering-loop', 'runs', runId, 'state.json'), 'utf8'));
  assert.strictEqual(state.goal.actor, 'AEL Round3 Tester');

  const unicodeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-freeze-name-'));
  const unicodeId = 'run-unicode';
  draft(unicodeRoot, unicodeId);
  const frozen = freezeGoal(unicodeRoot, unicodeId, { actor: 'José Müller', ...HATCH });
  assert.equal(frozen.goal.actor, 'José Müller');
  const cjkId = 'run-cjk';
  draft(unicodeRoot, cjkId);
  assert.equal(freezeGoal(unicodeRoot, cjkId, { actor: '李明', ...HATCH }).goal.actor, '李明');
  const slashId = 'run-slash';
  draft(unicodeRoot, slashId);
  assert.throws(
    () => freezeGoal(unicodeRoot, slashId, { actor: 'a/b', ...HATCH }),
    (error) => error.code === 'INVALID_GOAL_ACTOR'
  );
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
  assert.match(goal, /their own terminal/);
  assert.match(goal, /Never type that confirmation/);
  assert.match(goal, /Never set `AEL_GOAL_FREEZE_OK`/);
  assert.match(goal, /Do not search parent or sibling repos/);
  assert.match(skill, /never set `AEL_GOAL_FREEZE_OK`/);
  const hosts = fs.readFileSync(path.join(ROOT, 'skill-src', 'ael', 'references', 'loop-hosts.md'), 'utf8');
  assert.match(hosts, /Never set `AEL_GOAL_FREEZE_OK`/);
});
