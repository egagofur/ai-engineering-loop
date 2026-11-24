'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { createRun, loadRun } = require('../lib/run-state.js');
const { freezeGoal, loadGoalDraft } = require('../lib/goal-runtime.js');
const { listRunInteractions } = require('../lib/run-interactions.js');
const { summarizeProject } = require('../lib/studio/summary.js');
const { createStudioServer } = require('../lib/studio-server.js');
const { projectId } = require('../lib/studio/instance.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');
const TOKEN = 'freeze-wait-token';

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function cliDrafted() {
  const home = tempDir('ael-freeze-wait-home-');
  const root = tempDir('ael-freeze-wait-repo-');
  spawnSync('git', ['init', '-q'], { cwd: root });
  const env = { ...process.env, HOME: home, AEL_HOME: home };
  delete env.AEL_GOAL_FREEZE_OK;
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' });
  createRun(root, { runId: 'run-1', task: 'show the freeze wait' });
  fs.mkdirSync(path.join(root, '.ai-engineering-loop', 'drafts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'drafts', 'goal.json'), JSON.stringify({
    schemaVersion: 1,
    runId: 'run-1',
    objective: 'Show the freeze wait',
    restatement: { problem: 'Studio shows the wrong wait.', doneWhen: 'Studio shows Freeze.', failIf: 'Studio shows a question.', unknowns: 'None.' },
    acceptanceCriteria: [{ id: 'AC-1', statement: 'It waits for Freeze', evidenceRequired: 'test', failureCases: ['shows a question'] }]
  }));
  const draft = cli('goal', 'draft', '--json', '--run', 'run-1', '--file', '.ai-engineering-loop/drafts/goal.json', '--revision', '0');
  assert.equal(draft.status, 0, draft.stdout + draft.stderr);
  return { home, root, cli, hash: loadGoalDraft(root, 'run-1').metadata.contentHash };
}

function waitingOf(root) {
  return summarizeProject({ id: 'p', name: 'p', path: root, worktrees: [] }).run.waiting;
}

test('a Goal drafted through `goal draft` waits for Freeze, not a question, and carries the draft hash', () => {
  const { root, hash } = cliDrafted();
  assert.equal(listRunInteractions(root, 'run-1').pending.length, 1);
  const waiting = waitingOf(root);
  assert.equal(waiting.kind, 'freeze');
  assert.equal(waiting.goalHash, hash);
});

test('another pending question still shows as a question while the draft waits', () => {
  const { root, cli } = cliDrafted();
  const asked = cli('interaction', 'question', '--run', 'run-1', '--message', 'Which database?');
  assert.equal(asked.status, 0, asked.stdout + asked.stderr);
  assert.equal(waitingOf(root).kind, 'question');
});

test('a Studio freeze closes the freeze question so the Run stops waiting', async () => {
  const { home, root, hash } = cliDrafted();
  fs.mkdirSync(path.join(home, '.ai-engineering-loop'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ai-engineering-loop', 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ path: root }] }));
  fs.writeFileSync(path.join(home, '.ai-engineering-loop', 'config.json'), JSON.stringify({ studioActor: 'Ega' }));
  const studio = createStudioServer({ home, token: TOKEN, pollMs: 60_000 });
  await new Promise((resolve) => studio.server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = studio.server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/projects/${projectId(root)}/runs/run-1/goal/freeze`, {
      method: 'POST',
      headers: { 'x-ael-studio-token': TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedHash: hash })
    });
    assert.equal(response.status, 200);
  } finally {
    await studio.close();
  }
  const { pending, questions } = listRunInteractions(root, 'run-1');
  assert.equal(pending.length, 0);
  assert.equal(questions[0].answer.actor, 'Ega');
  assert.equal(waitingOf(root), null);
});

test('a repeat CLI freeze refuses an agent-like --by and records nothing; a human repeat closes the question', () => {
  const { root, cli } = cliDrafted();
  freezeGoal(root, 'run-1', { actor: 'Ega', studioSession: true });
  const refused = cli('goal', 'freeze', '--json', '--latest', '--run', 'run-1', '--by', 'claude');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stdout + refused.stderr, /GOAL_FREEZE_NOT_HUMAN/);
  assert.equal(listRunInteractions(root, 'run-1').pending.length, 1);
  assert.equal(loadRun(root, 'run-1').goal.actor, 'Ega');
  const repeat = cli('goal', 'freeze', '--json', '--latest', '--run', 'run-1', '--by', 'Ega');
  assert.equal(repeat.status, 0, repeat.stdout + repeat.stderr);
  assert.equal(JSON.parse(repeat.stdout).alreadyFrozen, true);
  const { pending, questions } = listRunInteractions(root, 'run-1');
  assert.equal(pending.length, 0);
  assert.equal(questions[0].answer.actor, 'Ega');
});
