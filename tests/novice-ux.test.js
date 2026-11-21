'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function box({ git = true, commit = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-nux-home-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-nux-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p","scripts":{"test":"node -e 0"}}\n');
  if (git) execFileSync('git', ['init', '-q'], { cwd: dir });
  if (git && commit) execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8', input: '' });
  return { dir, home, cli };
}

const lastJson = (result) => {
  const text = String(result.stdout);
  const start = text.search(/^\{/m);
  return JSON.parse(text.slice(start));
};

test('C-48 run refuses before creating a Run when the folder is not a repo or has no commit, with a FIX command', () => {
  const plain = box({ git: false });
  const refused = plain.cli('run', '--json', 'Add export');
  assert.strictEqual(refused.status, 1);
  const out = lastJson(refused);
  assert.strictEqual(out.code, 'GIT_NOT_A_REPO');
  assert.match(out.fix, /git init/);
  assert.ok(!fs.existsSync(path.join(plain.dir, '.ai-engineering-loop', 'runs')), 'no Run created');
  const human = plain.cli('run', 'Add export');
  assert.match(human.stderr, /FIX: `git init/);
  assert.doesNotMatch(human.stdout + human.stderr, /usage: git/);

  const empty = box({ commit: false });
  assert.strictEqual(lastJson(empty.cli('run', '--json', 'Add export')).code, 'GIT_NO_COMMIT');
  assert.strictEqual(lastJson(empty.cli('quick', 'start', 'Fix typo', '--json')).code, 'GIT_NO_COMMIT');
});

test('C-48 status says git is not ready instead of claiming the context is current', () => {
  const plain = box({ git: false });
  assert.strictEqual(plain.cli('init').status, 0);
  const status = plain.cli('status');
  assert.match(status.stdout + status.stderr, /Git: NOT READY \(this folder is not a git repository\)/);
  assert.match(status.stdout, /Context Baseline Git: none/);
  assert.doesNotMatch(status.stdout, /untracke\b/);
});

test('C-54 quick start on a different task while a Run is unfinished returns RUN_CONFLICT and leaves current.json alone', () => {
  const { dir, cli } = box();
  assert.strictEqual(cli('init').status, 0);
  const first = lastJson(cli('run', '--json', 'Build the export page with filters'));
  const currentFile = path.join(dir, '.ai-engineering-loop', 'runs', 'current.json');
  const before = fs.readFileSync(currentFile, 'utf8');
  const quick = cli('quick', 'start', 'Fix typo in README', '--json');
  assert.strictEqual(quick.status, 3);
  const out = lastJson(quick);
  assert.strictEqual(out.code, 'RUN_CONFLICT');
  assert.strictEqual(out.conflict.runId, first.runId);
  assert.strictEqual(fs.readFileSync(currentFile, 'utf8'), before);
});

test('C-49 status, init and run say NOT INSTALLED until an agent has the skill, then CURRENT', () => {
  const { home, cli } = box();
  fs.mkdirSync(path.join(home, '.claude'));
  const init = cli('init');
  assert.match(init.stdout + init.stderr, /ael setup/);
  const before = cli('status');
  assert.match(before.stdout + before.stderr, /Host skills: NOT INSTALLED/);
  assert.doesNotMatch(before.stdout, /CURRENT \(0 managed/);
  const run = cli('run', 'Add export');
  assert.match(run.stdout + run.stderr, /No agent has the ael skill yet/);
  assert.doesNotMatch(run.stdout, /AI Agent Ready/);
  const sync = cli('sync-hosts');
  assert.strictEqual(sync.status, 0, sync.stdout + sync.stderr);
  const after = cli('status');
  assert.match(after.stdout, /Host skills: CURRENT/);
});

test('C-50 scaffold goal, edit, goal draft and goal freeze work with no hand-written JSON shape', () => {
  const { dir, cli } = box();
  assert.strictEqual(cli('init').status, 0);
  const run = lastJson(cli('run', '--json', 'Add CSV export'));
  const missing = cli('goal', 'draft', '--run', run.runId, '--json');
  assert.match(lastJson(missing).fix, /scaffold goal/);
  const scaffold = lastJson(cli('scaffold', 'goal', '--json'));
  assert.strictEqual(scaffold.path, '.ai-engineering-loop/drafts/goal.json');
  const file = path.join(dir, scaffold.path);
  const template = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(template.runId, run.runId);
  const refused = cli('goal', 'draft', '--run', run.runId, '--file', scaffold.path, '--revision', '0', '--json');
  assert.strictEqual(lastJson(refused).code, 'TEMPLATE_ONLY');
  const filled = { ...template, acceptanceCriteria: [{ id: 'AC-1', statement: 'Export downloads a CSV of the filtered rows', evidenceRequired: 'unit test output', failureCases: ['CSV ignores the filter'] }], outOfScope: ['PDF export'] };
  delete filled._templateOnly;
  delete filled._howTo;
  fs.writeFileSync(file, JSON.stringify(filled));
  const draft = cli('goal', 'draft', '--run', run.runId, '--file', scaffold.path, '--revision', '0', '--json');
  assert.strictEqual(draft.status, 0, draft.stdout + draft.stderr);
  assert.doesNotMatch(draft.stderr, /outside \.ai-engineering-loop/);
  const freeze = cli('goal', 'freeze', '--run', run.runId, '--latest', '--by', 'human', '--json');
  assert.strictEqual(freeze.status, 0, freeze.stdout + freeze.stderr);
});

test('C-50 docs --section lists the sections that exist when the name is wrong', () => {
  const { cli } = box();
  const out = cli('docs', 'goal-contract', '--section', 'No such heading');
  assert.match(out.stdout + out.stderr, /Sections: .*JSON example for `goal draft`/);
});
