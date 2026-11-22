'use strict';

// #163 review-pack must leave diff-hunks.json parseable. #153 verify shows the failing output.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function setupRepo() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-pack-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-pack-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/widget.js'), 'module.exports = () => "old";\n');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo","scripts":{"test":"node --version"}}\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0, cli('init').stderr);
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx', '--allow-empty');
  return { repo, cli };
}

function ok(result, label) {
  assert.strictEqual(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  return result;
}

test('review-pack keeps diff-hunks.json valid when the diff and notes contain JSON and Markdown', () => {
  const { repo, cli } = setupRepo();
  const run = JSON.parse(ok(cli('run', '--json', 'Filter widgets by name'), 'run').stdout);
  const goal = {
    schemaVersion: 1,
    runId: run.runId,
    objective: 'Filter widgets by name.',
    restatement: {
      problem: 'The list shows every widget.',
      doneWhen: 'A name filter returns only matching widgets.',
      failIf: 'The filter returns widgets whose name does not match.',
      unknowns: 'None.'
    },
    acceptanceCriteria: [{ id: 'AC-1', statement: 'A name filter returns matching widgets.', evidenceRequired: 'node --version exit 0', failureCases: ['an empty name returns every widget'] }]
  };
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop/goal-draft.json'), JSON.stringify(goal));
  ok(cli('goal', 'draft', '--json', '--run', run.runId, '--file', '.ai-engineering-loop/goal-draft.json', '--revision', '0'), 'draft');
  ok(cli('goal', 'freeze', '--json', '--latest', '--run', run.runId, '--by', 'human'), 'freeze');
  fs.writeFileSync(path.join(repo, 'src/widget.js'), 'module.exports = () => ({ hello: "hello", note: "} ## Open debt" });\n');
  ok(cli('gate', 'maker', '--from-git', '--run', run.runId), 'maker');
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop/debt.json'), JSON.stringify({
    schemaVersion: 1,
    items: [{
      id: 'old:F-1',
      file: 'src/widget.js',
      location: 'src/widget.js:1',
      debt: 'quote " and brace } and ## not json',
      whyDeferred: 'later',
      risk: 'LOW',
      status: 'open'
    }]
  }));
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop/feature-map.md'), [
    '| Feature | Where (UI or endpoint) | Paths | How to reach | Driver |',
    '|---|---|---|---|---|',
    '| widgets | Widget list | src/widget.js | open the widget list | |',
    ''
  ].join('\n'));
  ok(cli('verify', '--run', run.runId, '--cmd', 'node --version', '--json'), 'verify');
  const pack = JSON.parse(ok(cli('review-pack', '--run', run.runId, '--json'), 'review-pack').stdout);
  const file = fs.readFileSync(path.join(repo, pack.packPath), 'utf8');
  const parsed = JSON.parse(file);
  assert.ok(parsed.files.some((entry) => entry.hunks.some((hunk) => hunk.content.includes('"hello"') && hunk.content.includes('}'))));
  assert.ok(parsed.appendices.some((section) => section.includes('quote " and brace }') && section.includes('## Open debt')));
  assert.ok(parsed.appendices.some((section) => section.includes('widgets')));
  const escalation = JSON.parse(ok(cli('escalation', '--run', run.runId, '--json'), 'escalation').stdout);
  assert.strictEqual(escalation.requiredTier, 'CHEAP_MODEL');
});

test('verify prints a bounded stderr tail and the exit code when a command fails', () => {
  const { repo, cli } = setupRepo();
  const run = JSON.parse(ok(cli('run', '--json', 'Filter widgets by name'), 'run').stdout);
  const goal = {
    schemaVersion: 1,
    runId: run.runId,
    objective: 'Filter widgets by name.',
    restatement: {
      problem: 'The list shows every widget.',
      doneWhen: 'A name filter returns only matching widgets.',
      failIf: 'The filter returns widgets whose name does not match.',
      unknowns: 'None.'
    },
    acceptanceCriteria: [{ id: 'AC-1', statement: 'A name filter returns matching widgets.', evidenceRequired: 'node --version exit 0', failureCases: ['an empty name returns every widget'] }]
  };
  fs.writeFileSync(path.join(repo, '.ai-engineering-loop/goal-draft.json'), JSON.stringify(goal));
  ok(cli('goal', 'draft', '--json', '--run', run.runId, '--file', '.ai-engineering-loop/goal-draft.json', '--revision', '0'), 'draft');
  ok(cli('goal', 'freeze', '--json', '--latest', '--run', run.runId, '--by', 'human'), 'freeze');
  fs.writeFileSync(path.join(repo, 'src/widget.js'), 'module.exports = () => "next";\n');
  ok(cli('gate', 'maker', '--from-git', '--run', run.runId), 'maker');
  fs.writeFileSync(path.join(repo, 'fail.js'), 'console.error("npm error could not determine executable to run"); process.exit(1);\n');
  const failing = cli('verify', '--run', run.runId, '--cmd', 'node fail.js', '--json');
  assert.notStrictEqual(failing.status, 0);
  const body = JSON.parse(failing.stdout);
  assert.strictEqual(body.code, 'VERIFICATION_FAILED');
  assert.strictEqual(body.commands[0].exitCode, 1);
  assert.match(body.commands[0].stderrTail, /could not determine executable to run/);
  fs.writeFileSync(path.join(repo, 'fail.js'), 'console.error("stderr-tail-marker"); console.log("stdout-tail-marker"); process.exit(2);\n');
  const plain = cli('verify', '--run', run.runId, '--cmd', 'node fail.js');
  assert.notStrictEqual(plain.status, 0);
  assert.match(plain.stdout, /exit 2/);
  assert.match(plain.stdout, /stderr-tail-marker/);
  assert.match(plain.stdout, /stdout-tail-marker/);
  const state = JSON.parse(fs.readFileSync(path.join(repo, '.ai-engineering-loop/runs', run.runId, 'state.json'), 'utf8'));
  assert.notStrictEqual(state.state, 'VERIFIED');
});
