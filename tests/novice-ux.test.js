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
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1', AEL_GOAL_FREEZE_OK: '1' };
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

test('C-53 stage-order errors name the next ready stage; gate judge after a pass is a no-op', () => {
  const { dir, cli } = box();
  assert.strictEqual(cli('init').status, 0);
  lastJson(cli('run', '--json', 'Add export page'));
  const early = lastJson(cli('deliver', '--json', '--destination', 'pr', '--summary', 'x', '--approve', '--by', 'e'));
  assert.strictEqual(early.code, 'NODE_NOT_READY');
  assert.ok(early.why);
  assert.match(early.fix, /Next ready stage is 'goal'/);
  const quick = box();
  fs.writeFileSync(path.join(quick.dir, 'README.md'), '# Demo\n\nThe demmo.\n');
  execFileSync('git', ['add', '-A'], { cwd: quick.dir });
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'readme'], { cwd: quick.dir });
  assert.strictEqual(quick.cli('init').status, 0);
  const start = lastJson(quick.cli('quick', 'start', 'Fix typo in README', '--json'));
  fs.writeFileSync(path.join(quick.dir, 'README.md'), '# fixed\n');
  assert.strictEqual(lastJson(quick.cli('quick', 'finish', '--run', start.runId, '--cmd', 'node --version', '--json')).state, 'JUDGED_PASS');
  const again = quick.cli('gate', 'judge', '--json');
  assert.strictEqual(again.status, 0, again.stdout);
  assert.strictEqual(lastJson(again).alreadyPassed, true);
  assert.ok(dir);
});

test('C-53 review ingest on prose explains the ledger it needs', () => {
  const { extractLedger } = require('../lib/review-ingest.js');
  assert.strictEqual(extractLedger('Looks fine to me, no issues.'), null);
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'review-ingest.js'), 'utf8');
  assert.match(source, /NO_LEDGER_IN_OUTPUT'\), \{\r?\n\s+why:/);
});

test('C-52 CLI basics: unknown command, help, bare ael, empty run, gate without a name', () => {
  const { dir, cli } = box();
  const typo = cli('int');
  assert.strictEqual(typo.status, 2);
  assert.match(typo.stderr + typo.stdout, /Unknown command: int\. Did you mean `init`\?/);
  assert.ok(typo.stdout.split('\n').length < 10, 'no help dump');
  const help = cli('help');
  assert.strictEqual(help.status, 0);
  assert.ok(help.stdout.split('\n').length <= 30, `short help, got ${help.stdout.split('\n').length} lines`);
  assert.match(help.stdout, /ael setup/);
  assert.match(cli('help', 'run').stdout, /^Usage: npx ai-engineering-loop run/);
  assert.match(cli('help', '--all').stdout, /generate-adapter/);
  const bare = cli();
  assert.strictEqual(bare.status, 0);
  assert.match(bare.stdout, /Pick one:[\s\S]*ael init[\s\S]*Nothing was written/);
  assert.ok(!fs.existsSync(path.join(dir, '.ai-engineering-loop')), 'bare ael writes nothing');
  assert.strictEqual(cli('init').status, 0);
  const empty = cli('run', '--json');
  assert.strictEqual(lastJson(empty).code, 'INVALID_USAGE');
  assert.match(lastJson(empty).fix, /run "/);
  const gate = cli('gate', '--json');
  assert.strictEqual(lastJson(gate).code, 'INVALID_USAGE');
  assert.match(cli().stdout, /Status: READY/, 'bare ael in an initialised project shows status');
});

test('C-51 doctor is about the machine: git, identity, agent skill, gh login, each with a FIX; package checks need --package', () => {
  const { home, dir, cli } = box();
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:a/b.git'], { cwd: dir });
  assert.strictEqual(cli('init').status, 0);
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1', GIT_CONFIG_GLOBAL: path.join(home, 'none'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: '', GIT_AUTHOR_EMAIL: '' };
  const doctor = spawnSync(process.execPath, [CLI, 'doctor', '--json'], { cwd: dir, env, encoding: 'utf8' });
  const result = JSON.parse(doctor.stdout);
  assert.strictEqual(result.scope, 'machine');
  const byId = Object.fromEntries(result.checks.map((check) => [check.id, check]));
  assert.match(byId['git-identity'].detail, /FIX: `git config --global user.name/);
  assert.match(byId['agent-skill'].detail, /FIX: `ael setup`/);
  assert.ok(!byId['evaluation-catalog'], 'package checks are not shown to users');
  const text = spawnSync(process.execPath, [CLI, 'doctor'], { cwd: dir, env, encoding: 'utf8' });
  assert.match(text.stdout, /READY \(warnings\)|NOT READY/);
  const pkg = JSON.parse(spawnSync(process.execPath, [CLI, 'doctor', '--package', '--json'], { cwd: dir, env, encoding: 'utf8' }).stdout);
  assert.ok(pkg.checks.some((check) => check.id === 'evaluation-catalog'));
});

test('C-56 no colour codes outside a terminal, and init says when it found no manifest', () => {
  const { dir, cli } = box();
  fs.unlinkSync(path.join(dir, 'package.json'));
  const init = cli('init');
  assert.strictEqual(init.status, 0);
  assert.doesNotMatch(init.stdout, /\x1b\[/);
  assert.match(init.stdout, /No manifest found/);
  assert.doesNotMatch(init.stdout, /Unit Test Command: npm test/);
});

test('host decisions are asked with the host option UI, with a numbered fallback', () => {
  const root = path.join(__dirname, '..');
  const skill = fs.readFileSync(path.join(root, '.agents', 'skills', 'ael', 'SKILL.md'), 'utf8');
  assert.match(skill, /Never infer human approval; ask with host buttons \(`loop-hosts`\)/);
  const hosts = fs.readFileSync(path.join(root, '.agents', 'skills', 'ael', 'references', 'loop-hosts.md'), 'utf8');
  assert.match(hosts, /## Asking the human/);
  assert.match(hosts, /AskUserQuestion/);
  assert.match(hosts, /Antigravity/);
  assert.match(hosts, /numbered list with the exact words to reply/);
});

test('short help lists every routed command, including gate, context and review', () => {
  const source = fs.readFileSync(CLI, 'utf8');
  const routed = [...new Set([...source.matchAll(/^ {2}case '([a-z][\w-]*)':/gm)].map((match) => match[1]))];
  const line = spawnSync(process.execPath, [CLI, 'help'], { encoding: 'utf8' }).stdout.trim().split('\n').pop();
  const names = new Set(line.replace(/^All commands:\s*/, '').split(/,\s*/));
  assert.ok(names.has('gate') && names.has('context') && names.has('review') && names.has('outcome'));
  assert.deepStrictEqual(routed.filter((name) => !names.has(name)), ['rules'], 'only the internal rules alias stays unlisted');
});
